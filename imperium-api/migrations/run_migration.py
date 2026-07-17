import asyncio
import os
import sys

# Ensure core and app can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from core.config import settings


async def run():
    print("Running database migrations...")
    engine = create_async_engine(
        settings.DATABASE_URL,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )

    async with engine.connect() as conn:
        try:
            print("Adding whatsapp_preference to crm.contacts...")
            await conn.execute(
                text(
                    "ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS whatsapp_preference BOOLEAN DEFAULT FALSE;"
                )
            )
            print("Adding whatsapp_preferred to crm.contacts...")
            await conn.execute(
                text(
                    "ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS whatsapp_preferred BOOLEAN DEFAULT FALSE;"
                )
            )
            await conn.commit()
            print("Migration completed successfully.")
        except Exception as e:
            await conn.rollback()
            print(f"Error executing migration: {e}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
