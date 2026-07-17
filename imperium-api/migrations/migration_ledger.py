from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text


MIGRATION_PATTERN = re.compile(r"^\d{3}_.+\.sql$")
SEED_MIGRATION_MARKER = "_seed_"


@dataclass(frozen=True)
class SqlMigration:
    sequence_number: int
    path: Path
    checksum: str

    @property
    def filename(self) -> str:
        return self.path.name


def migrations_dir() -> Path:
    return Path(__file__).resolve().parent


def include_seed_from_environment() -> bool:
    return os.getenv("AEGIS_INCLUDE_SEED_MIGRATIONS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


def checksum_for(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def discover_migrations(
    migrations_directory: Path | None = None,
    *,
    include_seed: bool = False,
) -> list[SqlMigration]:
    directory = migrations_directory or migrations_dir()
    paths = sorted(
        path
        for path in directory.iterdir()
        if path.is_file()
        and MIGRATION_PATTERN.match(path.name)
        and (include_seed or SEED_MIGRATION_MARKER not in path.name)
    )
    return [
        SqlMigration(sequence_number=index, path=path, checksum=checksum_for(path))
        for index, path in enumerate(paths, start=1)
    ]


def discover_all_raw_migrations(
    migrations_directory: Path | None = None,
) -> list[SqlMigration]:
    return discover_migrations(migrations_directory, include_seed=True)


def validate_unique_filenames(migrations: list[SqlMigration]) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for migration in migrations:
        if migration.filename in seen:
            duplicates.add(migration.filename)
        seen.add(migration.filename)
    if duplicates:
        raise RuntimeError(
            "Duplicate migration filenames are not allowed: "
            + ", ".join(sorted(duplicates))
        )


LEDGER_DDL = """
CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.aegis_migration_log (
    filename text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE core.aegis_migration_log
    ADD COLUMN IF NOT EXISTS sequence_number integer;

ALTER TABLE core.aegis_migration_log
    ADD COLUMN IF NOT EXISTS alembic_revision text;

ALTER TABLE core.aegis_migration_log
    ADD COLUMN IF NOT EXISTS applied_by text NOT NULL DEFAULT 'raw-sql-runner';
"""


def _record_sql(*, update_existing: bool) -> str:
    conflict_action = (
        """
        DO UPDATE SET
            sequence_number = EXCLUDED.sequence_number,
            alembic_revision = COALESCE(
                EXCLUDED.alembic_revision,
                core.aegis_migration_log.alembic_revision
            ),
            applied_by = CASE
                WHEN core.aegis_migration_log.applied_by = 'raw-sql-runner'
                THEN EXCLUDED.applied_by
                ELSE core.aegis_migration_log.applied_by
            END
        """
        if update_existing
        else "DO NOTHING"
    )
    return f"""
        INSERT INTO core.aegis_migration_log (
            filename,
            checksum,
            sequence_number,
            alembic_revision,
            applied_by
        )
        VALUES (
            :filename,
            :checksum,
            :sequence_number,
            :alembic_revision,
            :applied_by
        )
        ON CONFLICT (filename) {conflict_action};
    """


def _raise_if_checksum_changed(filename: str, existing: str, current: str) -> None:
    if existing != current:
        raise RuntimeError(f"Migration checksum changed after application: {filename}")


async def ensure_migration_log(conn) -> None:
    await conn.execute(text(LEDGER_DDL))


async def applied_migrations(conn) -> dict[str, str]:
    result = await conn.execute(
        text("SELECT filename, checksum FROM core.aegis_migration_log;")
    )
    return {row.filename: row.checksum for row in result}


async def execute_sql_file(conn, path: Path) -> None:
    sql_content = path.read_text(encoding="utf-8")
    raw_conn = await conn.get_raw_connection()
    await raw_conn.driver_connection.execute(sql_content)


async def record_migration(
    conn,
    migration: SqlMigration,
    *,
    alembic_revision: str | None = None,
    applied_by: str = "raw-sql-runner",
    update_existing: bool = False,
) -> None:
    await conn.execute(
        text(_record_sql(update_existing=update_existing)),
        {
            "filename": migration.filename,
            "checksum": migration.checksum,
            "sequence_number": migration.sequence_number,
            "alembic_revision": alembic_revision,
            "applied_by": applied_by,
        },
    )


async def apply_pending_migrations(
    conn,
    migrations: list[SqlMigration],
    *,
    alembic_revision: str | None = None,
    applied_by: str = "raw-sql-runner",
) -> list[str]:
    validate_unique_filenames(migrations)
    await ensure_migration_log(conn)
    applied = await applied_migrations(conn)
    applied_now: list[str] = []

    for migration in migrations:
        existing_checksum = applied.get(migration.filename)
        if existing_checksum is not None:
            _raise_if_checksum_changed(
                migration.filename, existing_checksum, migration.checksum
            )
            await record_migration(
                conn,
                migration,
                alembic_revision=alembic_revision,
                applied_by=applied_by,
                update_existing=True,
            )
            continue

        await execute_sql_file(conn, migration.path)
        await record_migration(
            conn,
            migration,
            alembic_revision=alembic_revision,
            applied_by=applied_by,
        )
        applied_now.append(migration.filename)

    return applied_now


def ensure_migration_log_sync(conn) -> None:
    conn.exec_driver_sql(LEDGER_DDL)


def applied_migrations_sync(conn) -> dict[str, str]:
    result = conn.execute(
        text("SELECT filename, checksum FROM core.aegis_migration_log;")
    )
    return {row.filename: row.checksum for row in result}


def execute_sql_file_sync(conn, path: Path) -> None:
    conn.exec_driver_sql(path.read_text(encoding="utf-8"))


def record_migration_sync(
    conn,
    migration: SqlMigration,
    *,
    alembic_revision: str | None = None,
    applied_by: str = "alembic",
    update_existing: bool = False,
) -> None:
    conn.execute(
        text(_record_sql(update_existing=update_existing)),
        {
            "filename": migration.filename,
            "checksum": migration.checksum,
            "sequence_number": migration.sequence_number,
            "alembic_revision": alembic_revision,
            "applied_by": applied_by,
        },
    )


def apply_pending_migrations_sync(
    conn,
    migrations: list[SqlMigration],
    *,
    alembic_revision: str | None = None,
    applied_by: str = "alembic",
) -> list[str]:
    validate_unique_filenames(migrations)
    ensure_migration_log_sync(conn)
    applied = applied_migrations_sync(conn)
    applied_now: list[str] = []

    for migration in migrations:
        existing_checksum = applied.get(migration.filename)
        if existing_checksum is not None:
            _raise_if_checksum_changed(
                migration.filename, existing_checksum, migration.checksum
            )
            record_migration_sync(
                conn,
                migration,
                alembic_revision=alembic_revision,
                applied_by=applied_by,
                update_existing=True,
            )
            continue

        execute_sql_file_sync(conn, migration.path)
        record_migration_sync(
            conn,
            migration,
            alembic_revision=alembic_revision,
            applied_by=applied_by,
        )
        applied_now.append(migration.filename)

    return applied_now
