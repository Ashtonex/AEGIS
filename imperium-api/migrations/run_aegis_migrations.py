import argparse
import asyncio
import os
import sys
from pathlib import Path

from sqlalchemy.ext.asyncio import create_async_engine

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
sys.path.append(os.path.abspath(os.path.dirname(__file__)))

from core.config import settings  # noqa: E402
from migration_ledger import (  # noqa: E402
    apply_pending_migrations,
    discover_migrations,
    ensure_migration_log,
)


async def run(plan_only: bool = False, include_seed: bool = False) -> None:
    migrations_dir = Path(__file__).resolve().parent
    migration_files = discover_migrations(migrations_dir, include_seed=include_seed)
    if plan_only:
        print("AEGIS migration plan:")
        for migration in migration_files:
            print(f"- {migration.sequence_number:03d} {migration.filename}")
        return

    engine = create_async_engine(
        settings.DATABASE_URL,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )

    async with engine.connect() as conn:
        try:
            await ensure_migration_log(conn)
            await conn.commit()
            applied_now = await apply_pending_migrations(conn, migration_files)
            await conn.commit()
        except Exception:
            await conn.rollback()
            raise

    await engine.dispose()
    if applied_now:
        for filename in applied_now:
            print(f"Applied migration: {filename}")
    else:
        print("No pending AEGIS migrations.")
    print("AEGIS migrations completed successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run AEGIS SQL migrations.")
    parser.add_argument(
        "--plan",
        action="store_true",
        help="List discovered migrations without connecting to the database.",
    )
    parser.add_argument(
        "--include-seed",
        action="store_true",
        help="Include explicit seed migrations. Excluded by default for safety.",
    )
    args = parser.parse_args()
    asyncio.run(run(plan_only=args.plan, include_seed=args.include_seed))


if __name__ == "__main__":
    main()
