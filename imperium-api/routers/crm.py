import json
from datetime import date
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError

from core.database import get_db
from core.security import require_permission, user_has_permission, is_self_certification, SUPERADMIN_ROLE
from app.services.tender_scraper import collect_tender_signals, configured_tender_sources
from app.services.crm.automation_engine import fire_trigger
from app.services.finance.department_transfers import post_department_transfer
from app.services.quotations.calculator import QuotationCalculator, build_calc_input_from_metadata
from app.services.finance.project_forecast import (
    seed_project_budget_from_quotation,
    seed_boq_line_items_from_quotation,
    refresh_project_forecast,
    check_and_alert_margin_threat,
)
from app.shared.sql import update_tenant_row_sql
from app.shared.task_stacks import generate_task_stack
from pydantic import BaseModel, ConfigDict, Field, field_validator

router = APIRouter()


class OpportunityStage(str, Enum):
    INQUIRY = "Inquiry"
    QUALIFICATION = "Qualification"
    SITE_VISIT = "Site Visit"
    QUOTATION = "Quotation"
    NEGOTIATION = "Negotiation"
    CONTRACT = "Contract"
    LOST = "Lost"


class TenderStage(str, Enum):
    TENDER_IDENTIFIED = "Tender Identified"
    BID_PREP = "Bid Prep"
    SUBMITTED = "Submitted"
    ADJUDICATION = "Adjudication"
    AWARDED_LOST = "Awarded/Lost"


OPPORTUNITY_STAGE_ALIASES = {
    "inquiry": OpportunityStage.INQUIRY.value,
    "qualification": OpportunityStage.QUALIFICATION.value,
    "site visit": OpportunityStage.SITE_VISIT.value,
    "quotation": OpportunityStage.QUOTATION.value,
    "proposal": OpportunityStage.QUOTATION.value,
    "negotiation": OpportunityStage.NEGOTIATION.value,
    "contract": OpportunityStage.CONTRACT.value,
    "won": OpportunityStage.CONTRACT.value,
    "lost": OpportunityStage.LOST.value,
}

TENDER_STAGE_ALIASES = {
    "idd": TenderStage.TENDER_IDENTIFIED.value,
    "tender identified": TenderStage.TENDER_IDENTIFIED.value,
    "bid prep": TenderStage.BID_PREP.value,
    "submitted": TenderStage.SUBMITTED.value,
    "adjudication": TenderStage.ADJUDICATION.value,
    "awarded/lost": TenderStage.AWARDED_LOST.value,
    "awarded lost": TenderStage.AWARDED_LOST.value,
}


def _normalize_stage(value: Any, aliases: Dict[str, str]) -> Any:
    if not isinstance(value, str):
        return value

    key = " ".join(value.strip().replace("_", " ").split()).casefold()
    return aliases.get(key, value)


def _require_org_id(user: dict) -> Any:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CRM routes require an organization context.",
        )
    return org_id


def _require_user_id(user: dict) -> Any:
    user_id = user.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CRM routes require an authenticated user subject.",
        )
    return user_id


def _pagination_params(limit: Optional[int], offset: int) -> Dict[str, Optional[int]]:
    return {"limit": limit, "offset": offset}


async def _list_meta(
    db: AsyncSession,
    count_sql: str,
    org_id: Any,
    items: List[Dict[str, Any]],
    limit: Optional[int],
    offset: int,
) -> Dict[str, Any]:
    if limit is None and offset == 0:
        return {"total": len(items)}

    result = await db.execute(text(count_sql), {"org_id": org_id})
    return {"total": int(result.scalar() or 0), "limit": limit, "offset": offset}


class CrmPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OpportunityCreate(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    stage: OpportunityStage = Field(default=OpportunityStage.INQUIRY)
    client_id: Optional[UUID] = None
    client_org_id: Optional[UUID] = None
    sales_owner_id: Optional[UUID] = None
    expected_close_date: Optional[date] = None
    budget: Decimal = Field(
        default=Decimal("0"),
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    probability: int = Field(default=0, ge=0, le=100)
    deal_value: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    expected_margin: Optional[Decimal] = Field(
        default=None, ge=Decimal("0"), le=Decimal("100"), max_digits=5, decimal_places=2
    )
    risk_level: Optional[str] = Field(default=None, max_length=50)
    originating_department_id: Optional[UUID] = None
    region: Optional[str] = Field(default=None, max_length=120)

    @field_validator("stage", mode="before")
    @classmethod
    def normalize_stage(cls, value: Any) -> Any:
        return _normalize_stage(value, OPPORTUNITY_STAGE_ALIASES)


class OpportunityUpdate(CrmPayload):
    """Validated, tenant-safe fields that may be changed on an opportunity."""

    client_id: Optional[UUID] = None
    client_org_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    stage: Optional[OpportunityStage] = None
    budget: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    probability: Optional[int] = Field(default=None, ge=0, le=100)
    expected_margin: Optional[Decimal] = Field(
        default=None, ge=Decimal("0"), le=Decimal("100"), max_digits=5, decimal_places=2
    )
    risk_level: Optional[str] = Field(default=None, max_length=50)
    sales_owner_id: Optional[UUID] = None
    expected_close_date: Optional[date] = None
    deal_value: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    next_activity_due_at: Optional[str] = None
    competitor: Optional[str] = Field(default=None, max_length=255)
    originating_department_id: Optional[UUID] = None
    region: Optional[str] = Field(default=None, max_length=120)
    margin_approval_required: Optional[bool] = None
    risk_approval_required: Optional[bool] = None
    approval_status: Optional[str] = Field(default=None, max_length=40)

    @field_validator("stage", mode="before")
    @classmethod
    def normalize_stage(cls, value: Any) -> Any:
        return _normalize_stage(value, OPPORTUNITY_STAGE_ALIASES)


OPPORTUNITY_UPDATE_COLUMNS = (
    "client_id",
    "client_org_id",
    "contact_id",
    "name",
    "stage",
    "budget",
    "probability",
    "expected_margin",
    "risk_level",
    "sales_owner_id",
    "expected_close_date",
    "deal_value",
    "weighted_value",
    "next_activity_due_at",
    "competitor",
    "margin_approval_required",
    "risk_approval_required",
    "approval_status",
    "originating_department_id",
    "region",
)


class CampaignPayload(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    campaign_type: Optional[str] = Field(default=None, max_length=80)
    channel: Optional[str] = Field(default=None, max_length=80)
    source_channel: Optional[str] = Field(default=None, max_length=80)
    source: Optional[str] = Field(default=None, max_length=120)
    status: str = Field(default="draft", max_length=40)
    budget: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    starts_on: Optional[date] = None
    ends_on: Optional[date] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    goals: Dict[str, Any] = Field(default_factory=dict)
    target_segment_id: Optional[UUID] = None


class CampaignMemberPayload(CrmPayload):
    lead_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    member_status: str = Field(default="targeted", max_length=40)
    source: Optional[str] = Field(default=None, max_length=120)


class SegmentPayload(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    criteria: Dict[str, Any] = Field(default_factory=dict)


class MessageTemplatePayload(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    channel: str = Field(default="email", max_length=40)
    subject: Optional[str] = Field(default=None, max_length=255)
    body: str = Field(..., min_length=1)
    variables: List[str] = Field(default_factory=list)


class NurtureSequencePayload(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    campaign_id: Optional[UUID] = None
    segment_id: Optional[UUID] = None
    status: str = Field(default="draft", max_length=40)


class SequenceStepPayload(CrmPayload):
    step_order: int = Field(..., ge=1)
    delay_days: int = Field(default=0, ge=0)
    template_id: Optional[UUID] = None
    action_type: str = Field(default="log_message", max_length=80)
    action_config: Dict[str, Any] = Field(default_factory=dict)


class CreateQuotationPayload(CrmPayload):
    quote_amount: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    status: str = Field(default="draft", max_length=50)
    notes: Optional[str] = None


class MarkWonPayload(CrmPayload):
    win_loss_reason: Optional[str] = None
    win_loss_reason_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    create_project: bool = True
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    start_date: Optional[date] = None
    planned_completion_date: Optional[date] = None
    department_id: Optional[UUID] = None
    originating_department_id: Optional[UUID] = None


class MarkLostPayload(CrmPayload):
    win_loss_reason: str = Field(..., min_length=1)
    win_loss_reason_id: Optional[UUID] = None
    competitor: Optional[str] = Field(default=None, max_length=255)


class WinLossReasonPayload(CrmPayload):
    reason_type: str = Field(..., pattern="^(won|lost)$")
    label: str = Field(..., min_length=1, max_length=160)


class TenderCreate(CrmPayload):
    tender_name: str = Field(..., min_length=1, max_length=255)
    stage: TenderStage = Field(default=TenderStage.TENDER_IDENTIFIED)
    # Nullable: most tenders arrive without a budget - the real figure comes
    # from the BOQ once it's priced, and gets filled in via a later update.
    bid_amount: Optional[Decimal] = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    region: Optional[str] = Field(default=None, max_length=120)

    @field_validator("stage", mode="before")
    @classmethod
    def normalize_stage(cls, value: Any) -> Any:
        return _normalize_stage(value, TENDER_STAGE_ALIASES)


class SubcontractorCreate(CrmPayload):
    name: str = Field(..., min_length=1, max_length=255)
    capability_tags: Optional[List[str]] = None
    compliance_status: Optional[str] = Field(default=None, max_length=50)
    nssa_number: Optional[str] = Field(default=None, max_length=100)
    praz_number: Optional[str] = Field(default=None, max_length=100)
    reliability_score: int = Field(default=0, ge=0, le=100)
    authorization_tier: int = Field(default=1, ge=1, le=5)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    physical_address: Optional[str] = None
    capability_matrix: Optional[List[Dict[str, Any]]] = None


class SubcontractorUpdate(CrmPayload):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    capability_tags: Optional[List[str]] = None
    compliance_status: Optional[str] = Field(default=None, max_length=50)
    nssa_number: Optional[str] = Field(default=None, max_length=100)
    praz_number: Optional[str] = Field(default=None, max_length=100)
    reliability_score: Optional[int] = Field(default=None, ge=0, le=100)
    authorization_tier: Optional[int] = Field(default=None, ge=1, le=5)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    physical_address: Optional[str] = None
    capability_matrix: Optional[List[Dict[str, Any]]] = None


SUBCONTRACTOR_COLUMNS = (
    "name",
    "capability_tags",
    "compliance_status",
    "nssa_number",
    "praz_number",
    "reliability_score",
    "authorization_tier",
    "contact_name",
    "contact_email",
    "contact_phone",
    "address",
    "submission_data",
)


def _subcontractor_db_values(values: Dict[str, Any]) -> Dict[str, Any]:
    db_values = dict(values)
    if "physical_address" in db_values:
        db_values["address"] = db_values.pop("physical_address")
    if "capability_matrix" in db_values:
        capability_matrix = db_values.pop("capability_matrix")
        db_values["submission_data"] = json.dumps(
            {"capability_matrix": capability_matrix}
        )
    return db_values


async def _rows(db: AsyncSession, sql: str, params: Dict[str, Any]) -> List[Dict[str, Any]]:
    result = await db.execute(text(sql), params)
    return [dict(row._mapping) for row in result]


async def _single_row(
    db: AsyncSession, sql: str, params: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    row = (await db.execute(text(sql), params)).first()
    return dict(row._mapping) if row else None


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def _weighted_value(value: Optional[Decimal], probability: Optional[int]) -> Optional[Decimal]:
    if value is None:
        return None
    return value * Decimal(probability or 0) / Decimal(100)


# Once an opportunity has been won or lost it's a decided deal, not an open
# one - moving its stage again (reopening/re-staging) needs sign-off beyond
# ordinary pipeline hygiene, same rationale as the close_won/close split above.
LOCKED_OPPORTUNITY_STAGES = {OpportunityStage.CONTRACT.value, OpportunityStage.LOST.value}
OPPORTUNITY_STAGE_OVERRIDE_PERMISSION = "crm.opportunities.override_stage"


async def _ensure_opportunity_stage_unlocked(
    db: AsyncSession, user: dict, current_stage: Optional[str]
) -> None:
    if current_stage not in LOCKED_OPPORTUNITY_STAGES:
        return
    if await user_has_permission(db, user, OPPORTUNITY_STAGE_OVERRIDE_PERMISSION):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=(
            f"Opportunity is already {current_stage} - only Admin, Executive, "
            "or Managing Director can change its stage further."
        ),
    )


@router.get("/customer-360/{client_org_id}")
async def customer_360(
    client_org_id: UUID,
    user: dict = Depends(require_permission("crm.customer360.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    params = {"org_id": org_id, "client_org_id": client_org_id}
    organization = await _single_row(
        db,
        """
        SELECT *
        FROM crm.organizations
        WHERE id=:client_org_id AND organization_id=:org_id AND is_deleted=false
        """,
        params,
    )
    if not organization:
        raise HTTPException(status_code=404, detail="Customer organization not found.")

    contacts = await _rows(
        db,
        """
        SELECT *
        FROM crm.contacts
        WHERE client_org_id=:client_org_id AND organization_id=:org_id AND is_deleted=false
        ORDER BY created_at DESC
        """,
        params,
    )
    contact_ids = [row["id"] for row in contacts]

    leads = await _rows(
        db,
        """
        SELECT *
        FROM crm.leads
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND (
            client_org_id=:client_org_id
            OR lower(company_name)=lower((SELECT name FROM crm.organizations WHERE id=:client_org_id))
          )
          AND lower(status) NOT IN ('converted', 'disqualified')
        ORDER BY created_at DESC
        """,
        params,
    )
    opportunities = await _rows(
        db,
        """
        SELECT o.*,
               COALESCE(o.deal_value, o.budget) AS forecast_value,
               COALESCE(o.weighted_value, COALESCE(o.deal_value, o.budget) * COALESCE(o.probability, 0) / 100.0) AS forecast_weighted_value,
               q.status AS quote_status,
               p.name AS project_name
        FROM crm.opportunities o
        LEFT JOIN finance.quotations q ON q.id=o.quote_id AND q.organization_id=o.organization_id AND q.is_deleted=false
        LEFT JOIN projects.projects p ON p.id=o.project_id AND p.organization_id=o.organization_id AND p.is_deleted=false
        WHERE o.organization_id=:org_id
          AND o.is_deleted=false
          AND (
            o.client_org_id=:client_org_id
            OR o.client_id = ANY(:contact_ids)
          )
        ORDER BY o.updated_at DESC
        """,
        {**params, "contact_ids": contact_ids or [None]},
    )
    quotations = await _rows(
        db,
        """
        SELECT q.*
        FROM finance.quotations q
        LEFT JOIN crm.opportunities o ON o.id=q.opportunity_id AND o.organization_id=q.organization_id
        WHERE q.organization_id=:org_id
          AND q.is_deleted=false
          AND (
            q.client_org_id=:client_org_id
            OR o.client_org_id=:client_org_id
            OR q.contact_id = ANY(:contact_ids)
          )
        ORDER BY q.created_at DESC
        """,
        {**params, "contact_ids": contact_ids or [None]},
    )
    projects = await _rows(
        db,
        """
        SELECT *
        FROM projects.projects
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND (
            client_org_id=:client_org_id
            OR client_name=CAST((SELECT name FROM crm.organizations WHERE id=:client_org_id) AS varchar)
          )
        ORDER BY updated_at DESC
        """,
        params,
    )
    tickets = await _rows(
        db,
        """
        SELECT *
        FROM crm.support_tickets
        WHERE organization_id=:org_id
          AND client_org_id=:client_org_id
          AND is_deleted=false
          AND status NOT IN ('resolved', 'closed')
        ORDER BY updated_at DESC
        """,
        params,
    )
    communications = await _rows(
        db,
        """
        SELECT *
        FROM crm.communication_events
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND (
            client_org_id=:client_org_id
            OR contact_id = ANY(:contact_ids)
          )
        ORDER BY started_at DESC
        LIMIT 25
        """,
        {**params, "contact_ids": contact_ids or [None]},
    )
    activities = await _rows(
        db,
        """
        SELECT *
        FROM crm.activities
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND status IN ('Pending', 'planned', 'pending')
          AND (
            client_org_id=:client_org_id
            OR contact_id = ANY(:contact_ids)
          )
        ORDER BY activity_date ASC
        LIMIT 25
        """,
        {**params, "contact_ids": contact_ids or [None]},
    )
    documents = await _rows(
        db,
        """
        SELECT d.*
        FROM core.documents d
        LEFT JOIN crm.opportunities o ON o.id=d.opportunity_id AND o.organization_id=d.organization_id
        WHERE d.organization_id=:org_id
          AND d.is_deleted=false
          AND o.client_org_id=:client_org_id
        ORDER BY d.created_at DESC
        LIMIT 50
        """,
        params,
    )
    financial_summary = await _single_row(
        db,
        """
        SELECT
            COALESCE(SUM(q.quote_amount), 0) AS quoted_value,
            COALESCE(SUM(p.contract_value), 0) AS awarded_value,
            COUNT(DISTINCT q.id) AS quotation_count,
            COUNT(DISTINCT p.id) AS project_count
        FROM crm.organizations org
        LEFT JOIN finance.quotations q
            ON q.organization_id=org.organization_id
           AND q.client_org_id=org.id
           AND q.is_deleted=false
        LEFT JOIN projects.projects p
            ON p.organization_id=org.organization_id
           AND p.client_org_id=org.id
           AND p.is_deleted=false
        WHERE org.id=:client_org_id AND org.organization_id=:org_id
        """,
        params,
    )

    return {
        "success": True,
        "data": {
            "organization": organization,
            "primary_contacts": contacts,
            "open_leads": leads,
            "active_opportunities": opportunities,
            "quotation_history": quotations,
            "awarded_projects": projects,
            "open_support_tickets": tickets,
            "recent_communications": communications,
            "upcoming_activities": activities,
            "documents": documents,
            "financial_summary": financial_summary or {},
            "risk_compliance_flags": {
                "risk_rating": organization.get("risk_rating"),
                "open_ticket_count": len(tickets),
                "stale_opportunity_count": len(
                    [
                        row
                        for row in opportunities
                        if row.get("next_activity_due_at") is None
                        and row.get("win_loss_status") not in ("won", "lost")
                    ]
                ),
            },
        },
        "message": "Customer 360 retrieved.",
        "meta": {},
    }


@router.get("/campaigns")
async def list_campaigns(
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    campaigns = await _rows(
        db,
        """
        SELECT c.*,
               COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.lead_id IS NOT NULL) AS leads_created,
               COUNT(DISTINCT l.id) FILTER (WHERE lower(l.status)='qualified') AS leads_qualified,
               COUNT(DISTINCT cm.opportunity_id) FILTER (WHERE cm.opportunity_id IS NOT NULL) AS opportunities_created,
               COUNT(DISTINCT q.id) AS quotes_sent,
               COUNT(DISTINCT o.id) FILTER (WHERE o.win_loss_status='won') AS deals_won
        FROM crm.campaigns c
        LEFT JOIN crm.campaign_members cm ON cm.campaign_id=c.id AND cm.organization_id=c.organization_id AND cm.is_deleted=false
        LEFT JOIN crm.leads l ON l.id=cm.lead_id AND l.organization_id=c.organization_id AND l.is_deleted=false
        LEFT JOIN crm.opportunities o ON o.id=COALESCE(cm.opportunity_id, l.opportunity_id) AND o.organization_id=c.organization_id AND o.is_deleted=false
        LEFT JOIN finance.quotations q ON q.opportunity_id=o.id AND q.organization_id=c.organization_id AND q.is_deleted=false
        WHERE c.organization_id=:org_id AND c.is_deleted=false
        GROUP BY c.id
        ORDER BY c.updated_at DESC
        """,
        {"org_id": org_id},
    )
    return {"success": True, "data": campaigns, "message": "Campaigns fetched.", "meta": {"total": len(campaigns)}}


@router.post("/campaigns", status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignPayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    row = await db.execute(
        text("""
        INSERT INTO crm.campaigns (
            organization_id, created_by, owner_user_id, name, status, budget,
            target_segment_id, campaign_type, source_channel, start_date, end_date, goals
        )
        VALUES (
            :org_id, :user_id, :user_id, :name, :status, :budget,
            :target_segment_id, :campaign_type, :source_channel, :start_date, :end_date, CAST(:goals AS jsonb)
        )
        RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "name": payload.name,
            "status": payload.status,
            "budget": payload.budget,
            "target_segment_id": payload.target_segment_id,
            "campaign_type": payload.campaign_type or payload.channel,
            "source_channel": payload.source_channel or payload.source,
            "start_date": payload.start_date or payload.starts_on,
            "end_date": payload.end_date or payload.ends_on,
            "goals": _json(payload.goals),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Campaign created.", "meta": {}}


@router.post("/campaigns/{campaign_id}/members", status_code=status.HTTP_201_CREATED)
async def add_campaign_member(
    campaign_id: UUID,
    payload: CampaignMemberPayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    if not (payload.lead_id or payload.contact_id or payload.opportunity_id):
        raise HTTPException(status_code=422, detail="A campaign member must link a lead, contact, or opportunity.")
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    campaign = await _single_row(
        db,
        "SELECT id FROM crm.campaigns WHERE id=:campaign_id AND organization_id=:org_id AND is_deleted=false",
        {"campaign_id": campaign_id, "org_id": org_id},
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    row = await db.execute(
        text("""
        INSERT INTO crm.campaign_members (
            organization_id, campaign_id, lead_id, contact_id, opportunity_id,
            status, created_by
        )
        VALUES (
            :org_id, :campaign_id, :lead_id, :contact_id, :opportunity_id,
            :status, :user_id
        )
        RETURNING id
        """),
        {
            "org_id": org_id,
            "campaign_id": campaign_id,
            "user_id": user_id,
            "lead_id": payload.lead_id,
            "contact_id": payload.contact_id,
            "opportunity_id": payload.opportunity_id,
            "status": payload.member_status,
        },
    )
    if payload.lead_id:
        await db.execute(
            text("""
            UPDATE crm.leads
            SET campaign_id=:campaign_id, updated_at=NOW()
            WHERE id=:lead_id AND organization_id=:org_id AND is_deleted=false
            """),
            {"campaign_id": campaign_id, "lead_id": payload.lead_id, "org_id": org_id},
        )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Campaign member added.", "meta": {}}


class CampaignSendPayload(CrmPayload):
    template_id: UUID


@router.post("/campaigns/{campaign_id}/send")
async def send_campaign(
    campaign_id: UUID,
    payload: CampaignSendPayload,
    user: dict = Depends(require_permission("crm.campaigns.send")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    campaign = await _single_row(
        db,
        "SELECT id FROM crm.campaigns WHERE id=:campaign_id AND organization_id=:org_id AND is_deleted=false",
        {"campaign_id": campaign_id, "org_id": org_id},
    )
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found.")
    template = await _single_row(
        db,
        "SELECT * FROM crm.message_templates WHERE id=:template_id AND organization_id=:org_id AND is_deleted=false",
        {"template_id": payload.template_id, "org_id": org_id},
    )
    if not template:
        raise HTTPException(status_code=404, detail="Message template not found.")

    members = await _rows(
        db,
        """
        SELECT cm.id AS member_id, cm.lead_id, cm.contact_id, cm.opportunity_id,
               COALESCE(l.contact_name, c.contact_name) AS recipient_name,
               COALESCE(l.contact_email, c.email) AS recipient_email
        FROM crm.campaign_members cm
        LEFT JOIN crm.leads l ON l.id = cm.lead_id AND l.organization_id = cm.organization_id
        LEFT JOIN crm.contacts c ON c.id = cm.contact_id AND c.organization_id = cm.organization_id
        WHERE cm.campaign_id=:campaign_id AND cm.organization_id=:org_id AND cm.is_deleted=false
          AND cm.status NOT IN ('sent', 'unsubscribed')
        """,
        {"campaign_id": campaign_id, "org_id": org_id},
    )

    sent_count = 0
    for member in members:
        body = template["body"]
        substitutions = {
            "recipient_name": member.get("recipient_name") or "",
            "campaign_id": str(campaign_id),
        }
        for key, value in substitutions.items():
            body = body.replace(f"{{{{{key}}}}}", str(value))
        await db.execute(
            text("""
                INSERT INTO crm.communication_events (
                    organization_id, created_by, actor_user_id, contact_id, lead_id, opportunity_id,
                    channel, direction, subject, body, status, template_id, campaign_id
                )
                VALUES (
                    :org_id, :user_id, :user_id, :contact_id, :lead_id, :opportunity_id,
                    :channel, 'outbound', :subject, :body, 'pending', :template_id, :campaign_id
                )
            """),
            {
                "org_id": org_id,
                "user_id": user_id,
                "contact_id": member.get("contact_id"),
                "lead_id": member.get("lead_id"),
                "opportunity_id": member.get("opportunity_id"),
                "channel": template["channel"],
                "subject": template.get("subject"),
                "body": body,
                "template_id": payload.template_id,
                "campaign_id": campaign_id,
            },
        )
        await db.execute(
            text("UPDATE crm.campaign_members SET status='sent', updated_at=NOW() WHERE id=:member_id"),
            {"member_id": member["member_id"]},
        )
        sent_count += 1

    await db.commit()
    return {"success": True, "data": {"sent_count": sent_count}, "message": f"Campaign sent to {sent_count} member(s).", "meta": {}}


@router.get("/segments")
async def list_segments(
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    segments = await _rows(
        db,
        "SELECT * FROM crm.segments WHERE organization_id=:org_id AND is_deleted=false ORDER BY name ASC",
        {"org_id": org_id},
    )
    return {"success": True, "data": segments, "message": "Segments fetched.", "meta": {"total": len(segments)}}


@router.post("/segments", status_code=status.HTTP_201_CREATED)
async def create_segment(
    payload: SegmentPayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    row = await db.execute(
        text("""
        INSERT INTO crm.segments (organization_id, created_by, owner_user_id, name, description, criteria)
        VALUES (:org_id, :user_id, :user_id, :name, :description, CAST(:criteria AS jsonb))
        RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "name": payload.name,
            "description": payload.description,
            "criteria": _json(payload.criteria),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Segment created.", "meta": {}}


@router.get("/templates")
async def list_templates(
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    templates = await _rows(
        db,
        "SELECT * FROM crm.message_templates WHERE organization_id=:org_id AND is_deleted=false ORDER BY updated_at DESC",
        {"org_id": org_id},
    )
    return {"success": True, "data": templates, "message": "Message templates fetched.", "meta": {"total": len(templates)}}


@router.post("/templates", status_code=status.HTTP_201_CREATED)
async def create_template(
    payload: MessageTemplatePayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    row = await db.execute(
        text("""
        INSERT INTO crm.message_templates (
            organization_id, created_by, owner_user_id, name, channel, subject, body, variables
        )
        VALUES (
            :org_id, :user_id, :user_id, :name, :channel, :subject, :body, CAST(:variables AS jsonb)
        )
        RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "name": payload.name,
            "channel": payload.channel,
            "subject": payload.subject,
            "body": payload.body,
            "variables": _json(payload.variables),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Message template created.", "meta": {}}


@router.get("/nurture-sequences")
async def list_nurture_sequences(
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    sequences = await _rows(
        db,
        """
        SELECT s.*, COUNT(st.id) AS step_count
        FROM crm.nurture_sequences s
        LEFT JOIN crm.sequence_steps st ON st.sequence_id = s.id AND st.organization_id = s.organization_id AND st.is_deleted = false
        WHERE s.organization_id = :org_id AND s.is_deleted = false
        GROUP BY s.id
        ORDER BY s.updated_at DESC
        """,
        {"org_id": org_id},
    )
    return {"success": True, "data": sequences, "message": "Nurture sequences fetched.", "meta": {"total": len(sequences)}}


@router.post("/nurture-sequences", status_code=status.HTTP_201_CREATED)
async def create_nurture_sequence(
    payload: NurtureSequencePayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    row = await db.execute(
        text("""
        INSERT INTO crm.nurture_sequences (organization_id, created_by, owner_user_id, name, campaign_id, segment_id, status)
        VALUES (:org_id, :user_id, :user_id, :name, :campaign_id, :segment_id, :status)
        RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "name": payload.name,
            "campaign_id": payload.campaign_id,
            "segment_id": payload.segment_id,
            "status": payload.status,
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Nurture sequence created.", "meta": {}}


@router.patch("/nurture-sequences/{sequence_id}")
async def update_nurture_sequence_status(
    sequence_id: UUID,
    payload: NurtureSequencePayload,
    user: dict = Depends(require_permission("crm.marketing.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    result = await db.execute(
        text("""
        UPDATE crm.nurture_sequences
        SET status = :status, updated_at = NOW()
        WHERE id = :sequence_id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
        """),
        {"status": payload.status, "sequence_id": sequence_id, "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Nurture sequence not found.")
    await db.commit()
    return {"success": True, "data": {"id": str(sequence_id)}, "message": "Nurture sequence updated.", "meta": {}}


@router.get("/nurture-sequences/{sequence_id}/steps")
async def list_sequence_steps(
    sequence_id: UUID,
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    steps = await _rows(
        db,
        """
        SELECT * FROM crm.sequence_steps
        WHERE sequence_id = :sequence_id AND organization_id = :org_id AND is_deleted = false
        ORDER BY step_order ASC
        """,
        {"sequence_id": sequence_id, "org_id": org_id},
    )
    return {"success": True, "data": steps, "message": "Sequence steps fetched.", "meta": {"total": len(steps)}}


@router.post("/nurture-sequences/{sequence_id}/steps", status_code=status.HTTP_201_CREATED)
async def create_sequence_step(
    sequence_id: UUID,
    payload: SequenceStepPayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    sequence = await _single_row(
        db,
        "SELECT id FROM crm.nurture_sequences WHERE id=:sequence_id AND organization_id=:org_id AND is_deleted=false",
        {"sequence_id": sequence_id, "org_id": org_id},
    )
    if not sequence:
        raise HTTPException(status_code=404, detail="Nurture sequence not found.")
    row = await db.execute(
        text("""
        INSERT INTO crm.sequence_steps (organization_id, created_by, sequence_id, step_order, delay_days, template_id, action_type, action_config)
        VALUES (:org_id, :user_id, :sequence_id, :step_order, :delay_days, :template_id, :action_type, CAST(:action_config AS jsonb))
        RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "sequence_id": sequence_id,
            "step_order": payload.step_order,
            "delay_days": payload.delay_days,
            "template_id": payload.template_id,
            "action_type": payload.action_type,
            "action_config": _json(payload.action_config),
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Sequence step created.", "meta": {}}


@router.get("/reports/lifecycle")
async def lifecycle_report(
    user: dict = Depends(require_permission("crm.reports.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    summary = await _single_row(
        db,
        """
        SELECT
            (SELECT COUNT(*) FROM crm.campaigns WHERE organization_id=:org_id AND is_deleted=false) AS campaigns,
            (SELECT COUNT(*) FROM crm.leads WHERE organization_id=:org_id AND is_deleted=false) AS leads,
            (SELECT COUNT(*) FROM crm.leads WHERE organization_id=:org_id AND is_deleted=false AND lower(status) IN ('qualified', 'converted')) AS qualified_leads,
            (SELECT COUNT(*) FROM crm.opportunities WHERE organization_id=:org_id AND is_deleted=false) AS opportunities,
            (SELECT COUNT(*) FROM finance.quotations WHERE organization_id=:org_id AND is_deleted=false) AS quotations,
            (SELECT COUNT(*) FROM projects.projects WHERE organization_id=:org_id AND is_deleted=false AND opportunity_id IS NOT NULL) AS handed_off_projects,
            (SELECT COALESCE(SUM(COALESCE(weighted_value, COALESCE(deal_value, budget) * COALESCE(probability, 0) / 100.0)), 0) FROM crm.opportunities WHERE organization_id=:org_id AND is_deleted=false AND COALESCE(win_loss_status, '') <> 'lost') AS weighted_forecast,
            (SELECT COUNT(*) FROM crm.opportunities WHERE organization_id=:org_id AND is_deleted=false AND win_loss_status='won') AS won_opportunities,
            (SELECT COUNT(*) FROM crm.opportunities WHERE organization_id=:org_id AND is_deleted=false AND win_loss_status='lost') AS lost_opportunities,
            (SELECT COUNT(*) FROM crm.support_tickets WHERE organization_id=:org_id AND is_deleted=false AND COALESCE(status,'new') NOT IN ('closed','resolved')) AS open_tickets,
            (SELECT COUNT(*) FROM crm.support_tickets WHERE organization_id=:org_id AND is_deleted=false AND resolution_due_at IS NOT NULL AND resolution_due_at < NOW() AND COALESCE(status,'new') NOT IN ('closed','resolved')) AS overdue_tickets,
            (SELECT COALESCE(AVG(satisfaction_score), 0) FROM crm.support_tickets WHERE organization_id=:org_id AND is_deleted=false AND satisfaction_score IS NOT NULL) AS avg_satisfaction
        """,
        {"org_id": org_id},
    )
    by_source = await _rows(
        db,
        """
        SELECT COALESCE(lead_source, source_channel, 'unknown') AS source, COUNT(*) AS lead_count,
          COUNT(*) FILTER (WHERE lower(status) IN ('qualified', 'converted')) AS qualified_count
        FROM crm.leads
        WHERE organization_id = :org_id AND is_deleted = false
        GROUP BY COALESCE(lead_source, source_channel, 'unknown')
        ORDER BY lead_count DESC
        """,
        {"org_id": org_id},
    )
    support_by_category = await _rows(
        db,
        """
        SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*) AS ticket_count
        FROM crm.support_tickets
        WHERE organization_id = :org_id AND is_deleted = false
        GROUP BY COALESCE(category, 'uncategorized')
        ORDER BY ticket_count DESC
        """,
        {"org_id": org_id},
    )
    return {
        "success": True,
        "data": {
            "summary": summary or {},
            "leads_by_source": by_source,
            "support_by_category": support_by_category,
        },
        "message": "CRM lifecycle report fetched.",
        "meta": {},
    }


@router.get("/reports/marketing")
async def marketing_report(
    user: dict = Depends(require_permission("crm.reports.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    by_source = await _rows(
        db,
        """
        SELECT
            COALESCE(l.lead_source, 'unknown') AS source,
            COUNT(DISTINCT l.id) AS leads_created,
            COUNT(DISTINCT l.id) FILTER (WHERE lower(l.status) IN ('qualified', 'converted')) AS leads_qualified,
            COUNT(DISTINCT o.id) FILTER (WHERE o.quote_id IS NOT NULL) AS opportunities_quoted,
            COUNT(DISTINCT o.id) FILTER (WHERE o.win_loss_status = 'won') AS opportunities_won
        FROM crm.leads l
        LEFT JOIN crm.opportunities o ON o.id = l.opportunity_id AND o.organization_id = l.organization_id
        WHERE l.organization_id = :org_id AND l.is_deleted = false
        GROUP BY COALESCE(l.lead_source, 'unknown')
        ORDER BY leads_created DESC
        """,
        {"org_id": org_id},
    )
    campaigns = await _rows(
        db,
        """
        SELECT c.id, c.name, c.status,
               COUNT(DISTINCT cm.lead_id) FILTER (WHERE cm.lead_id IS NOT NULL) AS leads_created,
               COUNT(DISTINCT l.id) FILTER (WHERE lower(l.status)='qualified') AS leads_qualified,
               COUNT(DISTINCT cm.opportunity_id) FILTER (WHERE cm.opportunity_id IS NOT NULL) AS opportunities_created,
               COUNT(DISTINCT q.id) AS quotes_sent,
               COUNT(DISTINCT o.id) FILTER (WHERE o.win_loss_status='won') AS deals_won
        FROM crm.campaigns c
        LEFT JOIN crm.campaign_members cm ON cm.campaign_id=c.id AND cm.organization_id=c.organization_id AND cm.is_deleted=false
        LEFT JOIN crm.leads l ON l.id=cm.lead_id AND l.organization_id=c.organization_id AND l.is_deleted=false
        LEFT JOIN crm.opportunities o ON o.id=COALESCE(cm.opportunity_id, l.opportunity_id) AND o.organization_id=c.organization_id AND o.is_deleted=false
        LEFT JOIN finance.quotations q ON q.opportunity_id=o.id AND q.organization_id=c.organization_id AND q.is_deleted=false
        WHERE c.organization_id=:org_id AND c.is_deleted=false
        GROUP BY c.id, c.name, c.status
        ORDER BY c.updated_at DESC
        LIMIT 50
        """,
        {"org_id": org_id},
    )
    return {
        "success": True,
        "data": {"leads_by_source": by_source, "campaigns": campaigns},
        "message": "CRM marketing report fetched.",
        "meta": {},
    }


@router.get("/reports/sales")
async def sales_report(
    user: dict = Depends(require_permission("crm.reports.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    summary = await _single_row(
        db,
        """
        SELECT
            COALESCE(SUM(COALESCE(deal_value, budget)) FILTER (WHERE win_loss_status IS NULL), 0) AS pipeline_value,
            COALESCE(SUM(weighted_value) FILTER (WHERE win_loss_status IS NULL), 0) AS weighted_forecast,
            COUNT(*) FILTER (WHERE win_loss_status = 'won') AS won_count,
            COUNT(*) FILTER (WHERE win_loss_status = 'lost') AS lost_count,
            COUNT(*) FILTER (WHERE win_loss_status IS NULL AND (next_activity_due_at IS NULL OR next_activity_due_at < NOW())) AS stale_opportunities,
            COUNT(*) FILTER (WHERE quote_id IS NOT NULL) AS quoted_count,
            COUNT(*) AS total_count
        FROM crm.opportunities
        WHERE organization_id = :org_id AND is_deleted = false
        """,
        {"org_id": org_id},
    )
    summary = dict(summary or {})
    won = summary.get("won_count") or 0
    lost = summary.get("lost_count") or 0
    total = summary.get("total_count") or 0
    summary["win_rate_pct"] = round(100.0 * won / (won + lost), 1) if (won + lost) else None
    summary["quote_conversion_pct"] = round(100.0 * (summary.get("quoted_count") or 0) / total, 1) if total else None

    stage_ageing = await _rows(
        db,
        """
        SELECT stage, COUNT(*) AS count,
               COALESCE(AVG(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400.0), 0) AS avg_age_days
        FROM crm.opportunities
        WHERE organization_id = :org_id AND is_deleted = false AND win_loss_status IS NULL
        GROUP BY stage
        ORDER BY avg_age_days DESC
        """,
        {"org_id": org_id},
    )
    loss_reasons = await _rows(
        db,
        """
        SELECT COALESCE(wlr.label, o.win_loss_reason, 'unspecified') AS reason, COUNT(*) AS count
        FROM crm.opportunities o
        LEFT JOIN crm.win_loss_reasons wlr ON wlr.id = o.win_loss_reason_id AND wlr.organization_id = o.organization_id
        WHERE o.organization_id = :org_id AND o.is_deleted = false AND o.win_loss_status = 'lost'
        GROUP BY COALESCE(wlr.label, o.win_loss_reason, 'unspecified')
        ORDER BY count DESC
        """,
        {"org_id": org_id},
    )
    activity_completion = await _single_row(
        db,
        """
        SELECT
            COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
            COUNT(*) FILTER (WHERE status IN ('Pending', 'planned', 'pending')) AS pending,
            COUNT(*) AS total
        FROM crm.activities
        WHERE organization_id = :org_id AND is_deleted = false
        """,
        {"org_id": org_id},
    )
    return {
        "success": True,
        "data": {
            "summary": summary,
            "stage_ageing": stage_ageing,
            "loss_reasons": loss_reasons,
            "activity_completion": activity_completion or {},
        },
        "message": "CRM sales report fetched.",
        "meta": {},
    }


@router.get("/reports/executive")
async def executive_crm_report(
    user: dict = Depends(require_permission("crm.reports.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    summary = await _single_row(
        db,
        """
        SELECT
            (SELECT COALESCE(SUM(COALESCE(deal_value, budget)), 0) FROM crm.opportunities WHERE organization_id=:org_id AND is_deleted=false AND win_loss_status IS NULL) AS revenue_pipeline,
            (SELECT COALESCE(SUM(bid_amount), 0) FROM crm.tenders WHERE organization_id=:org_id AND is_deleted=false AND COALESCE(stage,'') NOT IN ('lost','withdrawn')) AS tender_pipeline,
            (SELECT COUNT(*) FROM crm.leads WHERE organization_id=:org_id AND is_deleted=false) AS total_leads,
            (SELECT COUNT(*) FROM finance.quotations WHERE organization_id=:org_id AND is_deleted=false) AS total_quotes,
            (SELECT COUNT(*) FROM projects.projects WHERE organization_id=:org_id AND is_deleted=false AND opportunity_id IS NOT NULL) AS total_projects_from_pipeline
        """,
        {"org_id": org_id},
    )
    top_clients = await _rows(
        db,
        """
        SELECT co.id, co.name, co.risk_rating,
               COALESCE(SUM(p.contract_value), 0) AS revenue,
               COUNT(DISTINCT t.id) AS open_tickets
        FROM crm.organizations co
        LEFT JOIN projects.projects p ON p.client_org_id=co.id AND p.organization_id=co.organization_id AND p.is_deleted=false
        LEFT JOIN crm.support_tickets t ON t.organization_account_id=co.id AND t.organization_id=co.organization_id
            AND t.is_deleted=false AND t.status NOT IN ('resolved', 'closed')
        WHERE co.organization_id=:org_id AND co.is_deleted=false
        GROUP BY co.id, co.name, co.risk_rating
        ORDER BY revenue DESC
        LIMIT 20
        """,
        {"org_id": org_id},
    )
    risk_distribution = await _rows(
        db,
        """
        SELECT COALESCE(risk_rating, 'unrated') AS risk_rating, COUNT(*) AS count
        FROM crm.organizations
        WHERE organization_id = :org_id AND is_deleted = false
        GROUP BY COALESCE(risk_rating, 'unrated')
        """,
        {"org_id": org_id},
    )
    return {
        "success": True,
        "data": {
            "summary": summary or {},
            "top_clients": top_clients,
            "risk_distribution": risk_distribution,
        },
        "message": "CRM executive report fetched.",
        "meta": {},
    }


@router.get("/opportunities")
async def list_opportunities(
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(require_permission("crm.view_opportunities")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    pagination_params = _pagination_params(limit, offset)
    query = text("""
        SELECT
            o.id, o.name, o.stage, o.budget, o.probability, o.expected_margin, o.risk_level,
            o.client_org_id, o.client_id, o.contact_id, o.sales_owner_id, o.expected_close_date,
            o.deal_value, COALESCE(o.weighted_value, COALESCE(o.deal_value, o.budget) * COALESCE(o.probability, 0) / 100.0) AS weighted_value,
            o.next_activity_due_at, o.quote_id, o.project_id, o.win_loss_status, o.win_loss_reason,
            o.competitor, o.margin_approval_required, o.risk_approval_required, o.approval_status,
            c.contact_name as client_name,
            co.name as organization_name,
            q.status AS quote_status,
            p.name AS project_name,
            CASE
                WHEN o.win_loss_status IS NULL
                 AND o.next_activity_due_at IS NULL
                 AND o.updated_at < NOW() - INTERVAL '14 days'
                THEN true ELSE false
            END AS is_stale
        FROM crm.opportunities o
        LEFT JOIN crm.contacts c ON o.client_id = c.id
        LEFT JOIN crm.organizations co ON co.id = o.client_org_id AND co.organization_id = o.organization_id
        LEFT JOIN finance.quotations q ON q.id = o.quote_id AND q.organization_id = o.organization_id AND q.is_deleted = false
        LEFT JOIN projects.projects p ON p.id = o.project_id AND p.organization_id = o.organization_id AND p.is_deleted = false
        WHERE o.organization_id = :org_id AND o.is_deleted = false
        ORDER BY o.created_at DESC
        LIMIT :limit OFFSET :offset
    """)
    result = await db.execute(query, {"org_id": org_id, **pagination_params})
    opportunities = [dict(row._mapping) for row in result]
    meta = await _list_meta(
        db,
        """
        SELECT COUNT(*)
        FROM crm.opportunities o
        WHERE o.organization_id = :org_id AND o.is_deleted = false
        """,
        org_id,
        opportunities,
        limit,
        offset,
    )

    return {
        "success": True,
        "data": opportunities,
        "message": "Opportunities fetched.",
        "meta": meta,
    }


@router.get("/tenders")
async def list_tenders(
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(require_permission("crm.view_tenders")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    pagination_params = _pagination_params(limit, offset)
    query = text("""
        SELECT id, tender_name, bid_amount, stage, submission_deadline, bid_bond_secured
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """)
    result = await db.execute(query, {"org_id": org_id, **pagination_params})
    tenders = [dict(row._mapping) for row in result]
    meta = await _list_meta(
        db,
        """
        SELECT COUNT(*)
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
        """,
        org_id,
        tenders,
        limit,
        offset,
    )

    return {
        "success": True,
        "data": tenders,
        "message": "Tenders fetched.",
        "meta": meta,
    }


@router.get("/tender-signals")
async def list_tender_signals(
    limit: Optional[int] = Query(default=12, ge=1, le=50),
    sources: Optional[str] = Query(default=None),
    include_internal_public_feed: bool = Query(default=True),
    user: dict = Depends(require_permission("crm.view_tenders")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    if sources is None:
        source_urls = configured_tender_sources()
    else:
        source_urls = [part.strip() for part in sources.split(",") if part.strip()]

    signals = await collect_tender_signals(
        db,
        org_id,
        source_urls,
        include_internal_public_feed=include_internal_public_feed,
        limit=limit or 12,
    )
    return {
        "success": True,
        "data": [signal.model_dump(by_alias=True) for signal in signals],
        "message": "Tender signals fetched.",
        "meta": {
            "total": len(signals),
            "limit": limit or 12,
            "sources": source_urls,
            "include_internal_public_feed": include_internal_public_feed,
        },
    }


@router.post("/opportunities")
async def create_opportunity(
    payload: OpportunityCreate,
    user: dict = Depends(require_permission("crm.create_opportunities")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    weighted_value = _weighted_value(payload.deal_value or payload.budget, payload.probability)
    query = text("""
        INSERT INTO crm.opportunities (
            name, stage, budget, probability, client_id, contact_id, client_org_id,
            sales_owner_id, owner_user_id, expected_close_date, deal_value, weighted_value,
            expected_margin, risk_level, originating_department_id, region, organization_id, created_by
        )
        VALUES (
            :name, :stage, :budget, :probability, :client_id, :client_id, :client_org_id,
            :sales_owner_id, :sales_owner_id, :expected_close_date, :deal_value, :weighted_value,
            :expected_margin, :risk_level, :originating_department_id, :region, :org_id, :user_id
        )
        RETURNING id
    """)
    try:
        result = await db.execute(
            query,
            {
                "name": payload.name,
                "stage": payload.stage.value,
                "budget": payload.budget,
                "probability": payload.probability,
                "client_id": payload.client_id,
                "client_org_id": payload.client_org_id,
                "sales_owner_id": payload.sales_owner_id or user_id,
                "expected_close_date": payload.expected_close_date,
                "deal_value": payload.deal_value,
                "weighted_value": weighted_value,
                "expected_margin": payload.expected_margin,
                "risk_level": payload.risk_level,
                "originating_department_id": payload.originating_department_id,
                "region": payload.region,
                "org_id": org_id,
                "user_id": user_id,
            },
        )
        new_opportunity_id = result.scalar()
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Opportunity payload violates CRM database constraints.",
        ) from exc

    await generate_task_stack(
        db, org_id=org_id, entity_type="opportunity", entity_id=new_opportunity_id, created_by=user_id,
    )

    return {
        "success": True,
        "data": {"id": str(new_opportunity_id)},
        "message": "Opportunity created successfully.",
        "meta": {},
    }


@router.put("/opportunities/{opportunity_id}")
async def update_opportunity(
    opportunity_id: str,
    payload: OpportunityUpdate,
    user: dict = Depends(require_permission("crm.update_opportunities")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)

    values = payload.model_dump(exclude_unset=True, exclude_none=False)
    safe_keys = [column for column in OPPORTUNITY_UPDATE_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": opportunity_id},
            "message": "No fields to update.",
        }

    params = {k: values[k] for k in safe_keys}
    if "stage" in params and params["stage"] is not None:
        params["stage"] = params["stage"].value
        current_stage_row = await _single_row(
            db,
            """
            SELECT stage FROM crm.opportunities
            WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
            """,
            {"opportunity_id": opportunity_id, "org_id": org_id},
        )
        if not current_stage_row:
            raise HTTPException(status_code=404, detail="Opportunity not found")
        if params["stage"] != current_stage_row.get("stage"):
            await _ensure_opportunity_stage_unlocked(db, user, current_stage_row.get("stage"))
    if "deal_value" in params or "probability" in params:
        current = await _single_row(
            db,
            """
            SELECT deal_value, budget, probability
            FROM crm.opportunities
            WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
            """,
            {"opportunity_id": opportunity_id, "org_id": org_id},
        )
        if current:
            forecast_value = params.get("deal_value", current.get("deal_value") or current.get("budget"))
            probability = params.get("probability", current.get("probability"))
            params["weighted_value"] = _weighted_value(forecast_value, probability)
            if "weighted_value" not in safe_keys:
                safe_keys.append("weighted_value")
    params["opportunity_id"] = opportunity_id
    params["org_id"] = org_id

    query = update_tenant_row_sql(
        "crm.opportunities",
        safe_keys,
        OPPORTUNITY_UPDATE_COLUMNS,
        id_param="opportunity_id",
        returning_id=True,
    )

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Opportunity not found")
        await db.commit()
        if "stage" in safe_keys:
            await fire_trigger(db, org_id, user.get("sub"), "opportunity_stage_changed", {**params, "id": opportunity_id})
        return {
            "success": True,
            "data": {"id": opportunity_id},
            "message": "Opportunity updated successfully.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


class MergeOpportunityPayload(CrmPayload):
    source_opportunity_ids: list[str]


@router.get("/opportunities/duplicates")
async def find_duplicate_opportunities(
    name: Optional[str] = Query(default=None),
    client_org_id: Optional[str] = Query(default=None),
    client_id: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission("crm.view_opportunities")),
    db: AsyncSession = Depends(get_db),
):
    if not (name or client_org_id or client_id):
        raise HTTPException(status_code=422, detail="name, client_org_id, or client_id is required.")
    org_id = _require_org_id(user)
    items = await _rows(
        db,
        """
        SELECT id, name, stage, budget, deal_value, client_org_id, client_id, created_at
        FROM crm.opportunities
        WHERE organization_id=:org_id AND is_deleted=false AND (
            (CAST(:name AS text) IS NOT NULL AND lower(name)=lower(CAST(:name AS text)))
            OR (CAST(:client_org_id AS text) IS NOT NULL AND client_org_id::text=CAST(:client_org_id AS text))
            OR (CAST(:client_id AS text) IS NOT NULL AND client_id::text=CAST(:client_id AS text))
        )
        ORDER BY created_at DESC
        LIMIT 25
        """,
        {"org_id": org_id, "name": name, "client_org_id": client_org_id, "client_id": client_id},
    )
    return {"success": True, "data": items, "message": "Duplicate opportunity candidates fetched.", "meta": {"total": len(items)}}


@router.delete("/opportunities/{opportunity_id}")
async def delete_opportunity(
    opportunity_id: str,
    user: dict = Depends(require_permission("crm.opportunities.delete")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    result = await db.execute(
        text("""
        UPDATE crm.opportunities
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :opportunity_id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
        """),
        {"opportunity_id": opportunity_id, "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Opportunity not found")
    await db.commit()
    return {"success": True, "data": None, "message": "Opportunity deleted (soft delete).", "meta": {}}


@router.post("/opportunities/{opportunity_id}/merge")
async def merge_opportunities(
    opportunity_id: str,
    payload: MergeOpportunityPayload,
    user: dict = Depends(require_permission("crm.opportunities.delete")),
    db: AsyncSession = Depends(get_db),
):
    if not payload.source_opportunity_ids:
        raise HTTPException(status_code=422, detail="At least one source opportunity is required.")
    org_id = _require_org_id(user)
    result = await db.execute(
        text("""
        UPDATE crm.opportunities
        SET is_deleted=true, updated_at=NOW()
        WHERE id::text = ANY(:source_ids)
          AND id::text <> :opportunity_id
          AND organization_id=:org_id
          AND is_deleted=false
        RETURNING id
        """),
        {"opportunity_id": opportunity_id, "source_ids": payload.source_opportunity_ids, "org_id": org_id},
    )
    merged_ids = [str(row.id) for row in result]
    await db.commit()
    return {
        "success": True,
        "data": {"id": opportunity_id, "merged_ids": merged_ids},
        "message": "Duplicate opportunities merged.",
        "meta": {"merged": len(merged_ids)},
    }


@router.post("/opportunities/{opportunity_id}/create-quotation", status_code=status.HTTP_201_CREATED)
async def create_opportunity_quotation(
    opportunity_id: UUID,
    payload: CreateQuotationPayload,
    user: dict = Depends(require_permission("crm.opportunities.quote")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    opportunity = await _single_row(
        db,
        """
        SELECT o.*, c.contact_name, co.name AS organization_name
        FROM crm.opportunities o
        LEFT JOIN crm.contacts c ON c.id=o.client_id AND c.organization_id=o.organization_id
        LEFT JOIN crm.organizations co ON co.id=o.client_org_id AND co.organization_id=o.organization_id
        WHERE o.id=:opportunity_id AND o.organization_id=:org_id AND o.is_deleted=false
        """,
        {"opportunity_id": opportunity_id, "org_id": org_id},
    )
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found.")

    # Resume an existing quotation instead of creating a duplicate if this
    # opportunity already has one - this handoff previously overwrote
    # opportunities.quote_id on every call with no duplicate check.
    existing = await _single_row(
        db,
        """
        SELECT id FROM finance.quotations
        WHERE opportunity_id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
        LIMIT 1
        """,
        {"opportunity_id": opportunity_id, "org_id": org_id},
    )
    if existing:
        await db.execute(
            text("""
                UPDATE crm.opportunities
                SET quote_id=:quote_id, updated_at=NOW()
                WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
            """),
            {"quote_id": existing["id"], "opportunity_id": opportunity_id, "org_id": org_id},
        )
        await db.commit()
        return {
            "success": True,
            "data": {"id": str(existing["id"]), "opportunity_id": str(opportunity_id), "resumed": True},
            "message": "An estimate already exists for this opportunity - resuming it.",
            "meta": {},
        }

    quote_amount = payload.quote_amount
    if quote_amount is None:
        quote_amount = opportunity.get("deal_value") or opportunity.get("budget") or Decimal("0")
    client_name = (
        opportunity.get("organization_name")
        or opportunity.get("contact_name")
        or opportunity.get("name")
    )
    metadata = {
        "source": "crm_opportunity_handoff",
        "opportunity_id": str(opportunity_id),
        "approval": {
            "margin_required": bool(opportunity.get("margin_approval_required")),
            "risk_required": bool(opportunity.get("risk_approval_required")),
            "status": opportunity.get("approval_status"),
        },
        "notes": payload.notes,
    }
    try:
        row = await db.execute(
            text("""
                INSERT INTO finance.quotations (
                    organization_id, created_by, client_name, quote_amount, project_id,
                    metadata, status, opportunity_id, contact_id, client_org_id
                )
                VALUES (
                    :org_id, :user_id, :client_name, :quote_amount, :project_id,
                    CAST(:metadata AS jsonb), :status, :opportunity_id, :contact_id, :client_org_id
                )
                RETURNING id
            """),
            {
                "org_id": org_id,
                "user_id": user_id,
                "client_name": client_name,
                "quote_amount": quote_amount,
                "project_id": opportunity.get("project_id"),
                "metadata": _json(metadata),
                "status": payload.status,
                "opportunity_id": opportunity_id,
                "contact_id": opportunity.get("client_id"),
                "client_org_id": opportunity.get("client_org_id"),
            },
        )
        quote_id = row.scalar()
        await db.execute(
            text("""
                UPDATE crm.opportunities
                SET quote_id=:quote_id,
                    stage='Quotation',
                    weighted_value=COALESCE(deal_value, budget) * COALESCE(probability, 0) / 100.0,
                    updated_at=NOW()
                WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
            """),
            {"quote_id": quote_id, "opportunity_id": opportunity_id, "org_id": org_id},
        )
        await db.execute(
            text("""
                INSERT INTO crm.activities (
                    organization_id, created_by, client_org_id, contact_id, opportunity_id,
                    type, subject, description, status
                )
                VALUES (
                    :org_id, :user_id, :client_org_id, :contact_id, :opportunity_id,
                    'Quotation', 'Quotation created from opportunity', :description, 'Completed'
                )
            """),
            {
                "org_id": org_id,
                "user_id": user_id,
                "client_org_id": opportunity.get("client_org_id"),
                "contact_id": opportunity.get("client_id"),
                "opportunity_id": opportunity_id,
                "description": f"Quotation {quote_id} created for {opportunity.get('name')}.",
            },
        )
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Quotation handoff payload violates CRM constraints.") from exc

    await fire_trigger(db, org_id, user_id, "quote_sent", {"opportunity_id": str(opportunity_id), "id": str(quote_id), "quote_id": str(quote_id)})

    return {
        "success": True,
        "data": {"id": str(quote_id), "opportunity_id": str(opportunity_id)},
        "message": "Quotation created from opportunity.",
        "meta": {},
    }


@router.post("/opportunities/{opportunity_id}/mark-won")
async def mark_opportunity_won(
    opportunity_id: UUID,
    payload: MarkWonPayload,
    # Deliberately a stricter permission than mark-lost: this path can create
    # a real projects.projects row with a real contract_value, so it needs
    # sign-off beyond ordinary pipeline hygiene - see crm.opportunities.close
    # on mark-lost below, which has no such side effect.
    user: dict = Depends(require_permission("crm.opportunities.close_won")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    opportunity = await _single_row(
        db,
        """
        SELECT o.*, q.id AS latest_quote_id, q.quote_amount, q.metadata AS latest_quote_metadata,
               q.created_by AS latest_quote_created_by, co.name AS organization_name, c.contact_name
        FROM crm.opportunities o
        LEFT JOIN LATERAL (
            SELECT id, quote_amount, metadata, created_by
            FROM finance.quotations
            WHERE organization_id=o.organization_id AND opportunity_id=o.id AND is_deleted=false
            ORDER BY created_at DESC
            LIMIT 1
        ) q ON true
        LEFT JOIN crm.organizations co ON co.id=o.client_org_id AND co.organization_id=o.organization_id
        LEFT JOIN crm.contacts c ON c.id=o.client_id AND c.organization_id=o.organization_id
        WHERE o.id=:opportunity_id AND o.organization_id=:org_id AND o.is_deleted=false
        """,
        {"opportunity_id": opportunity_id, "org_id": org_id},
    )
    if not opportunity:
        raise HTTPException(status_code=404, detail="Opportunity not found.")
    await _ensure_opportunity_stage_unlocked(db, user, opportunity.get("stage"))

    project_id = payload.project_id or opportunity.get("project_id")
    budget_id = None
    forecast_metrics = None
    margin_alert_raised = False
    budget_pending_reason = None
    try:
        if not project_id and payload.create_project:
            project_row = await db.execute(
                text("""
                    INSERT INTO projects.projects (
                        organization_id, created_by, name, status, project_code, project_type,
                        client_name, contract_value, start_date, planned_completion_date,
                        client_org_id, opportunity_id, quotation_id, department_id, originating_department_id
                    )
                    VALUES (
                        :org_id, :user_id, :name, 'planning', :project_code, :project_type,
                        :client_name, :contract_value, :start_date, :planned_completion_date,
                        :client_org_id, :opportunity_id, :quotation_id, :department_id, :originating_department_id
                    )
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "user_id": user_id,
                    "name": opportunity.get("name"),
                    "project_code": payload.project_code,
                    "project_type": payload.project_type,
                    "client_name": opportunity.get("organization_name") or opportunity.get("contact_name"),
                    "contract_value": opportunity.get("quote_amount") or opportunity.get("deal_value") or opportunity.get("budget"),
                    "start_date": payload.start_date,
                    "planned_completion_date": payload.planned_completion_date,
                    "client_org_id": opportunity.get("client_org_id"),
                    "opportunity_id": opportunity_id,
                    "quotation_id": opportunity.get("latest_quote_id") or opportunity.get("quote_id"),
                    "department_id": payload.department_id,
                    "originating_department_id": payload.originating_department_id or opportunity.get("originating_department_id"),
                },
            )
            project_id = project_row.scalar()
        await db.execute(
            text("""
                UPDATE crm.opportunities
                SET stage='Contract',
                    win_loss_status='won',
                    win_loss_reason=:win_loss_reason,
                    win_loss_reason_id=:win_loss_reason_id,
                    project_id=:project_id,
                    quote_id=COALESCE(quote_id, :quote_id),
                    probability=100,
                    weighted_value=COALESCE(deal_value, budget),
                    closed_at=NOW(),
                    updated_at=NOW()
                WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
            """),
            {
                "win_loss_reason": payload.win_loss_reason,
                "win_loss_reason_id": payload.win_loss_reason_id,
                "project_id": project_id,
                "quote_id": opportunity.get("latest_quote_id"),
                "opportunity_id": opportunity_id,
                "org_id": org_id,
            },
        )
        if opportunity.get("latest_quote_id"):
            await db.execute(
                text("""
                    UPDATE finance.quotations
                    SET status='accepted',
                        project_id=COALESCE(project_id, :project_id),
                        updated_at=NOW()
                    WHERE id=:quote_id AND organization_id=:org_id
                """),
                {"quote_id": opportunity.get("latest_quote_id"), "project_id": project_id, "org_id": org_id},
            )

            # Seed the project's execution budget from this quotation inline
            # - previously, marking Won only flipped the quotation's status,
            # leaving budget-seeding as an easy-to-miss separate manual step
            # (Quotations > Decision), so a project could exist with no
            # budget at all if nobody remembered that second step.
            #
            # Segregation of duties still applies here exactly as it does in
            # quotations.py's decide_quotation: whoever authored the
            # quotation cannot also be the one whose Won confirmation
            # commits its budget. That doesn't block the win itself - the
            # project/opportunity handoff above already happened - it just
            # means the budget-seed is skipped and left for a second person
            # to complete via the existing Quotations > Decision action.
            if project_id:
                if user.get("role") != SUPERADMIN_ROLE and is_self_certification(
                    user_id, opportunity.get("latest_quote_created_by")
                ):
                    budget_pending_reason = (
                        "You authored this quotation and cannot also be the one whose "
                        "Won confirmation commits its budget - get an independent "
                        "commercial sign-off via Quotations > Decision."
                    )
                else:
                    try:
                        async with db.begin_nested():
                            metadata = opportunity.get("latest_quote_metadata") or {}
                            if isinstance(metadata, str):
                                metadata = json.loads(metadata)
                            calc_input = build_calc_input_from_metadata(
                                str(opportunity.get("latest_quote_id")), metadata
                            )
                            calculation = QuotationCalculator.calculate(calc_input)
                            direct_costs_total = sum(
                                float(v or 0)
                                for v in (calculation.breakdown_log.get("direct_costs_breakdown") or {}).values()
                            )
                            execution_total = (
                                direct_costs_total
                                + float(calculation.preliminaries or 0)
                                + float(calculation.overhead_amount or 0)
                                + float(calculation.contingency_amount or 0)
                            )
                            if not metadata.get("items") or execution_total <= 0:
                                # Never silently seed an approved $0 budget -
                                # e.g. a quotation still holding unpriced
                                # rate=0 lines straight from a Drawing
                                # Takeoff import that was never priced.
                                budget_pending_reason = (
                                    "Quotation has no priced line items - price the BOQ, "
                                    "then confirm via Quotations > Decision."
                                )
                            else:
                                budget_id = await seed_project_budget_from_quotation(
                                    db, org_id, str(project_id), str(opportunity.get("latest_quote_id")),
                                    calculation, created_by=user_id,
                                )
                                await seed_boq_line_items_from_quotation(
                                    db, org_id, str(project_id), str(opportunity.get("latest_quote_id")),
                                    metadata, created_by=user_id,
                                )
                                forecast_metrics = await refresh_project_forecast(
                                    db, org_id, str(project_id), computed_by=user_id,
                                )
                                if forecast_metrics:
                                    margin_alert_raised = await check_and_alert_margin_threat(
                                        db, org_id, str(project_id), forecast_metrics,
                                    )
                    except Exception:
                        budget_id = None
                        forecast_metrics = None
                        budget_pending_reason = (
                            "Budget could not be seeded automatically - confirm via "
                            "Quotations > Decision instead."
                        )

        # Commercial-sourced referral credit: fires only if a matching
        # finance.department_transfer_rules row is configured - no rule
        # means no-op, so this ships with zero behaviour change to the
        # won-flow until the user configures one via the finance transfer
        # rules UI. Wrapped in a SAVEPOINT so a misconfigured rule (or any
        # unexpected error computing it) can never fail the actual won
        # handoff, which is the part that matters.
        originating_department_id = payload.originating_department_id or opportunity.get("originating_department_id")
        if project_id and originating_department_id:
            try:
                async with db.begin_nested():
                    delivering_row = await db.execute(
                        text("SELECT department_id FROM projects.projects WHERE id = :id AND organization_id = :org_id"),
                        {"id": project_id, "org_id": org_id},
                    )
                    delivering_row = delivering_row.first()
                    delivering_department_id = delivering_row.department_id if delivering_row else None

                    if delivering_department_id and delivering_department_id != originating_department_id:
                        rule_row = await db.execute(
                            text("""
                                SELECT * FROM finance.department_transfer_rules
                                WHERE organization_id = :org_id AND transfer_type = 'internal_referral'
                                  AND trigger_event = 'opportunity_won' AND is_active = true AND is_deleted = false
                                  AND (from_department_id = :delivering OR from_department_id IS NULL)
                                  AND (to_department_id = :originating OR to_department_id IS NULL)
                                  AND effective_from <= CURRENT_DATE
                                  AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
                                ORDER BY (from_department_id IS NOT NULL) DESC, (to_department_id IS NOT NULL) DESC
                                LIMIT 1
                            """),
                            {"org_id": org_id, "delivering": delivering_department_id, "originating": originating_department_id},
                        )
                        rule = rule_row.mappings().first()
                        if rule:
                            contract_value = Decimal(str(
                                opportunity.get("quote_amount") or opportunity.get("deal_value") or opportunity.get("budget") or 0
                            ))
                            if rule["basis"] == "fixed_amount" and rule["fixed_amount"]:
                                referral_amount = Decimal(str(rule["fixed_amount"]))
                            elif rule["basis"] == "percent_of_contract_value" and rule["rate"]:
                                referral_amount = contract_value * Decimal(str(rule["rate"])) / Decimal("100")
                            else:
                                # percent_of_margin/manual need data this flow doesn't have (margin,
                                # or a human-entered amount) - not computed automatically here.
                                referral_amount = Decimal("0")
                            if referral_amount > 0:
                                await post_department_transfer(
                                    db,
                                    org_id=org_id,
                                    user_id=user_id,
                                    transfer_type="internal_referral",
                                    transfer_date=date.today(),
                                    from_department_id=delivering_department_id,
                                    to_department_id=originating_department_id,
                                    amount=referral_amount,
                                    description=f"Referral credit for opportunity: {opportunity.get('name')}",
                                    source_type="crm_opportunity",
                                    source_id=opportunity_id,
                                    project_id=project_id,
                                    cost_category="overhead",
                                    basis={
                                        "rule_code": rule["rule_code"],
                                        "basis": rule["basis"],
                                        "rate": str(rule["rate"]) if rule["rate"] else None,
                                        "contract_value": str(contract_value),
                                    },
                                )
            except Exception:
                pass

        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Won handoff payload violates CRM constraints.") from exc

    await fire_trigger(db, org_id, user_id, "quote_accepted", {"opportunity_id": str(opportunity_id), "id": str(opportunity_id)})

    return {
        "success": True,
        "data": {
            "id": str(opportunity_id),
            "project_id": str(project_id) if project_id else None,
            "budget_id": budget_id,
            "budget_seeded": budget_id is not None,
            "budget_pending_reason": budget_pending_reason,
            "forecast": forecast_metrics,
            "margin_alert_raised": margin_alert_raised,
        },
        "message": "Opportunity marked won and project handoff completed." + (
            " Project execution budget seeded from this quotation." if budget_id else ""
        ),
        "meta": {},
    }


@router.post("/opportunities/{opportunity_id}/mark-lost")
async def mark_opportunity_lost(
    opportunity_id: UUID,
    payload: MarkLostPayload,
    user: dict = Depends(require_permission("crm.opportunities.close")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    current_stage_row = await _single_row(
        db,
        """
        SELECT stage FROM crm.opportunities
        WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
        """,
        {"opportunity_id": opportunity_id, "org_id": org_id},
    )
    if not current_stage_row:
        raise HTTPException(status_code=404, detail="Opportunity not found.")
    await _ensure_opportunity_stage_unlocked(db, user, current_stage_row.get("stage"))

    result = await db.execute(
        text("""
        UPDATE crm.opportunities
        SET stage='Lost',
            win_loss_status='lost',
            win_loss_reason=:win_loss_reason,
            win_loss_reason_id=:win_loss_reason_id,
            competitor=:competitor,
            probability=0,
            weighted_value=0,
            closed_at=NOW(),
            updated_at=NOW()
        WHERE id=:opportunity_id AND organization_id=:org_id AND is_deleted=false
        RETURNING quote_id
        """),
        {
            "win_loss_reason_id": payload.win_loss_reason_id,
            "opportunity_id": opportunity_id,
            "org_id": org_id,
            "win_loss_reason": payload.win_loss_reason,
            "competitor": payload.competitor,
        },
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Opportunity not found.")
    if row.quote_id:
        await db.execute(
            text("""
            UPDATE finance.quotations
            SET status='rejected', updated_at=NOW()
            WHERE id=:quote_id AND organization_id=:org_id
            """),
            {"quote_id": row.quote_id, "org_id": org_id},
        )
    await db.commit()
    return {
        "success": True,
        "data": {"id": str(opportunity_id)},
        "message": "Opportunity marked lost.",
        "meta": {},
    }


@router.get("/win-loss-reasons")
async def list_win_loss_reasons(
    reason_type: Optional[str] = Query(default=None, pattern="^(won|lost)$"),
    user: dict = Depends(require_permission("crm.marketing.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    query = "SELECT * FROM crm.win_loss_reasons WHERE organization_id=:org_id AND is_deleted=false"
    params: dict = {"org_id": org_id}
    if reason_type:
        query += " AND reason_type=:reason_type"
        params["reason_type"] = reason_type
    query += " ORDER BY label ASC"
    reasons = await _rows(db, query, params)
    return {"success": True, "data": reasons, "message": "Win/loss reasons fetched.", "meta": {"total": len(reasons)}}


@router.post("/win-loss-reasons", status_code=status.HTTP_201_CREATED)
async def create_win_loss_reason(
    payload: WinLossReasonPayload,
    user: dict = Depends(require_permission("crm.marketing.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    row = await db.execute(
        text("""
        INSERT INTO crm.win_loss_reasons (organization_id, created_by, reason_type, label)
        VALUES (:org_id, :user_id, :reason_type, :label)
        ON CONFLICT (organization_id, reason_type, label) DO UPDATE SET updated_at = NOW()
        RETURNING id
        """),
        {"org_id": org_id, "user_id": user_id, "reason_type": payload.reason_type, "label": payload.label},
    )
    await db.commit()
    return {"success": True, "data": {"id": str(row.scalar())}, "message": "Win/loss reason created.", "meta": {}}


@router.post("/tenders")
async def create_tender(
    payload: TenderCreate,
    user: dict = Depends(require_permission("crm.create_tenders")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)

    duplicate = await db.execute(
        text("""
            SELECT id FROM crm.tenders
            WHERE organization_id = :org_id AND is_deleted = false
              AND lower(tender_name) = lower(:tender_name)
            LIMIT 1
        """),
        {"org_id": org_id, "tender_name": payload.tender_name},
    )
    duplicate_id = duplicate.scalar()
    if duplicate_id:
        raise HTTPException(
            status_code=409,
            detail=f"A tender named \"{payload.tender_name}\" already exists on the board: {duplicate_id}",
        )

    query = text("""
        INSERT INTO crm.tenders (tender_name, stage, bid_amount, region, organization_id)
        VALUES (:name, :stage, :amount, :region, :org_id)
        RETURNING id
    """)
    try:
        result = await db.execute(
            query,
            {
                "name": payload.tender_name,
                "stage": payload.stage.value,
                "amount": payload.bid_amount,
                "region": payload.region,
                "org_id": org_id,
            },
        )
        new_tender_id = result.scalar()
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tender payload violates CRM database constraints.",
        ) from exc

    await generate_task_stack(
        db, org_id=org_id, entity_type="tender", entity_id=new_tender_id, created_by=user.get("sub"),
    )

    return {
        "success": True,
        "data": {"id": str(new_tender_id)},
        "message": "Tender created successfully.",
        "meta": {},
    }


@router.post("/subcontractors")
async def create_subcontractor(
    payload: SubcontractorCreate,
    user: dict = Depends(require_permission("crm.create_subcontractors")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    user_id = _require_user_id(user)
    values = _subcontractor_db_values(payload.model_dump())
    query = text("""
        INSERT INTO crm.subcontractors (
            name,
            capability_tags,
            compliance_status,
            nssa_number,
            praz_number,
            reliability_score,
            authorization_tier,
            contact_name,
            contact_email,
            contact_phone,
            address,
            submission_data,
            organization_id,
            created_by
        )
        VALUES (
            :name,
            CAST(:capability_tags AS text[]),
            :compliance_status,
            :nssa_number,
            :praz_number,
            :reliability_score,
            :authorization_tier,
            :contact_name,
            :contact_email,
            :contact_phone,
            :address,
            CAST(:submission_data AS jsonb),
            :org_id,
            :user_id
        )
        RETURNING id
    """)

    try:
        result = await db.execute(
            query,
            {
                **values,
                "org_id": org_id,
                "user_id": user_id,
            },
        )
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subcontractor payload violates CRM database constraints.",
        ) from exc

    return {
        "success": True,
        "data": {"id": str(result.scalar())},
        "message": "Subcontractor created successfully.",
        "meta": {},
    }


@router.put("/subcontractors/{subcontractor_id}")
async def update_subcontractor(
    subcontractor_id: str,
    payload: SubcontractorUpdate,
    user: dict = Depends(require_permission("crm.update_subcontractors")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    values = _subcontractor_db_values(
        payload.model_dump(exclude_unset=True, exclude_none=False)
    )
    safe_keys = [column for column in SUBCONTRACTOR_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": subcontractor_id},
            "message": "No fields to update.",
            "meta": {},
        }

    query = update_tenant_row_sql(
        "crm.subcontractors",
        safe_keys,
        SUBCONTRACTOR_COLUMNS,
        id_param="subcontractor_id",
        returning_id=True,
        casts={"capability_tags": "text[]", "submission_data": "jsonb"},
    )

    try:
        result = await db.execute(
            query,
            {**values, "subcontractor_id": subcontractor_id, "org_id": org_id},
        )
        if not result.first():
            raise HTTPException(status_code=404, detail="Subcontractor not found")
        await db.commit()
    except HTTPException:
        raise
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Subcontractor payload violates CRM database constraints.",
        ) from exc

    return {
        "success": True,
        "data": {"id": subcontractor_id},
        "message": "Subcontractor updated successfully.",
        "meta": {},
    }


@router.get("/subcontractors")
async def list_subcontractors(
    limit: Optional[int] = Query(default=None, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(require_permission("crm.view_subcontractors")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    pagination_params = _pagination_params(limit, offset)
    query = text("""
        SELECT
            id,
            name,
            capability_tags,
            compliance_status,
            nssa_number,
            praz_number,
            reliability_score,
            authorization_tier,
            contact_name,
            contact_email,
            contact_phone,
            address AS physical_address,
            submission_data -> 'capability_matrix' AS capability_matrix
        FROM crm.subcontractors
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY reliability_score DESC, name ASC
        LIMIT :limit OFFSET :offset
    """)
    result = await db.execute(query, {"org_id": org_id, **pagination_params})
    subcontractors = [dict(row._mapping) for row in result]
    meta = await _list_meta(
        db,
        """
        SELECT COUNT(*)
        FROM crm.subcontractors
        WHERE organization_id = :org_id AND is_deleted = false
        """,
        org_id,
        subcontractors,
        limit,
        offset,
    )

    return {
        "success": True,
        "data": subcontractors,
        "message": "Subcontractors fetched.",
        "meta": meta,
    }


@router.get("/accountability")
async def get_accountability_metrics(
    user: dict = Depends(require_permission("crm.view_accountability")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    query = text("""
        SELECT metric_name, target_value, current_value, period
        FROM crm.accountability_targets
        WHERE organization_id = :org_id
    """)
    result = await db.execute(query, {"org_id": org_id})
    metrics = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": metrics,
        "message": "Accountability metrics fetched.",
        "meta": {},
    }


@router.get("/risk-matrices")
async def get_risk_matrices(
    user: dict = Depends(require_permission("crm.view_accountability")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]

    # Client concentration: real pipeline value grouped by client sector.
    sector_rows = (
        await db.execute(
            text("""
                SELECT COALESCE(o.sector, 'Unclassified') AS sector, SUM(opp.budget) AS value
                FROM crm.opportunities opp
                LEFT JOIN crm.organizations o ON o.id = opp.client_org_id
                WHERE opp.organization_id = :org_id AND opp.is_deleted = false AND opp.budget IS NOT NULL
                GROUP BY COALESCE(o.sector, 'Unclassified')
                ORDER BY value DESC
            """),
            {"org_id": org_id},
        )
    ).all()
    total_pipeline_value = sum(float(row.value) for row in sector_rows)
    if total_pipeline_value > 0:
        breakdown = [
            {
                "sector": row.sector,
                "percentage": round(float(row.value) / total_pipeline_value * 100),
                "value": float(row.value),
            }
            for row in sector_rows
        ]
        top = breakdown[0]
        level = "HIGH" if top["percentage"] >= 50 else "MEDIUM" if top["percentage"] >= 30 else "LOW"
        client_concentration = {
            "risk_score": top["percentage"],
            "level": level,
            "primary_dependency": f"{top['sector']} ({top['percentage']}%)",
            "directive": (
                f"{top['sector']} represents {top['percentage']}% of pipeline value. "
                "Diversify into other sectors to reduce concentration risk."
                if level != "LOW"
                else "Pipeline is reasonably diversified across client sectors."
            ),
            "breakdown": breakdown,
        }
    else:
        client_concentration = {
            "risk_score": None,
            "level": "NOT_RECORDED",
            "primary_dependency": None,
            "directive": "Not enough pipeline data to assess client concentration.",
            "breakdown": [],
        }

    # Subcontractor risk: real compliance-status mix, not a fabricated dependency %
    # we have no data source for (no subcontractor-to-contract-value linkage exists yet).
    subcontractor_rows = (
        await db.execute(
            text("""
                SELECT name, compliance_status, reliability_score
                FROM crm.subcontractors
                WHERE organization_id = :org_id AND is_deleted = false
                ORDER BY reliability_score ASC NULLS LAST
            """),
            {"org_id": org_id},
        )
    ).all()
    if subcontractor_rows:
        non_compliant = [
            row for row in subcontractor_rows if (row.compliance_status or "").lower() != "compliant"
        ]
        risk_score = round(len(non_compliant) / len(subcontractor_rows) * 100)
        level = "CRITICAL" if risk_score >= 50 else "HIGH" if risk_score >= 25 else "LOW"
        directive = (
            f"{len(non_compliant)} of {len(subcontractor_rows)} subcontractors are not marked compliant. "
            "Review before awarding new work."
            if non_compliant
            else "All recorded subcontractors are marked compliant."
        )
        subcontractor_risk = {
            "risk_score": risk_score,
            "level": level,
            "primary_dependency": (non_compliant[0].name if non_compliant else subcontractor_rows[0].name),
            "directive": directive,
            "breakdown": [
                {
                    "name": row.name,
                    "status": "Warning" if (row.compliance_status or "").lower() != "compliant" else "Stable",
                    "compliance_status": row.compliance_status or "Unknown",
                }
                for row in subcontractor_rows[:10]
            ],
        }
    else:
        subcontractor_risk = {
            "risk_score": None,
            "level": "NOT_RECORDED",
            "primary_dependency": None,
            "directive": "No subcontractors recorded. Add subcontractor compliance data to enable risk tracking.",
            "breakdown": [],
        }

    # Win/loss diagnostic: real win rate from closed opportunities, plus the current
    # (not historical - no stage-transition log exists yet) distribution of open
    # opportunities across stages.
    stage_rows = (
        await db.execute(
            text("""
                SELECT stage, COUNT(*) AS cnt
                FROM crm.opportunities
                WHERE organization_id = :org_id AND is_deleted = false
                GROUP BY stage
            """),
            {"org_id": org_id},
        )
    ).all()
    stage_counts = {row.stage: row.cnt for row in stage_rows}
    won = stage_counts.get("Contract", 0)
    lost = stage_counts.get("Lost", 0)
    total_closed = won + lost
    open_stage_order = ["Inquiry", "Qualification", "Site Visit", "Quotation", "Negotiation"]
    total_open = sum(stage_counts.get(stage, 0) for stage in open_stage_order)
    if total_closed > 0 or total_open > 0:
        win_loss_diagnostic = {
            "overall_win_rate": round(won / total_closed * 100) if total_closed > 0 else None,
            "directive": (
                f"{won} won, {lost} lost out of {total_closed} closed opportunities."
                if total_closed > 0
                else "No opportunities have closed (won or lost) yet."
            ),
            "stages": [
                {
                    "stage": stage,
                    "share_of_open_pipeline": (
                        round(stage_counts.get(stage, 0) / total_open * 100) if total_open > 0 else 0
                    ),
                }
                for stage in open_stage_order
            ],
        }
    else:
        win_loss_diagnostic = {
            "overall_win_rate": None,
            "directive": "Not enough opportunity data to compute a win/loss diagnostic.",
            "stages": [],
        }

    return {
        "success": True,
        "data": {
            "client_concentration": client_concentration,
            "subcontractor_risk": subcontractor_risk,
            "win_loss_diagnostic": win_loss_diagnostic,
        },
        "message": "Risk matrices generated successfully.",
        "meta": {},
    }
