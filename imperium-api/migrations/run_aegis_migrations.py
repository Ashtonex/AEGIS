import argparse
import asyncio
import hashlib
import os
import re
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from core.config import settings  # noqa: E402


MIGRATION_PATTERN = re.compile(r"^\d{3}_.+\.sql$")


def discover_migrations(migrations_dir: Path, include_seed: bool = False) -> list[Path]:
    return sorted(
        path
        for path in migrations_dir.iterdir()
        if path.is_file() and MIGRATION_PATTERN.match(path.name)
        and (include_seed or "_seed_" not in path.name)
    )


def checksum_for(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


async def ensure_migration_log(conn) -> None:
    await conn.execute(text("CREATE SCHEMA IF NOT EXISTS core;"))
    await conn.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS core.aegis_migration_log (
                filename text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            );
            """
        )
    )


async def applied_migrations(conn) -> dict[str, str]:
    result = await conn.execute(text("SELECT filename, checksum FROM core.aegis_migration_log;"))
    return {row.filename: row.checksum for row in result}


async def execute_sql_file(conn, path: Path) -> None:
    sql_content = path.read_text(encoding="utf-8")
    raw_conn = await conn.get_raw_connection()
    await raw_conn.driver_connection.execute(sql_content)


async def run(plan_only: bool = False, include_seed: bool = False) -> None:
    migrations_dir = Path(__file__).resolve().parent
    migration_files = discover_migrations(migrations_dir, include_seed=include_seed)
    if plan_only:
        print("AEGIS migration plan:")
        for path in migration_files:
            print(f"- {path.name}")
        return

    engine = create_async_engine(
        settings.DATABASE_URL,
        connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0},
    )

    async with engine.connect() as conn:
        await ensure_migration_log(conn)
        await conn.commit()
        applied = await applied_migrations(conn)

        for path in migration_files:
            checksum = checksum_for(path)
            if applied.get(path.name) == checksum:
                print(f"Skipping already-applied migration: {path.name}")
                continue
            if path.name in applied and applied[path.name] != checksum:
                raise RuntimeError(
                    f"Migration checksum changed after application: {path.name}"
                )

            print(f"Applying migration: {path.name}")
            try:
                await execute_sql_file(conn, path)
                await conn.execute(
                    text(
                        """
                        INSERT INTO core.aegis_migration_log (filename, checksum)
                        VALUES (:filename, :checksum);
                        """
                    ),
                    {"filename": path.name, "checksum": checksum},
                )
                await conn.commit()
            except Exception:
                await conn.rollback()
                raise

    await engine.dispose()
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
