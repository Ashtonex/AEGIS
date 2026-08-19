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

engine = create_async_engine(
    _APP_DATABASE_URL,
    echo=(settings.ENVIRONMENT == "development" and settings.DEBUG),
    future=True,
    pool_size=10,
    max_overflow=10,
    pool_recycle=180,
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
            await session.close()


async def check_database_health() -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "postgresql", "result": result.scalar_one()}


supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
