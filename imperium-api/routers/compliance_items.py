from datetime import datetime
import json
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission, get_current_user
from app.shared.pagination import ok
from app.shared.sql import safe_payload_columns, update_tenant_row_sql

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ObligationCreate(Payload):
    title: str = Field(min_length=1, max_length=255)
    authority: str = Field(default="ZIMRA", max_length=80)
    category: str = Field(default="tax", max_length=80)
    due_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    responsible_person: Optional[str] = None
    notes: Optional[str] = None


class CorrectiveActionCreate(Payload):
    finding_trigger: str = Field(min_length=1, max_length=255)
    responsible_person: str = Field(min_length=1, max_length=255)
    due_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    priority: str = Field(default="high", max_length=40)
    status: str = Field(default="open", max_length=40)
    notes: Optional[str] = None


class DeploymentRequirementPayload(Payload):
    requirement_scope: Literal[
        "all_deployments", "workforce_project_allocation", "equipment_assignment"
    ]
    certification_name: str = Field(min_length=1, max_length=160)
    required_verification_status: Literal["verified", "pending", "expired"] = "verified"
    warning_days: int = Field(default=30, ge=0, le=3650)
    project_id: Optional[UUID] = None
    target_role: Optional[str] = Field(default=None, max_length=120)
    equipment_type: Optional[str] = Field(default=None, max_length=120)
    is_active: bool = True


class DeploymentRequirementUpdate(Payload):
    requirement_scope: Optional[
        Literal[
            "all_deployments", "workforce_project_allocation", "equipment_assignment"
        ]
    ] = None
    certification_name: Optional[str] = Field(
        default=None, min_length=1, max_length=160
    )
    required_verification_status: Optional[
        Literal["verified", "pending", "expired"]
    ] = None
    warning_days: Optional[int] = Field(default=None, ge=0, le=3650)
    project_id: Optional[UUID] = None
    target_role: Optional[str] = Field(default=None, max_length=120)
    equipment_type: Optional[str] = Field(default=None, max_length=120)
    is_active: Optional[bool] = None


class DeploymentGateOverridePayload(Payload):
    reason: str = Field(min_length=12, max_length=2000)
    override_reference: Optional[str] = Field(default=None, max_length=160)


async def emit_compliance_event(
    db: AsyncSession,
    *,
    user: dict,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID,
    payload: dict,
) -> None:
    await db.execute(
        text("""
        INSERT INTO core.domain_events (
            organization_id, event_type, schema_version, aggregate_type, aggregate_id,
            actor_id, idempotency_key, payload
        ) VALUES (
            :org_id, :event_type, 1, :aggregate_type, :aggregate_id,
            :actor_id, :idempotency_key, CAST(:payload AS jsonb)
        ) ON CONFLICT (organization_id, idempotency_key) DO NOTHING
    """),
        {
            "org_id": user["org_id"],
            "event_type": event_type,
            "aggregate_type": aggregate_type,
            "aggregate_id": aggregate_id,
            "actor_id": user["user_id"],
            "idempotency_key": f"{event_type}:{aggregate_type}:{aggregate_id}:{datetime.utcnow().isoformat()}",
            "payload": json.dumps(payload, default=str),
        },
    )


@router.get("/obligations")
async def list_obligations(
    authority: Optional[str] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List persisted regulatory obligations for the active tenant."""
    result = await db.execute(
        text("""
        SELECT * FROM core.compliance_items
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY expiry_date ASC
    """),
        {"org_id": user["org_id"]},
    )
    rows = [dict(row._mapping) for row in result]

    # Map raw compliance_items to obligations shape for frontend
    data = []
    for r in rows:
        data.append(
            {
                "id": r["id"],
                "title": r.get("certificate_name")
                or r.get("title")
                or "Regulatory Filing",
                "authority": r.get("issuing_authority")
                or r.get("authority")
                or "ZIMRA",
                "category": r.get("category") or "statutory",
                "responsible_person": r.get("responsible_person")
                or "Compliance Officer",
                "due_date": r.get("expiry_date") or r.get("due_date"),
                "status": r.get("status") or "compliant",
            }
        )

    return ok(data, "Compliance obligations listed.")


@router.post("/obligations", status_code=status.HTTP_201_CREATED)
async def create_obligation(
    payload: ObligationCreate,
    user: dict = Depends(
        require_permission("finance.budget.create")
    ),  # general compliance auth
    db: AsyncSession = Depends(get_db),
):
    """
    Add a new obligation item to core.compliance_items.
    """
    try:
        item_id = (
            await db.execute(
                text("""
            INSERT INTO core.compliance_items (organization_id, certificate_name, expiry_date, is_deleted)
            VALUES (:org_id, :title, CAST(:due_date AS date), false)
            RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "title": f"{payload.authority} - {payload.title}",
                    "due_date": payload.due_date,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(item_id)}, "Compliance obligation recorded.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/employee-credentials")
async def list_employee_credentials(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Fetch active employee safety certificates and clearances.
    """
    query = text("""
        SELECT 
            ec.id,
            ec.certification_name,
            ec.certificate_number,
            ec.issuing_authority,
            ec.expires_on,
            ec.verification_status AS status,
            e.employee_name
        FROM hr.employee_certifications ec
        JOIN hr.employees e ON e.id = ec.employee_id AND e.organization_id = ec.organization_id
        WHERE ec.organization_id = :org_id AND ec.is_deleted = false
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    data = [dict(row._mapping) for row in result]
    return ok(data, "Employee credentials listed.")


@router.get("/equipment-credentials")
async def list_equipment_credentials(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Fetch equipment compliance inspections from the controlled fleet register."""
    rows = await db.execute(
        text("""
        SELECT
            i.id,
            f.asset_code,
            COALESCE(f.asset_code, f.vehicle_registration, f.make || ' ' || f.model, f.id::text) AS asset_name,
            i.inspection_type AS licence_type,
            NULL::text AS certificate_number,
            i.inspected_at::date AS issued_on,
            NULL::date AS expires_on,
            CASE
                WHEN i.outcome = 'pass' THEN 'compliant'
                WHEN i.outcome = 'conditional' THEN 'pending'
                WHEN i.outcome = 'fail' THEN 'expired'
                ELSE COALESCE(i.outcome, 'pending')
            END AS status
        FROM fleet.fleet_inspections i
        JOIN fleet.fleet f
          ON f.id = i.fleet_id
         AND f.organization_id = i.organization_id
         AND f.is_deleted = false
        WHERE i.organization_id = :org_id
          AND i.is_deleted = false
          AND i.inspection_type = 'compliance'
        ORDER BY i.inspected_at DESC
        LIMIT 500
    """),
        {"org_id": user["org_id"]},
    )
    data = [dict(row._mapping) for row in rows]
    return ok(data, "Equipment credentials listed.")


@router.get("/corrective-actions")
async def list_corrective_actions(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("compliance.corrective_action.read")),
    db: AsyncSession = Depends(get_db),
):
    """List tenant corrective actions from the CAPA register."""
    rows = await db.execute(
        text("""
        SELECT id, finding_trigger, responsible_person, due_date, priority, status, notes,
               source_type, source_id, created_at, completed_at
        FROM compliance.corrective_actions
        WHERE organization_id = :org_id
          AND is_deleted = false
          AND (CAST(:status AS varchar) IS NULL OR status = CAST(:status AS varchar))
        ORDER BY
          CASE status WHEN 'open' THEN 0 WHEN 'overdue' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END,
          due_date ASC
        LIMIT 500
    """),
        {"org_id": user["org_id"], "status": status_filter},
    )
    data = [dict(row._mapping) for row in rows]
    return ok(data, "Corrective actions listed.")


@router.post("/corrective-actions", status_code=status.HTTP_201_CREATED)
async def create_corrective_action(
    payload: CorrectiveActionCreate,
    user: dict = Depends(require_permission("compliance.corrective_action.create")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
        INSERT INTO compliance.corrective_actions (
            organization_id, finding_trigger, responsible_person, due_date,
            priority, status, notes, created_by
        ) VALUES (
            :org_id, :finding_trigger, :responsible_person, CAST(:due_date AS date),
            :priority, :status, :notes, :user_id
        )
        RETURNING id
    """),
        {**payload.model_dump(), "org_id": user["org_id"], "user_id": user["user_id"]},
    )
    action_id = row.scalar()
    await emit_compliance_event(
        db,
        user=user,
        event_type="compliance.corrective_action.created.v1",
        aggregate_type="corrective_action",
        aggregate_id=action_id,
        payload={**payload.model_dump(), "corrective_action_id": str(action_id)},
    )
    await db.commit()
    return ok({"id": str(action_id)}, "Corrective action generated.")


@router.get("/deployment-requirements")
async def list_deployment_requirements(
    scope: Optional[str] = Query(default=None),
    active: Optional[bool] = Query(default=None),
    user: dict = Depends(require_permission("compliance.requirement.read")),
    db: AsyncSession = Depends(get_db),
):
    query = """
        SELECT
            r.id,
            r.requirement_scope,
            r.project_id,
            p.name AS project_name,
            r.target_role,
            r.equipment_type,
            r.certification_name,
            r.required_verification_status,
            r.warning_days,
            r.is_active,
            r.created_at,
            r.updated_at,
            creator.email AS created_by_email
        FROM compliance.deployment_requirements r
        LEFT JOIN projects.projects p
          ON p.id = r.project_id
         AND p.organization_id = r.organization_id
         AND p.is_deleted = false
        LEFT JOIN core.users creator
          ON creator.id = r.created_by
         AND creator.organization_id = r.organization_id
        WHERE r.organization_id = :org_id
          AND (CAST(:scope AS varchar) IS NULL OR r.requirement_scope = CAST(:scope AS varchar))
          AND (CAST(:active AS boolean) IS NULL OR r.is_active = CAST(:active AS boolean))
        ORDER BY r.is_active DESC, r.requirement_scope, r.certification_name
        LIMIT 500
    """
    rows = (
        (
            await db.execute(
                text(query),
                {
                    "org_id": user["org_id"],
                    "scope": scope,
                    "active": active,
                },
            )
        )
        .mappings()
        .all()
    )
    return ok(
        [dict(row) for row in rows],
        "Deployment compliance requirements listed.",
        len(rows),
    )


@router.post("/deployment-requirements", status_code=status.HTTP_201_CREATED)
async def create_deployment_requirement(
    payload: DeploymentRequirementPayload,
    user: dict = Depends(require_permission("compliance.requirement.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    if values["project_id"]:
        exists = (
            await db.execute(
                text("""
            SELECT 1 FROM projects.projects
            WHERE id=:project_id AND organization_id=:org_id AND is_deleted=false
        """),
                {"project_id": values["project_id"], "org_id": user["org_id"]},
            )
        ).scalar()
        if not exists:
            raise HTTPException(status_code=404, detail="Project not found.")
    try:
        row = await db.execute(
            text("""
            INSERT INTO compliance.deployment_requirements (
                organization_id, requirement_scope, project_id, target_role, equipment_type,
                certification_name, required_verification_status, warning_days, is_active, created_by
            ) VALUES (
                :org_id, :requirement_scope, :project_id, :target_role, :equipment_type,
                :certification_name, :required_verification_status, :warning_days, :is_active, :user_id
            )
            RETURNING id
        """),
            {**values, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
        requirement_id = row.scalar()
        await emit_compliance_event(
            db,
            user=user,
            event_type="compliance.requirement.created.v1",
            aggregate_type="deployment_requirement",
            aggregate_id=requirement_id,
            payload={**values, "requirement_id": str(requirement_id)},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An active deployment requirement already exists for this scope.",
        ) from exc
    return ok({"id": str(requirement_id)}, "Deployment compliance requirement created.")


@router.patch("/deployment-requirements/{requirement_id}")
async def update_deployment_requirement(
    requirement_id: UUID,
    payload: DeploymentRequirementUpdate,
    user: dict = Depends(require_permission("compliance.requirement.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return ok({"id": str(requirement_id)}, "No fields to update.")
    existing = (
        await db.execute(
            text("""
        SELECT id FROM compliance.deployment_requirements
        WHERE id=:requirement_id AND organization_id=:org_id
    """),
            {"requirement_id": requirement_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not existing:
        raise HTTPException(status_code=404, detail="Deployment requirement not found.")
    if values.get("project_id"):
        exists = (
            await db.execute(
                text("""
            SELECT 1 FROM projects.projects
            WHERE id=:project_id AND organization_id=:org_id AND is_deleted=false
        """),
                {"project_id": values["project_id"], "org_id": user["org_id"]},
            )
        ).scalar()
        if not exists:
            raise HTTPException(status_code=404, detail="Project not found.")
    allowed = set(DeploymentRequirementUpdate.model_fields)
    safe_keys = safe_payload_columns(values.keys())
    try:
        await db.execute(
            update_tenant_row_sql(
                "compliance.deployment_requirements",
                safe_keys,
                allowed,
                id_param="requirement_id",
                require_not_deleted=False,
            ),
            {
                **{key: values[key] for key in safe_keys},
                "requirement_id": requirement_id,
                "org_id": user["org_id"],
            },
        )
        await emit_compliance_event(
            db,
            user=user,
            event_type="compliance.requirement.updated.v1",
            aggregate_type="deployment_requirement",
            aggregate_id=requirement_id,
            payload={"requirement_id": str(requirement_id), "fields": sorted(values)},
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="An active deployment requirement already exists for this scope.",
        ) from exc
    return ok({"id": str(requirement_id)}, "Deployment compliance requirement updated.")


@router.delete("/deployment-requirements/{requirement_id}")
async def archive_deployment_requirement(
    requirement_id: UUID,
    user: dict = Depends(require_permission("compliance.requirement.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await db.execute(
        text("""
        UPDATE compliance.deployment_requirements
        SET is_active=false, updated_at=NOW()
        WHERE id=:requirement_id AND organization_id=:org_id
        RETURNING id
    """),
        {"requirement_id": requirement_id, "org_id": user["org_id"]},
    )
    if not row.scalar():
        raise HTTPException(status_code=404, detail="Deployment requirement not found.")
    await emit_compliance_event(
        db,
        user=user,
        event_type="compliance.requirement.archived.v1",
        aggregate_type="deployment_requirement",
        aggregate_id=requirement_id,
        payload={"requirement_id": str(requirement_id)},
    )
    await db.commit()
    return ok(
        {"id": str(requirement_id)}, "Deployment compliance requirement archived."
    )


@router.get("/deployment-gate-checks")
async def list_deployment_gate_checks(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    employee_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_permission("compliance.gate.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        (
            await db.execute(
                text("""
        SELECT
            c.id,
            c.gate_type,
            c.subject_employee_id,
            e.employee_name,
            e.employee_number,
            c.fleet_id,
            f.asset_code,
            f.vehicle_registration,
            f.vehicle_type,
            c.project_id,
            p.name AS project_name,
            c.source_type,
            c.source_id,
            c.status,
            c.missing_requirements,
            c.warnings,
            c.override_reason,
            c.override_reference,
            c.override_at,
            override_actor.email AS override_by_email,
            c.checked_at,
            actor.email AS checked_by_email
        FROM compliance.deployment_gate_checks c
        LEFT JOIN hr.employees e
          ON e.id = c.subject_employee_id
         AND e.organization_id = c.organization_id
         AND e.is_deleted = false
        LEFT JOIN fleet.fleet f
          ON f.id = c.fleet_id
         AND f.organization_id = c.organization_id
         AND f.is_deleted = false
        LEFT JOIN projects.projects p
          ON p.id = c.project_id
         AND p.organization_id = c.organization_id
         AND p.is_deleted = false
        LEFT JOIN core.users actor
          ON actor.id = c.checked_by
         AND actor.organization_id = c.organization_id
        LEFT JOIN core.users override_actor
          ON override_actor.id = c.override_by
         AND override_actor.organization_id = c.organization_id
        WHERE c.organization_id = :org_id
          AND (CAST(:status AS varchar) IS NULL OR c.status = CAST(:status AS varchar))
          AND (CAST(:employee_id AS uuid) IS NULL OR c.subject_employee_id = CAST(:employee_id AS uuid))
          AND (CAST(:project_id AS uuid) IS NULL OR c.project_id = CAST(:project_id AS uuid))
        ORDER BY c.checked_at DESC
        LIMIT CAST(:limit AS integer)
    """),
                {
                    "org_id": user["org_id"],
                    "status": status_filter,
                    "employee_id": employee_id,
                    "project_id": project_id,
                    "limit": limit,
                },
            )
        )
        .mappings()
        .all()
    )
    return ok([dict(row) for row in rows], "Deployment gate checks listed.", len(rows))


@router.post("/deployment-gate-checks/{check_id}/override")
async def override_deployment_gate_check(
    check_id: UUID,
    payload: DeploymentGateOverridePayload,
    user: dict = Depends(require_permission("compliance.gate.override")),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        (
            await db.execute(
                text("""
        SELECT id, project_id, status, missing_requirements, warnings
        FROM compliance.deployment_gate_checks
        WHERE id=:check_id
          AND organization_id=:org_id
          AND is_deleted=false
    """),
                {"check_id": check_id, "org_id": user["org_id"]},
            )
        )
        .mappings()
        .first()
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Deployment gate check not found.")
    if existing["status"] != "blocked":
        raise HTTPException(
            status_code=409,
            detail="Only blocked deployment gate checks can be overridden.",
        )
    await db.execute(
        text("""
        UPDATE compliance.deployment_gate_checks
        SET status='override',
            override_reason=:reason,
            override_reference=:override_reference,
            override_by=:user_id,
            override_at=NOW()
        WHERE id=:check_id AND organization_id=:org_id
    """),
        {
            "check_id": check_id,
            "org_id": user["org_id"],
            "reason": payload.reason,
            "override_reference": payload.override_reference,
            "user_id": user["user_id"],
        },
    )
    await emit_compliance_event(
        db,
        user=user,
        event_type="compliance.deployment_override_recorded.v1",
        aggregate_type="deployment_gate_check",
        aggregate_id=check_id,
        payload={
            "gate_check_id": str(check_id),
            "reason": payload.reason,
            "override_reference": payload.override_reference,
            "previous_status": existing["status"],
            "missing_requirements": existing["missing_requirements"],
            "warnings": existing["warnings"],
        },
    )
    await db.commit()
    return ok({"id": str(check_id)}, "Deployment gate override recorded.")


@router.get("/score")
async def get_compliance_score(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    row = (
        (
            await db.execute(
                text("""
        WITH obligations AS (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE expiry_date < CURRENT_DATE) AS failed
            FROM core.compliance_items
            WHERE organization_id = :org_id AND is_deleted = false
        ),
        employee_credentials AS (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE expires_on < CURRENT_DATE
                       OR COALESCE(verification_status, '') NOT IN ('verified', 'compliant')
                ) AS failed
            FROM hr.employee_certifications
            WHERE organization_id = :org_id AND is_deleted = false
        ),
        deployment_gates AS (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status = 'blocked') AS failed
            FROM compliance.deployment_gate_checks
            WHERE organization_id = :org_id AND is_deleted = false
        ),
        corrective_actions AS (
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status IN ('open', 'overdue') AND due_date < CURRENT_DATE) AS failed
            FROM compliance.corrective_actions
            WHERE organization_id = :org_id AND is_deleted = false
        ),
        totals AS (
            SELECT
                (o.total + e.total + g.total + c.total) AS total,
                (o.failed + e.failed + g.failed + c.failed) AS failed
            FROM obligations o, employee_credentials e, deployment_gates g, corrective_actions c
        )
        SELECT
            CASE
                WHEN total = 0 THEN NULL
                ELSE GREATEST(0, LEAST(100, ROUND(((total - failed)::numeric / NULLIF(total, 0)) * 100)))
            END AS score,
            total,
            failed
        FROM totals
    """),
                {"org_id": user["org_id"]},
            )
        )
        .mappings()
        .one()
    )
    return ok(dict(row), "Compliance score fetched.")
