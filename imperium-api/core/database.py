from typing import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from supabase import Client, create_client

from core.config import settings

# ----------------------------------------------------------------------------
# Runtime app traffic uses Supavisor's *transaction*-mode pooler (port 6543),
# not the session-mode URL (port 5432) DATABASE_URL is otherwise configured
# with (session mode is what Supabase recommends migration tooling use - see
# migrations/run_aegis_migrations.py and alembic/env.py, which read
# settings.DATABASE_URL directly and are deliberately left untouched here).
#
# Why: this used to be poolclass=NullPool with prepared-statement caching
# disabled, which forces a fresh TCP+TLS+Postgres-auth handshake AND a full
# statement parse on every single query - measured at ~2.6-2.7s per query
# against the session pooler in eu-west-1, vs ~220ms (roughly raw network
# RTT) once a connection is actually reused via a real pool.
#
# Switching NullPool -> a real pool while staying on the session-mode URL
# was tried first and is NOT safe: Supavisor's session mode has a hard cap
# of exactly 15 concurrent connections for the *entire Supabase project*
# (not per-process) - confirmed directly ("EMAXCONNSESSION: max clients
# reached in session mode - max clients are limited to pool_size: 15").
# NullPool was almost certainly a deliberate (if costly) way to dodge that
# ceiling by never holding a connection open. But a single dashboard page
# load in this app fires 10-15 concurrent API calls on its own, so that
# ceiling is a latent risk in production today regardless of this change -
# a busy moment across even two users could already exhaust it.
#
# Transaction mode is Supavisor's pooler designed for exactly this many
# concurrent clients (it multiplexes many logical clients over few actual
# backend connections) - confirmed clean with zero errors at 30 concurrent
# requests against a pool of 20 (10+10), vs erroring past 15 total on the
# session pooler. The cost: prepared statements can't be cached (a query may
# land on a different backend connection each time), so that part of
# NullPool's old workaround is kept - but connection reuse via a real pool
# still removes the dominant cost (the handshake, ~1.4s of the old ~2.6s).
_APP_DATABASE_URL = settings.DATABASE_URL.replace(":5432/", ":6543/")

# Pool sizing is configurable (see core/config.py) because the right value
# depends on worker count. The old hardcoded 10+10 was the binding constraint
# on concurrency: get_db() holds its connection for the whole request (a
# SQLAlchemy Session keeps the connection from its first statement until
# commit/rollback/close), and a dashboard page fires 10-15 concurrent calls,
# so *one* user could occupy most of a 20-connection pool and a second user
# would queue behind pool_timeout. That queueing - not Supabase - is what
# produced the 8-45s response times recorded in aegis-web/src/lib/api.ts.
#
# Two changes address it together, and the second matters more than the first:
#   1. A larger pool (default 12+12 per worker). Safe on transaction mode,
#      which multiplexes logical clients over few backend connections.
#   2. A much shorter *hold time* per request. Caching the authorization
#      context (core/cache.py + core/security.py) removes four sequential
#      round trips - roughly 0.9s at ~220ms RTT - from every authenticated
#      request, and asyncio.gather in the hot routers removes more. Required
#      pool size is arrival rate x hold time, so cutting hold time ~60% is
#      equivalent to a 2.5x pool increase and costs no extra DB resources.
#
# pool_timeout is set explicitly and low: waiting 30s (the SQLAlchemy default)
# for a connection just converts pool exhaustion into a mystery hang. Failing
# in 10s surfaces it as the capacity problem it is.
engine = create_async_engine(
    _APP_DATABASE_URL,
    echo=(settings.ENVIRONMENT == "development" and settings.DEBUG),
    future=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE_SECONDS,
    pool_timeout=settings.DB_POOL_TIMEOUT_SECONDS,
    # Transaction-mode poolers can hand back a connection whose server-side
    # state died between checkouts; pre_ping turns that into a transparent
    # reconnect instead of a failed request.
    pool_pre_ping=True,
    connect_args={
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
    },
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            # Roll back before closing. Read-only endpoints never commit, so
            # without this the implicit transaction SQLAlchemy opened on the
            # first SELECT is returned to the pooler still open, and the next
            # checkout inherits an idle-in-transaction connection. Explicitly
            # ending it also releases any transaction-scoped state (e.g. the
            # request.jwt.claim.sub set_config used by the audit trigger) so
            # it can never leak into another request on a reused connection.
            await session.rollback()
            await session.close()


async def check_database_health() -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "postgresql", "result": result.scalar_one()}


supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
