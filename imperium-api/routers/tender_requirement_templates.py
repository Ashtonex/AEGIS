"""Zimbabwe Tender Requirements Library - crm.tender_requirement_templates
(migration 199). Individually named requirement templates across 18
categories, seeded by the migration; this router lets Compliance/MD
maintain the library over time (e.g. a new PRAZ category is introduced)
without another migration.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()

CATEGORIES = {
    "CORPORATE_LEGAL", "PRAZ", "ZIMRA_TAX", "NSSA", "CONSTRUCTION_REGISTRATION",
    "TENDER_FORMS_DECLARATIONS", "BID_SECURITY", "FINANCIAL_CAPACITY",
    "COMMERCIAL_BOQ", "TECHNICAL_CAPABILITY", "EXPERIENCE_REFERENCES",
    "KEY_PERSONNEL", "PLANT_EQUIPMENT", "HSE_ENVIRONMENTAL", "INSURANCE",
    "SITE_VISIT", "TENDER_SPECIFIC_FEES", "POST_AWARD",
}
SEVERITIES = {"FATAL", "CRITICAL", "MAJOR", "MINOR", "INFORMATIONAL"}


class TemplateWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    category: str
    requirement_name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    default_severity: str = "MAJOR"
    maps_to_credential_type: Optional[str] = Field(default=None, max_length=64)
    is_active: bool = True
    sort_order: int = 0

    @field_validator("category")
    @classmethod
    def _valid_category(cls, value: str) -> str:
        if value not in CATEGORIES:
            raise ValueError(f"Unknown category: {value!r}")
        return value

    @field_validator("default_severity")
    @classmethod
    def _valid_severity(cls, value: str) -> str:
        if value not in SEVERITIES:
            raise ValueError(f"Unknown severity: {value!r}")
        return value


@router.get("")
async def list_templates(
    category: Optional[str] = Query(default=None),
    include_inactive: bool = Query(default=False),
    user: dict = Depends(require_permission("tender_requirements_library.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["is_deleted = false", "(organization_id IS NULL OR organization_id = :org_id)"]
    params: dict = {"org_id": user["org_id"]}
    if category:
        filters.append("category = :category")
        params["category"] = category
    if not include_inactive:
        filters.append("is_active = true")
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT * FROM crm.tender_requirement_templates
            WHERE {where}
            ORDER BY category, sort_order, requirement_name
        """),  # nosec B608 - filters are static column checks above
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return ok(items, "Tender requirements library listed.", total=len(items))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: TemplateWrite,
    user: dict = Depends(require_permission("tender_requirements_library.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
            INSERT INTO crm.tender_requirement_templates (
                organization_id, category, requirement_name, description,
                default_severity, maps_to_credential_type, is_active, sort_order, created_by
            ) VALUES (
                :org_id, :category, :requirement_name, :description,
                :default_severity, :maps_to_credential_type, :is_active, :sort_order, :user_id
            ) RETURNING *
        """),
        {**payload.model_dump(), "org_id": user["org_id"], "user_id": user["sub"]},
    )
    await db.commit()
    return ok(dict(row.mappings().first()), "Requirement template added to library.")


@router.patch("/{template_id}")
async def update_template(
    template_id: UUID,
    payload: TemplateWrite,
    user: dict = Depends(require_permission("tender_requirements_library.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
            UPDATE crm.tender_requirement_templates
            SET category = :category, requirement_name = :requirement_name, description = :description,
                default_severity = :default_severity, maps_to_credential_type = :maps_to_credential_type,
                is_active = :is_active, sort_order = :sort_order, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING *
        """),
        {**payload.model_dump(), "id": template_id, "org_id": user["org_id"]},
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Requirement template not found or is a system default (org-owned templates only can be edited).")
    await db.commit()
    return ok(dict(result), "Requirement template updated.")


@router.delete("/{template_id}")
async def delete_template(
    template_id: UUID,
    user: dict = Depends(require_permission("tender_requirements_library.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
            UPDATE crm.tender_requirement_templates
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": template_id, "org_id": user["org_id"]},
    )
    if not row.first():
        raise HTTPException(status_code=404, detail="Requirement template not found or is a system default.")
    await db.commit()
    return ok({"id": str(template_id)}, "Requirement template removed.")
