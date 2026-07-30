from __future__ import annotations

import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import text


MIGRATION_PATTERN = re.compile(r"^(\d{3})_.+\.sql$")
SEED_MIGRATION_MARKER = "_seed_"


def _sequence_prefix(path: Path) -> str:
    match = MIGRATION_PATTERN.match(path.name)
    assert match is not None  # filtered by MIGRATION_PATTERN before this is called
    return match.group(1)


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
        (
            path
            for path in directory.iterdir()
            if path.is_file()
            and MIGRATION_PATTERN.match(path.name)
            and (include_seed or SEED_MIGRATION_MARKER not in path.name)
        ),
        # Explicit ordering key: numeric prefix first, filename as tie-break
        # for the (historical, already-applied) migrations that share a
        # number. This is equivalent to the old plain-filename sort for the
        # existing zero-padded 3-digit prefixes, but makes the intent
        # explicit instead of relying on that being a coincidence.
        key=lambda path: (_sequence_prefix(path), path.name),
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


def validate_no_new_duplicate_sequence_numbers(
    migrations: list[SqlMigration], applied: dict[str, str]
) -> None:
    """A number of historical migrations share a numeric prefix (e.g. 003,
    004, 024, 032-034, 038, 041) - they're already applied, in that exact
    filename form, to real environments, so renaming them now would make the
    ledger (keyed by filename) treat them as brand-new and try to re-run
    already-applied SQL. Those are left alone.

    This only guards the future: a *new*, not-yet-applied migration must not
    reuse a number some other migration (applied or not) already uses. Reusing
    a number silently makes execution order depend on incidental alphabetical
    sorting between two unrelated files instead of an explicit decision.
    """
    by_number: dict[str, list[str]] = {}
    for migration in migrations:
        match = MIGRATION_PATTERN.match(migration.filename)
        if not match:
            continue
        by_number.setdefault(match.group(1), []).append(migration.filename)

    for number, filenames in by_number.items():
        if len(filenames) < 2:
            continue
        new_filenames = [name for name in filenames if name not in applied]
        if not new_filenames:
            continue  # every file sharing this number is already applied - historical, leave it
        raise RuntimeError(
            f"New migration(s) {new_filenames} reuse sequence number {number}, "
            f"already used by {sorted(set(filenames) - set(new_filenames)) or filenames}. "
            "Give new migrations the next unused sequence number instead."
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


LEDGER_TRIGGER_HARDENING_SQL = """
DROP TRIGGER IF EXISTS trg_audit_aegis_migration_log ON core.aegis_migration_log;
"""


def allow_schema_adoption_from_environment() -> bool:
    """Whether an empty ledger may be auto-certified as "fully migrated" based
    on RAW_SCHEMA_ADOPTION_MARKERS. This only checks 5 markers against a
    corpus of dozens of migrations with real RLS/GRANT differences, so a
    near-miss schema (missing one policy from an unrelated migration) could
    otherwise be falsely certified as fully migrated with nothing ever
    detecting the gap. Requiring an explicit opt-in turns that into a
    deliberate one-time decision instead of something that fires silently
    whenever the ledger table happens to be empty (e.g. after a botched
    ledger reset)."""
    return os.getenv("AEGIS_ALLOW_SCHEMA_ADOPTION", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }


RAW_SCHEMA_ADOPTION_MARKERS = (
    "select to_regclass('core.organizations') is not null",
    "select to_regclass('core.domain_events') is not null",
    "select to_regclass('compliance.corrective_actions') is not null",
    """
    select exists (
        select 1
        from information_schema.columns
        where table_schema = 'compliance'
          and table_name = 'deployment_gate_checks'
          and column_name = 'override_by'
    )
    """,
    "select exists (select 1 from core.permissions where key = 'users.delete')",
)


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
    raw_conn = await conn.get_raw_connection()
    await raw_conn.driver_connection.execute(LEDGER_DDL)
    await raw_conn.driver_connection.execute(LEDGER_TRIGGER_HARDENING_SQL)


async def applied_migrations(conn) -> dict[str, str]:
    result = await conn.execute(
        text("SELECT filename, checksum FROM core.aegis_migration_log;")
    )
    return {row.filename: row.checksum for row in result}


async def has_adoptable_raw_schema(conn) -> bool:
    for marker in RAW_SCHEMA_ADOPTION_MARKERS:
        if not await conn.scalar(text(marker)):
            return False
    return True


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
    await ensure_migration_log(conn)
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
    validate_no_new_duplicate_sequence_numbers(migrations, applied)
    applied_now: list[str] = []

    if (
        not applied
        and allow_schema_adoption_from_environment()
        and await has_adoptable_raw_schema(conn)
    ):
        for migration in migrations:
            await record_migration(
                conn,
                migration,
                alembic_revision=alembic_revision,
                applied_by=f"{applied_by}-adopted",
            )
        return []

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
    execute_driver_sql_sync(conn, LEDGER_DDL)
    execute_driver_sql_sync(conn, LEDGER_TRIGGER_HARDENING_SQL)


def applied_migrations_sync(conn) -> dict[str, str]:
    result = conn.execute(
        text("SELECT filename, checksum FROM core.aegis_migration_log;")
    )
    return {row.filename: row.checksum for row in result}


def has_adoptable_raw_schema_sync(conn) -> bool:
    for marker in RAW_SCHEMA_ADOPTION_MARKERS:
        if not conn.execute(text(marker)).scalar():
            return False
    return True


def execute_sql_file_sync(conn, path: Path) -> None:
    execute_driver_sql_sync(conn, path.read_text(encoding="utf-8"))


def execute_driver_sql_sync(conn, sql: str) -> None:
    adapted_connection = getattr(conn.connection, "dbapi_connection", None)
    if adapted_connection is not None and hasattr(adapted_connection, "run_async"):
        adapted_connection.run_async(lambda driver_connection: driver_connection.execute(sql))
        return

    conn.exec_driver_sql(sql)


def record_migration_sync(
    conn,
    migration: SqlMigration,
    *,
    alembic_revision: str | None = None,
    applied_by: str = "alembic",
    update_existing: bool = False,
) -> None:
    ensure_migration_log_sync(conn)
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
    validate_no_new_duplicate_sequence_numbers(migrations, applied)
    applied_now: list[str] = []

    if (
        not applied
        and allow_schema_adoption_from_environment()
        and has_adoptable_raw_schema_sync(conn)
    ):
        for migration in migrations:
            record_migration_sync(
                conn,
                migration,
                alembic_revision=alembic_revision,
                applied_by=f"{applied_by}-adopted",
            )
        return []

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

