import json
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import DataError, IntegrityError

from core.database import get_db
from core.ml_engine import risk_engine
from core.security import require_permission
from app.services.tender_scraper import collect_tender_signals, configured_tender_sources
from app.shared.sql import update_tenant_row_sql
from pydantic import BaseModel, ConfigDict, Field, field_validator

router = APIRouter()


class OpportunityStage(str, Enum):
    INQUIRY = "Inquiry"
    QUALIFICATION = "Qualification"
    SITE_VISIT = "Site Visit"
    QUOTATION = "Quotation"
    NEGOTIATION = "Negotiation"
    CONTRACT = "Contract"


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
    "negotiation": OpportunityStage.NEGOTIATION.value,
    "contract": OpportunityStage.CONTRACT.value,
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
    budget: Decimal = Field(
        default=Decimal("0"),
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )
    probability: int = Field(default=0, ge=0, le=100)

    @field_validator("stage", mode="before")
    @classmethod
    def normalize_stage(cls, value: Any) -> Any:
        return _normalize_stage(value, OPPORTUNITY_STAGE_ALIASES)


class OpportunityUpdate(CrmPayload):
    """Validated, tenant-safe fields that may be changed on an opportunity."""

    client_id: Optional[UUID] = None
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

    @field_validator("stage", mode="before")
    @classmethod
    def normalize_stage(cls, value: Any) -> Any:
        return _normalize_stage(value, OPPORTUNITY_STAGE_ALIASES)


OPPORTUNITY_UPDATE_COLUMNS = (
    "client_id",
    "name",
    "stage",
    "budget",
    "probability",
    "expected_margin",
    "risk_level",
)


class TenderCreate(CrmPayload):
    tender_name: str = Field(..., min_length=1, max_length=255)
    stage: TenderStage = Field(default=TenderStage.TENDER_IDENTIFIED)
    bid_amount: Decimal = Field(
        default=Decimal("0"),
        ge=Decimal("0"),
        le=Decimal("9999999999999.99"),
        max_digits=15,
        decimal_places=2,
    )

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
        SELECT o.id, o.name, o.stage, o.budget, o.probability, o.expected_margin, o.risk_level, c.contact_name as client_name
        FROM crm.opportunities o
        LEFT JOIN crm.contacts c ON o.client_id = c.id
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
    query = text("""
        INSERT INTO crm.opportunities (name, stage, budget, probability, organization_id, created_by)
        VALUES (:name, :stage, :budget, :probability, :org_id, :user_id)
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
                "org_id": org_id,
                "user_id": user_id,
            },
        )
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Opportunity payload violates CRM database constraints.",
        ) from exc

    return {
        "success": True,
        "data": {"id": str(result.scalar())},
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


@router.post("/tenders")
async def create_tender(
    payload: TenderCreate,
    user: dict = Depends(require_permission("crm.create_tenders")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    query = text("""
        INSERT INTO crm.tenders (tender_name, stage, bid_amount, organization_id)
        VALUES (:name, :stage, :amount, :org_id)
        RETURNING id
    """)
    try:
        result = await db.execute(
            query,
            {
                "name": payload.tender_name,
                "stage": payload.stage.value,
                "amount": payload.bid_amount,
                "org_id": org_id,
            },
        )
        await db.commit()
    except (DataError, IntegrityError) as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tender payload violates CRM database constraints.",
        ) from exc

    return {
        "success": True,
        "data": {"id": str(result.scalar())},
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
    # In a real app we'd pass DB queries to the risk engine
    client_concentration = risk_engine.calculate_client_concentration()
    subcontractor_risk = risk_engine.calculate_subcontractor_risk()
    win_loss_diagnostic = risk_engine.calculate_win_loss_diagnostic()

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
