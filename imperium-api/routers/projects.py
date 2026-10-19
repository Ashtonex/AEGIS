"""Tenant-safe project lifecycle, programme, commercial and risk controls."""

import json
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import gather_reads, get_db
from core.logging import logger
from core.security import get_current_user, require_permission, require_any_permission, user_has_permission
from core.project_scope import enforce_project_path_scope, project_scope_sql, visible_project_ids
from app.shared.events import emit_event, emit_notification
from app.shared.sql import safe_payload_columns, tenant_upsert_sql, update_tenant_row_sql
from app.shared.task_stacks import generate_task_stack, cascade_delete_entity_tasks
from app.shared.task_gates import (
    COMMERCIAL_READINESS as COMMERCIAL_READINESS_GATE,
    PROJECT_CHECK,
    complete_stage_pack,
    sync_tasks_from_gate,
)
from app.shared.project_delete import (
    find_project_blockers,
    hard_delete_project,
    money_attached,
    purge_project_in_entirety,
)
from app.shared.project_setup import ensure_project_operational_setup
from app.services.microsoft.project_calendar import sync_milestone, sync_mobilisation
from app.services.finance.deposit_recognition import NoCashAccountError, recognise_deposit_as_claimed_revenue
from app.services.finance.project_forecast import seed_boq_line_items_from_quotation
from app.services.project_cpm import CyclicDependencyError, calculate_cpm_schedule, recalculate_and_persist_project_cpm
from app.services.project_plant import get_project_plant_analytics, record_project_plant_shift_log
from app.services.project_delays_eot import (
    list_project_delays,
    create_project_delay,
    list_project_eot_claims,
    create_project_eot_claim,
    determine_project_eot_claim,
)
from app.services.project_progress_pack import (
    list_project_drawings,
    record_controlled_drawing,
    list_project_photos,
    record_progress_photo,
    generate_project_progress_pack,
)
from app.services.project_evm import calculate_project_evm

# Every /{project_id} route is limited to the caller's visible projects.
router = APIRouter(dependencies=[Depends(enforce_project_path_scope)])

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
    opportunity_id: Optional[UUID] = None
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


class ProjectBudgetLineSet(BaseModel):
    cost_code: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=255)
    cost_category: Literal["labour", "equipment", "materials", "subcontract", "overhead", "other"] = "other"
    quantity: Optional[Decimal] = Field(default=None, gt=0)
    unit: Optional[str] = Field(default=None, max_length=40)
    unit_rate: Optional[Decimal] = Field(default=None, ge=0)
    amount: Decimal = Field(gt=0)
    source_line: Optional[int] = Field(default=None, ge=1)


class ProjectBudgetSet(BaseModel):
    total_amount: Decimal = Field(gt=0)
    notes: Optional[str] = None
    budget_stage: Literal["master", "execution"] = "master"
    lines: list[ProjectBudgetLineSet] = Field(default_factory=list, max_length=5000)


class ProjectDepositConfirm(BaseModel):
    deposit_received_amount: Decimal = Field(gt=0)
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
    duration_days: Optional[int] = Field(default=1, ge=0)
    predecessor_id: Optional[UUID] = None
    lag_days: Optional[int] = Field(default=0)
    dependency_type: Optional[Literal["FS", "SS", "FF", "SF"]] = "FS"


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
    duration_days: Optional[int] = Field(default=None, ge=0)
    predecessor_id: Optional[UUID] = None
    lag_days: Optional[int] = None
    dependency_type: Optional[Literal["FS", "SS", "FF", "SF"]] = None


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


async def _project_name(db: AsyncSession, project_id: UUID, org_id: str) -> str:
    """Display name for calendar subjects (Phase 15/16) - falls back to the
    project code, then the raw ID, rather than ever syncing a blank subject."""
    row = (
        await db.execute(
            text("SELECT name, project_code FROM projects.projects WHERE id = :project_id AND organization_id = :org_id"),
            {"project_id": project_id, "org_id": org_id},
        )
    ).mappings().first()
    if not row:
        return str(project_id)
    return row["name"] or row["project_code"] or str(project_id)


async def _sync_milestone_calendar(db: AsyncSession, *, org_id: str, project_id: UUID, milestone_id: UUID) -> None:
    """Best-effort: re-reads the milestone after commit and upserts/cancels
    its Microsoft event depending on current status/date. Never lets
    anything escape to the caller (Phase 22)."""
    try:
        milestone = (
            await db.execute(
                text("""
                    SELECT name, status, forecast_date, baseline_date FROM projects.project_milestones
                    WHERE id = :milestone_id AND project_id = :project_id AND organization_id = :org_id AND is_deleted = false
                """),
                {"milestone_id": milestone_id, "project_id": project_id, "org_id": org_id},
            )
        ).mappings().first()
        if not milestone:
            return
        await sync_milestone(
            db, organization_id=org_id, project_id=project_id, milestone_id=milestone_id,
            milestone_name=milestone["name"], status=milestone["status"],
            project_name=await _project_name(db, project_id, org_id),
            milestone_date=milestone["forecast_date"] or milestone["baseline_date"],
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001 - must never propagate
        await db.rollback()
        logger.warning("microsoft_graph.project_milestone_calendar_sync_errored", milestone_id=str(milestone_id), error=str(exc))


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
                    WHERE project_id = :project_id_exists
                      AND organization_id = :org_id_exists
                      AND check_type = :check_type_exists
                      AND check_name = :check_name_exists
                )
                RETURNING id
            """),
            {
                "project_id": project_id,
                "org_id": org_id,
                "check_name": gate,
                "check_type": PRE_MOBILISATION_GATE_TYPE,
                "project_id_exists": project_id,
                "org_id_exists": org_id,
                "check_type_exists": PRE_MOBILISATION_GATE_TYPE,
                "check_name_exists": gate,
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
    blocked = set(missing) | set(evidence_missing)
    return {
        "checks": checks,
        "total": len(checks),
        "ready_count": len(checks) - len(blocked),
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
    # Site roles only see the projects they're assigned to.
    scope_sql, scope_params = project_scope_sql("p.id", await visible_project_ids(db, user))
    rows = await db.execute(
        text(f"""
        SELECT p.*, pp.viability_status, pp.budget_amount, pp.forecast_cost,
               pp.region, CAST(pp.latitude AS float) AS latitude, CAST(pp.longitude AS float) AS longitude,
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
        WHERE p.organization_id = :org_id AND p.is_deleted = false AND {scope_sql}
        GROUP BY p.id, pp.project_id
        ORDER BY p.updated_at DESC LIMIT 100
    """),
        {"org_id": user["org_id"], **scope_params},
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

    def rows(query: str):
        async def read(session: AsyncSession):
            return [dict(r._mapping) for r in await session.execute(text(query), params)]

        return read

    async def read_project(session: AsyncSession):
        return (
            await session.execute(
                text(
                    "SELECT p.*, pp.* FROM projects.projects p LEFT JOIN projects.project_profiles pp ON pp.project_id=p.id AND pp.organization_id=p.organization_id WHERE p.id=:project_id AND p.organization_id=:org_id"
                ),
                params,
            )
        ).first()

    # Everything below is an independent read - run them concurrently.
    project, milestones, changes, risks, pre_mobilisation, commercial_readiness = await gather_reads(
        db,
        read_project,
        rows(
            """SELECT m.*, owner.full_name AS owner_name, pred.name AS predecessor_name
               FROM projects.project_milestones m
               LEFT JOIN core.users owner ON owner.id = m.owner_id
               LEFT JOIN projects.project_milestones pred ON pred.id = m.predecessor_id
               WHERE m.project_id=:project_id AND m.organization_id=:org_id AND m.is_deleted=false
               ORDER BY m.baseline_date NULLS LAST, m.created_at"""
        ),
        rows(
            "SELECT * FROM projects.project_changes WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY created_at DESC"
        ),
        rows(
            "SELECT *, CASE WHEN likelihood IS NOT NULL AND impact IS NOT NULL THEN likelihood * impact END AS exposure FROM projects.project_risks WHERE project_id=:project_id AND organization_id=:org_id AND is_deleted=false ORDER BY (likelihood * impact) DESC NULLS LAST, created_at DESC"
        ),
        lambda session: _pre_mobilisation_readiness(session, org_id=user["org_id"], project_id=project_id),
        lambda session: _commercial_readiness_summary(session, org_id=user["org_id"], project_id=project_id),
    )
    return _result(
        {
            "project": dict(project._mapping),
            "milestones": milestones,
            "changes": changes,
            "risks": risks,
            "pre_mobilisation": pre_mobilisation,
            "commercial_readiness": commercial_readiness,
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
    fields = payload.model_dump()
    row = (
        await db.execute(
            text(
                """INSERT INTO projects.project_milestones (
                    project_id, organization_id, created_by, name, status,
                    baseline_date, forecast_date, actual_date, weight, owner_id, notes,
                    duration_days, predecessor_id, lag_days, dependency_type
                ) VALUES (
                    :project_id, :org_id, :user_id, :name, :status,
                    :baseline_date, :forecast_date, :actual_date, :weight, :owner_id, :notes,
                    COALESCE(:duration_days, 1), :predecessor_id, COALESCE(:lag_days, 0), COALESCE(:dependency_type, 'FS')
                ) RETURNING id"""
            ),
            {
                **fields,
                "project_id": project_id,
                "org_id": user["org_id"],
                "user_id": user["user_id"],
            },
        )
    ).first()
    await db.commit()

    try:
        await recalculate_and_persist_project_cpm(db, user["org_id"], project_id)
    except Exception as cpm_err:
        logger.warning(f"CPM calculation on milestone add non-fatal error: {cpm_err}")

    await _sync_milestone_calendar(db, org_id=user["org_id"], project_id=project_id, milestone_id=row.id)
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
    record its actual_date, reassign its owner, update predecessor, duration, lag, etc."""
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
                    duration_days = COALESCE(:duration_days, duration_days),
                    predecessor_id = CASE WHEN :predecessor_id_provided THEN CAST(:predecessor_id AS uuid) ELSE predecessor_id END,
                    lag_days = COALESCE(:lag_days, lag_days),
                    dependency_type = COALESCE(:dependency_type, dependency_type),
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
                "duration_days": fields.get("duration_days"),
                "predecessor_id_provided": "predecessor_id" in fields,
                "predecessor_id": str(fields["predecessor_id"]) if fields.get("predecessor_id") else None,
                "lag_days": fields.get("lag_days"),
                "dependency_type": fields.get("dependency_type"),
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Milestone not found.")
    await db.commit()

    try:
        await recalculate_and_persist_project_cpm(db, user["org_id"], project_id)
    except Exception as cpm_err:
        logger.warning(f"CPM calculation on milestone update non-fatal error: {cpm_err}")

    calendar_fields = {"name", "status", "baseline_date", "forecast_date"}
    if calendar_fields & set(fields.keys()):
        await _sync_milestone_calendar(db, org_id=user["org_id"], project_id=project_id, milestone_id=milestone_id)

    return _result({"id": str(row.id)}, "Milestone updated.")


@router.delete("/{project_id}/milestones/{milestone_id}")
async def delete_milestone(
    project_id: UUID,
    milestone_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Soft-deletes a milestone and cleans up downstream references."""
    await _project_or_404(db, project_id, user["org_id"])
    row = (
        await db.execute(
            text("""
                UPDATE projects.project_milestones SET
                    is_deleted = true,
                    updated_at = NOW()
                WHERE id = :milestone_id AND project_id = :project_id AND organization_id = :org_id AND is_deleted = false
                RETURNING id
            """),
            {"milestone_id": milestone_id, "project_id": project_id, "org_id": user["org_id"]},
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Milestone not found.")

    await db.execute(
        text("""
            UPDATE projects.project_milestones SET predecessor_id = NULL
            WHERE predecessor_id = :milestone_id AND project_id = :project_id AND organization_id = :org_id
        """),
        {"milestone_id": milestone_id, "project_id": project_id, "org_id": user["org_id"]},
    )
    await db.commit()

    try:
        await recalculate_and_persist_project_cpm(db, user["org_id"], project_id)
    except Exception as cpm_err:
        logger.warning(f"CPM calculation on milestone delete non-fatal error: {cpm_err}")

    return _result({"id": str(milestone_id)}, "Milestone deleted.")


@router.post("/{project_id}/schedule/calculate-cpm")
async def trigger_cpm_calculation(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.update")),
):
    """Triggers Critical Path Method (CPM) calculation across all project milestones.
    Computes Early Start/Finish, Late Start/Finish, Total Float, and tags Critical Path.
    """
    await _project_or_404(db, project_id, user["org_id"])
    try:
        updated_milestones = await recalculate_and_persist_project_cpm(db, user["org_id"], project_id)
        critical_count = sum(1 for m in updated_milestones if m.get("is_critical"))
        return _result(
            {
                "milestones": updated_milestones,
                "total_milestones": len(updated_milestones),
                "critical_milestones": critical_count,
            },
            f"Schedule CPM calculation complete. {critical_count} critical path activities identified."
        )
    except CyclicDependencyError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Circular dependency detected in project schedule: {' -> '.join(exc.cycle_nodes)}. Break the loop to calculate CPM."
        )


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


@router.get("/{project_id}/team")
async def get_project_team(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    """Live roster of everyone allocated to this project, sourced directly
    from hr.project_allocations (the same table the workforce-assignment
    action writes to) and enriched with each employee's real position/trade
    and category from HR master data."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    rows = await db.execute(
        text("""
        SELECT
          a.id AS allocation_id, a.employee_id, a.role_on_project, a.allocation_percent,
          a.starts_on, a.ends_on, a.status, a.notes, a.created_at,
          e.employee_name, e.employee_number, e.job_title, e.employment_type, e.employment_status,
          wc.name AS category_name, wc.payroll_eligible,
          pos.name AS position_name, pos.trade, pos.grade,
          cu.email AS assigned_by_email,
          (a.status IN ('planned','active') AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)) AS is_current
        FROM hr.project_allocations a
        JOIN hr.employees e ON e.id = a.employee_id AND e.organization_id = a.organization_id
        LEFT JOIN hr.worker_categories wc ON wc.id = e.category_id AND wc.organization_id = a.organization_id
        LEFT JOIN hr.positions pos ON pos.id = e.position_id AND pos.organization_id = a.organization_id
        LEFT JOIN core.users cu ON cu.id = a.created_by
        WHERE a.organization_id = :org_id AND a.project_id = :project_id AND a.is_deleted = false

        UNION ALL

        SELECT
          w.id AS allocation_id, NULL::uuid AS employee_id, w.trade AS role_on_project, 100.0 AS allocation_percent,
          w.start_date AS starts_on, w.end_date AS ends_on, w.status, w.notes, w.created_at,
          w.full_name AS employee_name, COALESCE(w.national_id, 'HIRE') AS employee_number,
          w.trade AS job_title, 'project_hire' AS employment_type, 'active' AS employment_status,
          'Project Hire' AS category_name, false AS payroll_eligible,
          w.trade AS position_name, w.trade, 'Site' AS grade,
          NULL::character varying AS assigned_by_email,
          (w.status = 'active' AND (w.end_date IS NULL OR w.end_date >= CURRENT_DATE)) AS is_current
        FROM finance.site_workers w
        WHERE w.organization_id = :org_id AND w.project_id = :project_id AND w.is_deleted = false

        ORDER BY is_current DESC, starts_on DESC
        """),
        {"org_id": user["org_id"], "project_id": project["id"]},
    )
    team = [dict(row._mapping) for row in rows]
    return _result(team, "Project team retrieved.")


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
    current_status = str(project.get("status") or "")
    new_status = "pre_mobilisation" if current_status == "pending_deposit" else current_status

    await db.execute(
        text("""
            UPDATE projects.projects
            SET status = :new_status,
                deposit_confirmed_at = COALESCE(deposit_confirmed_at, NOW()),
                deposit_confirmed_by = COALESCE(deposit_confirmed_by, :user_id),
                deposit_reference = COALESCE(:deposit_reference, deposit_reference),
                deposit_received_amount = COALESCE(deposit_received_amount, 0) + :deposit_received_amount,
                updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "new_status": new_status,
            "deposit_reference": payload.deposit_reference,
            "deposit_received_amount": payload.deposit_received_amount,
        },
    )
    if current_status == "pending_deposit":
        await _seed_pre_mobilisation_checks(
            db,
            org_id=user["org_id"],
            project_id=project_id,
            user_id=user["user_id"],
        )
        await _open_commercial_readiness_pack(db, org_id=user["org_id"], project_id=project_id)

    # Finance sign-off on the deposit is itself claimed revenue and cash in
    # hand - drive it through the same progress_claims lifecycle (create ->
    # certify -> pay) a live billing claim uses, so it shows up as certified/
    # claimed value, cash collected and GL revenue in the Finance module
    # instead of only living on the project record. Same shared helper the
    # backfill script uses for deposits confirmed before this existed.
    deposit_amount = float(payload.deposit_received_amount)
    try:
        recognition = await recognise_deposit_as_claimed_revenue(
            db,
            org_id=user["org_id"],
            project_id=project_id,
            project_name=project.get("name"),
            contract_value=float(project.get("contract_value") or 0),
            department_id=project.get("department_id"),
            deposit_amount=deposit_amount,
            deposit_reference=payload.deposit_reference,
            notes=payload.notes,
            user_id=user["user_id"],
        )
    except NoCashAccountError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    claim_id = recognition["claim_id"]
    gl_proposal_warning = recognition["gl_proposal_warning"]

    await emit_event(
        db,
        user=user,
        event_type="project.pre_mobilisation_opened.v1",
        aggregate_type="project",
        aggregate_id=project_id,
        project_id=project_id,
        event_data={
            "deposit_reference": payload.deposit_reference,
            "deposit_received_amount": str(payload.deposit_received_amount),
            "notes": payload.notes,
            "progress_claim_id": str(claim_id),
        },
    )
    # The deposit pack (invoice / chase / confirm) was driving toward exactly
    # this - close it off with the deposit as its evidence.
    await complete_stage_pack(
        db,
        org_id=user["org_id"],
        entity_type="project",
        entity_id=str(project_id),
        stage="pending_deposit",
        evidence_ref=f"Deposit confirmed: {payload.deposit_reference or payload.deposit_received_amount}",
        user_id=user["user_id"],
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
    response = {
        "id": str(project_id),
        "status": "pre_mobilisation",
        "deposit_received_amount": str(payload.deposit_received_amount),
        "progress_claim_id": str(claim_id),
        "tasks_created": tasks_created,
        "commercial_tasks_created": commercial_tasks_created,
    }
    if gl_proposal_warning:
        response["gl_proposal_warning"] = gl_proposal_warning
    return _result(response, "Deposit confirmed. Pre-mobilisation gate opened and recognised in Finance as claimed revenue.")


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
                RETURNING id, check_name, evidence_reference
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
    # Keep the linked task in step with the gate (app/shared/task_gates.py).
    await sync_tasks_from_gate(
        db,
        org_id=user["org_id"],
        project_id=str(project_id),
        target_type=PROJECT_CHECK,
        field=row.check_name,
        done=payload.status in PRE_MOBILISATION_READY_STATUSES,
        evidence_ref=row.evidence_reference,
        user_id=user["user_id"],
    )
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
    pack_before = dict(pack)
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
                commercial_cleared_at = CASE WHEN :status_check = 'cleared' THEN commercial_cleared_at ELSE NULL END,
                commercial_cleared_by = CASE WHEN :status_check = 'cleared' THEN commercial_cleared_by ELSE NULL END,
                updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
        """),
        {
            "project_id": project_id,
            "org_id": user["org_id"],
            "status": status,
            "status_check": status,
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
    # Controls ticked/unticked here complete/reopen their linked tasks.
    for key in COMMERCIAL_READINESS_CONTROLS:
        if bool(pack.get(key)) != bool(pack_before.get(key)):
            await sync_tasks_from_gate(
                db,
                org_id=user["org_id"],
                project_id=str(project_id),
                target_type=COMMERCIAL_READINESS_GATE,
                field=key,
                done=bool(pack.get(key)),
                evidence_ref="Ticked on the project's commercial readiness pack",
                user_id=user["user_id"],
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

    # Best-effort Microsoft Calendar sync (Phase 15/16) - never fails an
    # already-authorised mobilisation.
    try:
        await sync_mobilisation(
            db, organization_id=user["org_id"], project_id=project_id,
            project_name=project.get("name") or project.get("project_code") or str(project_id),
            project_code=project.get("project_code"), mobilisation_date=payload.mobilisation_date,
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        logger.warning("microsoft_graph.project_mobilisation_calendar_errored", project_id=str(project_id), error=str(exc))

    return _result(
        {"id": str(project_id), "status": "active", "mobilisation_authorisation_number": auth_number},
        "Mobilisation authorised. Project is now active.",
    )


@router.post("/{project_id}/budget", status_code=201)
async def set_project_budget(
    project_id: str,
    payload: ProjectBudgetSet,
    user: dict = Depends(require_permission("projects.registration.approve")),
    db: AsyncSession = Depends(get_db),
):
    """Save a versioned master baseline or an execution-budget review draft.

    Master versions remain immutable in history when superseded. Execution
    uploads are retained as drafts and never replace the approved baseline.
    A project's FIRST master baseline can be set by anyone holding project
    registration approval (initial setup). Once a baseline has been
    approved/protected, superseding it with a new version is a budget-
    ceiling adjustment, not setup, and is restricted to Finance regardless
    of who else happens to hold the broader registration-approve
    permission.
    """
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    if payload.budget_stage == "master":
        existing_protected_baseline = (
            await db.execute(
                text("""
                    SELECT 1 FROM finance.project_budgets
                    WHERE project_id = :project_id AND organization_id = :org_id
                      AND status = 'approved' AND is_deleted = false
                    LIMIT 1
                """),
                {"project_id": project_id, "org_id": user["org_id"]},
            )
        ).scalar()
        if existing_protected_baseline and not await user_has_permission(db, user, "projects.budget_baseline.lock"):
            raise HTTPException(
                status_code=403,
                detail="This project's master budget baseline is already protected. Only Finance can adjust it further.",
            )
        await db.execute(
            text("""
            UPDATE finance.project_budgets
            SET status='superseded', updated_at=NOW()
            WHERE project_id=:project_id AND organization_id=:org_id
              AND status='approved' AND is_deleted=false
        """),
            {"project_id": project_id, "org_id": user["org_id"]},
        )
    else:
        await db.execute(
            text("""
            UPDATE finance.project_budgets
            SET status='cancelled', updated_at=NOW()
            WHERE project_id=:project_id AND organization_id=:org_id
              AND status='draft' AND label='Execution budget review' AND is_deleted=false
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
    is_master = payload.budget_stage == "master"
    row = (
        await db.execute(
            text("""
        INSERT INTO finance.project_budgets (
            organization_id, project_id, budget_version, status, label,
            effective_date, total_amount, notes, approved_by, approved_at, created_by
        ) VALUES (
            :org_id, :project_id, :version, :status, :label,
            CURRENT_DATE, :total_amount, :notes, :approved_by,
            CASE WHEN :is_master THEN NOW() ELSE NULL END, :user_id
        ) RETURNING id
    """),
            {
                "org_id": user["org_id"],
                "project_id": project_id,
                "version": next_version,
                "status": "approved" if is_master else "draft",
                "label": "Protected master budget baseline" if is_master else "Execution budget review",
                "total_amount": payload.total_amount,
                "notes": payload.notes,
                "approved_by": user["user_id"] if is_master else None,
                "is_master": is_master,
                "user_id": user["user_id"],
            },
        )
    ).first()
    budget_id = row.id
    for line in payload.lines:
        cost_code_id = (
            await db.execute(
                text("""
                INSERT INTO finance.cost_codes (
                    organization_id, code, name, category, department_id, created_by
                ) VALUES (
                    :org_id, :code, :name, :category, :department_id, :user_id
                )
                ON CONFLICT (organization_id, code) DO UPDATE SET
                    name=EXCLUDED.name,
                    is_active=true,
                    updated_at=NOW()
                RETURNING id
            """),
                {
                    "org_id": user["org_id"],
                    "code": line.cost_code,
                    "name": line.description,
                    "category": line.cost_category,
                    "department_id": project.get("department_id"),
                    "user_id": user["user_id"],
                },
            )
        ).scalar_one()
        line_notes = "; ".join(
            part
            for part in (
                f"Source line {line.source_line}" if line.source_line else "",
                f"Unit: {line.unit}" if line.unit else "",
            )
            if part
        ) or None
        await db.execute(
            text("""
            INSERT INTO finance.budget_lines (
                organization_id, budget_id, cost_code_id, cost_category,
                description, quantity, unit_rate, amount, notes, created_by
            ) VALUES (
                :org_id, :budget_id, :cost_code_id, :cost_category,
                :description, :quantity, :unit_rate, :amount, :notes, :user_id
            )
        """),
            {
                "org_id": user["org_id"],
                "budget_id": budget_id,
                "cost_code_id": cost_code_id,
                "cost_category": line.cost_category,
                "description": line.description,
                "quantity": line.quantity,
                "unit_rate": line.unit_rate,
                "amount": line.amount,
                "notes": line_notes,
                "user_id": user["user_id"],
            },
        )
    await db.commit()
    return _result(
        {
            "id": str(budget_id),
            "budget_stage": payload.budget_stage,
            "status": "approved" if is_master else "draft",
            "line_count": len(payload.lines),
        },
        "Master budget baseline protected." if is_master else "Execution budget saved for review.",
    )


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
    if (
        str(current_project.get("status") or "").lower() == "pending_deposit"
        and str(values.get("status") or "").lower() in ("pre_mobilisation", "active")
    ):
        # A deposit must be confirmed through POST /{project_id}/confirm-deposit
        # (which records who confirmed it, when, and the real amount received)
        # - this generic field-update endpoint must never be a side door past
        # that checkpoint into pre_mobilisation or beyond. Other destinations
        # (cancelled, on_hold, back to field_intake, ...) are legitimate ways
        # to leave pending_deposit without a deposit ever being paid and must
        # stay open.
        raise HTTPException(
            status_code=409,
            detail="A received deposit must be confirmed (Confirm Deposit) before this project can move to pre-mobilisation or active.",
        )

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
            if "opportunity_id" in project_values and project_values["opportunity_id"]:
                await db.execute(
                    text("""
                        UPDATE crm.opportunities
                        SET project_id = :project_id, updated_at = NOW()
                        WHERE id = :opp_id AND organization_id = :org_id
                    """),
                    {
                        "project_id": project_id,
                        "opp_id": project_values["opportunity_id"],
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


@router.post("/{project_id}/link-opportunity/{opportunity_id}")
async def link_project_to_opportunity(
    project_id: UUID,
    opportunity_id: UUID,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Link an existing project to a CRM opportunity deal."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])
    await db.execute(
        text("""
            UPDATE projects.projects
            SET opportunity_id = :opp_id, updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {"opp_id": opportunity_id, "project_id": project_id, "org_id": user["org_id"]},
    )
    await db.execute(
        text("""
            UPDATE crm.opportunities
            SET project_id = :project_id, updated_at = NOW()
            WHERE id = :opp_id AND organization_id = :org_id
        """),
        {"project_id": project_id, "opp_id": opportunity_id, "org_id": user["org_id"]},
    )
    await db.commit()
    return _result({"project_id": str(project_id), "opportunity_id": str(opportunity_id)}, "Project linked to opportunity successfully.")


@router.post("/{project_id}/generate-boq-milestones")
async def generate_boq_milestones(
    project_id: UUID,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Autogenerate weekly project milestones based on BOQ line items or phases."""
    project = await _project_ref_or_404(db, str(project_id), user["org_id"])

    boq_items = (await db.execute(
        text("""
            SELECT item_no, description, contract_amount, cost_category, sort_order
            FROM finance.boq_line_items
            WHERE project_id = :project_id AND organization_id = :org_id AND is_deleted = false
            ORDER BY sort_order ASC, item_no ASC
        """),
        {"project_id": project_id, "org_id": user["org_id"]},
    )).mappings().all()

    start_date = project.get("start_date") or date.today()
    if isinstance(start_date, datetime):
        start_date = start_date.date()

    created_milestones = []

    if boq_items and len(boq_items) > 0:
        categories = []
        for item in boq_items:
            cat = item.get("cost_category") or "General Works"
            if cat not in categories:
                categories.append(cat)

        total_contract = float(project.get("contract_value") or sum(float(i.get("contract_amount") or 0) for i in boq_items) or 100)

        for idx, cat in enumerate(categories):
            cat_items = [i for i in boq_items if (i.get("cost_category") or "General Works") == cat]
            cat_sum = sum(float(i.get("contract_amount") or 0) for i in cat_items)
            w = round((cat_sum / total_contract) * 100, 1) if total_contract > 0 else round(100.0 / len(categories), 1)
            b_date = start_date + timedelta(days=7 * (idx + 1))

            m_name = f"Week {idx + 1}: {cat.replace('_', ' ').title()}"
            m_notes = f"Auto-generated from BOQ: {', '.join([str(i.get('item_no') or '') for i in cat_items[:3]])}"

            row = (await db.execute(
                text("""
                    INSERT INTO projects.project_milestones (
                        organization_id, project_id, name, status,
                        baseline_date, forecast_date, weight, notes,
                        created_by, created_at, updated_at, is_deleted
                    ) VALUES (
                        :org_id, :project_id, :name, 'not_started',
                        :baseline_date, :forecast_date, :weight, :notes,
                        :user_id, NOW(), NOW(), false
                    ) RETURNING id, name, baseline_date, weight
                """),
                {
                    "org_id": user["org_id"],
                    "project_id": project_id,
                    "name": m_name,
                    "baseline_date": b_date,
                    "forecast_date": b_date,
                    "weight": w,
                    "notes": m_notes,
                    "user_id": user["user_id"],
                },
            )).first()
            if row:
                created_milestones.append(dict(row._mapping))
    else:
        stages = [
            ("Week 1: Site Mobilisation & Earthworks", 15.0, "Site establishment, perimeter hoarding, earthworks & excavation."),
            ("Week 2: Substructure & Foundations", 20.0, "Footings, reinforced concrete foundations, and stub columns."),
            ("Week 3: Superstructure & Framing", 25.0, "Brickwork, structural columns, beams and slab casting."),
            ("Week 4: MEP Rough-in & Enclosure", 15.0, "Plumbing, electrical conduit piping, roofing and door/window frames."),
            ("Week 5: Finishes & Surface Treatments", 15.0, "Plastering, screed, tiling, painting, and sanitaryware fixtures."),
            ("Week 6: QA Testing, Snagging & Handover", 10.0, "Pressure testing, electrical commissioning, final cleaning, and client signoff."),
        ]
        for idx, (s_name, s_weight, s_notes) in enumerate(stages):
            b_date = start_date + timedelta(days=7 * (idx + 1))
            row = (await db.execute(
                text("""
                    INSERT INTO projects.project_milestones (
                        organization_id, project_id, name, status,
                        baseline_date, forecast_date, weight, notes,
                        created_by, created_at, updated_at, is_deleted
                    ) VALUES (
                        :org_id, :project_id, :name, 'not_started',
                        :baseline_date, :forecast_date, :weight, :notes,
                        :user_id, NOW(), NOW(), false
                    ) RETURNING id, name, baseline_date, weight
                """),
                {
                    "org_id": user["org_id"],
                    "project_id": project_id,
                    "name": s_name,
                    "baseline_date": b_date,
                    "forecast_date": b_date,
                    "weight": s_weight,
                    "notes": s_notes,
                    "user_id": user["user_id"],
                },
            )).first()
            if row:
                created_milestones.append(dict(row._mapping))

    await db.commit()
    return _result(created_milestones, f"Generated {len(created_milestones)} weekly milestones from programme BOQ.")


@router.get("/{project_id}/delete-impact")
async def get_project_delete_impact(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.delete")),
):
    """What deleting this project would affect - asked before the delete."""
    await _project_or_404(db, project_id, user["org_id"])
    blockers = await find_project_blockers(db, project_id)
    return _result(
        {"money": await money_attached(db, project_id), "blocked_by": blockers, "would_wipe": not blockers},
        "Delete impact computed.",
    )


@router.delete("/{project_id}")
async def delete_project(
    project_id: UUID,
    acknowledge_money: bool = Query(default=False, description="Required when bank lines, claims, costs or ledger entries are attached"),
    purge_all: bool = Query(default=False, description="Permanently delete project and purge all linked records (financial movements, tasks, site logs, etc.)"),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.delete")),
):
    await _project_or_404(db, project_id, user["org_id"])

    money = await money_attached(db, project_id)
    if money["has_money"] and not acknowledge_money:
        # Archiving hides all of this from the Finance dashboard and project
        # pickers - make the caller confirm they know before doing it.
        raise HTTPException(
            status_code=409,
            detail={
                "message": "This project has money attached (bank lines, claims, costs or ledger entries). "
                           "Confirm to archive it anyway, or move its bank lines to another project first.",
                "money": money,
            },
        )

    if purge_all:
        await purge_project_in_entirety(db, org_id=user["org_id"], project_id=project_id)
        return _result(
            {"wiped": True, "archived": False, "blocked_by": []},
            "Project and all associated financial movements and records permanently deleted.",
        )

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


# ==============================================================================
# PROJECT ROLE ASSIGNMENTS & DELEGATION (projects.site_role_assignments)
# ==============================================================================

class ProjectRoleAssignmentCreate(BaseModel):
    user_id: UUID
    role_name: str = Field(min_length=2, max_length=80)
    site_id: Optional[UUID] = None
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None


class ProjectRoleAssignmentUpdate(BaseModel):
    role_name: Optional[str] = None
    site_id: Optional[UUID] = None
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    is_active: Optional[bool] = None
    reason: Optional[str] = None


@router.get("/{project_id}/roles")
async def list_project_roles(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all role assignments and available personnel for a project."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # Query active and inactive assignments
    assignments_res = await db.execute(
        text("""
            SELECT sra.id, sra.project_id, sra.site_id, sra.user_id, sra.role_name,
                   sra.starts_on, sra.ends_on, sra.is_active, sra.created_at,
                   u.full_name AS user_name, u.email AS user_email,
                   ab.full_name AS assigned_by_name,
                   s.name AS site_name
            FROM projects.site_role_assignments sra
            JOIN core.users u ON u.id = sra.user_id
            LEFT JOIN core.users ab ON ab.id = sra.assigned_by
            LEFT JOIN projects.sites s ON s.id = sra.site_id
            WHERE sra.project_id = :project_id AND sra.organization_id = :org_id AND sra.is_deleted = false
            ORDER BY sra.is_active DESC, sra.created_at DESC
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    assignments = [dict(row._mapping) for row in assignments_res]

    # Available system users to assign
    users_res = await db.execute(
        text("""
            SELECT u.id, u.full_name, u.email,
                   COALESCE(
                       (SELECT r.name FROM core.user_roles ur JOIN core.roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.is_deleted = false LIMIT 1),
                       'Member'
                   ) AS role
            FROM core.users u
            WHERE u.organization_id = :org_id AND u.is_active = true AND u.is_deleted = false
            ORDER BY u.full_name ASC
            LIMIT 200
        """),
        {"org_id": user["org_id"]},
    )
    available_users = [dict(row._mapping) for row in users_res]

    return _result({
        "assignments": assignments,
        "available_users": available_users,
        "total_active": len([a for a in assignments if a.get("is_active")]),
    }, "Project role assignments retrieved.")


@router.post("/{project_id}/roles", status_code=201)
async def assign_project_role(
    project_id: str,
    payload: ProjectRoleAssignmentCreate,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Assign or delegate a key responsibility (Project Manager, Site Engineer, Foreman, etc.)."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # Validate target user belongs to tenant
    user_check = (await db.execute(
        text("SELECT id, full_name FROM core.users WHERE id = :user_id AND organization_id = :org_id AND is_deleted = false"),
        {"user_id": payload.user_id, "org_id": user["org_id"]},
    )).first()
    if not user_check:
        raise HTTPException(status_code=404, detail="Target user not found or inactive in organization.")

    # Check for existing assignment to reactivate or update
    existing = (await db.execute(
        text("""
            SELECT id FROM projects.site_role_assignments
            WHERE organization_id = :org_id AND project_id = :project_id AND user_id = :user_id AND role_name = :role_name
        """),
        {
            "org_id": user["org_id"],
            "project_id": resolved_project_id,
            "user_id": payload.user_id,
            "role_name": payload.role_name.strip(),
        },
    )).first()

    if existing:
        await db.execute(
            text("""
                UPDATE projects.site_role_assignments
                SET is_active = true, is_deleted = false,
                    site_id = :site_id, starts_on = :starts_on, ends_on = :ends_on,
                    assigned_by = :assigned_by, updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": existing.id,
                "site_id": payload.site_id,
                "starts_on": payload.starts_on,
                "ends_on": payload.ends_on,
                "assigned_by": user["user_id"],
            },
        )
        assignment_id = existing.id
    else:
        assignment_id = (await db.execute(
            text("""
                INSERT INTO projects.site_role_assignments (
                    organization_id, project_id, site_id, user_id, role_name,
                    starts_on, ends_on, is_active, assigned_by, created_at, updated_at, is_deleted
                ) VALUES (
                    :org_id, :project_id, :site_id, :user_id, :role_name,
                    :starts_on, :ends_on, true, :assigned_by, NOW(), NOW(), false
                ) RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "project_id": resolved_project_id,
                "site_id": payload.site_id,
                "user_id": payload.user_id,
                "role_name": payload.role_name.strip(),
                "starts_on": payload.starts_on,
                "ends_on": payload.ends_on,
                "assigned_by": user["user_id"],
            },
        )).scalar()

    # If assigning Project Manager, update projects.projects.project_manager
    if payload.role_name.strip().lower() in {"project manager", "lead project manager", "pm"}:
        await db.execute(
            text("""
                UPDATE projects.projects
                SET project_manager = :manager_name, updated_at = NOW()
                WHERE id = :project_id AND organization_id = :org_id
            """),
            {
                "manager_name": user_check.full_name,
                "project_id": resolved_project_id,
                "org_id": user["org_id"],
            },
        )

    # Mirror assignment to hr.project_allocations so the project shows up on the employee Person Card / Dossier popup
    emp_row = (await db.execute(
        text("""
            SELECT id FROM hr.employees
            WHERE organization_id = :org_id AND is_deleted = false
              AND (linked_user_id = :user_id OR personal_email = (SELECT email FROM core.users WHERE id = :user_id))
            LIMIT 1
        """),
        {"org_id": user["org_id"], "user_id": payload.user_id},
    )).first()
    if emp_row:
        existing_alloc = (await db.execute(
            text("""
                SELECT id FROM hr.project_allocations
                WHERE organization_id = :org_id AND employee_id = :emp_id AND project_id = :project_id AND is_deleted = false
            """),
            {"org_id": user["org_id"], "emp_id": emp_row.id, "project_id": resolved_project_id},
        )).first()
        if not existing_alloc:
            await db.execute(
                text("""
                    INSERT INTO hr.project_allocations (
                        organization_id, employee_id, project_id, role_on_project,
                        allocation_percent, starts_on, ends_on, status, created_by, created_at, updated_at, is_deleted
                    ) VALUES (
                        :org_id, :emp_id, :project_id, :role_name,
                        100.0, COALESCE(:starts_on, CURRENT_DATE), :ends_on, 'active', :user_id, NOW(), NOW(), false
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "emp_id": emp_row.id,
                    "project_id": resolved_project_id,
                    "role_name": payload.role_name.strip(),
                    "starts_on": payload.starts_on,
                    "ends_on": payload.ends_on,
                    "user_id": user["user_id"],
                },
            )

    await emit_event(
        db,
        user=user,
        event_type="project.role_assigned.v1",
        aggregate_type="project_role_assignment",
        aggregate_id=assignment_id,
        project_id=resolved_project_id,
        event_data={
            "project_id": str(resolved_project_id),
            "assignment_id": str(assignment_id),
            "user_id": str(payload.user_id),
            "role_name": payload.role_name,
            "assigned_by": str(user["user_id"]),
        },
    )

    await db.commit()

    return _result({
        "id": str(assignment_id),
        "user_id": str(payload.user_id),
        "role_name": payload.role_name,
        "user_name": user_check.full_name,
    }, f"Assigned {user_check.full_name} as {payload.role_name}.")


@router.patch("/{project_id}/roles/{assignment_id}")
async def update_project_role(
    project_id: str,
    assignment_id: UUID,
    payload: ProjectRoleAssignmentUpdate,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Update or deactivate a project role assignment."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    existing = (await db.execute(
        text("SELECT * FROM projects.site_role_assignments WHERE id = :id AND project_id = :project_id AND organization_id = :org_id"),
        {"id": assignment_id, "project_id": resolved_project_id, "org_id": user["org_id"]},
    )).first()
    if not existing:
        raise HTTPException(status_code=404, detail="Role assignment not found.")

    updates = []
    params: dict = {"id": assignment_id, "project_id": resolved_project_id, "org_id": user["org_id"]}

    if payload.role_name is not None:
        updates.append("role_name = :role_name")
        params["role_name"] = payload.role_name.strip()
    if payload.site_id is not None:
        updates.append("site_id = :site_id")
        params["site_id"] = payload.site_id
    if payload.starts_on is not None:
        updates.append("starts_on = :starts_on")
        params["starts_on"] = payload.starts_on
    if payload.ends_on is not None:
        updates.append("ends_on = :ends_on")
        params["ends_on"] = payload.ends_on
    if payload.is_active is not None:
        updates.append("is_active = :is_active")
        params["is_active"] = payload.is_active
        if not payload.is_active and not payload.ends_on:
            updates.append("ends_on = CURRENT_DATE")

    if updates:
        updates.append("updated_at = NOW()")
        await db.execute(
            text(f"UPDATE projects.site_role_assignments SET {', '.join(updates)} WHERE id = :id AND project_id = :project_id AND organization_id = :org_id"),
            params,
        )
        await db.commit()

    return _result({"id": str(assignment_id), "updated": True}, "Role assignment updated successfully.")


@router.delete("/{project_id}/roles/{assignment_id}")
async def deactivate_project_role(
    project_id: str,
    assignment_id: UUID,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-deactivate a role assignment, ending future authority while preserving all historical records."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    await db.execute(
        text("""
            UPDATE projects.site_role_assignments
            SET is_active = false, is_deleted = true, ends_on = CURRENT_DATE, updated_at = NOW()
            WHERE id = :id AND project_id = :project_id AND organization_id = :org_id
        """),
        {"id": assignment_id, "project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    await db.commit()

    return _result({"id": str(assignment_id), "deactivated": True}, "Role assignment deactivated and ended.")


# ==============================================================================
# PROJECT HIRES & CASUAL WORKFORCE (finance.site_workers / site_day_attendance)
# ==============================================================================

class ProjectHireCreate(BaseModel):
    full_name: str = Field(min_length=2, max_length=160)
    trade: Optional[str] = Field(default="General Labourer", max_length=80)
    hourly_rate: Optional[Decimal] = Field(default=Decimal("0.0"), ge=0)
    phone: Optional[str] = Field(default=None, max_length=50)
    national_id: Optional[str] = Field(default=None, max_length=50)
    payment_method: Optional[str] = Field(default="cash", max_length=30)
    status_reason: Optional[str] = None


@router.get("/{project_id}/hires")
async def list_project_hires(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all project hires (casual and temporary workers) for this project,
    cleanly deduplicated per unique individual with aggregated site hours and last attendance."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    query = text("""
        WITH attendance_agg AS (
            SELECT 
                a.site_worker_id,
                LOWER(TRIM(a.worker_name)) AS norm_name,
                MAX(a.worker_name) AS att_worker_name,
                MAX(a.trade) AS att_trade,
                SUM(COALESCE(a.regular_hours, 0) + COALESCE(a.overtime_hours, 0)) AS total_hours,
                MAX(a.created_at) AS last_attended,
                CASE 
                    WHEN bool_or(a.hr_status = 'accepted') THEN 'accepted'
                    WHEN bool_or(a.hr_status = 'pending') THEN 'pending'
                    ELSE 'open'
                END AS hr_status
            FROM projects.site_day_attendance a
            WHERE a.project_id = CAST(:project_id AS uuid) 
              AND a.organization_id = CAST(:org_id AS uuid)
              AND a.worker_kind = 'project_hire'
            GROUP BY a.site_worker_id, LOWER(TRIM(a.worker_name))
        ),
        worker_attendance AS (
            SELECT 
                COALESCE(site_worker_id, (
                    SELECT w2.id FROM finance.site_workers w2 
                    WHERE w2.project_id = CAST(:project_id AS uuid) 
                      AND LOWER(TRIM(w2.full_name)) = attendance_agg.norm_name 
                    LIMIT 1
                )) AS resolved_worker_id,
                norm_name,
                MAX(att_worker_name) AS worker_name,
                MAX(att_trade) AS trade,
                SUM(total_hours) AS total_hours,
                MAX(last_attended) AS last_attended,
                MAX(hr_status) AS hr_status
            FROM attendance_agg
            GROUP BY 1, norm_name
        )
        SELECT 
            COALESCE(w.id, wa.resolved_worker_id) AS id,
            COALESCE(w.full_name, wa.worker_name) AS full_name,
            COALESCE(w.trade, wa.trade, 'General Labourer') AS trade,
            COALESCE(w.hourly_rate, 0) AS hourly_rate,
            COALESCE(w.phone, '') AS phone,
            COALESCE(w.national_id, '') AS national_id,
            COALESCE(w.status, 'active') AS status,
            COALESCE(w.registered_via, 'site_register') AS registered_via,
            COALESCE(w.hr_verified, wa.hr_status = 'accepted', false) AS hr_verified,
            COALESCE(wa.hr_status, CASE WHEN w.hr_verified THEN 'accepted' ELSE 'pending' END) AS hr_status,
            COALESCE(wa.total_hours, 0) AS hours_logged,
            wa.last_attended,
            w.created_at
        FROM finance.site_workers w
        FULL OUTER JOIN worker_attendance wa ON wa.resolved_worker_id = w.id
        WHERE (w.project_id = CAST(:project_id AS uuid) OR wa.resolved_worker_id IS NOT NULL)
          AND (w.organization_id = CAST(:org_id AS uuid) OR w.organization_id IS NULL)
          AND (w.is_deleted IS NULL OR w.is_deleted = false)
        ORDER BY status ASC, full_name ASC
    """)
    res = await db.execute(query, {"project_id": resolved_project_id, "org_id": user["org_id"]})
    hires = [dict(row._mapping) for row in res]

    return _result({
        "hires": hires,
        "total": len(hires),
        "active_count": len([h for h in hires if h.get("status") == "active"]),
    }, "Project hires retrieved.")


@router.post("/{project_id}/hires", status_code=201)
async def create_project_hire(
    project_id: str,
    payload: ProjectHireCreate,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Add a new project hire (casual/daily worker) directly to the project workforce."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # Prevent duplicate national ID if given
    if payload.national_id:
        dup = (await db.execute(
            text("SELECT full_name FROM finance.site_workers WHERE organization_id = :org_id AND UPPER(national_id) = UPPER(:nid) AND is_deleted = false"),
            {"org_id": user["org_id"], "nid": payload.national_id.strip()},
        )).scalar()
        if dup:
            raise HTTPException(status_code=409, detail=f"National ID is already registered to {dup}.")

    worker_id = (await db.execute(
        text("""
            INSERT INTO finance.site_workers (
                organization_id, project_id, full_name, trade, hourly_rate,
                phone, national_id, payment_method, status, start_date,
                registered_via, hr_verified, created_by, created_at, updated_at, is_deleted
            ) VALUES (
                :org_id, :project_id, :full_name, :trade, :hourly_rate,
                :phone, :national_id, :payment_method, 'active', CURRENT_DATE,
                'project_module', false, :user_id, NOW(), NOW(), false
            ) RETURNING id
        """),
        {
            "org_id": user["org_id"],
            "project_id": resolved_project_id,
            "full_name": payload.full_name.strip(),
            "trade": payload.trade.strip() if payload.trade else "General Labourer",
            "hourly_rate": payload.hourly_rate or Decimal("0.0"),
            "phone": payload.phone.strip() if payload.phone else None,
            "national_id": payload.national_id.strip() if payload.national_id else None,
            "payment_method": payload.payment_method or "cash",
            "user_id": user["user_id"],
        },
    )).scalar()

    await emit_event(
        db,
        user=user,
        event_type="project.hire_created.v1",
        aggregate_type="project_hire",
        aggregate_id=worker_id,
        project_id=resolved_project_id,
        event_data={
            "project_id": str(resolved_project_id),
            "worker_id": str(worker_id),
            "full_name": payload.full_name,
            "trade": payload.trade,
            "created_by": str(user["user_id"]),
        },
    )

    await db.commit()

    return _result({
        "id": str(worker_id),
        "full_name": payload.full_name,
        "trade": payload.trade,
        "status": "active",
    }, f"Registered {payload.full_name} for this project.")


@router.delete("/{project_id}/hires/{worker_id}")
async def deactivate_project_hire(
    project_id: str,
    worker_id: UUID,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-deactivate (or toggle) a project hire, removing them from upcoming registers while preserving past attendance."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])

    # Check current status
    curr = (await db.execute(
        text("SELECT status FROM finance.site_workers WHERE id = :id AND (organization_id = :org_id OR organization_id IS NULL)"),
        {"id": worker_id, "org_id": user["org_id"]},
    )).scalar()

    new_status = "active" if curr == "inactive" else "inactive"
    reason = "Reactivated for project" if new_status == "active" else "Deactivated from project"
    end_date_val = None if new_status == "active" else date.today()

    await db.execute(
        text("""
            UPDATE finance.site_workers
            SET status = :status, status_reason = :reason,
                end_date = :end_date, updated_at = NOW()
            WHERE id = :id AND (organization_id = :org_id OR organization_id IS NULL)
        """),
        {"id": worker_id, "org_id": user["org_id"], "status": new_status, "reason": reason, "end_date": end_date_val},
    )
    await db.commit()

    return _result({"id": str(worker_id), "status": new_status, "deactivated": (new_status == "inactive")}, f"Worker status updated to {new_status}.")


# ==============================================================================
# PERMANENT ALLOCATIONS REMOVAL (hr.project_allocations)
# ==============================================================================

@router.delete("/{project_id}/allocations/{allocation_id}")
async def remove_project_allocation(
    project_id: str,
    allocation_id: UUID,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Remove / soft-end a permanent employee allocation from this project."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    res = await db.execute(
        text("""
            UPDATE hr.project_allocations
            SET status = 'cancelled', is_deleted = true,
                ends_on = LEAST(ends_on, CURRENT_DATE),
                updated_at = NOW()
            WHERE id = :id AND project_id = :project_id AND organization_id = :org_id
            RETURNING employee_id
        """),
        {"id": allocation_id, "project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Allocation record not found.")

    await db.commit()

    return _result({"id": str(allocation_id), "removed": True}, "Employee allocation removed from project.")


# ==============================================================================
# BULK-CATEGORY BUDGET & QUOTATIONS BRIDGE
# ==============================================================================

CANONICAL_BUDGET_CATEGORIES = [
    {"key": "materials", "label": "Materials & Aggregates", "default_code": "200-MATERIALS"},
    {"key": "labour", "label": "Direct Labour & Supervision", "default_code": "100-LABOUR"},
    {"key": "equipment", "label": "Plant & Heavy Machinery", "default_code": "300-EQUIP"},
    {"key": "subcontract", "label": "Specialist Subcontracts", "default_code": "400-SUBCONT"},
    {"key": "overhead", "label": "Preliminaries & Site Overheads", "default_code": "500-OVERHEAD"},
    {"key": "contingency", "label": "Contingency & Risk Reserve", "default_code": "600-CONTINGENCY"},
    {"key": "other", "label": "Other Project Allowances", "default_code": "700-OTHER"},
]

class QuotationImportPayload(BaseModel):
    quotation_id: Optional[UUID] = None
    notes: Optional[str] = None


class QuotationLinkPayload(BaseModel):
    quotation_id: UUID


def extract_quotation_cost_breakdown(
    quote_id: str,
    quote_meta: Any,
    quote_amount: float = 0.0,
) -> dict[str, float]:
    """Reconstructs real execution cost categories (materials, labour, plant/equipment,
    subcontract, overheads, contingency, other) from quotation metadata.

    First inspects stored `calculation.direct_costs_breakdown`. If missing or all-zero
    (common when quotes are green-lit via BOQ approval without a full CCB re-evaluation),
    it dynamically rolls up each approved BOQ item from `items` by buildup component or
    BOQ section.
    """
    meta = quote_meta if isinstance(quote_meta, dict) else {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}

    calc = meta.get("calculation") if isinstance(meta.get("calculation"), dict) else {}
    breakdown = calc.get("direct_costs_breakdown") if isinstance(calc.get("direct_costs_breakdown"), dict) else {}

    materials = float(breakdown.get("materials") or 0.0)
    labour = float(breakdown.get("labour") or 0.0)
    equipment = float(breakdown.get("equipment") or 0.0)
    subcontract = float(breakdown.get("subcontractors") or 0.0)
    other = float(breakdown.get("other") or 0.0)

    # If breakdown was missing or all zero, reconstruct from items
    if (materials + labour + equipment + subcontract + other) <= 0.0:
        items = meta.get("items") or []
        for it in items:
            if not isinstance(it, dict):
                continue
            qty = float(it.get("qty") or it.get("quantity") or 0.0)
            rate = float(it.get("rate") or it.get("unit_rate") or 0.0)
            line_tot = float(it.get("cost") or it.get("total_amount") or it.get("amount") or (qty * rate) or 0.0)
            cat = str(it.get("category") or it.get("cost_category") or "").lower()
            sec = str(it.get("section") or "").lower()
            desc = str(it.get("description") or "").lower()

            buildup = it.get("buildup") or []
            if buildup and isinstance(buildup, list):
                for b in buildup:
                    if not isinstance(b, dict):
                        continue
                    b_type = str(b.get("type") or "").lower()
                    b_rate = float(b.get("rate") or b.get("amount") or 0.0)
                    b_tot = qty * b_rate
                    if "mat" in b_type:
                        materials += b_tot
                    elif "lab" in b_type:
                        labour += b_tot
                    elif "equip" in b_type or "plant" in b_type:
                        equipment += b_tot
                    elif "sub" in b_type:
                        subcontract += b_tot
                    else:
                        other += b_tot
            else:
                if "mat" in cat or "mat" in sec or "mat" in desc:
                    materials += line_tot
                elif "lab" in cat or "lab" in sec or "lab" in desc:
                    labour += line_tot
                elif "plant" in cat or "equip" in cat or "plant" in sec or "equip" in sec or "hire" in desc:
                    equipment += line_tot
                elif "sub" in cat or "sub" in sec or "specialist" in desc:
                    subcontract += line_tot
                else:
                    other += line_tot

    overhead = float(meta.get("overhead_amount") or calc.get("overhead_amount") or 0.0) + float(
        meta.get("preliminaries") or calc.get("preliminaries") or 0.0
    )
    contingency = float(meta.get("contingency_amount") or calc.get("contingency_amount") or 0.0)

    # Final fallback if quotation has no item breakdown at all
    total_direct = materials + labour + equipment + subcontract + other
    if total_direct <= 0.0 and quote_amount > 0.0:
        materials = round(quote_amount * 0.45, 2)
        labour = round(quote_amount * 0.25, 2)
        equipment = round(quote_amount * 0.15, 2)
        subcontract = round(quote_amount * 0.10, 2)
        overhead = round(quote_amount * 0.05, 2)

    return {
        "materials": round(materials, 2),
        "labour": round(labour, 2),
        "equipment": round(equipment, 2),
        "subcontract": round(subcontract, 2),
        "overhead": round(overhead, 2),
        "contingency": round(contingency, 2),
        "other": round(other, 2),
        "total": round(materials + labour + equipment + subcontract + overhead + contingency + other, 2),
    }


@router.get("/{project_id}/budget/category-summary")
async def get_budget_category_summary(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns real-time bulk BOQ cost-category totals with side-by-side approved budget,
    committed exposure, actual incurred execution costs, and remaining headroom."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # 1. Approved budget lines by category
    budget_lines_res = await db.execute(
        text("""
            SELECT bl.cost_category, SUM(bl.amount) AS category_budget
            FROM finance.project_budgets pb
            JOIN finance.budget_lines bl ON bl.budget_id = pb.id AND bl.is_deleted = false
            WHERE pb.project_id = :project_id AND pb.organization_id = :org_id
              AND pb.status = 'approved' AND pb.is_deleted = false
            GROUP BY bl.cost_category
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    budget_map = {row.cost_category.lower(): float(row.category_budget or 0) for row in budget_lines_res}

    # 2. Committed amounts from active commitments
    commitments_res = await db.execute(
        text("""
            SELECT COALESCE(NULLIF(cost_category, ''), 'materials') AS category,
                   SUM(outstanding_amount) AS committed_amount
            FROM finance.commitments
            WHERE project_id = :project_id AND organization_id = :org_id
              AND status = 'active' AND is_deleted = false
            GROUP BY COALESCE(NULLIF(cost_category, ''), 'materials')
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    commit_map = {row.category.lower(): float(row.committed_amount or 0) for row in commitments_res}

    # 3. Actual incurred costs
    actuals_res = await db.execute(
        text("""
            SELECT COALESCE(NULLIF(cost_category, ''), 'materials') AS category,
                   SUM(amount) AS actual_amount
            FROM finance.cost_transactions
            WHERE project_id = :project_id AND organization_id = :org_id
            GROUP BY COALESCE(NULLIF(cost_category, ''), 'materials')
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    actual_map = {row.category.lower(): float(row.actual_amount or 0) for row in actuals_res}

    # 4. Check for linked quotation via explicit link, lineage, or client org
    quote_res = await db.execute(
        text("""
            SELECT q.id, q.client_name, q.quote_amount, q.status, q.metadata, q.created_at
            FROM finance.quotations q
            WHERE q.organization_id = :org_id AND q.is_deleted = false
              AND (
                q.id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)
                OR q.project_id = :project_id
                OR (
                  (SELECT opportunity_id FROM projects.projects WHERE id = :project_id) IS NOT NULL
                  AND q.opportunity_id = (SELECT opportunity_id FROM projects.projects WHERE id = :project_id)
                )
                OR (
                  (SELECT client_org_id FROM projects.projects WHERE id = :project_id) IS NOT NULL
                  AND q.client_org_id = (SELECT client_org_id FROM projects.projects WHERE id = :project_id)
                )
                OR (
                  (SELECT client_name FROM projects.projects WHERE id = :project_id) IS NOT NULL
                  AND lower(trim(q.client_name)) = lower(trim((SELECT client_name FROM projects.projects WHERE id = :project_id)))
                )
              )
            ORDER BY
              (q.id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)) DESC NULLS LAST,
              (q.project_id = :project_id) DESC NULLS LAST,
              (q.status = 'won') DESC NULLS LAST,
              (q.metadata->'boq_approval'->>'status' = 'approved') DESC NULLS LAST,
              q.created_at DESC
            LIMIT 1
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    quote_row = quote_res.first()
    linked_quotation = None
    quote_category_map: dict[str, float] = {}

    if quote_row:
        quote_breakdown = extract_quotation_cost_breakdown(
            str(quote_row.id), quote_row.metadata, float(quote_row.quote_amount or 0.0)
        )
        quote_category_map = quote_breakdown

        linked_quotation = {
            "id": str(quote_row.id),
            "client_name": quote_row.client_name,
            "quote_amount": float(quote_row.quote_amount or 0),
            "status": quote_row.status,
            "created_at": str(quote_row.created_at),
            "category_estimates": quote_category_map,
        }

    # Build category rows
    category_rows = []
    total_budget = 0.0
    total_committed = 0.0
    total_actual = 0.0

    for cat in CANONICAL_BUDGET_CATEGORIES:
        key = cat["key"]
        b_amount = budget_map.get(key, 0.0)
        c_amount = commit_map.get(key, 0.0)
        a_amount = actual_map.get(key, 0.0)
        q_amount = quote_category_map.get(key, 0.0)
        headroom = round(b_amount - a_amount - c_amount, 2)
        burn_pct = round(((a_amount + c_amount) / b_amount * 100), 1) if b_amount > 0 else 0.0

        total_budget += b_amount
        total_committed += c_amount
        total_actual += a_amount

        category_rows.append({
            "category": key,
            "label": cat["label"],
            "default_code": cat["default_code"],
            "estimated_cost": q_amount,
            "budget": b_amount,
            "committed": c_amount,
            "actual": a_amount,
            "headroom": headroom,
            "burn_pct": burn_pct,
        })

    return _result({
        "categories": category_rows,
        "totals": {
            "budget": round(total_budget, 2),
            "committed": round(total_committed, 2),
            "actual": round(total_actual, 2),
            "headroom": round(total_budget - total_actual - total_committed, 2),
            "burn_pct": round(((total_actual + total_committed) / total_budget * 100), 1) if total_budget > 0 else 0.0,
        },
        "linked_quotation": linked_quotation,
    }, "Project budget category summary retrieved.")


@router.get("/{project_id}/budget/eligible-quotations")
async def get_eligible_quotations_for_project(
    project_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("projects.read")),
):
    """Lists eligible candidate quotations for linking or importing into the given project.
    Distinguishes direct links, opportunity/lineage matches, and all approved/won organization quotes.
    """
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # Load candidate and organization quotations
    quotes_res = await db.execute(
        text("""
            SELECT q.id, q.client_name, q.quote_amount, q.status, q.metadata, q.created_at,
                   q.opportunity_id, q.tender_id, q.client_org_id,
                   (q.id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)) AS is_direct_quotation_id,
                   (q.project_id = :project_id) AS is_direct_project_id,
                   (q.opportunity_id IS NOT NULL AND q.opportunity_id = (SELECT opportunity_id FROM projects.projects WHERE id = :project_id)) AS is_opp_match,
                   (q.client_org_id IS NOT NULL AND q.client_org_id = (SELECT client_org_id FROM projects.projects WHERE id = :project_id)) AS is_client_org_match,
                   (lower(trim(COALESCE(q.client_name, ''))) = lower(trim(COALESCE((SELECT client_name FROM projects.projects WHERE id = :project_id), '')))) AS is_name_match
            FROM finance.quotations q
            WHERE q.organization_id = :org_id AND q.is_deleted = false
            ORDER BY
              (q.id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)) DESC,
              (q.project_id = :project_id) DESC,
              (q.status IN ('won', 'approved', 'accepted')) DESC,
              (q.metadata->'boq_approval'->>'status' = 'approved') DESC,
              q.created_at DESC
            LIMIT 200
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    rows = quotes_res.mappings().all()

    matched_quotations = []
    all_eligible_quotations = []

    for row in rows:
        meta = row["metadata"] if isinstance(row["metadata"], dict) else {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}

        boq_app = meta.get("boq_approval") or {}
        has_approved_boq = boq_app.get("status") == "approved"
        is_direct = bool(row["is_direct_quotation_id"] or row["is_direct_project_id"])

        match_reasons = []
        if is_direct:
            match_reasons.append("Directly linked to this project")
        if row["is_opp_match"]:
            match_reasons.append("Linked via CRM Opportunity")
        if row["is_client_org_match"]:
            match_reasons.append("Linked via Client Account")
        elif row["is_name_match"]:
            match_reasons.append("Matches Client Name")

        breakdown = extract_quotation_cost_breakdown(
            str(row["id"]), meta, float(row["quote_amount"] or 0.0)
        )

        item_summary = {
            "id": str(row["id"]),
            "reference_number": meta.get("reference_number") or str(row["id"])[:8],
            "client_name": row["client_name"] or "Unknown Client",
            "quote_amount": float(row["quote_amount"] or 0.0),
            "status": row["status"],
            "created_at": str(row["created_at"]),
            "project_title": meta.get("project_title"),
            "has_approved_boq": has_approved_boq,
            "is_directly_linked": is_direct,
            "match_reasons": match_reasons,
            "category_estimates": breakdown,
            "items_count": len(meta.get("items") or []),
        }

        if match_reasons:
            matched_quotations.append(item_summary)
        all_eligible_quotations.append(item_summary)

    return _result({
        "matched_quotations": matched_quotations,
        "all_eligible_quotations": all_eligible_quotations,
    }, "Eligible quotations retrieved.")


@router.post("/{project_id}/budget/link-quotation")
async def link_project_quotation(
    project_id: str,
    payload: QuotationLinkPayload,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Explicitly associates an approved quotation with this project without overwriting existing budgets."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    quote = (await db.execute(
        text("SELECT id, client_name, quote_amount FROM finance.quotations WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.quotation_id, "org_id": user["org_id"]},
    )).first()

    if not quote:
        raise HTTPException(status_code=404, detail="Quotation not found in this organization.")

    await db.execute(
        text("""
            UPDATE projects.projects
            SET quotation_id = :quote_id, updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {"quote_id": payload.quotation_id, "project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    await db.execute(
        text("""
            UPDATE finance.quotations
            SET project_id = :project_id, updated_at = NOW()
            WHERE id = :quote_id AND organization_id = :org_id
        """),
        {"quote_id": payload.quotation_id, "project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    await db.commit()

    return _result({
        "project_id": str(resolved_project_id),
        "quotation_id": str(payload.quotation_id),
        "client_name": quote.client_name,
    }, "Quotation successfully linked to project.")


@router.post("/{project_id}/budget/import-quotation")
async def import_budget_from_quotation(
    project_id: str,
    payload: QuotationImportPayload,
    user: dict = Depends(require_permission("projects.update")),
    db: AsyncSession = Depends(get_db),
):
    """Import and seed bulk category execution budget directly from Quotations & Estimations."""
    project = await _project_ref_or_404(db, project_id, user["org_id"])
    resolved_project_id = project["id"]

    # Locate target quotation
    if payload.quotation_id:
        quote = (await db.execute(
            text("SELECT * FROM finance.quotations WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.quotation_id, "org_id": user["org_id"]},
        )).first()
    else:
        quote = (await db.execute(
            text("""
                SELECT * FROM finance.quotations
                WHERE organization_id = :org_id AND is_deleted = false
                  AND (
                    id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)
                    OR project_id = :project_id
                    OR (
                      (SELECT opportunity_id FROM projects.projects WHERE id = :project_id) IS NOT NULL
                      AND opportunity_id = (SELECT opportunity_id FROM projects.projects WHERE id = :project_id)
                    )
                    OR (
                      (SELECT client_org_id FROM projects.projects WHERE id = :project_id) IS NOT NULL
                      AND client_org_id = (SELECT client_org_id FROM projects.projects WHERE id = :project_id)
                    )
                    OR (
                      (SELECT client_name FROM projects.projects WHERE id = :project_id) IS NOT NULL
                      AND lower(trim(client_name)) = lower(trim((SELECT client_name FROM projects.projects WHERE id = :project_id)))
                    )
                  )
                ORDER BY
                  (id = (SELECT quotation_id FROM projects.projects WHERE id = :project_id)) DESC NULLS LAST,
                  (project_id = :project_id) DESC NULLS LAST,
                  (status = 'won') DESC NULLS LAST,
                  (metadata->'boq_approval'->>'status' = 'approved') DESC NULLS LAST,
                  created_at DESC
                LIMIT 1
            """),
            {"project_id": resolved_project_id, "org_id": user["org_id"]},
        )).first()

    if not quote:
        raise HTTPException(
            status_code=404,
            detail="No matching quotation found for this project. Please select a quotation from the Quotation Selector.",
        )

    meta = quote.metadata if isinstance(quote.metadata, dict) else {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except Exception:
            meta = {}

    breakdown = extract_quotation_cost_breakdown(
        str(quote.id), meta, float(quote.quote_amount or 0.0)
    )

    materials = breakdown["materials"]
    labour = breakdown["labour"]
    equipment = breakdown["equipment"]
    subcontract = breakdown["subcontract"]
    overhead = breakdown["overhead"]
    contingency = breakdown["contingency"]
    other = breakdown["other"]
    execution_total = breakdown["total"]

    # Supersede existing budgets
    await db.execute(
        text("""
            UPDATE finance.project_budgets
            SET status = 'superseded', updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
              AND status = 'approved' AND is_deleted = false
        """),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )

    version_res = await db.execute(
        text("SELECT COALESCE(MAX(budget_version), 0) + 1 FROM finance.project_budgets WHERE project_id = :project_id AND organization_id = :org_id"),
        {"project_id": resolved_project_id, "org_id": user["org_id"]},
    )
    next_ver = version_res.scalar() or 1

    # Insert new master budget
    budget_id = (await db.execute(
        text("""
            INSERT INTO finance.project_budgets (
                organization_id, project_id, budget_version, status, label,
                effective_date, total_amount, notes, approved_by, approved_at, created_by
            ) VALUES (
                :org_id, :project_id, :version, 'approved', :label,
                CURRENT_DATE, :total_amount, :notes, :user_id, NOW(), :user_id
            ) RETURNING id
        """),
        {
            "org_id": user["org_id"],
            "project_id": resolved_project_id,
            "version": next_ver,
            "label": f"Imported from Quotation {quote.id}",
            "total_amount": execution_total,
            "notes": payload.notes or f"Imported execution budget from quotation {quote.id} (Client: {quote.client_name})",
            "user_id": user["user_id"],
        },
    )).scalar()

    # Insert bulk category lines
    cat_amounts = [
        ("materials", "200-MATERIALS", "Materials, Concrete & Aggregates Allowance", materials),
        ("labour", "100-LABOUR", "Direct Site Labour & Supervision Allowance", labour),
        ("equipment", "300-EQUIP", "Plant & Heavy Equipment Allowance", equipment),
        ("subcontract", "400-SUBCONT", "Specialist Subcontractor Packages", subcontract),
        ("overhead", "500-OVERHEAD", "Preliminaries & Site Facilities Allowance", overhead),
        ("contingency", "600-CONTINGENCY", "Contingency & Unforeseen Reserve", contingency),
        ("other", "700-OTHER", "Other Project Allowances", other),
    ]

    for cat_key, code, desc, amount in cat_amounts:
        if amount > 0:
            await db.execute(
                text("""
                    INSERT INTO finance.budget_lines (
                        organization_id, budget_id, cost_category, description, amount, created_by
                    ) VALUES (:org_id, :budget_id, :cat, :desc, :amount, :user_id)
                """),
                {
                    "org_id": user["org_id"],
                    "budget_id": budget_id,
                    "cat": cat_key,
                    "desc": desc,
                    "amount": amount,
                    "user_id": user["user_id"],
                },
            )

    # Seed BOQ line items into finance.boq_line_items if quotation has items
    try:
        await seed_boq_line_items_from_quotation(
            db, user["org_id"], str(project_id), str(quote.id), meta, created_by=user["sub"]
        )
    except Exception as boq_err:
        logger.warning(f"Could not seed BOQ lines during quotation import: {boq_err}")

    # Explicitly stamp quotation_id on project and project_id on quotation
    await db.execute(
        text("""
            UPDATE projects.projects
            SET quotation_id = :quote_id,
                contract_value = COALESCE(contract_value, :quote_amount),
                updated_at = NOW()
            WHERE id = :project_id AND organization_id = :org_id
        """),
        {
            "quote_id": quote.id,
            "project_id": project_id,
            "org_id": user["org_id"],
            "quote_amount": float(quote.quote_amount or execution_total),
        },
    )

    await db.execute(
        text("""
            UPDATE finance.quotations
            SET project_id = :project_id, updated_at = NOW()
            WHERE id = :quote_id AND organization_id = :org_id
              AND (project_id IS NULL OR project_id = :project_id)
        """),
        {
            "project_id": project_id,
            "quote_id": quote.id,
            "org_id": user["org_id"],
        },
    )

    await emit_event(
        db,
        user=user,
        event_type="project.budget_imported_from_quotation.v1",
        aggregate_type="project_budget",
        aggregate_id=budget_id,
        project_id=project_id,
        event_data={
            "project_id": str(project_id),
            "budget_id": str(budget_id),
            "quotation_id": str(quote.id),
            "total_amount": execution_total,
            "imported_by": str(user["user_id"]),
        },
    )

    await db.commit()

    return _result({
        "budget_id": str(budget_id),
        "quotation_id": str(quote.id),
        "total_amount": execution_total,
        "categories": {
            "materials": materials,
            "labour": labour,
            "equipment": equipment,
            "subcontract": subcontract,
            "overhead": overhead,
            "contingency": contingency,
            "other": other,
        },
    }, f"Successfully imported execution budget of ${execution_total:,.2f} from Quotations & Estimations.")


@router.get("/{project_id}/supply-chain")
async def get_project_supply_chain(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    user: dict = Depends(require_permission("projects.read")),
):
    """Consolidated project supply chain endpoint.
    Aggregates:
    - Linked site store(s)
    - Live on-hand inventory balances & valuation
    - Site material requisitions
    - Purchase orders linked to this project
    - Goods received notes (deliveries)
    - Consumed material logs (daily site reports)
    """
    org_id = user["org_id"]

    # 1. Site stores linked to project
    stores_res = await db.execute(
        text("""
            SELECT id, name, store_code AS code, store_type, site_id, location_label AS location,
                   (status = 'active') AS is_active, created_at
            FROM procurement.stores
            WHERE organization_id = :org_id
              AND project_id = :project_id
              AND is_deleted = false
            ORDER BY created_at ASC
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    site_stores = [dict(r._mapping) for r in stores_res.fetchall()]
    store_ids = [s["id"] for s in site_stores]

    # 2. Live stock balances in site store(s) or directly tagged to project
    stock_rows = []
    if store_ids:
        stock_res = await db.execute(
            text("""
                SELECT
                    sl.item_id,
                    COALESCE(i.item_code, 'UNLISTED') AS item_code,
                    COALESCE(i.item_name, 'Uncatalogued Item') AS item_name,
                    COALESCE(i.unit_of_measure, 'units') AS unit_of_measure,
                    COALESCE(i.category, 'General') AS category,
                    sl.store_id,
                    s.name AS store_name,
                    SUM(sl.quantity) AS on_hand_quantity,
                    AVG(NULLIF(sl.unit_cost, 0)) AS avg_unit_cost,
                    SUM(sl.quantity * COALESCE(sl.unit_cost, 0)) AS total_value
                FROM procurement.stock_ledger sl
                LEFT JOIN procurement.inventory_items i ON i.id = sl.item_id
                LEFT JOIN procurement.stores s ON s.id = sl.store_id
                WHERE sl.organization_id = :org_id
                  AND (sl.project_id = :project_id OR sl.store_id = ANY(:store_ids))
                GROUP BY sl.item_id, i.item_code, i.item_name, i.unit_of_measure, i.category, sl.store_id, s.name
                HAVING SUM(sl.quantity) > 0
                ORDER BY total_value DESC
            """),
            {"org_id": org_id, "project_id": project_id, "store_ids": store_ids},
        )
        stock_rows = [dict(r._mapping) for r in stock_res.fetchall()]
    else:
        stock_res = await db.execute(
            text("""
                SELECT
                    sl.item_id,
                    COALESCE(i.item_code, 'UNLISTED') AS item_code,
                    COALESCE(i.name, 'Uncatalogued Item') AS item_name,
                    COALESCE(i.unit_of_measure, 'units') AS unit_of_measure,
                    COALESCE(i.category, 'General') AS category,
                    sl.store_id,
                    s.name AS store_name,
                    SUM(sl.quantity) AS on_hand_quantity,
                    AVG(NULLIF(sl.unit_cost, 0)) AS avg_unit_cost,
                    SUM(sl.quantity * COALESCE(sl.unit_cost, 0)) AS total_value
                FROM procurement.stock_ledger sl
                LEFT JOIN procurement.inventory_items i ON i.id = sl.item_id
                LEFT JOIN procurement.stores s ON s.id = sl.store_id
                WHERE sl.organization_id = :org_id
                  AND sl.project_id = :project_id
                GROUP BY sl.item_id, i.item_code, i.name, i.unit_of_measure, i.category, sl.store_id, s.name
                HAVING SUM(sl.quantity) > 0
                ORDER BY total_value DESC
            """),
            {"org_id": org_id, "project_id": project_id},
        )
        stock_rows = [dict(r._mapping) for r in stock_res.fetchall()]

    # 3. Requisitions originating for or linked to this project
    reqs_res = await db.execute(
        text("""
            SELECT
                r.id,
                r.requisition_number,
                COALESCE(r.justification, r.requisition_number) AS title,
                r.status,
                r.priority,
                r.created_at,
                r.required_by_date,
                r.site_id,
                si.name AS site_name,
                COALESCE((SELECT COUNT(*) FROM procurement.requisition_lines rl WHERE rl.requisition_id = r.id AND rl.is_deleted = false), 0) AS item_count,
                COALESCE(r.total_estimated, 0) AS estimated_total
            FROM procurement.purchase_requisitions r
            LEFT JOIN projects.sites si ON si.id = r.site_id
            WHERE r.organization_id = CAST(:org_id AS uuid)
              AND r.project_id = CAST(:project_id AS uuid)
              AND r.is_deleted = false
            ORDER BY r.created_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    requisitions = [dict(r._mapping) for r in reqs_res.fetchall()]

    # 4. Purchase orders linked to project
    po_res = await db.execute(
        text("""
            SELECT
                po.id,
                po.po_number,
                po.status,
                po.supplier_id,
                s.name AS supplier_name,
                po.currency,
                po.total_amount,
                po.created_at,
                po.expected_delivery_date,
                po.payment_terms
            FROM procurement.purchase_orders po
            LEFT JOIN procurement.suppliers s ON s.id = po.supplier_id
            WHERE po.organization_id = CAST(:org_id AS uuid)
              AND po.project_id = CAST(:project_id AS uuid)
              AND po.is_deleted = false
            ORDER BY po.created_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    purchase_orders = [dict(r._mapping) for r in po_res.fetchall()]

    # 5. Goods Received Notes (Deliveries to site)
    dummy_uuid = uuid4()
    grn_res = await db.execute(
        text("""
            SELECT
                g.id,
                g.grn_number,
                g.po_id,
                po.po_number,
                g.store_id,
                st.name AS store_name,
                g.delivery_note_ref AS delivery_note_number,
                g.delivery_date AS received_at,
                g.status AS inspection_status,
                COALESCE((SELECT COUNT(*) FROM procurement.grn_lines gl WHERE gl.grn_id = g.id AND gl.is_deleted = false), 0) AS item_count
            FROM procurement.goods_received_notes g
            LEFT JOIN procurement.purchase_orders po ON po.id = g.po_id
            LEFT JOIN procurement.stores st ON st.id = g.store_id
            WHERE g.organization_id = CAST(:org_id AS uuid)
              AND (g.project_id = CAST(:project_id AS uuid) OR g.store_id = ANY(:store_ids))
              AND g.is_deleted = false
            ORDER BY g.delivery_date DESC NULLS LAST, g.created_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id, "store_ids": store_ids or [dummy_uuid]},
    )
    deliveries = [dict(r._mapping) for r in grn_res.fetchall()]

    # 6. RFQs & Sourcing for project
    rfq_res = await db.execute(
        text("""
            SELECT
                rfq.id,
                rfq.rfq_number,
                rfq.title,
                rfq.status,
                rfq.closing_date,
                rfq.created_at,
                rfq.description
            FROM procurement.rfqs rfq
            WHERE rfq.organization_id = CAST(:org_id AS uuid)
              AND rfq.project_id = CAST(:project_id AS uuid)
              AND rfq.is_deleted = false
            ORDER BY rfq.created_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    rfqs = [dict(r._mapping) for r in rfq_res.fetchall()]

    # 7. Consumption logs from daily site reports
    cons_res = await db.execute(
        text("""
            SELECT
                drm.id,
                drm.report_id,
                dr.report_date,
                drm.item_id,
                COALESCE(i.name, 'Site Material') AS item_name,
                COALESCE(i.item_code, 'MAT') AS item_code,
                COALESCE(drm.work_package, 'General Works') AS description,
                drm.quantity_used,
                COALESCE(i.unit_of_measure, 'units') AS unit_of_measure,
                drm.notes,
                drm.created_at
            FROM projects.daily_report_materials drm
            JOIN projects.daily_site_reports dr ON dr.id = drm.report_id
            LEFT JOIN procurement.inventory_items i ON i.id = drm.item_id
            WHERE dr.organization_id = CAST(:org_id AS uuid)
              AND dr.project_id = CAST(:project_id AS uuid)
              AND drm.is_deleted = false
            ORDER BY dr.report_date DESC, drm.created_at DESC
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    consumption_logs = [dict(r._mapping) for r in cons_res.fetchall()]

    # 8. Wastage & Usage Variance Analysis (Stock Issued vs In-situ Consumed)
    wastage_res = await db.execute(
        text("""
            SELECT
                COALESCE(i.item_code, drm.item_code, 'MAT') AS item_code,
                COALESCE(i.item_name, drm.item_name, 'Site Material') AS item_name,
                COALESCE(i.unit_of_measure, drm.unit_of_measure, 'units') AS unit_of_measure,
                COALESCE(iss.issued_qty, 0) AS quantity_issued,
                COALESCE(con.consumed_qty, 0) AS quantity_consumed,
                COALESCE(iss.avg_cost, i.standard_cost, 0) AS avg_unit_cost
            FROM (
                SELECT
                    sl.item_id,
                    SUM(CASE WHEN sl.movement_type = 'issue' THEN ABS(sl.quantity) ELSE 0 END) -
                    SUM(CASE WHEN sl.movement_type = 'return' THEN ABS(sl.quantity) ELSE 0 END) AS issued_qty,
                    AVG(COALESCE(sl.unit_cost, 0)) AS avg_cost
                FROM procurement.stock_ledger sl
                WHERE sl.organization_id = CAST(:org_id AS uuid)
                  AND (sl.project_id = CAST(:project_id AS uuid) OR sl.store_id = ANY(:store_ids))
                GROUP BY sl.item_id
            ) iss
            FULL OUTER JOIN (
                SELECT
                    drm.item_id,
                    drm.item_code,
                    drm.item_name,
                    drm.unit_of_measure,
                    SUM(drm.quantity_used) AS consumed_qty
                FROM projects.daily_report_materials drm
                JOIN projects.daily_site_reports dr ON dr.id = drm.report_id
                WHERE dr.organization_id = CAST(:org_id AS uuid)
                  AND dr.project_id = CAST(:project_id AS uuid)
                  AND drm.is_deleted = false
                GROUP BY drm.item_id, drm.item_code, drm.item_name, drm.unit_of_measure
            ) con ON con.item_id = iss.item_id
            LEFT JOIN procurement.inventory_items i ON i.id = COALESCE(iss.item_id, con.item_id)
            WHERE COALESCE(iss.issued_qty, 0) > 0 OR COALESCE(con.consumed_qty, 0) > 0
            LIMIT 50
        """),
        {"org_id": org_id, "project_id": project_id, "store_ids": store_ids or [dummy_uuid]},
    )
    wastage_rows = []
    total_wastage_cost = 0.0
    for r in wastage_res.fetchall():
        row_dict = dict(r._mapping)
        iss_q = float(row_dict.get("quantity_issued") or 0)
        con_q = float(row_dict.get("quantity_consumed") or 0)
        u_cost = float(row_dict.get("avg_unit_cost") or 0)
        var_q = max(0.0, iss_q - con_q) if iss_q > 0 else 0.0
        w_pct = round((var_q / iss_q * 100.0), 1) if iss_q > 0 else 0.0
        w_cost = round(var_q * u_cost, 2)
        total_wastage_cost += w_cost

        status_flag = "balanced"
        if iss_q > 0:
            if w_pct <= 3.5:
                status_flag = "normal"
            elif w_pct <= 7.0:
                status_flag = "elevated"
            else:
                status_flag = "critical_loss"

        row_dict.update({
            "quantity_issued": iss_q,
            "quantity_consumed": con_q,
            "variance_quantity": round(var_q, 2),
            "wastage_percent": w_pct,
            "wastage_cost": w_cost,
            "status_flag": status_flag,
        })
        wastage_rows.append(row_dict)

    # 9. Cross-module Financial Reconciliation & Sanity Verification
    fin_res = await db.execute(
        text("""
            SELECT
                COALESCE(contract_value, budget, 0) AS contract_value,
                COALESCE(budget_amount, budget, 0) AS budget_amount,
                COALESCE(deposit_received_amount, 0) AS deposit_received_amount,
                COALESCE(actual_cost, 0) AS actual_cost,
                COALESCE(committed_cost, 0) AS committed_cost
            FROM projects.projects
            WHERE id = CAST(:project_id AS uuid) AND organization_id = CAST(:org_id AS uuid)
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    fin_mapping = fin_res.mappings().first() or {}
    contract_val = float(fin_mapping.get("contract_value") or 0)
    budget_amt = float(fin_mapping.get("budget_amount") or 0)
    deposits_rec = float(fin_mapping.get("deposit_received_amount") or 0)

    total_on_hand_val = sum(float(r.get("total_value") or 0) for r in stock_rows)
    total_committed_po_val = sum(
        float(p.get("total_amount") or 0)
        for p in purchase_orders
        if p.get("status") in ("issued", "approved", "partially_received")
    )
    total_exposure = round(total_on_hand_val + total_committed_po_val, 2)
    deposit_coverage_pct = round((deposits_rec / total_exposure * 100.0), 1) if total_exposure > 0 else 100.0
    is_deposit_backed = (deposits_rec >= total_exposure) or (total_exposure == 0)
    is_within_budget = (total_exposure <= budget_amt) if budget_amt > 0 else True

    if is_deposit_backed and is_within_budget:
        sanity_verdict = "VERIFIED_SOUND"
        sanity_message = "Material exposure is fully backed by cleared client advance deposits and stays within approved baseline budget."
    elif not is_deposit_backed and is_within_budget:
        sanity_verdict = "DEPOSIT_LAG"
        sanity_message = "Material procurement exposure exceeds cleared client advance deposits. Commercial cashflow verification required."
    else:
        sanity_verdict = "BUDGET_OVERRUN_RISK"
        sanity_message = "Total committed and on-hand material exposure exceeds project budget ceiling. Variation approval required."

    data = {
        "project_id": str(project_id),
        "site_stores": site_stores,
        "inventory_on_hand": stock_rows,
        "requisitions": requisitions,
        "purchase_orders": purchase_orders,
        "deliveries": deliveries,
        "rfqs": rfqs,
        "consumption_logs": consumption_logs,
        "wastage_records": wastage_rows,
        "finance_verification": {
            "contract_value": contract_val,
            "budget_amount": budget_amt,
            "deposit_received_amount": deposits_rec,
            "total_material_exposure": total_exposure,
            "deposit_coverage_percent": deposit_coverage_pct,
            "is_deposit_backed": is_deposit_backed,
            "is_within_budget": is_within_budget,
            "verdict": sanity_verdict,
            "message": sanity_message,
        },
        "summary": {
            "total_site_stores": len(site_stores),
            "total_inventory_items": len(stock_rows),
            "on_hand_inventory_value": round(total_on_hand_val, 2),
            "open_committed_po_value": round(total_committed_po_val, 2),
            "total_open_pos": len([p for p in purchase_orders if p.get("status") in ("issued", "approved", "partially_received")]),
            "total_requisitions": len(requisitions),
            "total_deliveries": len(deliveries),
            "total_rfqs": len(rfqs),
            "total_wastage_cost": round(total_wastage_cost, 2),
            "average_wastage_percent": round(
                sum(r["wastage_percent"] for r in wastage_rows) / len(wastage_rows), 1
            ) if wastage_rows else 0.0,
        },
    }
    return _result(data, "Project supply chain loaded successfully.")


@router.get("/{project_id}/leadership-dossier")
async def get_project_leadership_dossier(
    project_id: UUID,
    month: Optional[str] = Query(None, description="Month in YYYY-MM format, e.g. 2026-10"),
    user: dict = Depends(require_any_permission(
        "projects.read",
        "executive.view_dashboard",
        "site_operations.read",
        "financial_performance.read",
    )),
    db: AsyncSession = Depends(get_db),
):
    """
    Month-End Leadership Accountability Dossier for Site Project Delivery.
    Synthesizes delivery KPIs, compliance, and cost exposure across the three site pillars:
    1. Site Engineer (daily site diaries, delays & issues, QA milestones)
    2. Site Foreman (toolbox briefings, daily crew headcount, overtime burn, safety)
    3. Quantity Surveyor (QS) (actual site costs vs weekly budgets, client variations, headroom)
    Empowers executive leadership to sit down with site leadership with hard facts.
    """
    today = date.today()
    if month:
        try:
            parts = month.split("-")
            yr, mo = int(parts[0]), int(parts[1])
            start_dt = date(yr, mo, 1)
            next_month_start = date(yr + 1, 1, 1) if mo == 12 else date(yr, mo + 1, 1)
            month_label = f"{yr:04d}-{mo:02d}"
        except Exception:
            start_dt = date(today.year, today.month, 1)
            next_month_start = date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)
            month_label = f"{today.year:04d}-{today.month:02d}"
    else:
        start_dt = date(today.year, today.month, 1)
        next_month_start = date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)
        month_label = f"{today.year:04d}-{today.month:02d}"

    end_date_inclusive = next_month_start - timedelta(days=1)

    cur = start_dt
    working_days = 0
    days_elapsed = 0
    now_dt = min(today, end_date_inclusive)
    while cur < next_month_start:
        if cur.weekday() < 5:
            working_days += 1
            if cur <= now_dt:
                days_elapsed += 1
        cur += timedelta(days=1)
    if working_days == 0:
        working_days = 22
    if days_elapsed == 0:
        days_elapsed = 1

    org_id = user["org_id"]
    proj_res = await db.execute(
        text("""
            SELECT p.id, p.name, p.project_code, p.status, p.contract_value, p.start_date,
                   p.planned_completion_date, COALESCE(c.name, p.client_name) AS client_name
            FROM projects.projects p
            LEFT JOIN crm.organizations c ON c.id = p.client_org_id
            WHERE p.id = CAST(:project_id AS uuid) AND p.organization_id = CAST(:org_id AS uuid)
        """),
        {"project_id": project_id, "org_id": org_id},
    )
    project = proj_res.mappings().first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    team_res = await db.execute(
        text("""
            SELECT pa.employee_id, pa.role_on_project,
                   e.employee_name AS full_name, e.job_title, e.personal_email AS work_email, e.personal_phone AS phone_number
            FROM hr.project_allocations pa
            JOIN hr.employees e ON e.id = pa.employee_id
            WHERE pa.project_id = CAST(:project_id AS uuid) AND pa.organization_id = CAST(:org_id AS uuid) AND pa.is_deleted = false
            UNION ALL
            SELECT e.id AS employee_id, sra.role_name AS role_on_project,
                   e.employee_name AS full_name, e.job_title, e.personal_email AS work_email, e.personal_phone AS phone_number
            FROM projects.site_role_assignments sra
            JOIN hr.employees e ON e.linked_user_id = sra.user_id
            WHERE sra.project_id = CAST(:project_id AS uuid) AND sra.organization_id = CAST(:org_id AS uuid) AND sra.is_deleted = false
        """),
        {"project_id": project_id, "org_id": org_id},
    )
    team_members = [dict(r) for r in team_res.mappings().all()]

    engineer_member = next((m for m in team_members if any(k in (m.get("role_on_project") or "").lower() or k in (m.get("job_title") or "").lower() for k in ["engineer", "agent", "site manager"])), None)
    foreman_member = next((m for m in team_members if any(k in (m.get("role_on_project") or "").lower() or k in (m.get("job_title") or "").lower() for k in ["foreman", "supervisor"])), None)
    qs_member = next((m for m in team_members if any(k in (m.get("role_on_project") or "").lower() or k in (m.get("job_title") or "").lower() for k in ["quantity", "qs", "commercial"])), None)

    # 1. Site Engineer Metrics
    reports_res = await db.execute(
        text("""
            SELECT
                COUNT(*) AS total_reports,
                COUNT(CASE WHEN safety_notes IS NOT NULL AND length(trim(safety_notes)) > 0 THEN 1 END) AS reports_with_issues,
                COUNT(CASE WHEN delays IS NOT NULL AND length(trim(delays)) > 0 THEN 1 END) AS reports_with_delays
            FROM projects.daily_site_reports
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND report_date >= CAST(:start_dt AS date)
              AND report_date < CAST(:next_month_start AS date)
              AND is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    report_stats = reports_res.mappings().first() or {}
    total_reports = int(report_stats.get("total_reports") or 0)
    reports_with_issues = int(report_stats.get("reports_with_issues") or 0)
    reports_with_delays = int(report_stats.get("reports_with_delays") or 0)
    reporting_compliance_pct = round(min(100.0, (total_reports / max(days_elapsed, 1)) * 100.0), 1)

    recent_delays_res = await db.execute(
        text("""
            SELECT report_date, actual_work AS work_summary, safety_notes AS issues_notes, delays AS delays_notes
            FROM projects.daily_site_reports
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND report_date >= CAST(:start_dt AS date)
              AND report_date < CAST(:next_month_start AS date)
              AND (
                (delays IS NOT NULL AND length(trim(delays)) > 0)
                OR (safety_notes IS NOT NULL AND length(trim(safety_notes)) > 0)
              )
              AND is_deleted = false
            ORDER BY report_date DESC
            LIMIT 5
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    recent_delays = [dict(r) for r in recent_delays_res.mappings().all()]

    milestones_res = await db.execute(
        text("""
            SELECT
                COUNT(*) AS total_milestones,
                COUNT(CASE WHEN status = 'complete' THEN 1 END) AS completed_milestones,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) AS in_progress_milestones,
                COUNT(CASE WHEN status = 'blocked' THEN 1 END) AS blocked_milestones
            FROM projects.project_milestones
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    milestone_stats = milestones_res.mappings().first() or {}
    m_total = int(milestone_stats.get("total_milestones") or 0)
    m_completed = int(milestone_stats.get("completed_milestones") or 0)
    milestone_pct = round((m_completed / max(m_total, 1)) * 100.0, 1) if m_total > 0 else 0.0

    engineer_verdict = (
        "EXEMPLARY - High reporting discipline & schedule tracking"
        if reporting_compliance_pct >= 90 and reports_with_delays == 0
        else "STABLE - Routine reporting maintained"
        if reporting_compliance_pct >= 70
        else "CRITICAL SCRUTINY - Site diaries lapsed, commercial exposure risk"
    )
    engineer_talking_points = [
        f"{total_reports} daily reports filed out of {days_elapsed} active elapsed days ({reporting_compliance_pct}% compliance).",
        f"{reports_with_delays} site delay events logged; {reports_with_issues} obstacle/blocker notes recorded.",
        f"Milestone progress: {m_completed}/{m_total} milestones completed ({milestone_pct}% overall).",
        "Mandate: Ensure contemporary site diaries are completed every day without exception to substantiate all client claims."
    ]

    # 2. Site Foreman Metrics
    briefings_res = await db.execute(
        text("""
            SELECT
                COUNT(DISTINCT sdb.id) AS briefings_count,
                COUNT(sda.id) AS total_attendees,
                ROUND(COUNT(sda.id)::numeric / GREATEST(COUNT(DISTINCT sdb.id), 1), 1) AS avg_attendees
            FROM projects.site_day_briefings sdb
            LEFT JOIN projects.site_day_attendance sda ON sda.briefing_id = sdb.id
            WHERE sdb.organization_id = CAST(:org_id AS uuid)
              AND sdb.project_id = CAST(:project_id AS uuid)
              AND sdb.briefing_date >= CAST(:start_dt AS date)
              AND sdb.briefing_date < CAST(:next_month_start AS date)
              AND sdb.is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    briefing_stats = briefings_res.mappings().first() or {}
    briefings_conducted = int(briefing_stats.get("briefings_count") or 0)
    briefing_compliance_pct = round(min(100.0, (briefings_conducted / max(days_elapsed, 1)) * 100.0), 1)

    labour_res = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(drl.regular_hours), 0) AS total_regular_hours,
                COALESCE(SUM(drl.overtime_hours), 0) AS total_overtime_hours,
                COALESCE(SUM(drl.regular_hours * drl.cost_rate + drl.overtime_hours * drl.cost_rate * 1.5), 0) AS total_labour_cost,
                COUNT(DISTINCT dr.report_date) AS active_site_days,
                COUNT(drl.id) AS total_man_shifts
            FROM projects.daily_report_labour drl
            JOIN projects.daily_site_reports dr ON dr.id = drl.report_id
            WHERE dr.organization_id = CAST(:org_id AS uuid)
              AND dr.project_id = CAST(:project_id AS uuid)
              AND dr.report_date >= CAST(:start_dt AS date)
              AND dr.report_date < CAST(:next_month_start AS date)
              AND drl.is_deleted = false
              AND dr.is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    labour_stats = labour_res.mappings().first() or {}
    total_reg_hrs = float(labour_stats.get("total_regular_hours") or 0)
    total_ot_hrs = float(labour_stats.get("total_overtime_hours") or 0)
    total_labour_cost = float(labour_stats.get("total_labour_cost") or 0)
    active_site_days = int(labour_stats.get("active_site_days") or 0)
    total_man_shifts = int(labour_stats.get("total_man_shifts") or 0)
    avg_daily_headcount = round(total_man_shifts / max(active_site_days, 1), 1) if active_site_days > 0 else 0.0
    total_work_hrs = total_reg_hrs + total_ot_hrs
    overtime_ratio_pct = round((total_ot_hrs / max(total_work_hrs, 1.0)) * 100.0, 1)

    foreman_verdict = (
        "ELEVATED OVERTIME BURN - Scrutinize overtime productivity"
        if overtime_ratio_pct > 20.0
        else "DISCIPLINED EXECUTION - Active morning alignment & steady crew size"
        if briefing_compliance_pct >= 80
        else "CREW COORDINATION GAP - Improve daily briefing and attendance logging"
    )
    foreman_talking_points = [
        f"{briefings_conducted} morning briefings recorded ({briefing_compliance_pct}% coverage). Average workforce: {avg_daily_headcount} operatives/day.",
        f"Hours logged: {total_reg_hrs:,.1f} regular vs {total_ot_hrs:,.1f} overtime ({overtime_ratio_pct}% OT ratio).",
        f"Direct site labour payroll incurred: ${total_labour_cost:,.2f} across {total_man_shifts} individual worker shifts.",
        "Mandate: Reconcile daily attendance registers before 08:30 AM; eliminate unauthorized overtime premiums."
    ]

    # 3. Quantity Surveyor (QS) Metrics
    plant_res = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(dre.operating_hours), 0) AS total_plant_operating_hours,
                COALESCE(SUM(dre.idle_hours), 0) AS total_plant_idle_hours,
                COALESCE(SUM(dre.operating_hours * dre.cost_rate), 0) AS total_plant_cost,
                COALESCE(SUM(dre.fuel_litres), 0) AS total_fuel_litres
            FROM projects.daily_report_equipment dre
            JOIN projects.daily_site_reports dr ON dr.id = dre.report_id
            WHERE dr.organization_id = CAST(:org_id AS uuid)
              AND dr.project_id = CAST(:project_id AS uuid)
              AND dr.report_date >= CAST(:start_dt AS date)
              AND dr.report_date < CAST(:next_month_start AS date)
              AND dre.is_deleted = false
              AND dr.is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    plant_stats = plant_res.mappings().first() or {}
    total_plant_cost = float(plant_stats.get("total_plant_cost") or 0)

    mat_res = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(drm.quantity_used * drm.unit_cost), 0) AS total_material_cost,
                COUNT(drm.id) AS material_issue_count
            FROM projects.daily_report_materials drm
            JOIN projects.daily_site_reports dr ON dr.id = drm.report_id
            WHERE dr.organization_id = CAST(:org_id AS uuid)
              AND dr.project_id = CAST(:project_id AS uuid)
              AND dr.report_date >= CAST(:start_dt AS date)
              AND dr.report_date < CAST(:next_month_start AS date)
              AND drm.is_deleted = false
              AND dr.is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )
    mat_stats = mat_res.mappings().first() or {}
    total_mat_cost = float(mat_stats.get("total_material_cost") or 0)
    total_direct_site_cost = round(total_labour_cost + total_plant_cost + total_mat_cost, 2)

    var_res = await db.execute(
        text("""
            SELECT
                COUNT(*) AS total_variations,
                COALESCE(SUM(cost_impact), 0) AS total_variation_amount,
                COALESCE(SUM(CASE WHEN client_approval_status = 'approved' OR status = 'approved' THEN cost_impact ELSE 0 END), 0) AS approved_variation_amount,
                COALESCE(SUM(CASE WHEN COALESCE(client_approval_status, status) != 'approved' THEN cost_impact ELSE 0 END), 0) AS pending_variation_amount,
                COUNT(CASE WHEN client_approval_status = 'approved' OR status = 'approved' THEN 1 END) AS approved_count,
                COUNT(CASE WHEN qs_review_status = 'pending' THEN 1 END) AS pending_qs_count
            FROM finance.variations
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    var_stats = var_res.mappings().first() or {}
    total_var_count = int(var_stats.get("total_variations") or 0)
    total_var_amt = float(var_stats.get("total_variation_amount") or 0)
    app_var_amt = float(var_stats.get("approved_variation_amount") or 0)
    pend_var_amt = float(var_stats.get("pending_variation_amount") or 0)
    pending_qs_count = int(var_stats.get("pending_qs_count") or 0)

    wbud_res = await db.execute(
        text("""
            SELECT
                COUNT(*) AS weekly_budgets_count,
                COALESCE(SUM(total_planned_amount), 0) AS total_budget_amount
            FROM projects.weekly_budgets
            WHERE organization_id = CAST(:org_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND week_start >= CAST(:start_dt AS date)
              AND week_start < CAST(:next_month_start AS date)
              AND is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id, "start_dt": start_dt, "next_month_start": next_month_start},
    )

    wbud_stats = wbud_res.mappings().first() or {}
    weekly_budgets_count = int(wbud_stats.get("weekly_budgets_count") or 0)
    planned_weekly_budget = float(wbud_stats.get("total_budget_amount") or 0)
    variance_to_weekly_budget = round(total_direct_site_cost - planned_weekly_budget, 2)

    qs_verdict = (
        "COMMERCIAL EXPOSURE - Unapproved client variations pending sign-off"
        if pend_var_amt > 10000.0 or pending_qs_count > 0
        else "BUDGET OVERRUN RISK - Direct site spend exceeds weekly planned baseline"
        if variance_to_weekly_budget > 5000.0
        else "COMMERCIALLY SOUND - Controlled site expenditures and variance headroom"
    )
    qs_talking_points = [
        f"Month direct site spend: ${total_direct_site_cost:,.2f} (Labour: ${total_labour_cost:,.2f}, Plant: ${total_plant_cost:,.2f}, Materials: ${total_mat_cost:,.2f}).",
        f"Planned weekly budgets: ${planned_weekly_budget:,.2f} across {weekly_budgets_count} weekly submissions. Variance: ${variance_to_weekly_budget:+,.2f}.",
        f"Contract variations: {total_var_count} total claims (${total_var_amt:,.2f}). Approved: ${app_var_amt:,.2f}. Pending Client Sign-off: ${pend_var_amt:,.2f}.",
        "Mandate: Submit formal pricing and notices for all site instructions to convert potential cost leaks into billable revenue."
    ]

    # Executive discipline score (0 - 100)
    var_score = 100.0 if pend_var_amt == 0 else max(30.0, 100.0 - (pend_var_amt / 1000.0))
    ot_score = max(0.0, 100.0 - (overtime_ratio_pct * 2.0)) if total_work_hrs > 0 else (100.0 if total_reports > 0 else 0.0)
    discipline_score = int(round(
        (min(reporting_compliance_pct, 100.0) * 0.35) +
        (min(briefing_compliance_pct, 100.0) * 0.35) +
        (ot_score * 0.15) +
        (var_score * 0.15)
    ))

    # Dynamic Truthful Health Assessment (Approved Policy A2)
    # Honest evaluation: Adverse operational signals strictly take precedence over stored manual status.
    calculated_health = "on_track"
    health_reasons = []
    if reports_with_delays >= 3 or variance_to_weekly_budget > 10000.0 or discipline_score < 40:
        calculated_health = "critical"
        if reports_with_delays >= 3:
            health_reasons.append(f"{reports_with_delays} active contractual delay reports recorded")
        if variance_to_weekly_budget > 10000.0:
            health_reasons.append(f"Direct site spend exceeds weekly planned budget by ${variance_to_weekly_budget:,.2f}")
        if discipline_score < 40:
            health_reasons.append(f"Low site reporting discipline score ({discipline_score}/100)")
    elif reports_with_delays >= 1 or variance_to_weekly_budget > 2500.0 or discipline_score < 70 or (days_elapsed > 3 and reporting_compliance_pct < 50.0):
        calculated_health = "at_risk"
        if reports_with_delays >= 1:
            health_reasons.append(f"{reports_with_delays} active delay report(s)")
        if variance_to_weekly_budget > 2500.0:
            health_reasons.append(f"Direct site spend exceeds weekly budget by ${variance_to_weekly_budget:,.2f}")
        if discipline_score < 70:
            health_reasons.append(f"Suboptimal site discipline score ({discipline_score}/100)")
        if days_elapsed > 3 and reporting_compliance_pct < 50.0:
            health_reasons.append(f"Site reporting compliance below threshold ({reporting_compliance_pct:.1f}%)")

    stored_health = project.get("health_status")
    # Approved Rule A2: Adverse signals (critical, at_risk) strictly override manual stored status.
    if calculated_health in ("critical", "at_risk"):
        assessed_health = calculated_health
        health_provenance = "dynamic_operational_assessment"
    elif stored_health:
        assessed_health = stored_health
        health_provenance = "manual_stored_override"
    else:
        assessed_health = calculated_health
        health_provenance = "dynamic_operational_assessment"

    data = {
        "project": {
            "id": str(project["id"]),
            "name": project["name"],
            "project_code": project["project_code"],
            "client_name": project["client_name"] or "Direct Client",
            "contract_value": float(project["contract_value"] or 0),
            "status": project["status"],
            "health_status": assessed_health,
            "health_provenance": health_provenance,
            "health_assessment_reasons": health_reasons,
            "assessed_at": datetime.now(timezone.utc).isoformat(),
        },
        "period": {
            "month": month_label,
            "start_date": str(start_dt),
            "end_date": str(end_date_inclusive),
            "working_days": working_days,
            "days_elapsed": days_elapsed,
        },
        "discipline_score": discipline_score,
        "engineer": {
            "name": engineer_member["full_name"] if engineer_member else "Site Engineer / Lead Agent",
            "role": engineer_member["role_on_project"] if engineer_member else "Site Engineer",
            "reports_filed": total_reports,
            "reporting_compliance_pct": reporting_compliance_pct,
            "reports_with_issues": reports_with_issues,
            "reports_with_delays": reports_with_delays,
            "milestones_total": m_total,
            "milestones_completed": m_completed,
            "milestones_completion_pct": milestone_pct,
            "recent_delays": recent_delays,
            "verdict": engineer_verdict,
            "talking_points": engineer_talking_points,
        },
        "site_engineer": {
            "name": engineer_member["full_name"] if engineer_member else "Site Engineer / Lead Agent",
            "role": engineer_member["role_on_project"] if engineer_member else "Site Engineer",
            "reports_recorded": total_reports,
            "reporting_compliance_pct": reporting_compliance_pct,
            "reports_with_issues": reports_with_issues,
            "reports_with_delays": reports_with_delays,
            "milestones_total": m_total,
            "milestones_completed": m_completed,
            "milestones_completion_pct": milestone_pct,
        },

        "foreman": {
            "name": foreman_member["full_name"] if foreman_member else "General Site Foreman",
            "role": foreman_member["role_on_project"] if foreman_member else "General Foreman",
            "briefings_conducted": briefings_conducted,
            "briefing_compliance_pct": briefing_compliance_pct,
            "avg_daily_headcount": avg_daily_headcount,
            "active_site_days": active_site_days,
            "total_man_shifts": total_man_shifts,
            "total_regular_hours": total_reg_hrs,
            "total_overtime_hours": total_ot_hrs,
            "overtime_ratio_pct": overtime_ratio_pct,
            "verdict": foreman_verdict,
            "talking_points": foreman_talking_points,
        },
        "qs": {
            "name": qs_member["full_name"] if qs_member else "Lead Quantity Surveyor",
            "role": qs_member["role_on_project"] if qs_member else "Quantity Surveyor",
            "total_labour_cost": total_labour_cost,
            "total_plant_cost": total_plant_cost,
            "total_material_cost": total_mat_cost,
            "total_direct_site_cost": total_direct_site_cost,
            "weekly_budgets_count": weekly_budgets_count,
            "planned_weekly_budget": planned_weekly_budget,
            "variance_to_weekly_budget": variance_to_weekly_budget,
            "total_variations_count": total_var_count,
            "total_variation_amount": total_var_amt,
            "approved_variation_amount": app_var_amt,
            "pending_variation_amount": pend_var_amt,
            "pending_qs_reviews": pending_qs_count,
            "verdict": qs_verdict,
            "talking_points": qs_talking_points,
        },
        "action_agenda": [
            f"Review {total_reports} daily site diaries with Site Engineer; ensure unrecorded delays are substantiated.",
            f"Audit Foreman workforce records: {overtime_ratio_pct}% overtime burn rate across ${total_labour_cost:,.2f} payroll.",
            f"Review Quantity Surveyor claims: ${pend_var_amt:,.2f} pending client sign-off before month-end billing closure.",
        ],
    }
    return _result(data, "Month-end leadership accountability dossier loaded successfully.")


# ---------------------------------------------------------------------------
# CAPABILITY 2: Concrete Pour Cards & Site Quality Management
# ---------------------------------------------------------------------------

class PourCardCreate(BaseModel):
    pour_number: str = Field(min_length=1, max_length=80)
    element_name: str = Field(min_length=1, max_length=255)
    structure_level: Optional[str] = Field(default=None, max_length=80)
    concrete_grade: str = Field(min_length=1, max_length=40)
    design_volume_m3: Decimal = Field(default=Decimal("0"), ge=0)
    target_slump_mm: Optional[int] = Field(default=100, ge=0, le=300)
    supplier_name: Optional[str] = Field(default=None, max_length=255)
    notes: Optional[str] = None


class PourCardUpdate(BaseModel):
    element_name: Optional[str] = None
    structure_level: Optional[str] = None
    concrete_grade: Optional[str] = None
    design_volume_m3: Optional[Decimal] = None
    actual_volume_m3: Optional[Decimal] = None
    target_slump_mm: Optional[int] = None
    measured_slump_mm: Optional[int] = None
    supplier_name: Optional[str] = None
    status: Optional[str] = None
    rebar_inspected: Optional[bool] = None
    formwork_inspected: Optional[bool] = None
    cleanliness_inspected: Optional[bool] = None
    embedded_mep_inspected: Optional[bool] = None
    cover_blocks_verified: Optional[bool] = None
    pour_started_at: Optional[str] = None
    pour_completed_at: Optional[str] = None
    cubes_sampled_count: Optional[int] = None
    cube_sample_ids: Optional[str] = None
    strength_7d_mpa: Optional[Decimal] = None
    strength_28d_mpa: Optional[Decimal] = None
    test_result_verdict: Optional[str] = None
    test_certificate_ref: Optional[str] = None
    notes: Optional[str] = None


@router.get("/{project_id}/pour-cards")
async def list_pour_cards(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    status_filter: Optional[str] = Query(default=None, alias="status"),
):
    """Lists all concrete pour cards and QA inspection status for a project."""
    await _project_or_404(db, project_id, user["org_id"])
    query = """
        SELECT c.*, eng.full_name AS approved_by_name, creator.full_name AS created_by_name
        FROM projects.concrete_pour_cards c
        LEFT JOIN core.users eng ON eng.id = c.pre_pour_approved_by
        LEFT JOIN core.users creator ON creator.id = c.created_by
        WHERE c.project_id = CAST(:project_id AS uuid)
          AND c.organization_id = CAST(:org_id AS uuid)
          AND c.is_deleted = false
    """
    params = {"project_id": str(project_id), "org_id": str(user["org_id"])}
    if status_filter:
        query += " AND c.status = :st"
        params["st"] = status_filter
    query += " ORDER BY c.created_at DESC"

    res = await db.execute(text(query), params)
    cards = [dict(r) for r in res.mappings().all()]
    return _result(cards, f"Retrieved {len(cards)} concrete pour cards.")


@router.post("/{project_id}/pour-cards", status_code=201)
async def create_pour_card(
    project_id: UUID,
    payload: PourCardCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Creates a new Concrete Pour Card with mix specifications and pre-pour requirements."""
    await _project_or_404(db, project_id, user["org_id"])
    try:
        row = (
            await db.execute(
                text("""
                    INSERT INTO projects.concrete_pour_cards (
                        organization_id, project_id, pour_number, element_name,
                        structure_level, concrete_grade, design_volume_m3,
                        target_slump_mm, supplier_name, notes, created_by,
                        status, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:project_id AS uuid), :pour_number, :element_name,
                        :structure_level, :concrete_grade, :design_volume_m3,
                        :target_slump_mm, :supplier_name, :notes, CAST(:user_id AS uuid),
                        'pre_pour_check', NOW(), NOW()
                    ) RETURNING id
                """),
                {
                    **payload.model_dump(),
                    "org_id": str(user["org_id"]),
                    "project_id": str(project_id),
                    "user_id": str(user["user_id"]),
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Concrete pour card created successfully.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Pour card number '{payload.pour_number}' already exists for this project."
        ) from exc


@router.patch("/{project_id}/pour-cards/{pour_id}")
async def update_pour_card(
    project_id: UUID,
    pour_id: UUID,
    payload: PourCardUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Updates QA pre-pour checklist, execution metrics, or 7d/28d cube crushing strength results."""
    await _project_or_404(db, project_id, user["org_id"])
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")

    row = (
        await db.execute(
            text("""
                UPDATE projects.concrete_pour_cards SET
                    element_name = COALESCE(:element_name, element_name),
                    structure_level = COALESCE(:structure_level, structure_level),
                    concrete_grade = COALESCE(:concrete_grade, concrete_grade),
                    design_volume_m3 = COALESCE(:design_volume_m3, design_volume_m3),
                    actual_volume_m3 = COALESCE(:actual_volume_m3, actual_volume_m3),
                    target_slump_mm = COALESCE(:target_slump_mm, target_slump_mm),
                    measured_slump_mm = COALESCE(:measured_slump_mm, measured_slump_mm),
                    supplier_name = COALESCE(:supplier_name, supplier_name),
                    status = COALESCE(:status, status),
                    rebar_inspected = COALESCE(:rebar_inspected, rebar_inspected),
                    formwork_inspected = COALESCE(:formwork_inspected, formwork_inspected),
                    cleanliness_inspected = COALESCE(:cleanliness_inspected, cleanliness_inspected),
                    embedded_mep_inspected = COALESCE(:embedded_mep_inspected, embedded_mep_inspected),
                    cover_blocks_verified = COALESCE(:cover_blocks_verified, cover_blocks_verified),
                    cubes_sampled_count = COALESCE(:cubes_sampled_count, cubes_sampled_count),
                    cube_sample_ids = COALESCE(:cube_sample_ids, cube_sample_ids),
                    strength_7d_mpa = COALESCE(:strength_7d_mpa, strength_7d_mpa),
                    strength_28d_mpa = COALESCE(:strength_28d_mpa, strength_28d_mpa),
                    test_result_verdict = COALESCE(:test_result_verdict, test_result_verdict),
                    test_certificate_ref = COALESCE(:test_certificate_ref, test_certificate_ref),
                    notes = COALESCE(:notes, notes),
                    updated_at = NOW()
                WHERE id = CAST(:pour_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                RETURNING id
            """),
            {
                "pour_id": str(pour_id),
                "project_id": str(project_id),
                "org_id": str(user["org_id"]),
                "element_name": fields.get("element_name"),
                "structure_level": fields.get("structure_level"),
                "concrete_grade": fields.get("concrete_grade"),
                "design_volume_m3": fields.get("design_volume_m3"),
                "actual_volume_m3": fields.get("actual_volume_m3"),
                "target_slump_mm": fields.get("target_slump_mm"),
                "measured_slump_mm": fields.get("measured_slump_mm"),
                "supplier_name": fields.get("supplier_name"),
                "status": fields.get("status"),
                "rebar_inspected": fields.get("rebar_inspected"),
                "formwork_inspected": fields.get("formwork_inspected"),
                "cleanliness_inspected": fields.get("cleanliness_inspected"),
                "embedded_mep_inspected": fields.get("embedded_mep_inspected"),
                "cover_blocks_verified": fields.get("cover_blocks_verified"),
                "cubes_sampled_count": fields.get("cubes_sampled_count"),
                "cube_sample_ids": fields.get("cube_sample_ids"),
                "strength_7d_mpa": fields.get("strength_7d_mpa"),
                "strength_28d_mpa": fields.get("strength_28d_mpa"),
                "test_result_verdict": fields.get("test_result_verdict"),
                "test_certificate_ref": fields.get("test_certificate_ref"),
                "notes": fields.get("notes"),
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Pour card not found.")
    await db.commit()
    return _result({"id": str(pour_id)}, "Pour card updated.")


class ConcretePourAuthorizeRequest(BaseModel):
    rebar_inspected: Optional[bool] = None
    formwork_inspected: Optional[bool] = None
    cleanliness_inspected: Optional[bool] = None
    embedded_mep_inspected: Optional[bool] = None
    cover_blocks_verified: Optional[bool] = None


@router.post("/{project_id}/pour-cards/{pour_id}/authorize-pour")
async def authorize_concrete_pour(
    project_id: UUID,
    pour_id: UUID,
    payload: Optional[ConcretePourAuthorizeRequest] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.approve")),
):
    """Site Engineer Authorization Gate: Verifies rebar, formwork, cleanliness, MEP, and cover blocks

    before advancing status to 'approved_for_pour'.
    """
    await _project_or_404(db, project_id, user["org_id"])
    if payload:
        update_fields = payload.model_dump(exclude_none=True)
        if update_fields:
            set_clauses = [f"{k} = :{k}" for k in update_fields.keys()]
            params = {k: v for k, v in update_fields.items()}
            params["pour_id"] = str(pour_id)
            params["project_id"] = str(project_id)
            params["org_id"] = str(user["org_id"])
            await db.execute(
                text(f"""
                    UPDATE projects.concrete_pour_cards SET
                        {", ".join(set_clauses)},
                        updated_at = NOW()
                    WHERE id = CAST(:pour_id AS uuid)
                      AND project_id = CAST(:project_id AS uuid)
                      AND organization_id = CAST(:org_id AS uuid)
                      AND is_deleted = false
                """),
                params,
            )
            await db.flush()

    res = await db.execute(
        text("""
            SELECT id, rebar_inspected, formwork_inspected, cleanliness_inspected,
                   embedded_mep_inspected, cover_blocks_verified, status
            FROM projects.concrete_pour_cards
            WHERE id = CAST(:pour_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND organization_id = CAST(:org_id AS uuid)
              AND is_deleted = false
        """),
        {"pour_id": str(pour_id), "project_id": str(project_id), "org_id": str(user["org_id"])},
    )
    card = res.mappings().first()
    if not card:
        raise HTTPException(status_code=404, detail="Pour card not found.")

    # Verification gate
    missing_checks = []
    if not card["rebar_inspected"]:
        missing_checks.append("Rebar reinforcement placement & tie-wire check")
    if not card["formwork_inspected"]:
        missing_checks.append("Formwork alignment, bracing & release agent check")
    if not card["cleanliness_inspected"]:
        missing_checks.append("Formwork cleanliness & air-blowout check")
    if not card["embedded_mep_inspected"]:
        missing_checks.append("Embedded MEP conduits & cast-in sleeves check")
    if not card["cover_blocks_verified"]:
        missing_blocks_verified = True
        missing_checks.append("Concrete cover spacer blocks verification")

    if missing_checks:
        raise HTTPException(
            status_code=400,
            detail=f"Pour cannot be authorized. Missing mandatory pre-pour inspections: {'; '.join(missing_checks)}."
        )

    user_id = user.get("user_id") or user.get("id")
    await db.execute(
        text("""
            UPDATE projects.concrete_pour_cards SET
                status = 'approved_for_pour',
                pre_pour_approved_by = CAST(:user_id AS uuid),
                pre_pour_approved_at = NOW(),
                updated_at = NOW()
            WHERE id = CAST(:pour_id AS uuid)
        """),
        {"pour_id": str(pour_id), "user_id": str(user_id)},
    )
    await db.commit()
    return _result({"id": str(pour_id), "status": "approved_for_pour"}, "Concrete pour authorized by Site Engineer.")


# ---------------------------------------------------------------------------
# CAPABILITY 2 (Continued): Mobile Snag / Defect Management
# ---------------------------------------------------------------------------

class SnagCreate(BaseModel):
    snag_number: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    location_zone: str = Field(min_length=1, max_length=255)
    severity: Literal["cosmetic", "minor", "major", "critical_safety"] = "minor"
    subcontractor_id: Optional[UUID] = None
    trade: Optional[str] = Field(default=None, max_length=80)
    due_date: Optional[date] = None
    photo_url: Optional[str] = None


class SnagUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location_zone: Optional[str] = None
    severity: Optional[str] = None
    status: Optional[str] = None
    trade: Optional[str] = None
    subcontractor_id: Optional[UUID] = None
    due_date: Optional[date] = None
    photo_url: Optional[str] = None
    rectified_photo_url: Optional[str] = None


@router.get("/{project_id}/snags")
async def list_snags(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    severity_filter: Optional[str] = Query(default=None, alias="severity"),
):
    """Lists defects and snags for the project with trade assignment and resolution status."""
    await _project_or_404(db, project_id, user["org_id"])
    query = """
        SELECT s.*, sub.name AS subcontractor_name, creator.full_name AS created_by_name,
               rectifier.full_name AS rectified_by_name, closer.full_name AS closed_by_name
        FROM projects.site_snags s
        LEFT JOIN crm.subcontractors sub ON sub.id = s.subcontractor_id
        LEFT JOIN core.users creator ON creator.id = s.created_by
        LEFT JOIN core.users rectifier ON rectifier.id = s.rectified_by
        LEFT JOIN core.users closer ON closer.id = s.closed_by
        WHERE s.project_id = CAST(:project_id AS uuid)
          AND s.organization_id = CAST(:org_id AS uuid)
          AND s.is_deleted = false
    """
    params = {"project_id": str(project_id), "org_id": str(user["org_id"])}
    if status_filter:
        query += " AND s.status = :st"
        params["st"] = status_filter
    if severity_filter:
        query += " AND s.severity = :sev"
        params["sev"] = severity_filter
    query += " ORDER BY s.created_at DESC"

    res = await db.execute(text(query), params)
    snags = [dict(r) for r in res.mappings().all()]
    return _result(snags, f"Retrieved {len(snags)} site snags.")


@router.post("/{project_id}/snags", status_code=201)
async def create_snag(
    project_id: UUID,
    payload: SnagCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Logs a site snag or defect with location, trade, severity, and photo."""
    await _project_or_404(db, project_id, user["org_id"])
    try:
        row = (
            await db.execute(
                text("""
                    INSERT INTO projects.site_snags (
                        organization_id, project_id, snag_number, title, description,
                        location_zone, severity, status, subcontractor_id, trade,
                        due_date, photo_url, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:project_id AS uuid), :snag_number, :title, :description,
                        :location_zone, :severity, 'open', CAST(:subcontractor_id AS uuid), :trade,
                        :due_date, :photo_url, CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                """),
                {
                    **payload.model_dump(),
                    "org_id": str(user["org_id"]),
                    "project_id": str(project_id),
                    "user_id": str(user["user_id"]),
                    "subcontractor_id": str(payload.subcontractor_id) if payload.subcontractor_id else None,
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Site snag recorded.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Snag number '{payload.snag_number}' already exists for this project."
        ) from exc


@router.patch("/{project_id}/snags/{snag_id}")
async def update_snag(
    project_id: UUID,
    snag_id: UUID,
    payload: SnagUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Updates snag details or marks rectification."""
    await _project_or_404(db, project_id, user["org_id"])
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")

    is_rectifying = fields.get("status") == "rectified"
    row = (
        await db.execute(
            text("""
                UPDATE projects.site_snags SET
                    title = COALESCE(:title, title),
                    description = COALESCE(:description, description),
                    location_zone = COALESCE(:location_zone, location_zone),
                    severity = COALESCE(:severity, severity),
                    status = COALESCE(:status, status),
                    trade = COALESCE(:trade, trade),
                    subcontractor_id = CASE WHEN :subcontractor_id_provided THEN CAST(:subcontractor_id AS uuid) ELSE subcontractor_id END,
                    due_date = COALESCE(:due_date, due_date),
                    photo_url = COALESCE(:photo_url, photo_url),
                    rectified_photo_url = COALESCE(:rectified_photo_url, rectified_photo_url),
                    rectified_at = CASE WHEN :is_rectifying THEN NOW() ELSE rectified_at END,
                    rectified_by = CASE WHEN :is_rectifying THEN CAST(:user_id AS uuid) ELSE rectified_by END,
                    updated_at = NOW()
                WHERE id = CAST(:snag_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                RETURNING id
            """),
            {
                "snag_id": str(snag_id),
                "project_id": str(project_id),
                "org_id": str(user["org_id"]),
                "user_id": str(user["user_id"]),
                "title": fields.get("title"),
                "description": fields.get("description"),
                "location_zone": fields.get("location_zone"),
                "severity": fields.get("severity"),
                "status": fields.get("status"),
                "trade": fields.get("trade"),
                "subcontractor_id_provided": "subcontractor_id" in fields,
                "subcontractor_id": str(fields["subcontractor_id"]) if fields.get("subcontractor_id") else None,
                "due_date": fields.get("due_date"),
                "photo_url": fields.get("photo_url"),
                "rectified_photo_url": fields.get("rectified_photo_url"),
                "is_rectifying": is_rectifying,
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Snag not found.")
    await db.commit()
    return _result({"id": str(snag_id)}, "Snag updated.")


@router.post("/{project_id}/snags/{snag_id}/sign-off")
async def close_snag_sign_off(
    project_id: UUID,
    snag_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.approve")),
):
    """QA Engineer sign-off gate: Formally closes a rectified defect."""
    await _project_or_404(db, project_id, user["org_id"])
    row = (
        await db.execute(
            text("""
                UPDATE projects.site_snags SET
                    status = 'closed',
                    closed_at = NOW(),
                    closed_by = CAST(:user_id AS uuid),
                    updated_at = NOW()
                WHERE id = CAST(:snag_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                RETURNING id
            """),
            {"snag_id": str(snag_id), "project_id": str(project_id), "org_id": str(user["org_id"]), "user_id": str(user["user_id"])},
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Snag not found.")
    await db.commit()
    return _result({"id": str(snag_id), "status": "closed"}, "Defect inspection signed off and closed.")


# ---------------------------------------------------------------------------
# CAPABILITY 1: Subcontractor Packages, Payment Certification, Retentions & Back-Charges
# ---------------------------------------------------------------------------

class SubcontractPackageCreate(BaseModel):
    package_number: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    subcontractor_id: UUID
    trade: str = Field(min_length=1, max_length=80)
    award_value: Decimal = Field(default=Decimal("0"), ge=0)
    retention_percentage: Decimal = Field(default=Decimal("10.0"), ge=0, le=20)
    retention_cap: Optional[Decimal] = Field(default=Decimal("0"), ge=0)
    start_date: Optional[date] = None
    completion_date: Optional[date] = None
    scope_description: Optional[str] = None


class SubcontractPackageUpdate(BaseModel):
    title: Optional[str] = None
    trade: Optional[str] = None
    award_value: Optional[Decimal] = None
    retention_percentage: Optional[Decimal] = None
    retention_cap: Optional[Decimal] = None
    status: Optional[str] = None
    start_date: Optional[date] = None
    completion_date: Optional[date] = None
    scope_description: Optional[str] = None


class SubcontractCertificateCreate(BaseModel):
    certificate_number: str = Field(min_length=1, max_length=80)
    valuation_date: date
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    claimed_amount: Decimal = Field(default=Decimal("0"), ge=0)
    certified_gross_amount: Decimal = Field(default=Decimal("0"), ge=0)
    notes: Optional[str] = None


class SubcontractBackChargeCreate(BaseModel):
    package_id: UUID
    subcontractor_id: UUID
    charge_number: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=255)
    reason_category: Literal[
        "defective_work_rectification",
        "plant_hire_recovery",
        "material_usage_recovery",
        "site_cleaning_penalty",
        "safety_non_compliance",
    ]
    amount: Decimal = Field(gt=0)
    evidence_reference: Optional[str] = None


class SubcontractBackChargeUpdate(BaseModel):
    title: Optional[str] = None
    reason_category: Optional[str] = None
    amount: Optional[Decimal] = None
    evidence_reference: Optional[str] = None
    status: Optional[str] = None


@router.get("/{project_id}/subcontracts")
async def list_subcontract_packages(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lists all subcontract packages for a project with aggregated valuations,

    retention held, back-charges, and net payments.
    """
    await _project_or_404(db, project_id, user["org_id"])
    query = """
        SELECT
            p.*,
            sub.name AS subcontractor_name,
            sub.contact_email AS subcontractor_email,
            sub.contact_phone AS subcontractor_phone,
            COALESCE(SUM(c.certified_gross_amount), 0) AS total_certified_gross,
            COALESCE(SUM(c.retention_deducted), 0) AS total_retention_held,
            COALESCE(SUM(c.contra_charges_deducted), 0) AS total_contra_deducted,
            COALESCE(SUM(c.net_payable_amount), 0) AS total_net_payable,
            COUNT(c.id) AS certificates_count
        FROM projects.subcontract_packages p
        LEFT JOIN crm.subcontractors sub ON sub.id = p.subcontractor_id
        LEFT JOIN projects.subcontractor_certificates c ON c.package_id = p.id AND c.is_deleted = false AND c.status != 'rejected'
        WHERE p.project_id = CAST(:project_id AS uuid)
          AND p.organization_id = CAST(:org_id AS uuid)
          AND p.is_deleted = false
        GROUP BY p.id, sub.id
        ORDER BY p.created_at DESC
    """
    res = await db.execute(text(query), {"project_id": str(project_id), "org_id": str(user["org_id"])})
    packages = [dict(r) for r in res.mappings().all()]
    return _result(packages, f"Retrieved {len(packages)} subcontract packages.")


@router.post("/{project_id}/subcontracts", status_code=201)
async def create_subcontract_package(
    project_id: UUID,
    payload: SubcontractPackageCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "procurement.order.create")),
):
    """Creates a new subcontract package tied to a verified subcontractor and project."""
    await _project_or_404(db, project_id, user["org_id"])
    try:
        row = (
            await db.execute(
                text("""
                    INSERT INTO projects.subcontract_packages (
                        organization_id, project_id, package_number, title,
                        subcontractor_id, trade, award_value, retention_percentage,
                        retention_cap, start_date, completion_date, scope_description,
                        status, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:project_id AS uuid), :package_number, :title,
                        CAST(:subcontractor_id AS uuid), :trade, :award_value, :retention_percentage,
                        :retention_cap, :start_date, :completion_date, :scope_description,
                        'awarded', CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                """),
                {
                    **payload.model_dump(),
                    "org_id": str(user["org_id"]),
                    "project_id": str(project_id),
                    "user_id": str(user["user_id"]),
                    "subcontractor_id": str(payload.subcontractor_id),
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Subcontract package created successfully.")
    except Exception as exc:
        await db.rollback()
        err_msg = str(exc)
        if "unique" in err_msg.lower() or "duplicate" in err_msg.lower():
            raise HTTPException(
                status_code=409,
                detail=f"Subcontract package number '{payload.package_number}' already exists for this project."
            ) from exc
        raise HTTPException(status_code=400, detail=f"Failed to create subcontract package: {err_msg}") from exc



@router.patch("/{project_id}/subcontracts/{package_id}")
async def update_subcontract_package(
    project_id: UUID,
    package_id: UUID,
    payload: SubcontractPackageUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "procurement.order.create")),
):
    """Updates terms, value, or lifecycle status of a subcontract package."""
    await _project_or_404(db, project_id, user["org_id"])
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")

    row = (
        await db.execute(
            text("""
                UPDATE projects.subcontract_packages SET
                    title = COALESCE(:title, title),
                    trade = COALESCE(:trade, trade),
                    award_value = COALESCE(:award_value, award_value),
                    retention_percentage = COALESCE(:retention_percentage, retention_percentage),
                    retention_cap = COALESCE(:retention_cap, retention_cap),
                    status = COALESCE(:status, status),
                    start_date = COALESCE(:start_date, start_date),
                    completion_date = COALESCE(:completion_date, completion_date),
                    scope_description = COALESCE(:scope_description, scope_description),
                    updated_at = NOW()
                WHERE id = CAST(:package_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                RETURNING id
            """),
            {
                "package_id": str(package_id),
                "project_id": str(project_id),
                "org_id": str(user["org_id"]),
                "title": fields.get("title"),
                "trade": fields.get("trade"),
                "award_value": fields.get("award_value"),
                "retention_percentage": fields.get("retention_percentage"),
                "retention_cap": fields.get("retention_cap"),
                "status": fields.get("status"),
                "start_date": fields.get("start_date"),
                "completion_date": fields.get("completion_date"),
                "scope_description": fields.get("scope_description"),
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Subcontract package not found.")
    await db.commit()
    return _result({"id": str(package_id)}, "Subcontract package updated.")


@router.get("/{project_id}/subcontracts/{package_id}/certificates")
async def list_subcontract_certificates(
    project_id: UUID,
    package_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lists all interim payment certificates for a subcontract package."""
    await _project_or_404(db, project_id, user["org_id"])
    query = """
        SELECT c.*, qs.full_name AS qs_assessor_name, mgr.full_name AS manager_approver_name
        FROM projects.subcontractor_certificates c
        LEFT JOIN core.users qs ON qs.id = c.qs_assessor_id
        LEFT JOIN core.users mgr ON mgr.id = c.commercial_manager_approver_id
        WHERE c.package_id = CAST(:package_id AS uuid)
          AND c.project_id = CAST(:project_id AS uuid)
          AND c.organization_id = CAST(:org_id AS uuid)
          AND c.is_deleted = false
        ORDER BY c.valuation_date DESC, c.created_at DESC
    """
    res = await db.execute(text(query), {
        "package_id": str(package_id),
        "project_id": str(project_id),
        "org_id": str(user["org_id"]),
    })
    certs = [dict(r) for r in res.mappings().all()]
    return _result(certs, f"Retrieved {len(certs)} payment certificates.")


@router.post("/{project_id}/subcontracts/{package_id}/certificates", status_code=201)
async def create_subcontract_certificate(
    project_id: UUID,
    package_id: UUID,
    payload: SubcontractCertificateCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "finance.manage")),
):
    """Creates a new Interim Payment Certificate with automatic retention and contra-charge deduction."""
    await _project_or_404(db, project_id, user["org_id"])

    # 1. Fetch subcontract package terms
    pkg_res = await db.execute(
        text("""
            SELECT id, award_value, retention_percentage, retention_cap, subcontractor_id
            FROM projects.subcontract_packages
            WHERE id = CAST(:package_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND organization_id = CAST(:org_id AS uuid)
              AND is_deleted = false
        """),
        {"package_id": str(package_id), "project_id": str(project_id), "org_id": str(user["org_id"])},
    )
    pkg = pkg_res.mappings().first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Subcontract package not found.")

    # 2. Fetch previous certified gross to date
    prev_res = await db.execute(
        text("""
            SELECT COALESCE(MAX(certified_gross_amount), 0) AS max_prev_gross,
                   COALESCE(SUM(retention_deducted), 0) AS total_retention_so_far
            FROM projects.subcontractor_certificates
            WHERE package_id = CAST(:package_id AS uuid)
              AND status IN ('certified', 'approved', 'posted_to_finance', 'paid')
              AND is_deleted = false
        """),
        {"package_id": str(package_id)},
    )
    prev = prev_res.mappings().first() or {}
    prev_gross = Decimal(str(prev.get("max_prev_gross") or 0))
    total_ret_so_far = Decimal(str(prev.get("total_retention_so_far") or 0))

    # 3. Calculate retention deduction
    gross = payload.certified_gross_amount
    ret_pct = Decimal(str(pkg["retention_percentage"])) / Decimal("100")
    ret_cap = Decimal(str(pkg["retention_cap"] or 0))

    incremental_gross = max(Decimal("0"), gross - prev_gross)
    raw_retention = incremental_gross * ret_pct

    if ret_cap > 0 and (total_ret_so_far + raw_retention) > ret_cap:
        retention_to_deduct = max(Decimal("0"), ret_cap - total_ret_so_far)
    else:
        retention_to_deduct = raw_retention

    # 4. Fetch pending approved back-charges to apply
    bc_res = await db.execute(
        text("""
            SELECT id, amount
            FROM projects.subcontractor_back_charges
            WHERE package_id = CAST(:package_id AS uuid)
              AND status = 'approved'
              AND is_deleted = false
        """),
        {"package_id": str(package_id)},
    )
    approved_charges = [dict(r) for r in bc_res.mappings().all()]
    total_contra = sum(Decimal(str(c["amount"])) for c in approved_charges)

    # 5. Calculate net payable
    net_payable = max(Decimal("0"), incremental_gross - retention_to_deduct - total_contra)

    # 6. Insert Certificate
    cert_row = (
        await db.execute(
            text("""
                INSERT INTO projects.subcontractor_certificates (
                    organization_id, project_id, package_id, certificate_number,
                    valuation_date, period_start, period_end, claimed_amount,
                    certified_gross_amount, retention_deducted, contra_charges_deducted,
                    previous_certified_gross, net_payable_amount, status,
                    qs_assessor_id, certified_at, notes, created_by, created_at, updated_at
                ) VALUES (
                    CAST(:org_id AS uuid), CAST(:project_id AS uuid), CAST(:package_id AS uuid), :cert_num,
                    :val_date, :p_start, :p_end, :claimed,
                    :gross, :retention, :contra,
                    :prev_gross, :net_payable, 'certified',
                    CAST(:user_id AS uuid), NOW(), :notes, CAST(:user_id AS uuid), NOW(), NOW()
                ) RETURNING id
            """),
            {
                "org_id": str(user["org_id"]),
                "project_id": str(project_id),
                "package_id": str(package_id),
                "cert_num": payload.certificate_number,
                "val_date": payload.valuation_date,
                "p_start": payload.period_start,
                "p_end": payload.period_end,
                "claimed": payload.claimed_amount,
                "gross": gross,
                "retention": retention_to_deduct,
                "contra": total_contra,
                "prev_gross": prev_gross,
                "net_payable": net_payable,
                "user_id": str(user["user_id"]),
                "notes": payload.notes,
            },
        )
    ).first()
    cert_id = cert_row.id

    # 7. Mark back-charges as applied to this certificate
    if approved_charges:
        charge_ids = [str(c["id"]) for c in approved_charges]
        await db.execute(
            text("""
                UPDATE projects.subcontractor_back_charges
                SET status = 'applied_to_certificate',
                    applied_certificate_id = CAST(:cert_id AS uuid),
                    updated_at = NOW()
                WHERE id = ANY(CAST(:ids AS uuid[]))
            """),
            {"cert_id": str(cert_id), "ids": charge_ids},
        )

    await db.commit()
    return _result({
        "id": str(cert_id),
        "gross": float(gross),
        "retention_deducted": float(retention_to_deduct),
        "contra_charges_deducted": float(total_contra),
        "net_payable": float(net_payable),
    }, "Payment certificate certified successfully.")


@router.post("/{project_id}/subcontracts/{package_id}/certificates/{cert_id}/post-to-finance")
async def post_certificate_to_finance(
    project_id: UUID,
    package_id: UUID,
    cert_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "finance.manage")),
):
    """Posts certified subcontractor liability into finance.cost_transactions and

    retention held into finance.retention_ledger idempotently.
    """
    await _project_or_404(db, project_id, user["org_id"])

    # 1. Fetch certificate with row-level lock to serialize concurrent posts
    cert_res = await db.execute(
        text("""
            SELECT id, certificate_number, valuation_date, certified_gross_amount,
                   previous_certified_gross, net_payable_amount, retention_deducted, status
            FROM projects.subcontractor_certificates
            WHERE id = CAST(:cert_id AS uuid)
              AND package_id = CAST(:package_id AS uuid)
              AND project_id = CAST(:project_id AS uuid)
              AND organization_id = CAST(:org_id AS uuid)
              AND is_deleted = false
            FOR UPDATE
        """),
        {
            "cert_id": str(cert_id),
            "package_id": str(package_id),
            "project_id": str(project_id),
            "org_id": str(user["org_id"]),
        },
    )
    cert = cert_res.mappings().first()
    if not cert:
        raise HTTPException(status_code=404, detail="Payment certificate not found.")

    if cert["status"] == "posted_to_finance":
        return _result(
            {
                "id": str(cert_id),
                "status": "posted_to_finance",
                "already_posted": True,
            },
            message="Payment certificate was already posted to finance.",
        )

    gross_val = Decimal(str(cert["certified_gross_amount"] or cert["net_payable_amount"]))
    prev_val = Decimal(str(cert["previous_certified_gross"] or 0))
    incurred_cost = (gross_val - prev_val) if (gross_val - prev_val) > 0 else gross_val
    retention = Decimal(str(cert["retention_deducted"] or 0))
    val_date = cert["valuation_date"]
    cert_num = cert["certificate_number"]

    # 2. Post gross work liability into finance.cost_transactions (category: 'subcontract')
    # FIDIC/JBCC accounting rule: Incurred cost reflects gross work executed; retention is balance-sheet security withholding
    if incurred_cost > 0:
        await db.execute(
            text("""
                INSERT INTO finance.cost_transactions (
                    organization_id, project_id, source_type, source_id,
                    cost_category, description, quantity, unit_cost, amount,
                    transaction_date, status, posted_by, posted_at, created_at
                ) VALUES (
                    CAST(:org_id AS uuid), CAST(:project_id AS uuid), 'subcontractor_certificate', CAST(:cert_id AS uuid),
                    'subcontract', :desc, 1, :amount, :amount,
                    :txn_date, 'posted', CAST(:user_id AS uuid), NOW(), NOW()
                )
                ON CONFLICT (organization_id, source_type, source_id, cost_category)
                DO UPDATE SET
                    amount = EXCLUDED.amount,
                    posted_at = NOW()
            """),
            {
                "org_id": str(user["org_id"]),
                "project_id": str(project_id),
                "cert_id": str(cert_id),
                "desc": f"Subcontractor Valuation {cert_num} gross certified liability",
                "amount": incurred_cost,
                "txn_date": val_date,
                "user_id": str(user["user_id"]),
            },
        )

    # 3. Post retention into finance.retention_ledger idempotently
    if retention > 0:
        existing_ret = (await db.execute(
            text("""
                SELECT id FROM finance.retention_ledger
                WHERE organization_id = CAST(:org_id AS uuid)
                  AND source_id = CAST(:cert_id AS uuid)
                  AND movement_type = 'held'
            """),
            {"org_id": str(user["org_id"]), "cert_id": str(cert_id)}
        )).scalar()
        if not existing_ret:
            await db.execute(
                text("""
                    INSERT INTO finance.retention_ledger (
                        organization_id, project_id, source_type, source_id,
                        movement_type, amount, movement_date, notes, recorded_by, created_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:project_id AS uuid), 'progress_claim', CAST(:cert_id AS uuid),
                        'held', :amount, :m_date, :notes, CAST(:user_id AS uuid), NOW()
                    )
                """),
                {
                    "org_id": str(user["org_id"]),
                    "project_id": str(project_id),
                    "cert_id": str(cert_id),
                    "amount": retention,
                    "m_date": val_date,
                    "notes": f"Retention held on Subcontractor IPC {cert_num}",
                    "user_id": str(user["user_id"]),
                },
            )

    already_posted = (cert["status"] == "posted_to_finance")

    # 4. Update certificate status to 'posted_to_finance'
    await db.execute(
        text("""
            UPDATE projects.subcontractor_certificates
            SET status = 'posted_to_finance',
                commercial_manager_approver_id = CAST(:user_id AS uuid),
                updated_at = NOW()
            WHERE id = CAST(:cert_id AS uuid)
        """),
        {"cert_id": str(cert_id), "user_id": str(user["user_id"])},
    )

    await db.commit()
    return _result(
        {
            "id": str(cert_id),
            "status": "posted_to_finance",
            "already_posted": already_posted,
        },
        "Certificate posted to general finance ledgers."
    )



# ---------------------------------------------------------------------------
# Back-Charges & Contra-Charges API
# ---------------------------------------------------------------------------

@router.get("/{project_id}/back-charges")
async def list_subcontractor_back_charges(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    package_id: Optional[UUID] = None,
):
    """Lists contra-charges and back-charges across the project."""
    await _project_or_404(db, project_id, user["org_id"])
    query = """
        SELECT b.*, sub.name AS subcontractor_name, pkg.package_number, pkg.title AS package_title,
               approver.full_name AS approver_name
        FROM projects.subcontractor_back_charges b
        LEFT JOIN crm.subcontractors sub ON sub.id = b.subcontractor_id
        LEFT JOIN projects.subcontract_packages pkg ON pkg.id = b.package_id
        LEFT JOIN core.users approver ON approver.id = b.approved_by
        WHERE b.project_id = CAST(:project_id AS uuid)
          AND b.organization_id = CAST(:org_id AS uuid)
          AND b.is_deleted = false
    """
    params = {"project_id": str(project_id), "org_id": str(user["org_id"])}
    if package_id:
        query += " AND b.package_id = CAST(:pkg_id AS uuid)"
        params["pkg_id"] = str(package_id)
    query += " ORDER BY b.created_at DESC"

    res = await db.execute(text(query), params)
    charges = [dict(r) for r in res.mappings().all()]
    return _result(charges, f"Retrieved {len(charges)} back-charges.")


@router.post("/{project_id}/back-charges", status_code=201)
async def create_subcontractor_back_charge(
    project_id: UUID,
    payload: SubcontractBackChargeCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Issues a contra-charge / back-charge notice to a subcontractor."""
    await _project_or_404(db, project_id, user["org_id"])
    try:
        row = (
            await db.execute(
                text("""
                    INSERT INTO projects.subcontractor_back_charges (
                        organization_id, project_id, package_id, subcontractor_id,
                        charge_number, title, reason_category, amount,
                        evidence_reference, status, created_by, created_at, updated_at
                    ) VALUES (
                        CAST(:org_id AS uuid), CAST(:project_id AS uuid), CAST(:package_id AS uuid), CAST(:sub_id AS uuid),
                        :charge_number, :title, :reason_category, :amount,
                        :evidence_reference, 'approved', CAST(:user_id AS uuid), NOW(), NOW()
                    ) RETURNING id
                """),
                {
                    "org_id": str(user["org_id"]),
                    "project_id": str(project_id),
                    "package_id": str(payload.package_id),
                    "sub_id": str(payload.subcontractor_id),
                    "charge_number": payload.charge_number,
                    "title": payload.title,
                    "reason_category": payload.reason_category,
                    "amount": payload.amount,
                    "evidence_reference": payload.evidence_reference,
                    "user_id": str(user["user_id"]),
                },
            )
        ).first()
        await db.commit()
        return _result({"id": str(row.id)}, "Back-charge notice issued and approved.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"Back-charge number '{payload.charge_number}' already exists for this project."
        ) from exc


@router.patch("/{project_id}/back-charges/{charge_id}")
async def update_subcontractor_back_charge(
    project_id: UUID,
    charge_id: UUID,
    payload: SubcontractBackChargeUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Updates back-charge status (e.g. waived, disputed, approved)."""
    await _project_or_404(db, project_id, user["org_id"])
    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=422, detail="No fields to update.")

    row = (
        await db.execute(
            text("""
                UPDATE projects.subcontractor_back_charges SET
                    title = COALESCE(:title, title),
                    reason_category = COALESCE(:reason_category, reason_category),
                    amount = COALESCE(:amount, amount),
                    evidence_reference = COALESCE(:evidence_reference, evidence_reference),
                    status = COALESCE(:status, status),
                    updated_at = NOW()
                WHERE id = CAST(:charge_id AS uuid)
                  AND project_id = CAST(:project_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
                RETURNING id
            """),
            {
                "charge_id": str(charge_id),
                "project_id": str(project_id),
                "org_id": str(user["org_id"]),
                "title": fields.get("title"),
                "reason_category": fields.get("reason_category"),
                "amount": fields.get("amount"),
                "evidence_reference": fields.get("evidence_reference"),
                "status": fields.get("status"),
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Back-charge not found.")
    await db.commit()
    return _result({"id": str(charge_id)}, "Back-charge updated.")


# ==============================================================================
# PROJECT PLANT & FLEET OPERATIONS (fleet.fleet_assignments & utilization_logs)
# ==============================================================================

class PlantShiftLogCreate(BaseModel):
    fleet_id: UUID
    occurred_on: Optional[date] = None
    operating_hours: float = Field(ge=0, le=24, default=0.0)
    idle_hours: float = Field(ge=0, le=24, default=0.0)
    breakdown_downtime_hours: float = Field(ge=0, le=24, default=0.0)
    weather_downtime_hours: float = Field(ge=0, le=24, default=0.0)
    output_quantity: Optional[float] = Field(ge=0, default=None)
    output_unit: Optional[str] = Field(max_length=30, default=None)
    fuel_litres: float = Field(ge=0, default=0.0)
    work_performed: Optional[str] = None


@router.get("/{project_id}/plant/analytics")
async def get_project_plant_operations_analytics(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """
    Returns unified project plant allocations, utilization rates,
    downtimes, fuel burn rates vs benchmark, and productivity metrics.
    """
    await _project_or_404(db, project_id, user["org_id"])
    analytics = await get_project_plant_analytics(db, project_id, user["org_id"])
    return _result(analytics, "Plant operations analytics retrieved.")


@router.post("/{project_id}/plant/quick-log")
async def create_project_plant_shift_log(
    project_id: UUID,
    payload: PlantShiftLogCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """
    Directly logs a daily plant shift hours, downtime, output, and fuel
    for plant assigned to this project.
    """
    await _project_or_404(db, project_id, user["org_id"])
    result = await record_project_plant_shift_log(
        db=db,
        project_id=project_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "Plant shift log recorded successfully.")


# ==============================================================================
# CONTRACTUAL DELAY EVENTS & EXTENSION OF TIME CLAIMS (FIDIC / NEC / JBCC)
# ==============================================================================

class ContractualDelayCreate(BaseModel):
    event_number: str = Field(min_length=2, max_length=60)
    title: str = Field(min_length=2, max_length=255)
    cause_category: str = Field(min_length=2, max_length=60)
    contract_clause_reference: Optional[str] = Field(max_length=120, default=None)
    event_occurred_date: date
    event_ended_date: Optional[date] = None
    notice_required_days: int = Field(ge=1, default=28)
    notice_served_date: Optional[date] = None
    notice_status: Optional[str] = Field(default="draft")
    estimated_days_impact: int = Field(ge=0, default=0)
    mitigation_actions: Optional[str] = None
    description: Optional[str] = None


class ExtensionOfTimeClaimCreate(BaseModel):
    claim_reference: str = Field(min_length=2, max_length=80)
    title: str = Field(min_length=2, max_length=255)
    delay_event_id: Optional[UUID] = None
    days_requested: int = Field(gt=0)
    impacted_milestone_id: Optional[UUID] = None
    is_critical_path_impact: bool = True
    prolongation_cost_claimed: Decimal = Field(ge=0, default=Decimal("0"))
    submission_date: date = Field(default_factory=date.today)


class ExtensionOfTimeDeterminationCreate(BaseModel):
    days_granted: int = Field(ge=0, default=0)
    prolongation_cost_approved: Decimal = Field(ge=0, default=Decimal("0"))
    determination_date: Optional[date] = None
    determination_notes: Optional[str] = None
    engineer_representative_name: Optional[str] = Field(max_length=160, default=None)
    revised_contractual_completion_date: Optional[date] = None
    status: Optional[str] = Field(default="determined")


@router.get("/{project_id}/delays")
async def get_project_contractual_delays(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """Returns all contractual delay events with notice time-bar tracking."""
    await _project_or_404(db, project_id, user["org_id"])
    delays = await list_project_delays(db, project_id, user["org_id"])
    return _result(delays, "Contractual delay events retrieved.")


@router.post("/{project_id}/delays")
async def create_project_contractual_delay(
    project_id: UUID,
    payload: ContractualDelayCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Records a new contractual delay event with statutory notice countdown."""
    await _project_or_404(db, project_id, user["org_id"])
    result = await create_project_delay(
        db=db,
        project_id=project_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "Contractual delay event recorded.")


@router.get("/{project_id}/eot-claims")
async def get_project_eot_claims(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """Returns all EOT claims, prolongation requests, and determinations."""
    await _project_or_404(db, project_id, user["org_id"])
    claims = await list_project_eot_claims(db, project_id, user["org_id"])
    return _result(claims, "Extension of Time claims retrieved.")


@router.post("/{project_id}/eot-claims")
async def create_project_extension_of_time_claim(
    project_id: UUID,
    payload: ExtensionOfTimeClaimCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Submits an Extension of Time (EOT) claim linked to delay event and CPM milestone."""
    await _project_or_404(db, project_id, user["org_id"])
    result = await create_project_eot_claim(
        db=db,
        project_id=project_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "Extension of Time claim submitted successfully.")


@router.post("/{project_id}/eot-claims/{claim_id}/determine")
async def determine_project_extension_of_time(
    project_id: UUID,
    claim_id: UUID,
    payload: ExtensionOfTimeDeterminationCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Records the Engineer / Client determination on an EOT claim."""
    await _project_or_404(db, project_id, user["org_id"])
    result = await determine_project_eot_claim(
        db=db,
        project_id=project_id,
        claim_id=claim_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "EOT claim determination registered.")


# ==============================================================================
# CONTROLLED DRAWING REGISTER, PHOTO DIARY & MONTH-END PROGRESS PACK
# ==============================================================================

class ControlledDrawingCreate(BaseModel):
    drawing_number: str = Field(min_length=2, max_length=100)
    title: str = Field(min_length=2, max_length=255)
    discipline: str = Field(min_length=2, max_length=60)
    current_revision: str = Field(default="Rev A")
    ifc_status: str = Field(default="issued_for_construction")
    date_received: date = Field(default_factory=date.today)
    file_url: Optional[str] = None


class ProgressPhotoCreate(BaseModel):
    photo_url: str = Field(min_length=5)
    caption: str = Field(min_length=2, max_length=255)
    element_tag: str = Field(min_length=2, max_length=100)
    captured_date: date = Field(default_factory=date.today)
    weather_condition: Optional[str] = Field(default="clear_sunny")
    gps_lat: Optional[float] = None
    gps_lng: Optional[float] = None


@router.get("/{project_id}/drawings")
async def get_project_controlled_drawings(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """Returns the controlled drawing revision register for a project."""
    await _project_or_404(db, project_id, user["org_id"])
    drawings = await list_project_drawings(db, project_id, user["org_id"])
    return _result(drawings, "Controlled drawings retrieved.")


@router.post("/{project_id}/drawings")
async def create_or_revise_project_drawing(
    project_id: UUID,
    payload: ControlledDrawingCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Registers a new drawing or uploads a new revision, superseding the previous version."""
    await _project_or_404(db, project_id, user["org_id"])
    result = await record_controlled_drawing(
        db=db,
        project_id=project_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "Controlled drawing registered successfully.")


@router.get("/{project_id}/photos")
async def get_project_progress_photos(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """Returns site progress photo diary entries."""
    await _project_or_404(db, project_id, user["org_id"])
    photos = await list_project_photos(db, project_id, user["org_id"])
    return _result(photos, "Progress photos retrieved.")


@router.post("/{project_id}/photos")
async def add_project_progress_photo(
    project_id: UUID,
    payload: ProgressPhotoCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.update", "site_operations.report.submit")),
):
    """Records a progress photo entry with element tag, capture date, and weather."""
    await _project_or_404(db, project_id, user["org_id"])
    result = await record_progress_photo(
        db=db,
        project_id=project_id,
        org_id=user["org_id"],
        user_id=user.get("user_id") or user.get("id"),
        payload=payload.model_dump(),
    )
    return _result(result, "Progress photo diary entry recorded.")


@router.get("/{project_id}/progress-pack")
async def get_project_consolidated_progress_pack(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "site_operations.report.view")),
):
    """
    Generates a consolidated client and month-end progress pack compiling
    schedule CPM, quality, plant, subcontractor commercials, contractual delays,
    drawings, and progress photos.
    """
    await _project_or_404(db, project_id, user["org_id"])
    pack = await generate_project_progress_pack(db, project_id, user["org_id"])
    return _result(pack, "Consolidated progress pack retrieved.")


@router.get("/{project_id}/evm-analytics")
async def get_project_evm_analytics(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_any_permission("projects.read", "finance.report.view")),
):
    """
    Returns Earned Value Management (EVM) commercial indices:
    BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, VAC, TCPI, and S-Curve trajectory points.
    """
    await _project_or_404(db, project_id, user["org_id"])
    evm_data = await calculate_project_evm(db, project_id, user["org_id"])
    return _result(evm_data, "Project EVM analytics retrieved successfully.")





