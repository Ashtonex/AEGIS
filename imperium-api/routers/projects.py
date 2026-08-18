"""Tenant-safe project lifecycle, programme, commercial and risk controls."""

import json
from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.events import emit_event, emit_notification
from app.shared.sql import safe_payload_columns, tenant_upsert_sql, update_tenant_row_sql

router = APIRouter()

# Fields that live on projects.project_profiles (a 1:1 side table) rather than
# projects.projects itself. update_project() routes ProjectUpdate payload keys
# to the right table based on this set.
PROFILE_COLUMNS = {"region", "latitude", "longitude"}


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="planning", max_length=50)
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_name: Optional[str] = Field(default=None, max_length=255)
    contract_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None
    department_id: Optional[UUID] = None


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
    department_id: Optional[UUID] = None
    region: Optional[str] = Field(default=None, max_length=120)
    latitude: Optional[float] = Field(default=None, ge=-90, le=90)
    longitude: Optional[float] = Field(default=None, ge=-180, le=180)


class ProjectRegistrationSubmit(BaseModel):
    """Formal fields proposed when promoting a Field Intake project to a
    fully registered one - held in the approval instance's metadata until
    Finance signs off, then applied to the project row on approval."""

    client_name: Optional[str] = Field(default=None, max_length=255)
    client_org_id: Optional[UUID] = None
    contract_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    project_code: Optional[str] = Field(default=None, max_length=80)


class ProjectRegistrationDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)


class ProjectBudgetSet(BaseModel):
    total_amount: Decimal = Field(gt=0)
    notes: Optional[str] = None


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
        SELECT p.*, pp.region, pp.latitude, pp.longitude
        FROM projects.projects p
        LEFT JOIN projects.project_profiles pp ON pp.project_id = p.id AND pp.organization_id = p.organization_id
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
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
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
    _: dict = Depends(require_permission("projects.create")),
):
    try:
        row = (
            await db.execute(
                text("""
            INSERT INTO projects.projects (name, status, project_code, project_type, client_name, contract_value, start_date, planned_completion_date, department_id, organization_id, created_by)
            VALUES (:name, :status, :project_code, :project_type, :client_name, :contract_value, :start_date, :planned_completion_date, :department_id, :org_id, :user_id)
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
    _: dict = Depends(require_permission("projects.read")),
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
    _: dict = Depends(require_permission("projects.update")),
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
    _: dict = Depends(require_permission("projects.update")),
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
    _: dict = Depends(require_permission("projects.update")),
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
    _: dict = Depends(require_permission("projects.read")),
):
    return _result(await _project_ref_or_404(db, project_id, user["org_id"]), "Project retrieved.")


@router.post("/{project_id}/submit-registration", status_code=201)
async def submit_project_registration(
    project_id: UUID,
    payload: ProjectRegistrationSubmit,
    user: dict = Depends(require_permission("projects.create")),
    db: AsyncSession = Depends(get_db),
):
    """Submits a Field Intake project for Finance sign-off, proposing the
    formal fields (client, contract value, real start date) it should carry
    once registered. Nothing on the project itself changes until approved -
    every requisition/store/cost transaction already carries the correct
    project_id from day one, so there's nothing to reparent on promotion."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if project.get("status") != "field_intake":
        raise HTTPException(
            status_code=409,
            detail="Only Field Intake projects can be submitted for registration.",
        )

    metadata = payload.model_dump(mode="json", exclude_none=True)
    approval_id = (
        await db.execute(
            text("""
        INSERT INTO core.approval_instances (
            organization_id, workflow_key, target_type, target_id, project_id, submitted_by, metadata
        ) VALUES (
            :org_id, 'project_field_intake_registration', 'project', :project_id, :project_id,
            :user_id, CAST(:metadata AS jsonb)
        ) ON CONFLICT (organization_id, workflow_key, target_type, target_id)
          WHERE is_deleted=false AND status='pending'
          DO UPDATE SET metadata = CAST(:metadata AS jsonb), updated_at=NOW()
        RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "project_id": project_id,
                "user_id": user["user_id"],
                "metadata": json.dumps(metadata),
            },
        )
    ).scalar()
    await db.execute(
        text("""
        INSERT INTO core.approval_steps (organization_id, approval_instance_id, step_number, role_name)
        VALUES (:org_id, :approval_id, 1, 'Finance Manager')
        ON CONFLICT (organization_id, approval_instance_id, step_number) DO NOTHING
    """),
        {"org_id": user["org_id"], "approval_id": approval_id},
    )
    await emit_event(
        db,
        user=user,
        event_type="project.field_intake_registration.submitted.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data=metadata,
    )
    await db.commit()
    return _result(
        {"id": str(project_id), "approval_id": str(approval_id)},
        "Submitted for Finance sign-off.",
    )


@router.post("/{project_id}/registration-decision")
async def decide_project_registration(
    project_id: UUID,
    payload: ProjectRegistrationDecision,
    user: dict = Depends(require_permission("projects.registration.approve")),
    db: AsyncSession = Depends(get_db),
):
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    approval = (
        (
            await db.execute(
                text("""
        SELECT id, submitted_by, metadata FROM core.approval_instances
        WHERE organization_id=:org_id AND workflow_key='project_field_intake_registration'
          AND target_type='project' AND target_id=:project_id
          AND status='pending' AND is_deleted=false
        ORDER BY created_at DESC LIMIT 1
    """),
                {"org_id": user["org_id"], "project_id": project_id},
            )
        )
        .mappings()
        .first()
    )
    if not approval:
        raise HTTPException(
            status_code=409, detail="No pending registration approval exists for this project."
        )
    if str(approval["submitted_by"]) == str(user["user_id"]):
        raise HTTPException(status_code=403, detail="Self-approval is not permitted.")

    if payload.decision == "approved":
        metadata = approval["metadata"] or {}
        # metadata came back out of jsonb, so start_date is a plain string -
        # asyncpg needs a real date object to bind against the CAST(...AS date)
        # placeholder below, the same class of bug fixed for tender_bids.py's
        # submission_deadline.
        metadata_start_date = (
            date.fromisoformat(metadata["start_date"]) if metadata.get("start_date") else None
        )
        await db.execute(
            text("""
            UPDATE projects.projects
            SET status='planning',
                client_name=COALESCE(:client_name, client_name),
                client_org_id=COALESCE(CAST(:client_org_id AS uuid), client_org_id),
                contract_value=COALESCE(CAST(:contract_value AS numeric), contract_value),
                start_date=COALESCE(CAST(:start_date AS date), start_date),
                project_code=COALESCE(:project_code, project_code),
                updated_at=NOW()
            WHERE id=:project_id AND organization_id=:org_id
        """),
            {
                "project_id": project_id,
                "org_id": user["org_id"],
                "client_name": metadata.get("client_name"),
                "client_org_id": metadata.get("client_org_id"),
                "contract_value": metadata.get("contract_value"),
                "start_date": metadata_start_date,
                "project_code": metadata.get("project_code"),
            },
        )
        event_type = "project.field_intake_registration.approved.v1"
        notif_title = "Project Registration Approved"
        notif_message = f"{project.get('name')} has been registered as a formal AEGIS project."
    else:
        event_type = "project.field_intake_registration.rejected.v1"
        notif_title = "Project Registration Rejected"
        notif_message = f"Registration for {project.get('name')} was rejected. Reason: {payload.reason or 'Not specified'}"

    await db.execute(
        text("""
        UPDATE core.approval_instances
        SET status=:decision, decided_by=:user_id, decided_at=NOW(), decision_reason=:reason, updated_at=NOW()
        WHERE id=:approval_id AND organization_id=:org_id
    """),
        {
            "approval_id": approval["id"],
            "org_id": user["org_id"],
            "decision": payload.decision,
            "user_id": user["user_id"],
            "reason": payload.reason,
        },
    )
    await db.execute(
        text("""
        UPDATE core.approval_steps
        SET status=:decision, decided_by=:user_id, decided_at=NOW(), reason=:reason, updated_at=NOW()
        WHERE approval_instance_id=:approval_id AND organization_id=:org_id AND step_number=1
    """),
        {
            "approval_id": approval["id"],
            "org_id": user["org_id"],
            "decision": payload.decision,
            "user_id": user["user_id"],
            "reason": payload.reason,
        },
    )
    await emit_event(
        db,
        user=user,
        event_type=event_type,
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={"decision": payload.decision, "reason": payload.reason},
    )
    if approval["submitted_by"]:
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(approval["submitted_by"]),
            title=notif_title,
            message=notif_message,
        )
    await db.commit()
    return _result({"id": str(project_id), "decision": payload.decision}, "Registration decision recorded.")


@router.post("/{project_id}/budget", status_code=201)
async def set_project_budget(
    project_id: UUID,
    payload: ProjectBudgetSet,
    user: dict = Depends(require_permission("projects.registration.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Finance sets an ad-hoc execution budget ceiling directly, for a
    project that never went through a won quotation (e.g. a promoted Field
    Intake project) - same finance.project_budgets shape
    seed_project_budget_from_quotation produces, just without a quotation
    behind it."""
    await _project_or_404(db, project_id, user["org_id"])
    await db.execute(
        text("""
        UPDATE finance.project_budgets
        SET status='superseded', updated_at=NOW()
        WHERE project_id=:project_id AND organization_id=:org_id AND status='approved' AND is_deleted=false
    """),
        {"project_id": project_id, "org_id": user["org_id"]},
    )
    next_version = (
        await db.execute(
            text("""
        SELECT COALESCE(MAX(budget_version), 0) + 1 FROM finance.project_budgets
        WHERE project_id=:project_id AND organization_id=:org_id
    """),
            {"project_id": project_id, "org_id": user["org_id"]},
        )
    ).scalar()
    row = (
        await db.execute(
            text("""
        INSERT INTO finance.project_budgets (
            organization_id, project_id, budget_version, status, label,
            effective_date, total_amount, notes, approved_by, approved_at, created_by
        ) VALUES (
            :org_id, :project_id, :version, 'approved', 'Finance-set ad-hoc budget',
            CURRENT_DATE, :total_amount, :notes, :user_id, NOW(), :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "project_id": project_id,
                "version": next_version,
                "total_amount": payload.total_amount,
                "notes": payload.notes,
                "user_id": user["user_id"],
            },
        )
    ).first()
    await db.commit()
    return _result({"id": str(row.id)}, "Project budget set.")


@router.patch("/{project_id}")
async def update_project(
    project_id: UUID,
    payload: ProjectUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    await _project_or_404(db, project_id, user["org_id"])
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=400, detail="No project changes were supplied.")

    project_values = {key: val for key, val in values.items() if key not in PROFILE_COLUMNS}
    profile_values = {key: val for key, val in values.items() if key in PROFILE_COLUMNS}

    try:
        if project_values:
            safe_keys = safe_payload_columns(project_values.keys())
            await db.execute(
                update_tenant_row_sql(
                    "projects.projects",
                    safe_keys,
                    ProjectUpdate.model_fields,
                    id_param="project_id",
                    require_not_deleted=False,
                ),
                {
                    **{key: project_values[key] for key in safe_keys},
                    "project_id": project_id,
                    "org_id": user["org_id"],
                },
            )
        if profile_values:
            await db.execute(
                tenant_upsert_sql(
                    "projects.project_profiles",
                    profile_values.keys(),
                    PROFILE_COLUMNS,
                    base_columns=["project_id", "organization_id"],
                    conflict_target="project_id",
                ),
                {
                    **profile_values,
                    "project_id": project_id,
                    "organization_id": user["org_id"],
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
    _: dict = Depends(require_permission("projects.delete")),
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
