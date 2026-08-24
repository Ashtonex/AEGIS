"""Tenant-safe project lifecycle, programme, commercial and risk controls."""

import json
from datetime import date
from decimal import Decimal
from typing import Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.events import emit_event, emit_notification
from app.shared.sql import safe_payload_columns, tenant_upsert_sql, update_tenant_row_sql
from app.shared.task_stacks import generate_task_stack, cascade_delete_entity_tasks
from app.shared.project_delete import find_project_blockers, hard_delete_project
from app.shared.project_setup import ensure_project_operational_setup

router = APIRouter()

# Fields that live on projects.project_profiles (a 1:1 side table) rather than
# projects.projects itself. update_project() routes ProjectUpdate payload keys
# to the right table based on this set.
PROFILE_COLUMNS = {"region", "latitude", "longitude"}

PRE_MOBILISATION_GATE_TYPE = "pre_mobilisation"
PRE_MOBILISATION_READY_STATUSES = {"complete", "complete_with_conditions", "not_applicable"}
PRE_MOBILISATION_GATES = [
    ("Contract authority", "Signed contract, PO or notice to proceed"),
    ("Site access", "Written possession/access confirmation"),
    ("Scope", "Controlled drawings, specifications and scope"),
    ("Budget", "Approved commercial baseline"),
    ("Programme", "Approved baseline or pre-start programme"),
    ("Cash", "Confirmed mobilisation funding"),
    ("Procurement", "Approved initial procurement plan"),
    ("Plant", "Approved plant deployment plan"),
    ("Workforce", "Confirmed personnel and employment records"),
    ("HSE", "Approved HSE plan and risk assessment"),
    ("Insurance", "Valid project-specific cover"),
    ("Governance", "Named team and approval matrix"),
    ("Risk", "Reviewed risk register and treatment actions"),
]
COMMERCIAL_READINESS_CONTROLS: dict[str, str] = {
    "contract_authority_verified": "Reliable written authority to start has not been verified",
    "contract_review_completed": "Formal contract review is not complete",
    "tender_handover_completed": "Tender-to-project commercial handover is not complete",
    "award_reconciled": "Award has not been reconciled against the tender",
    "commercial_baseline_approved": "Approved commercial baseline is missing",
    "cash_flow_forecast_approved": "Project cash-flow forecast and funding logic are not approved",
    "procurement_plan_ready": "Procurement commercial plan is not ready",
    "subcontract_plan_ready": "Subcontract package plan is not ready",
    "valuation_system_ready": "Measurement and valuation system is not configured",
    "variation_control_ready": "Variation control procedure is not configured",
    "claims_notice_ready": "Claims and notice controls are not configured",
    "commercial_registers_ready": "Commercial registers are not configured",
    "reporting_ready": "Commercial reporting and CVR structure are not configured",
    "readiness_review_completed": "Commercial readiness review is not complete",
}
COMMERCIAL_AUTHORITY_STATUSES = {
    "fully_executed",
    "awarded_subject_to_conditions",
    "letter_of_intent_only",
    "purchase_order_only",
    "verbal_instruction",
    "commercially_unacceptable",
}
COMMERCIAL_BLOCKING_AUTHORITY_STATUSES = {"verbal_instruction", "commercially_unacceptable"}


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    status: str = Field(default="planning", max_length=50)
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_org_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    client_name: Optional[str] = Field(default=None, max_length=255)
    contract_value: Optional[Decimal] = None
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None
    department_id: Optional[UUID] = None
    # 'company' marks a project the Company itself initiates to produce
    # something to sell (internal or external) rather than one commissioned
    # by a client - e.g. RMC's ready-mix concrete plant. Its task stack does
    # NOT generate at creation like a normal project; it waits until the
    # structured intake (category, investment, funding) is committed via
    # POST /{project_id}/commit-intake.
    initiated_by: str = Field(default="client", pattern="^(client|company)$")
    # Company-initiated projects have no client deadline - what matters is
    # how long setup takes before production/sale can begin.
    setup_duration_weeks: Optional[int] = Field(default=None, gt=0)


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    status: Optional[str] = Field(default=None, max_length=50)
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    client_org_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
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
    # For a project that was already underway before entering AEGIS - so its
    # progress and remaining budget reflect reality from day one instead of
    # starting artificially at 0%/fully-funded.
    initial_percent_complete: Optional[Decimal] = Field(default=None, ge=0, le=100)
    initial_costs_incurred: Optional[Decimal] = Field(default=None, ge=0)


class ProjectRegistrationDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=2000)


class ProjectBudgetSet(BaseModel):
    total_amount: Decimal = Field(gt=0)
    notes: Optional[str] = None


class ProjectDepositConfirm(BaseModel):
    deposit_reference: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = Field(default=None, max_length=2000)


class PreMobilisationCheckUpdate(BaseModel):
    status: Literal["complete", "complete_with_conditions", "incomplete", "not_applicable"]
    evidence_reference: Optional[str] = Field(default=None, max_length=2000)


class PreMobilisationApproval(BaseModel):
    mobilisation_date: date
    mobilisation_budget: Optional[Decimal] = Field(default=None, ge=0)
    conditions: Optional[str] = Field(default=None, max_length=4000)
    residual_risk_notes: Optional[str] = Field(default=None, max_length=4000)


class CommercialReadinessUpdate(BaseModel):
    readiness_pack: dict = Field(default_factory=dict)
    authority_status: Optional[Literal[
        "fully_executed",
        "awarded_subject_to_conditions",
        "letter_of_intent_only",
        "purchase_order_only",
        "verbal_instruction",
        "commercially_unacceptable",
    ]] = None
    clearance_statement: dict = Field(default_factory=dict)
    manual_blockers: list[str] = Field(default_factory=list, max_length=50)


class CommercialClearancePayload(BaseModel):
    authority_relied_upon: str = Field(min_length=1, max_length=500)
    approved_contract_value: Optional[Decimal] = Field(default=None, ge=0)
    approved_commercial_baseline: Optional[str] = Field(default=None, max_length=500)
    expected_margin: Optional[Decimal] = None
    mobilisation_budget: Optional[Decimal] = Field(default=None, ge=0)
    peak_working_capital_requirement: Optional[Decimal] = None
    payment_and_retention_conditions: Optional[str] = Field(default=None, max_length=2000)
    major_commercial_risks: list[str] = Field(default_factory=list, max_length=50)
    outstanding_conditions: list[str] = Field(default_factory=list, max_length=50)
    temporary_controls: list[str] = Field(default_factory=list, max_length=50)
    named_risk_owners: list[str] = Field(default_factory=list, max_length=50)
    executive_exceptions_accepted: list[str] = Field(default_factory=list, max_length=50)


class ProjectIntakeUpdate(BaseModel):
    """Structured intake for a company-initiated production project (see
    ProjectCreate.initiated_by) - saved incrementally as each question is
    answered, ahead of the final commit that generates its task stack."""

    project_category: Optional[str] = Field(default=None, pattern="^(construction|plant|commercial)$")
    investment_required: Optional[Decimal] = Field(default=None, ge=0)
    funding_internal: Optional[Decimal] = Field(default=None, ge=0)
    funding_external: Optional[Decimal] = Field(default=None, ge=0)
    setup_duration_weeks: Optional[int] = Field(default=None, gt=0)


class ProductionExpenseCreate(BaseModel):
    cost_category: str = Field(pattern=r"^(labour|equipment|materials|subcontract|overhead|other)$")
    description: str = Field(min_length=1, max_length=500)
    amount: Decimal = Field(gt=0)
    transaction_date: Optional[date] = None
    paid: bool = True


class ProductionRevenueCreate(BaseModel):
    amount: Decimal = Field(gt=0)
    description: Optional[str] = Field(default=None, max_length=500)
    transaction_date: Optional[date] = None


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


class MilestoneUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    status: Optional[Literal[
        "not_started", "in_progress", "complete", "blocked", "cancelled"
    ]] = None
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
        SELECT p.*, pp.region, pp.latitude::float AS latitude, pp.longitude::float AS longitude,
               pp.initiated_by, pp.project_category, pp.investment_required,
               pp.funding_internal, pp.funding_external, pp.intake_completed_at,
               pp.setup_duration_weeks, pp.mobilisation_approved_at,
               pp.mobilisation_approved_by, pp.mobilisation_authorisation_number,
               pp.approved_mobilisation_date, pp.mobilisation_budget,
               pp.mobilisation_conditions, pp.residual_risk_notes,
               pp.commercial_readiness_status, pp.commercial_readiness_pack,
               pp.commercial_readiness_blockers, pp.commercial_clearance_statement,
               pp.commercial_cleared_at, pp.commercial_cleared_by
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


async def _client_org_name_or_404(db: AsyncSession, client_org_id: UUID, org_id: str) -> str:
    name = (
        await db.execute(
            text("""
                SELECT name
                FROM crm.organizations
                WHERE id = :client_org_id
                  AND organization_id = :org_id
                  AND is_deleted = false
            """),
            {"client_org_id": client_org_id, "org_id": org_id},
        )
    ).scalar()
    if not name:
        raise HTTPException(status_code=404, detail="Client organization not found")
    return str(name)


async def _client_contact_name_or_404(db: AsyncSession, client_id: UUID, org_id: str) -> str:
    name = (
        await db.execute(
            text("""
                SELECT COALESCE(NULLIF(contact_name, ''), NULLIF(first_name || ' ' || last_name, ' '), email, phone)
                FROM crm.contacts
                WHERE id = :client_id
                  AND organization_id = :org_id
                  AND is_deleted = false
            """),
            {"client_id": client_id, "org_id": org_id},
        )
    ).scalar()
    if not name:
        raise HTTPException(status_code=404, detail="Individual client contact not found")
    return str(name)


def _result(data, message: str, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def _seed_pre_mobilisation_checks(db: AsyncSession, *, org_id: str, project_id: UUID, user_id: str) -> int:
    created = 0
    for sort_order, (gate, evidence) in enumerate(PRE_MOBILISATION_GATES, start=1):
        row = await db.execute(
            text("""
                INSERT INTO projects.project_checks (
                    project_id, organization_id, check_name, check_type, status
                )
                SELECT :project_id, :org_id, :check_name, :check_type, 'incomplete'
                WHERE NOT EXISTS (
                    SELECT 1 FROM projects.project_checks
                    WHERE project_id = :project_id
                      AND organization_id = :org_id
                      AND check_type = :check_type
                      AND check_name = :check_name
                )
                RETURNING id
            """),
            {
                "project_id": project_id,
                "org_id": org_id,
                "check_name": gate,
                "check_type": PRE_MOBILISATION_GATE_TYPE,
                "sort_order": sort_order,
                "user_id": user_id,
            },
        )
        if row.first():
            created += 1
    return created


async def _pre_mobilisation_readiness(db: AsyncSession, *, org_id: str, project_id: UUID) -> dict:
    rows = (
        await db.execute(
            text("""
                SELECT id, check_name, check_type, status, completed_at, evidence_reference, created_at
                FROM projects.project_checks
                WHERE project_id = :project_id
                  AND organization_id = :org_id
                  AND check_type = :check_type
                ORDER BY created_at, check_name
            """),
            {"project_id": project_id, "org_id": org_id, "check_type": PRE_MOBILISATION_GATE_TYPE},
        )
    ).mappings().all()
    required_evidence = dict(PRE_MOBILISATION_GATES)
    checks = [
        {**dict(row), "mandatory_evidence": required_evidence.get(row["check_name"], "Evidence required")}
        for row in rows
    ]
    missing = [
        check["check_name"]
        for check in checks
        if str(check.get("status") or "").lower() not in PRE_MOBILISATION_READY_STATUSES
    ]
    evidence_missing = [
        check["check_name"]
        for check in checks
        if str(check.get("status") or "").lower() != "not_applicable"
        and not str(check.get("evidence_reference") or "").strip()
    ]
    return {
        "checks": checks,
        "total": len(checks),
        "ready_count": len(checks) - len(missing),
        "missing": missing,
        "evidence_missing": evidence_missing,
        "ready": bool(checks) and not missing and not evidence_missing,
    }


def _normalize_commercial_readiness_pack(raw: dict | None) -> dict:
    source = raw if isinstance(raw, dict) else {}
    pack = {key: bool(source.get(key)) for key in COMMERCIAL_READINESS_CONTROLS}
    authority_status = source.get("authority_status")
    if authority_status in COMMERCIAL_AUTHORITY_STATUSES:
        pack["authority_status"] = authority_status
    elif isinstance(authority_status, str) and authority_status.strip():
        pack["authority_status"] = authority_status.strip().lower().replace(" ", "_")
    return pack


def _commercial_readiness_blockers(pack: dict, manual_blockers: list[str] | None = None) -> list[str]:
    blockers = [label for key, label in COMMERCIAL_READINESS_CONTROLS.items() if not pack.get(key)]
    authority_status = str(pack.get("authority_status") or "").lower()
    if not authority_status:
        blockers.append("Contract authority status has not been recorded")
    elif authority_status in COMMERCIAL_BLOCKING_AUTHORITY_STATUSES:
        blockers.append("Contract authority is commercially unacceptable or only verbal")
    for blocker in manual_blockers or []:
        if isinstance(blocker, str) and blocker.strip():
            blockers.append(blocker.strip())
    return list(dict.fromkeys(blockers))


def _commercial_readiness_status(pack: dict, blockers: list[str], current_status: str | None = None) -> str:
    if current_status == "cleared":
        return "cleared"
    if blockers:
        return "blocked" if any(pack.values()) else "not_started"
    return "ready"


async def _ensure_commercial_readiness_pack(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
) -> dict:
    await db.execute(
        text("""
            INSERT INTO projects.project_profiles (
                project_id, organization_id, commercial_readiness_status
            )
            VALUES (:project_id, :org_id, 'in_progress')
            ON CONFLICT (project_id) DO UPDATE SET
                commercial_readiness_status = CASE
                    WHEN projects.project_profiles.commercial_readiness_status = 'not_started'
                    THEN 'in_progress'
                    ELSE projects.project_profiles.commercial_readiness_status
                END,
                updated_at = NOW()
        """),
        {"project_id": project_id, "org_id": org_id},
    )
    row = (
        await db.execute(
            text("""
                SELECT commercial_readiness_status, commercial_readiness_pack,
                       commercial_readiness_blockers, commercial_clearance_statement,
                       commercial_cleared_at, commercial_cleared_by
                FROM projects.project_profiles
                WHERE project_id = :project_id AND organization_id = :org_id
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).mappings().first()
    return dict(row or {})


async def _open_commercial_readiness_pack(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
) -> None:
    await _ensure_commercial_readiness_pack(db, org_id=org_id, project_id=project_id)


async def _commercial_readiness_summary(
    db: AsyncSession,
    *,
    org_id: str,
    project_id: UUID,
) -> dict:
    row = (
        await db.execute(
            text("""
                SELECT commercial_readiness_status, commercial_readiness_pack,
                       commercial_readiness_blockers, commercial_clearance_statement,
                       commercial_cleared_at, commercial_cleared_by
                FROM projects.project_profiles
                WHERE project_id = :project_id AND organization_id = :org_id
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).mappings().first()
    data = dict(row or {})
    pack = _normalize_commercial_readiness_pack(data.get("commercial_readiness_pack"))
    blockers = list(data.get("commercial_readiness_blockers") or _commercial_readiness_blockers(pack))
    complete_count = sum(1 for key in COMMERCIAL_READINESS_CONTROLS if pack.get(key))
    return {
        "status": data.get("commercial_readiness_status") or "not_started",
        "pack": pack,
        "controls": [
            {"key": key, "label": label, "complete": bool(pack.get(key))}
            for key, label in COMMERCIAL_READINESS_CONTROLS.items()
        ],
        "authority_status": pack.get("authority_status"),
        "blockers": blockers,
        "clearance_statement": data.get("commercial_clearance_statement") or {},
        "cleared_at": data.get("commercial_cleared_at"),
        "cleared_by": data.get("commercial_cleared_by"),
        "total": len(COMMERCIAL_READINESS_CONTROLS),
        "ready_count": complete_count,
        "ready": (data.get("commercial_readiness_status") == "cleared") or (complete_count == len(COMMERCIAL_READINESS_CONTROLS) and not blockers),
    }


async def _ensure_project_can_activate(db: AsyncSession, *, org_id: str, project_id: UUID) -> None:
    approved_at = (
        await db.execute(
            text("""
                SELECT mobilisation_approved_at
                FROM projects.project_profiles
                WHERE project_id = :project_id AND organization_id = :org_id
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).scalar()
    if not approved_at:
        raise HTTPException(
            status_code=409,
            detail="Project cannot become active until the pre-mobilisation readiness gate is approved.",
        )


@router.get("/")
async def list_projects(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    rows = await db.execute(
        text("""
        SELECT p.*, pp.viability_status, pp.budget_amount, pp.forecast_cost,
               pp.region, pp.latitude::float AS latitude, pp.longitude::float AS longitude,
               pp.initiated_by, pp.project_category, pp.investment_required,
               pp.funding_internal, pp.funding_external, pp.intake_completed_at,
               pp.setup_duration_weeks, pp.mobilisation_approved_at,
               pp.mobilisation_approved_by, pp.mobilisation_authorisation_number,
               pp.approved_mobilisation_date, pp.mobilisation_budget,
               pp.mobilisation_conditions, pp.residual_risk_notes,
               pp.commercial_readiness_status, pp.commercial_readiness_pack,
               pp.commercial_readiness_blockers, pp.commercial_clearance_statement,
               pp.commercial_cleared_at, pp.commercial_cleared_by,
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
    fields = payload.model_dump()
    initiated_by = fields.pop("initiated_by")
    setup_duration_weeks = fields.pop("setup_duration_weeks")
    if fields.get("client_org_id"):
        client_org_name = await _client_org_name_or_404(db, fields["client_org_id"], user["org_id"])
        fields["client_name"] = fields.get("client_name") or client_org_name
        fields["client_id"] = None
    elif fields.get("client_id"):
        client_contact_name = await _client_contact_name_or_404(db, fields["client_id"], user["org_id"])
        fields["client_name"] = fields.get("client_name") or client_contact_name
        fields["client_org_id"] = None
    try:
        row = (
            await db.execute(
                text("""
            INSERT INTO projects.projects (name, status, project_code, project_type, client_org_id, client_id, client_name, contract_value, start_date, planned_completion_date, department_id, organization_id, created_by)
            VALUES (:name, :status, :project_code, :project_type, :client_org_id, :client_id, :client_name, :contract_value, :start_date, :planned_completion_date, :department_id, :org_id, :user_id)
            RETURNING id
        """),
                {
                    **fields,
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).first()
        if initiated_by == "company":
            await db.execute(
                text("""
                    INSERT INTO projects.project_profiles (project_id, organization_id, initiated_by, setup_duration_weeks)
                    VALUES (:project_id, :org_id, 'company', :setup_duration_weeks)
                    ON CONFLICT (project_id) DO UPDATE SET initiated_by = 'company', setup_duration_weeks = COALESCE(:setup_duration_weeks, projects.project_profiles.setup_duration_weeks)
                """),
                {"project_id": row.id, "org_id": user["org_id"], "setup_duration_weeks": setup_duration_weeks},
            )
        await ensure_project_operational_setup(
            db, org_id=user["org_id"], project_id=row.id, created_by=user["user_id"]
        )
        await db.commit()
        if initiated_by == "client":
            # Company-initiated projects defer task generation until their
            # structured intake is committed (see commit_project_intake).
            await generate_task_stack(
                db, org_id=user["org_id"], entity_type="project", entity_id=row.id, created_by=user["user_id"],
            )
        return _result({"id": str(row.id)}, "Project created.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="Project code already exists for this organization."
        ) from exc


@router.patch("/{project_id}/intake")
async def update_project_intake(
    project_id: UUID,
    payload: ProjectIntakeUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Saves whichever intake questions have been answered so far - callable
    repeatedly before commit-intake finalizes it. Values already on file are
    preserved for fields left out of this payload."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if project.get("intake_completed_at"):
        raise HTTPException(status_code=409, detail="Intake already committed for this project.")

    fields = payload.model_dump(exclude_none=True)
    row = (
        await db.execute(
            text("""
                INSERT INTO projects.project_profiles (project_id, organization_id, project_category, investment_required, funding_internal, funding_external, setup_duration_weeks)
                VALUES (:project_id, :org_id, :project_category, :investment_required, :funding_internal, :funding_external, :setup_duration_weeks)
                ON CONFLICT (project_id) DO UPDATE SET
                    project_category = COALESCE(:project_category, projects.project_profiles.project_category),
                    investment_required = COALESCE(:investment_required, projects.project_profiles.investment_required),
                    funding_internal = COALESCE(:funding_internal, projects.project_profiles.funding_internal),
                    funding_external = COALESCE(:funding_external, projects.project_profiles.funding_external),
                    setup_duration_weeks = COALESCE(:setup_duration_weeks, projects.project_profiles.setup_duration_weeks)
                RETURNING project_category, investment_required, funding_internal, funding_external, setup_duration_weeks
            """),
            {
                "project_id": project_id,
                "org_id": user["org_id"],
                "project_category": fields.get("project_category"),
                "investment_required": fields.get("investment_required"),
                "funding_internal": fields.get("funding_internal"),
                "funding_external": fields.get("funding_external"),
                "setup_duration_weeks": fields.get("setup_duration_weeks"),
            },
        )
    ).mappings().first()
    await db.commit()

    total = (row["funding_internal"] or 0) + (row["funding_external"] or 0)
    required = row["investment_required"]
    return _result(
        {
            **dict(row),
            "funding_total": total,
            "funding_gap": (required - total) if required is not None else None,
            "funding_coverage_pct": (float(total) / float(required) * 100) if required else None,
        },
        "Intake updated.",
    )


@router.post("/{project_id}/commit-intake", status_code=201)
async def commit_project_intake(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Finalizes a company-initiated project's intake and generates its task
    stack - the trigger the normal client-project flow gets for free at
    creation (see create_project)."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if project.get("initiated_by") != "company":
        raise HTTPException(status_code=409, detail="Only company-initiated projects have an intake to commit.")
    if project.get("intake_completed_at"):
        raise HTTPException(status_code=409, detail="Intake already committed for this project.")
    if not project.get("project_category") or project.get("investment_required") is None:
        raise HTTPException(status_code=422, detail="Project category and required investment must be set before committing.")

    await db.execute(
        text("UPDATE projects.project_profiles SET intake_completed_at = NOW() WHERE project_id = :project_id AND organization_id = :org_id"),
        {"project_id": project_id, "org_id": user["org_id"]},
    )
    await db.commit()
    created = await generate_task_stack(
        db, org_id=user["org_id"], entity_type="project", entity_id=project_id, created_by=user["user_id"],
    )
    return _result({"tasks_created": created}, "Intake committed - task stack generated.")


async def _company_project_or_409(db: AsyncSession, project_id: UUID, org_id: str) -> dict:
    project = await _project_ref_or_404(db, str(project_id), org_id)
    if project.get("initiated_by") != "company":
        raise HTTPException(status_code=409, detail="Only company-initiated projects track setup expenses/revenue.")
    return project


async def _pick_production_cash_account(db: AsyncSession, org_id: str, currency: str = "USD") -> str:
    account_id = (
        await db.execute(
            text("""
                SELECT id FROM finance.cash_accounts
                WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
                ORDER BY (currency = :currency) DESC, created_at ASC
                LIMIT 1
            """),
            {"org_id": org_id, "currency": currency},
        )
    ).scalar()
    if not account_id:
        raise HTTPException(status_code=422, detail="No active cash account is configured.")
    return str(account_id)


@router.get("/{project_id}/production-expenses")
async def list_production_expenses(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    await _company_project_or_409(db, project_id, user["org_id"])
    rows = await db.execute(
        text("""
            SELECT id, cost_category, description, amount, transaction_date, status, posted_at
            FROM finance.cost_transactions
            WHERE organization_id = :org_id AND project_id = :project_id AND source_type = 'project_setup_expense'
            ORDER BY transaction_date DESC, posted_at DESC
        """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    items = [dict(r._mapping) for r in rows]
    total = sum((item["amount"] or 0) for item in items)
    return _result({"items": items, "total": total}, "Production setup expenses listed.")


@router.post("/{project_id}/production-expenses", status_code=201)
async def add_production_expense(
    project_id: UUID,
    payload: ProductionExpenseCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Records a setup-phase (or ongoing) spend against a company-initiated
    project - posts into finance.cost_transactions, the same table every
    live cost writer uses, so it flows into actual-cost project summaries
    automatically. When paid, also posts a matching cashbook outflow so it
    affects cash position, not just project cost."""
    project = await _company_project_or_409(db, project_id, user["org_id"])
    org_id = user["org_id"]
    txn_date = payload.transaction_date or date.today()
    source_id = uuid4()

    await db.execute(
        text("""
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category,
                description, quantity, unit_cost, amount, transaction_date, status, posted_by
            ) VALUES (
                :org_id, :project_id, 'project_setup_expense', :source_id, :cost_category,
                :description, 1, :amount, :amount, :transaction_date, 'posted', :user_id
            )
        """),
        {
            "org_id": org_id, "project_id": project_id, "source_id": source_id,
            "cost_category": payload.cost_category, "description": payload.description,
            "amount": payload.amount, "transaction_date": txn_date, "user_id": user["user_id"],
        },
    )

    cashbook_id = None
    if payload.paid:
        cash_account_id = await _pick_production_cash_account(db, org_id)
        tx_number = f"SETUP-{str(source_id)[:8].upper()}"
        cashbook_row = await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, source_type, source_id, project_id,
                    counterparty_type, counterparty_name, payment_method, description, amount, currency, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :transaction_date,
                    'payment', 'outflow', 'project_setup_expense', :source_id, :project_id,
                    'supplier', :counterparty_name, 'bank_transfer', :description, :amount, 'USD', :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id, "cash_account_id": cash_account_id, "tx_number": tx_number,
                "transaction_date": txn_date, "source_id": source_id, "project_id": project_id,
                "counterparty_name": payload.description, "description": payload.description,
                "amount": payload.amount, "user_id": user["user_id"],
            },
        )
        cashbook_id = str(cashbook_row.scalar())

    await db.commit()
    return _result({"id": str(source_id), "cashbook_transaction_id": cashbook_id}, "Setup expense recorded.")


@router.get("/{project_id}/production-revenue")
async def list_production_revenue(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    await _company_project_or_409(db, project_id, user["org_id"])
    rows = await db.execute(
        text("""
            SELECT id, description, amount, transaction_date, posted_at
            FROM finance.cashbook_transactions
            WHERE organization_id = :org_id AND project_id = :project_id AND source_type = 'production_revenue' AND is_deleted = false
            ORDER BY transaction_date DESC, posted_at DESC
        """),
        {"org_id": user["org_id"], "project_id": project_id},
    )
    items = [dict(r._mapping) for r in rows]
    total = sum((item["amount"] or 0) for item in items)
    return _result({"items": items, "total": total}, "Production revenue listed.")


@router.post("/{project_id}/production-revenue", status_code=201)
async def add_production_revenue(
    project_id: UUID,
    payload: ProductionRevenueCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Records revenue from what a company-initiated project actually sells
    once it's live - there's no client/contract behind it, so this posts
    straight into the cashbook rather than driving a progress-claim
    lifecycle (that's the client-billing model, see
    financial_performance.create_historical_revenue)."""
    project = await _company_project_or_409(db, project_id, user["org_id"])
    if str(project.get("status") or "planning").lower() != "active":
        raise HTTPException(status_code=409, detail="This project must be active before revenue can be recorded.")

    org_id = user["org_id"]
    txn_date = payload.transaction_date or date.today()
    description = payload.description or "Production revenue"
    cash_account_id = await _pick_production_cash_account(db, org_id)
    source_id = uuid4()
    tx_number = f"PRODREV-{str(source_id)[:8].upper()}"

    row = await db.execute(
        text("""
            INSERT INTO finance.cashbook_transactions (
                organization_id, cash_account_id, transaction_number, transaction_date,
                transaction_type, direction, source_type, source_id, project_id,
                counterparty_type, counterparty_name, payment_method, description, amount, currency, posted_by
            ) VALUES (
                :org_id, :cash_account_id, :tx_number, :transaction_date,
                'receipt', 'inflow', 'production_revenue', :source_id, :project_id,
                'customer', :counterparty_name, 'bank_transfer', :description, :amount, 'USD', :user_id
            ) RETURNING id
        """),
        {
            "org_id": org_id, "cash_account_id": cash_account_id, "tx_number": tx_number,
            "transaction_date": txn_date, "source_id": source_id, "project_id": project_id,
            "counterparty_name": description, "description": description,
            "amount": payload.amount, "user_id": user["user_id"],
        },
    )
    cashbook_id = row.scalar()
    await db.commit()
    return _result({"id": str(cashbook_id)}, "Production revenue recorded.")


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
                """SELECT m.*, owner.full_name AS owner_name
                   FROM projects.project_milestones m
                   LEFT JOIN core.users owner ON owner.id = m.owner_id
                   WHERE m.project_id=:project_id AND m.organization_id=:org_id AND m.is_deleted=false
                   ORDER BY m.baseline_date NULLS LAST, m.created_at"""
            ),
            "changes": await rows(
                "SELECT * FROM projects.project_changes WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY created_at DESC"
            ),
            "risks": await rows(
                "SELECT *, CASE WHEN likelihood IS NOT NULL AND impact IS NOT NULL THEN likelihood * impact END AS exposure FROM projects.project_risks WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY (likelihood * impact) DESC NULLS LAST, created_at DESC"
            ),
            "pre_mobilisation": await _pre_mobilisation_readiness(db, org_id=user["org_id"], project_id=project_id),
            "commercial_readiness": await _commercial_readiness_summary(db, org_id=user["org_id"], project_id=project_id),
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


@router.patch("/{project_id}/milestones/{milestone_id}")
async def update_milestone(
    project_id: UUID,
    milestone_id: UUID,
    payload: MilestoneUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Progresses a milestone after creation - mark it in-progress/complete,
    record its actual_date, reassign its owner, etc. Fields left out of the
    payload keep their existing value (same COALESCE pattern as
    update_project_intake)."""
    await _project_or_404(db, project_id, user["org_id"])
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")
    row = (
        await db.execute(
            text("""
                UPDATE projects.project_milestones SET
                    name = COALESCE(:name, name),
                    status = COALESCE(:status, status),
                    baseline_date = COALESCE(:baseline_date, baseline_date),
                    forecast_date = COALESCE(:forecast_date, forecast_date),
                    actual_date = COALESCE(:actual_date, actual_date),
                    weight = COALESCE(:weight, weight),
                    owner_id = COALESCE(:owner_id, owner_id),
                    notes = COALESCE(:notes, notes),
                    updated_at = NOW()
                WHERE id = :milestone_id AND project_id = :project_id AND organization_id = :org_id AND is_deleted = false
                RETURNING id
            """),
            {
                "milestone_id": milestone_id,
                "project_id": project_id,
                "org_id": user["org_id"],
                "name": fields.get("name"),
                "status": fields.get("status"),
                "baseline_date": fields.get("baseline_date"),
                "forecast_date": fields.get("forecast_date"),
                "actual_date": fields.get("actual_date"),
                "weight": fields.get("weight"),
                "owner_id": fields.get("owner_id"),
                "notes": fields.get("notes"),
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Milestone not found.")
    await db.commit()
    return _result({"id": str(row.id)}, "Milestone updated.")


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
        initial_percent_complete = metadata.get("initial_percent_complete")
        initial_costs_incurred = metadata.get("initial_costs_incurred")
        if initial_percent_complete is not None or initial_costs_incurred is not None:
            await db.execute(
                text("""
                INSERT INTO projects.project_profiles (project_id, organization_id, initial_percent_complete, initial_costs_incurred)
                VALUES (:project_id, :org_id, :initial_percent_complete, :initial_costs_incurred)
                ON CONFLICT (project_id) DO UPDATE SET
                    initial_percent_complete = COALESCE(EXCLUDED.initial_percent_complete, projects.project_profiles.initial_percent_complete),
                    initial_costs_incurred = COALESCE(EXCLUDED.initial_costs_incurred, projects.project_profiles.initial_costs_incurred),
                    updated_at = NOW()
            """),
                {
                    "project_id": project_id,
                    "org_id": user["org_id"],
                    "initial_percent_complete": initial_percent_complete,
                    "initial_costs_incurred": initial_costs_incurred,
                },
            )
        if initial_costs_incurred:
            await db.execute(
                text("""
                INSERT INTO finance.cost_transactions (
                    organization_id, project_id, source_type, source_id, cost_category,
                    description, quantity, unit_cost, amount, transaction_date, posted_by
                ) VALUES (
                    :org_id, :project_id, 'project_opening_balance', :project_id, 'other',
                    'Opening balance - costs incurred prior to AEGIS registration', 1, :amount, :amount, CURRENT_DATE, :posted_by
                ) ON CONFLICT (organization_id, source_type, source_id, cost_category) DO NOTHING
            """),
                {
                    "org_id": user["org_id"],
                    "project_id": project_id,
                    "amount": initial_costs_incurred,
                    "posted_by": user["user_id"],
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


@router.post("/{project_id}/confirm-deposit")
async def confirm_project_deposit(
    project_id: UUID,
    payload: ProjectDepositConfirm,
    user: dict = Depends(require_permission("projects.deposit.confirm")),
    db: AsyncSession = Depends(get_db),
):
    """Finance sign-off that a project's deposit has been received. The
    project moves into pre-mobilisation readiness, not active delivery; the
    readiness gate must be approved before mobilisation can start."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if project.get("status") != "pending_deposit":
        raise HTTPException(
            status_code=409,
            detail=f"Project is '{project.get('status')}', not pending deposit confirmation.",
        )

    await db.execute(
        text("""
            UPDATE projects.projects
            SET status = 'pre_mobilisation',
                deposit_confirmed_at = NOW(),
                deposit_confirmed_by = :user_id,
                deposit_reference = :deposit_reference,
                updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "deposit_reference": payload.deposit_reference,
        },
    )
    await _seed_pre_mobilisation_checks(
        db,
        org_id=user["org_id"],
        project_id=project_id,
        user_id=user["user_id"],
    )
    await _open_commercial_readiness_pack(db, org_id=user["org_id"], project_id=project_id)
    await emit_event(
        db,
        user=user,
        event_type="project.pre_mobilisation_opened.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={"deposit_reference": payload.deposit_reference, "notes": payload.notes},
    )
    await db.commit()
    tasks_created = await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="project",
        entity_id=project_id,
        created_by=user["user_id"],
    )
    commercial_tasks_created = await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="commercial_readiness",
        entity_id=project_id,
        created_by=user["user_id"],
    )
    return _result(
        {
            "id": str(project_id),
            "status": "pre_mobilisation",
            "tasks_created": tasks_created,
            "commercial_tasks_created": commercial_tasks_created,
        },
        "Deposit confirmed. Pre-mobilisation gate opened.",
    )


@router.get("/{project_id}/pre-mobilisation")
async def get_pre_mobilisation_readiness(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    await _project_or_404(db, project_id, user["org_id"])
    await _seed_pre_mobilisation_checks(
        db,
        org_id=user["org_id"],
        project_id=project_id,
        user_id=user["user_id"],
    )
    await db.commit()
    return _result(
        await _pre_mobilisation_readiness(db, org_id=user["org_id"], project_id=project_id),
        "Pre-mobilisation readiness retrieved.",
    )


@router.patch("/{project_id}/pre-mobilisation/{check_id}")
async def update_pre_mobilisation_check(
    project_id: UUID,
    check_id: UUID,
    payload: PreMobilisationCheckUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    await _project_or_404(db, project_id, user["org_id"])
    completed_at_sql = "NOW()" if payload.status in {"complete", "complete_with_conditions", "not_applicable"} else "NULL"
    row = (
        await db.execute(
            text(f"""
                UPDATE projects.project_checks
                SET status = :status,
                    evidence_reference = COALESCE(:evidence_reference, evidence_reference),
                    completed_at = {completed_at_sql}
                WHERE id = :check_id
                  AND project_id = :project_id
                  AND organization_id = :org_id
                  AND check_type = :check_type
                RETURNING id
            """),
            {
                "check_id": check_id,
                "project_id": project_id,
                "org_id": user["org_id"],
                "check_type": PRE_MOBILISATION_GATE_TYPE,
                "status": payload.status,
                "evidence_reference": payload.evidence_reference,
            },
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Pre-mobilisation check not found.")
    await db.commit()
    return _result({"id": str(check_id)}, "Pre-mobilisation check updated.")


@router.get("/{project_id}/commercial-readiness")
async def get_commercial_readiness(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.commercial_readiness.read")),
):
    await _project_or_404(db, project_id, user["org_id"])
    await _ensure_commercial_readiness_pack(db, org_id=user["org_id"], project_id=project_id)
    await db.commit()
    tasks_created = await generate_task_stack(
        db,
        org_id=user["org_id"],
        entity_type="commercial_readiness",
        entity_id=project_id,
        created_by=user["user_id"],
    )
    summary = await _commercial_readiness_summary(db, org_id=user["org_id"], project_id=project_id)
    summary["tasks_created"] = tasks_created
    return _result(summary, "Commercial readiness retrieved.")


@router.patch("/{project_id}/commercial-readiness")
async def update_commercial_readiness(
    project_id: UUID,
    payload: CommercialReadinessUpdate,
    user: dict = Depends(require_permission("projects.commercial_readiness.update")),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    current = await _ensure_commercial_readiness_pack(db, org_id=user["org_id"], project_id=project_id)
    pack = _normalize_commercial_readiness_pack(current.get("commercial_readiness_pack"))
    for key, value in payload.readiness_pack.items():
        if key in COMMERCIAL_READINESS_CONTROLS:
            pack[key] = bool(value)
        else:
            pack[key] = value
    if payload.authority_status:
        pack["authority_status"] = payload.authority_status
    blockers = _commercial_readiness_blockers(pack, payload.manual_blockers)
    status = _commercial_readiness_status(pack, blockers, current.get("commercial_readiness_status"))
    if status == "cleared" and blockers:
        status = "blocked"

    await db.execute(
        text("""
            UPDATE projects.project_profiles
            SET commercial_readiness_status = :status,
                commercial_readiness_pack = CAST(:pack AS jsonb),
                commercial_readiness_blockers = CAST(:blockers AS jsonb),
                commercial_clearance_statement = CAST(:clearance_statement AS jsonb),
                commercial_cleared_at = CASE WHEN :status = 'cleared' THEN commercial_cleared_at ELSE NULL END,
                commercial_cleared_by = CASE WHEN :status = 'cleared' THEN commercial_cleared_by ELSE NULL END,
                updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "status": status,
            "pack": json.dumps(pack, default=str),
            "blockers": json.dumps(blockers, default=str),
            "clearance_statement": json.dumps(payload.clearance_statement, default=str),
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="project.commercial_readiness_updated.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={"status": status, "blockers": blockers},
    )
    await db.commit()
    return _result(
        await _commercial_readiness_summary(db, org_id=user["org_id"], project_id=project_id),
        "Commercial readiness updated.",
    )


@router.post("/{project_id}/commercial-readiness/clear")
async def clear_commercial_readiness(
    project_id: UUID,
    payload: CommercialClearancePayload,
    user: dict = Depends(require_permission("projects.commercial_readiness.clear")),
    db: AsyncSession = Depends(get_db),
):
    await _project_or_404(db, project_id, user["org_id"])
    current = await _ensure_commercial_readiness_pack(db, org_id=user["org_id"], project_id=project_id)
    pack = _normalize_commercial_readiness_pack(current.get("commercial_readiness_pack"))
    blockers = list(current.get("commercial_readiness_blockers") or _commercial_readiness_blockers(pack))
    if blockers:
        raise HTTPException(status_code=409, detail=f"Commercial readiness is blocked: {', '.join(blockers)}")

    incomplete = [label for key, label in COMMERCIAL_READINESS_CONTROLS.items() if not pack.get(key)]
    if incomplete:
        raise HTTPException(status_code=409, detail=f"Commercial readiness is incomplete: {', '.join(incomplete)}")

    statement = payload.model_dump(mode="json")
    await db.execute(
        text("""
            UPDATE projects.project_profiles
            SET commercial_readiness_status = 'cleared',
                commercial_readiness_blockers = '[]'::jsonb,
                commercial_clearance_statement = CAST(:statement AS jsonb),
                commercial_cleared_at = NOW(),
                commercial_cleared_by = :user_id,
                updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "statement": json.dumps(statement, default=str),
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="project.commercial_readiness_cleared.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data=statement,
    )
    await db.commit()
    return _result(
        await _commercial_readiness_summary(db, org_id=user["org_id"], project_id=project_id),
        "Commercial readiness cleared.",
    )


@router.post("/{project_id}/pre-mobilisation/approve")
async def approve_pre_mobilisation(
    project_id: UUID,
    payload: PreMobilisationApproval,
    user: dict = Depends(require_permission("projects.registration.approve")),
    db: AsyncSession = Depends(get_db),
):
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if str(project.get("status") or "").lower() not in {"pre_mobilisation", "planning", "pending_deposit"}:
        raise HTTPException(status_code=409, detail="Only a project in pre-mobilisation or planning can be authorised for mobilisation.")

    await _seed_pre_mobilisation_checks(
        db,
        org_id=user["org_id"],
        project_id=project_id,
        user_id=user["user_id"],
    )
    readiness = await _pre_mobilisation_readiness(db, org_id=user["org_id"], project_id=project_id)
    if not readiness["ready"]:
        blocked_by = readiness["missing"] + readiness["evidence_missing"]
        raise HTTPException(
            status_code=409,
            detail=f"Pre-mobilisation gate is not ready: {', '.join(dict.fromkeys(blocked_by))}",
        )
    commercial = await _commercial_readiness_summary(db, org_id=user["org_id"], project_id=project_id)
    if commercial["status"] != "cleared":
        blocked_by = commercial["blockers"] or [
            item["label"] for item in commercial["controls"] if not item["complete"]
        ]
        raise HTTPException(
            status_code=409,
            detail=f"Commercial readiness must be cleared before mobilisation: {', '.join(dict.fromkeys(blocked_by))}",
        )

    auth_number = f"MOB-{date.today().strftime('%Y%m%d')}-{str(project_id)[:8].upper()}"
    await db.execute(
        text("""
            INSERT INTO projects.project_profiles (
                project_id, organization_id, mobilisation_approved_at, mobilisation_approved_by,
                mobilisation_authorisation_number, approved_mobilisation_date, mobilisation_budget,
                mobilisation_conditions, residual_risk_notes
            )
            VALUES (
                :project_id, :org_id, NOW(), :user_id, :auth_number, :mobilisation_date,
                :mobilisation_budget, :conditions, :residual_risk_notes
            )
            ON CONFLICT (project_id) DO UPDATE SET
                mobilisation_approved_at = NOW(),
                mobilisation_approved_by = :user_id,
                mobilisation_authorisation_number = :auth_number,
                approved_mobilisation_date = :mobilisation_date,
                mobilisation_budget = :mobilisation_budget,
                mobilisation_conditions = :conditions,
                residual_risk_notes = :residual_risk_notes,
                updated_at = NOW()
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "auth_number": auth_number,
            "mobilisation_date": payload.mobilisation_date,
            "mobilisation_budget": payload.mobilisation_budget,
            "conditions": payload.conditions,
            "residual_risk_notes": payload.residual_risk_notes,
        },
    )
    await db.execute(
        text("""
            UPDATE projects.projects
            SET status = 'active', start_date = COALESCE(start_date, :mobilisation_date), updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {"project_id": project_id, "org_id": user["org_id"], "mobilisation_date": payload.mobilisation_date},
    )
    await emit_event(
        db,
        user=user,
        event_type="project.mobilisation_authorised.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={
            "authorisation_number": auth_number,
            "mobilisation_date": str(payload.mobilisation_date),
            "mobilisation_budget": str(payload.mobilisation_budget) if payload.mobilisation_budget is not None else None,
        },
    )
    await db.commit()
    return _result(
        {"id": str(project_id), "status": "active", "mobilisation_authorisation_number": auth_number},
        "Mobilisation authorised. Project is now active.",
    )


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
    current_project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(status_code=400, detail="No project changes were supplied.")
    if values.get("client_org_id"):
        client_org_name = await _client_org_name_or_404(db, values["client_org_id"], user["org_id"])
        values["client_name"] = values.get("client_name") or client_org_name
        values["client_id"] = None
    elif values.get("client_id"):
        client_contact_name = await _client_contact_name_or_404(db, values["client_id"], user["org_id"])
        values["client_name"] = values.get("client_name") or client_contact_name
        values["client_org_id"] = None
    if (
        str(values.get("status") or "").lower() == "active"
        and str(current_project.get("status") or "").lower() != "active"
    ):
        await _ensure_project_can_activate(db, org_id=user["org_id"], project_id=project_id)

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
    updated_project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    return _result(updated_project, "Project updated.")


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.delete")),
):
    await _project_or_404(db, project_id, user["org_id"])

    blockers = await find_project_blockers(db, project_id)
    if blockers:
        # Real activity exists somewhere - refuse the wipe and fall back to
        # the same soft-delete/archive this endpoint always did, so the
        # action still does *something* rather than a bare refusal.
        await db.execute(
            text(
                "UPDATE projects.projects SET is_deleted=true, updated_at=NOW() WHERE id=:project_id AND organization_id=:org_id"
            ),
            {"project_id": project_id, "org_id": user["org_id"]},
        )
        await db.commit()
        await cascade_delete_entity_tasks(db, org_id=user["org_id"], entity_type="project", entity_id=project_id)
        return _result(
            {"wiped": False, "archived": True, "blocked_by": blockers},
            "Project has linked records - archived instead of permanently deleted.",
        )

    await hard_delete_project(db, org_id=user["org_id"], project_id=project_id)
    return _result({"wiped": True, "archived": False, "blocked_by": []}, "Project permanently deleted.")
