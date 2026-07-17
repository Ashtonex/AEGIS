"""Shared tenant-scoped reference validation utility.

Every module that needs to verify that a foreign key points to a real,
non-deleted record in a specific table for the current organisation must
use this helper.  Keeps validation logic in one place and prevents
accidental cross-tenant data leakage.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.shared.sql import tenant_reference_sql

# Whitelist of tables that may be validated by this utility.
# Add new tables here as modules are implemented.
_ALLOWED_TABLES: frozenset[str] = frozenset(
    {
        # Core
        "core.users",
        "core.documents",
        # Projects
        "projects.projects",
        "projects.sites",
        "projects.daily_site_reports",
        # HR
        "hr.employees",
        # Fleet
        "fleet.fleet",
        # Procurement
        "procurement.inventory_items",
        "procurement.stores",
        "procurement.suppliers",
        "procurement.purchase_requisitions",
        "procurement.purchase_orders",
        "procurement.goods_received_notes",
        # Finance
        "finance.cost_codes",
        "finance.project_budgets",
        # Compliance (future schema)
        "compliance.obligations",
    }
)


async def tenant_reference(
    db: AsyncSession,
    table: str,
    record_id: Optional[UUID | str],
    org_id: str,
    label: str,
) -> None:
    """Assert that *record_id* exists in *table* for *org_id*.

    Args:
        db: Active async SQLAlchemy session.
        table: Fully-qualified schema.table name (must be in allowlist).
        record_id: UUID of the record to verify.  If ``None``, the check
            is silently skipped.
        org_id: Organisation UUID string for tenant scoping.
        label: Human-readable name used in 404 error messages.

    Raises:
        HTTPException(404): If the record does not exist or is soft-deleted.
        HTTPException(500): If the table is not in the allowed whitelist.
    """
    if record_id is None:
        return

    if table not in _ALLOWED_TABLES:
        raise HTTPException(
            status_code=500,
            detail=f"Internal configuration error: unregistered reference table '{table}'.",
        )

    found = await db.execute(
        tenant_reference_sql(table, _ALLOWED_TABLES),
        {"id": str(record_id), "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail=f"{label} not found.")


async def project_exists(db: AsyncSession, project_id: UUID | str, org_id: str) -> None:
    """Assert that a project exists and belongs to the organisation."""
    await tenant_reference(db, "projects.projects", project_id, org_id, "Project")


async def site_exists(
    db: AsyncSession,
    site_id: Optional[UUID | str],
    project_id: UUID | str,
    org_id: str,
) -> None:
    """Assert that a site belongs to the given project and organisation."""
    if site_id is None:
        return
    found = await db.execute(
        text("""
            SELECT 1 FROM projects.sites
            WHERE id = :site_id
              AND project_id = :project_id
              AND organization_id = :org_id
              AND is_deleted = false
        """),
        {"site_id": str(site_id), "project_id": str(project_id), "org_id": org_id},
    )
    if not found.scalar():
        raise HTTPException(status_code=404, detail="Site not found.")
