"""Project setup helpers shared by manual, CRM and tender handoffs."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


DEFAULT_COST_CODES: tuple[tuple[str, str, str], ...] = (
    ("MAT", "Materials", "materials"),
    ("LAB", "Labour", "labour"),
    ("PLT", "Plant and equipment", "equipment"),
    ("SUB", "Subcontractors", "subcontract"),
    ("PRE", "Preliminaries and overhead", "overhead"),
    ("OTH", "Other project costs", "other"),
)


def _code_seed(value: str | None, project_id: UUID) -> str:
    seed = "".join(ch for ch in str(value or "") if ch.isalnum()).upper()
    return (seed[:10] or str(project_id).split("-")[0].upper())


async def ensure_project_operational_setup(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
    created_by: str,
) -> dict[str, object]:
    """Creates the default project site store and standard project cost codes.

    The function is idempotent. It is safe to call after project creation,
    tender award, opportunity-won handoff, or goods receipt.
    """
    project = (
        await db.execute(
            text("""
                SELECT id, name, project_code, department_id
                FROM projects.projects
                WHERE id = :project_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).mappings().first()
    if not project:
        return {"store_id": None, "cost_codes_created": 0}

    code_seed = _code_seed(project["project_code"] or project["name"], project_id)
    store_code = f"{code_seed}-STORE"
    store_id = (
        await db.execute(
            text("""
                INSERT INTO procurement.stores (
                    organization_id, project_id, store_code, name, store_type,
                    status, location_label, created_by
                ) VALUES (
                    :org_id, :project_id, :store_code, :name, 'site',
                    'active', :location_label, :created_by
                )
                ON CONFLICT (organization_id, store_code) DO UPDATE SET
                    project_id = COALESCE(procurement.stores.project_id, EXCLUDED.project_id),
                    status = CASE WHEN procurement.stores.status = 'closed' THEN 'active' ELSE procurement.stores.status END,
                    updated_at = NOW()
                RETURNING id
            """),
            {
                "org_id": org_id,
                "project_id": project_id,
                "store_code": store_code,
                "name": f"{project['name']} Store",
                "location_label": project["name"],
                "created_by": created_by,
            },
        )
    ).scalar()

    created_codes = 0
    for suffix, name, category in DEFAULT_COST_CODES:
        inserted = (
            await db.execute(
                text("""
                    INSERT INTO finance.cost_codes (
                        organization_id, code, name, category, department_id, created_by
                    ) VALUES (
                        :org_id, :code, :name, :category, :department_id, :created_by
                    )
                    ON CONFLICT (organization_id, code) DO NOTHING
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "code": f"{code_seed}-{suffix}",
                    "name": f"{project['name']} - {name}",
                    "category": category,
                    "department_id": project["department_id"],
                    "created_by": created_by,
                },
            )
        ).scalar()
        if inserted:
            created_codes += 1

    return {"store_id": str(store_id) if store_id else None, "cost_codes_created": created_codes}
