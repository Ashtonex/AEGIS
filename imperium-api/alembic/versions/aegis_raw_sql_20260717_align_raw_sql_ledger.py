"""align raw SQL migration ledger

Revision ID: aegis_raw_sql_20260717
Revises:
Create Date: 2026-07-17 00:00:00.000000

"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Sequence, Union

from alembic import op


revision: str = "aegis_raw_sql_20260717"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = ("raw_sql_ledger",)
depends_on: Union[str, Sequence[str], None] = None


MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"
sys.path.append(str(MIGRATIONS_DIR))

from migration_ledger import (  # noqa: E402
    apply_pending_migrations_sync,
    discover_migrations,
    include_seed_from_environment,
)


def upgrade() -> None:
    """Apply and ledger the raw SQL migration corpus through Alembic."""
    migrations = discover_migrations(
        MIGRATIONS_DIR,
        include_seed=include_seed_from_environment(),
    )
    apply_pending_migrations_sync(
        op.get_bind(),
        migrations,
        alembic_revision=revision,
        applied_by="alembic",
    )


def downgrade() -> None:
    """Raw SQL migrations are intentionally not auto-reversible."""
    raise NotImplementedError(
        "AEGIS raw SQL migrations are forward-only; restore from backup for rollback."
    )

