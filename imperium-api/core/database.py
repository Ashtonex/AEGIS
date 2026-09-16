from typing import AsyncGenerator

from sqlalchemy import event, text
from sqlalchemy.exc import TimeoutError as SATimeoutError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from supabase import Client, create_client

from core.config import settings
from core.logging import logger

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
#
# pool_size/max_overflow are read from settings (default 10/10, same 20
# total proven above) rather than hardcoded, so a multi-worker deployment
# can size each process's pool down and keep the same proven aggregate
# ceiling across all workers combined - see DB_POOL_SIZE's docstring in
# core/config.py.
_APP_DATABASE_URL = settings.DATABASE_URL.replace(":5432/", ":6543/")

engine = create_async_engine(
    _APP_DATABASE_URL,
    echo=(settings.ENVIRONMENT == "development" and settings.DEBUG),
    future=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
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


# ----------------------------------------------------------------------------
# Pool instrumentation (AEGIS audit item 1.1 follow-up). The audit's literal
# recommendation - acquire/release the DB connection per query instead of per
# request - is a correctness-risky rewrite across ~1,565 call sites (it can
# silently split a write endpoint's multi-statement transaction into several
# non-atomic ones). Before attempting that, measure whether pool exhaustion
# under get_db()'s current per-request session is actually still happening
# now that a smaller per-worker pool (1.2) and Redis auth caching (1.3, which
# removes most of the auth-tax queries that used to hold the connection
# during every request) are in place. No such measurement existed before -
# this only observes, it changes no behavior for callers.
_pool = engine.sync_engine.pool
_POOL_CAPACITY = settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW
_POOL_WARN_RATIO = 0.8


def pool_status() -> dict:
    checked_out = _pool.checkedout()
    return {
        "checked_out": checked_out,
        "capacity": _POOL_CAPACITY,
        "checked_in": _pool.checkedin(),
        "overflow": _pool.overflow(),
    }


@event.listens_for(engine.sync_engine, "checkout")
def _log_pool_pressure(dbapi_connection, connection_record, connection_proxy) -> None:
    checked_out = _pool.checkedout()
    if checked_out >= _POOL_CAPACITY * _POOL_WARN_RATIO:
        logger.warning(
            "db_pool_near_capacity",
            checked_out=checked_out,
            capacity=_POOL_CAPACITY,
            overflow=_pool.overflow(),
        )


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except SATimeoutError:
            # This is the failure mode root cause 2 predicted: every slot in
            # this worker's pool was checked out and a new request waited the
            # full pool_timeout (SQLAlchemy default 30s) without getting one.
            # Logged with pool_status() so it's visible whether this is a
            # live problem, not just a theoretical one from the audit.
            logger.error("db_pool_checkout_timeout", **pool_status())
            raise
        finally:
            await session.close()


async def check_database_health() -> dict:
    async with AsyncSessionLocal() as session:
        result = await session.execute(text("SELECT 1"))
        return {"status": "ok", "database": "postgresql", "result": result.scalar_one()}


supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
