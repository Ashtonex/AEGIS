from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user
from app.shared.sql import safe_payload_columns, tenant_upsert_sql

router = APIRouter()

# Modules that ship a first-visit onboarding tour. Deliberately an allowlist
# (not free text) - module_tours_completed is a JSONB map keyed by these
# values, and an unbounded key set would let a client write junk keys into
# it forever.
MODULE_TOUR_KEYS = {
    "finance", "crm", "quotations", "supplier_portal", "client_portal",
    "quotations_builder", "quotations_ccb", "quotations_drawings", "quotations_intelligence",
}


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    preferred_name: Optional[str] = Field(default=None, max_length=100)
    first_name: Optional[str] = Field(default=None, max_length=100)
    last_name: Optional[str] = Field(default=None, max_length=100)
    work_phone: Optional[str] = Field(default=None, max_length=40)
    job_title: Optional[str] = Field(default=None, max_length=150)
    department: Optional[str] = Field(default=None, max_length=150)
    location: Optional[str] = Field(default=None, max_length=150)
    timezone: Optional[str] = Field(default=None, max_length=64)
    bio: Optional[str] = Field(default=None, max_length=1500)
    linkedin_url: Optional[HttpUrl] = None
    portfolio_url: Optional[HttpUrl] = None
    website_url: Optional[HttpUrl] = None
    skills: Optional[list[str]] = Field(default=None, max_length=30)
    languages: Optional[list[str]] = Field(default=None, max_length=20)
    theme_preference: Optional[Literal["ink", "paper", "slate", "contrast"]] = None
    onboarding_completed_at: Optional[datetime] = None


def _url(value: Optional[HttpUrl]) -> Optional[str]:
    return str(value) if value else None


@router.get("/me")
async def get_my_profile(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        text("""
        SELECT u.id AS user_id, u.email, u.full_name, p.preferred_name, p.first_name, p.last_name,
               p.work_phone, p.job_title, p.department, p.location, p.timezone, p.bio,
               p.linkedin_url, p.portfolio_url, p.website_url, p.avatar_path, p.skills, p.languages,
               p.theme_preference,
               p.profile_completed_at, p.onboarding_completed_at,
               COALESCE(p.module_tours_completed, '{}'::jsonb) AS module_tours_completed
        FROM core.users u
        LEFT JOIN hr.employee_profiles p ON p.user_id = u.id AND p.organization_id = u.organization_id
        WHERE u.id = :user_id AND u.organization_id = :org_id AND u.is_deleted = false
    """),
        {"user_id": user["user_id"], "org_id": user["org_id"]},
    )
    profile = result.fetchone()
    if not profile:
        raise HTTPException(
            status_code=404, detail="Employee identity is not provisioned."
        )
    return {
        "success": True,
        "data": dict(profile._mapping),
        "message": "Profile fetched.",
        "meta": {},
    }


@router.patch("/me")
async def update_my_profile(
    payload: ProfileUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    linkedin = _url(payload.linkedin_url)
    if linkedin and "linkedin.com/" not in linkedin.lower():
        raise HTTPException(
            status_code=422, detail="LinkedIn URL must use linkedin.com."
        )
    fields = payload.model_dump(exclude_unset=True)
    values = {
        key: (str(value) if isinstance(value, HttpUrl) else value)
        for key, value in fields.items()
    }
    if not values:
        raise HTTPException(status_code=400, detail="No profile changes were supplied.")
    safe_keys = safe_payload_columns(values.keys())
    result = await db.execute(
        tenant_upsert_sql(
            "hr.employee_profiles",
            safe_keys,
            ProfileUpdate.model_fields,
            base_columns=("user_id", "organization_id"),
            conflict_target="user_id",
            returning_columns=(
                "user_id",
                "preferred_name",
                "first_name",
                "last_name",
                "work_phone",
                "job_title",
                "department",
                "location",
                "timezone",
                "bio",
                "linkedin_url",
                "portfolio_url",
                "website_url",
                "skills",
                "languages",
                "theme_preference",
                "profile_completed_at",
                "onboarding_completed_at",
            ),
            touch_profile_completed_at=True,
        ),
        {
            **{key: values[key] for key in safe_keys},
            "user_id": user["user_id"],
            "organization_id": user["org_id"],
        },
    )
    await db.commit()
    return {
        "success": True,
        "data": dict(result.fetchone()._mapping),
        "message": "Profile updated.",
        "meta": {},
    }


@router.post("/me/module-tours/{module_key}")
async def complete_module_tour(
    module_key: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Marks one module's first-visit tour as seen. A JSONB merge (not a
    full-profile overwrite) so completing one module's tour can never race
    with, or clobber, another module's completion written moments earlier -
    the exact failure mode a naive read-modify-write PATCH from the client
    would have."""
    if module_key not in MODULE_TOUR_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown module '{module_key}'.")

    # jsonb_build_object is variadic/polymorphic ("any"), so asyncpg can't
    # infer a bind parameter's type from context alone when it's passed
    # straight in - IndeterminateDatatypeError on $3. Explicit CAST(...)
    # (function syntax, not the :param::type form - that gets misparsed as
    # an escaped colon by SQLAlchemy's bind-param parser) resolves it.
    result = await db.execute(
        text("""
            INSERT INTO hr.employee_profiles (user_id, organization_id, module_tours_completed)
            VALUES (:user_id, :organization_id, jsonb_build_object(CAST(:module_key AS text), CAST(:completed_at AS text)))
            ON CONFLICT (user_id) DO UPDATE SET
                module_tours_completed = COALESCE(hr.employee_profiles.module_tours_completed, '{}'::jsonb)
                    || jsonb_build_object(CAST(:module_key AS text), CAST(:completed_at AS text)),
                updated_at = NOW()
            RETURNING module_tours_completed
        """),
        {
            "user_id": user["user_id"],
            "organization_id": user["org_id"],
            "module_key": module_key,
            "completed_at": datetime.utcnow().isoformat(),
        },
    )
    await db.commit()
    return {
        "success": True,
        "data": {"module_tours_completed": result.fetchone()._mapping["module_tours_completed"]},
        "message": f"{module_key} tour marked complete.",
        "meta": {},
    }
