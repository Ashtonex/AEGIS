from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from supabase import create_client, Client
from core.config import settings
from typing import AsyncGenerator

# SQLAlchemy Async Engine
engine = create_async_engine(
    settings.DATABASE_URL, 
    echo=(settings.ENVIRONMENT == "development"),
    future=True
)

# Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine, 
    class_=AsyncSession, 
    expire_on_commit=False,
    autocommit=False,
    autoflush=False
)

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for injecting SQLAlchemy AsyncSessions."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

# Supabase Client Initialization
# Utilizes the Service Role Key to bypass RLS when performing privileged backend operations.
supabase: Client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
