import importlib.util
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "migrations"
ALEMBIC_REVISION = (
    ROOT
    / "alembic"
    / "versions"
    / "aegis_raw_sql_20260717_align_raw_sql_ledger.py"
)

sys.path.append(str(MIGRATIONS_DIR))

from migration_ledger import (  # noqa: E402
    discover_all_raw_migrations,
    discover_migrations,
)


def test_raw_sql_manifest_covers_every_sql_migration_file():
    sql_files = sorted(path.name for path in MIGRATIONS_DIR.glob("*.sql"))
    discovered = [
        migration.filename
        for migration in discover_all_raw_migrations(MIGRATIONS_DIR)
    ]

    assert discovered == sql_files
    discovered_names = {
        migration.filename
        for migration in discover_all_raw_migrations(MIGRATIONS_DIR)
    }
    assert len(discovered_names) == len(sql_files)


def test_default_migration_plan_excludes_explicit_seed_file_only():
    all_files = [
        migration.filename
        for migration in discover_all_raw_migrations(MIGRATIONS_DIR)
    ]
    default_files = [
        migration.filename
        for migration in discover_migrations(MIGRATIONS_DIR)
    ]

    assert "003_seed_test_user.sql" in all_files
    assert "003_seed_test_user.sql" not in default_files
    assert default_files == [
        filename for filename in all_files if "_seed_" not in filename
    ]


def test_alembic_bridge_uses_shared_raw_sql_ledger():
    spec = importlib.util.spec_from_file_location(
        "aegis_raw_sql_revision",
        ALEMBIC_REVISION,
    )
    assert spec is not None
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    assert module.revision == "aegis_raw_sql_20260717"
    assert module.down_revision is None
    assert module.MIGRATIONS_DIR == MIGRATIONS_DIR
    assert module.discover_migrations is discover_migrations

