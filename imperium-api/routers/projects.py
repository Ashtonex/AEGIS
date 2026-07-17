"""Tenant-safe project lifecycle, programme, commercial and risk controls."""

from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user
from app.shared.sql import safe_payload_columns, update_tenant_row_sql

router = APIRouter()


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="planning", max_length=50)
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_name: Optional[str] = Field(default=None, max_length=255)
    contract_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    status: Optional[str] = Field(default=None, max_length=50)
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_name: Optional[str] = Field(default=None, max_length=255)
    contract_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None
    actual_completion_date: Optional[date] = None


class MilestonePayload(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: Literal[
        "not_started", "in_progress", "complete", "blocked", "cancelled"
    ] = "not_started"
    baseline_date: Optional[date] = None
    forecast_date: Optional[date] = None
    actual_date: Optional[date] = None
    weight: Optional[Decimal] = Field(default=None, ge=0, le=100)
    owner_id: Optional[UUID] = None
    notes: Optional[str] = None


class ChangePayload(BaseModel):
    change_number: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    status: Literal[
        "draft", "submitted", "approved", "rejected", "implemented", "withdrawn"
    ] = "draft"
    type: Optional[str] = Field(default=None, max_length=80)
    cost_impact: Optional[Decimal] = None
    programme_impact_days: Optional[int] = None
    rationale: Optional[str] = None
    evidence_reference: Optional[str] = None


class RiskPayload(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=80)
    status: Literal["open", "mitigating", "accepted", "closed"] = "open"
    likelihood: Optional[int] = Field(default=None, ge=1, le=5)
    impact: Optional[int] = Field(default=None, ge=1, le=5)
    response_plan: Optional[str] = None
    owner_id: Optional[UUID] = None
    due_date: Optional[date] = None


async def _project_or_404(db: AsyncSession, project_id: UUID, org_id: str) -> None:
    result = await db.execute(
        text("""
        SELECT 1 FROM projects.projects
        WHERE id = :project_id AND organization_id = :org_id AND is_deleted = false
    """),
        {"project_id": project_id, "org_id": org_id},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Project not found")


async def _project_ref_or_404(db: AsyncSession, project_ref: str, org_id: str) -> dict:
    result = await db.execute(
        text("""
        SELECT p.*
        FROM projects.projects p
        WHERE p.organization_id = :org_id
          AND p.is_deleted = false
          AND (
            p.id::text = :project_ref
            OR p.project_code = :project_ref
            OR to_jsonb(p)->>'project_code' = :project_ref
            OR to_jsonb(p)->>'slug' = :project_ref
            OR lower(p.name) = lower(:project_ref)
            OR lower(COALESCE(to_jsonb(p)->>'title', '')) = lower(:project_ref)
          )
        LIMIT 1
    """),
        {"project_ref": project_ref, "org_id": org_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return dict(row._mapping)


def _result(data, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


@router.get("/")
async def list_projects(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    rows = await db.execute(
        text("""
        SELECT p.*, pp.viability_status, pp.budget_amount, pp.forecast_cost,
               COUNT(m.id) FILTER (WHERE m.status = 'blocked') AS blocked_milestones,
               COUNT(r.id) FILTER (WHERE r.status IN ('open', 'mitigating')) AS open_risks
        FROM projects.projects p
        LEFT JOIN projects.project_profiles pp ON pp.project_id = p.id AND pp.organization_id = p.organization_id
        LEFT JOIN projects.project_milestones m ON m.project_id = p.id AND m.organization_id = p.organization_id AND m.is_deleted = false
        LEFT JOIN projects.project_risks r ON r.project_id = p.id AND r.organization_id = p.organization_id AND r.is_deleted = false
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        GROUP BY p.id, pp.project_id
        ORDER BY p.updated_at DESC LIMIT 100
    """),
        {"org_id": user["org_id"]},
    )
    data = [dict(row._mapping) for row in rows]
    return _result(data, "Projects listed.", len(data))


@router.post("/", status_code=201)
async def create_project(
    payload: ProjectCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = (
            await db.execute(
                text("""
            INSERT INTO projects.projects (name, status, project_code, project_type, client_name, contract_value, start_date, planned_completion_date, organization_id, created_by)
            VALUES (:name, :status, :project_code, :project_type, :client_name, :contract_value, :start_date, :planned_completion_date, :org_id, :user_id)
            RETURNING id
        """),
                {
                    **payload.model_dump(),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Project created.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Project code already exists for this organization."
        ) from exc


@router.get("/{project_id}/lifecycle")
async def project_lifecycle(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    params = {"project_id": project_id, "org_id": user["org_id"]}

    async def rows(query: str):
        return [dict(r._mapping) for r in await db.execute(text(query), params)]

    project = (
        await db.execute(
            text(
                "SELECT p.*, pp.* FROM projects.projects p LEFT JOIN projects.project_profiles pp ON pp.project_id=p.id AND pp.organization_id=p.organization_id WHERE p.id=:project_id AND p.organization_id=:org_id"
            ),
            params,
        )
    ).first()
    return _result(
        {
            "project": dict(project._mapping),
            "milestones": await rows(
                "SELECT * FROM projects.project_milestones WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY baseline_date NULLS LAST, created_at"
            ),
            "changes": await rows(
                "SELECT * FROM projects.project_changes WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY created_at DESC"
            ),
            "risks": await rows(
                "SELECT *, CASE WHEN likelihood IS NOT NULL AND impact IS NOT NULL THEN likelihood * impact END AS exposure FROM projects.project_risks WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY (likelihood * impact) DESC NULLS LAST, created_at DESC"
            ),
        },
        "Project lifecycle retrieved.",
    )


@router.post("/{project_id}/milestones", status_code=201)
async def add_milestone(
    project_id: UUID,
    payload: MilestonePayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    row = (
        await db.execute(
            text(
                """INSERT INTO projects.project_milestones (project_id, organization_id, created_by, name, status, baseline_date, forecast_date, actual_date, weight, owner_id, notes) VALUES (:project_id,:org_id,:user_id,:name,:status,:baseline_date,:forecast_date,:actual_date,:weight,:owner_id,:notes) RETURNING id"""
            ),
            {
                **payload.model_dump(),
                "project_id": project_id,
                "org_id": user["org_id"],
                "user_id": user["user_id"],
            },
        )
    ).first()
    await db.commit()
    return _result({"id": str(row.id)}, "Milestone created.")


@router.post("/{project_id}/changes", status_code=201)
async def add_change(
    project_id: UUID,
    payload: ChangePayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    try:
        row = (
            await db.execute(
                text(
                    """INSERT INTO projects.project_changes (project_id,organization_id,created_by,change_number,title,status,type,cost_impact,programme_impact_days,rationale,evidence_reference,requested_at) VALUES (:project_id,:org_id,:user_id,:change_number,:title,:status,:type,:cost_impact,:programme_impact_days,:rationale,:evidence_reference,NOW()) RETURNING id"""
                ),
                {
                    **payload.model_dump(),
                    "project_id": project_id,
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Change request created.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Change number already exists for this project."
        ) from exc


@router.post("/{project_id}/risks", status_code=201)
async def add_risk(
    project_id: UUID,
    payload: RiskPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    row = (
        await db.execute(
            text(
                """INSERT INTO projects.project_risks (project_id,organization_id,created_by,title,description,category,status,likelihood,impact,response_plan,owner_id,due_date) VALUES (:project_id,:org_id,:user_id,:title,:description,:category,:status,:likelihood,:impact,:response_plan,:owner_id,:due_date) RETURNING id"""
            ),
            {
                **payload.model_dump(),
                "project_id": project_id,
                "org_id": user["org_id"],
                "user_id": user["user_id"],
            },
        )
    ).first()
    await db.commit()
    return _result({"id": str(row.id)}, "Project risk created.")


@router.get("/{project_id}")
async def get_project(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return _result(await _project_ref_or_404(db, project_id, user["org_id"]), "Project retrieved.")


@router.patch("/{project_id}")
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=400, detail="No project changes were supplied.")
    safe_keys = safe_payload_columns(values.keys())
    try:
        await db.execute(
            update_tenant_row_sql(
                "projects.projects",
                safe_keys,
                ProjectUpdate.model_fields,
                id_param="project_id",
                require_not_deleted=False,
            ),
            {
                **{key: values[key] for key in safe_keys},
                "project_id": project_id,
                "org_id": user["org_id"],
            },
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Project code already exists for this organization."
        ) from exc
    return _result({"id": str(project_id)}, "Project updated.")


@router.delete("/{project_id}")
async def archive_project(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    await db.execute(
        text(
            "UPDATE projects.projects SET is_deleted=true, updated_at=NOW() WHERE id=:project_id AND organization_id=:org_id"
        ),
        {"project_id": project_id, "org_id": user["org_id"]},
    )
    await db.commit()
    return _result(None, "Project archived.")
