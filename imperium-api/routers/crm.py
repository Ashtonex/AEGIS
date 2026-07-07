from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any

from core.database import get_db
from core.security import require_permission, get_current_user
from pydantic import BaseModel

router = APIRouter()

class WebIntakeLead(BaseModel):
    name: str
    email: str
    company: str = None
    phone: str = None
    project_type: str = None
    message: str = None

class OpportunityCreate(BaseModel):
    name: str
    stage: str = 'Inquiry'
    budget: float = 0
    probability: int = 0

class TenderCreate(BaseModel):
    tender_name: str
    stage: str = 'Tender Identified'
    bid_amount: float = 0

@router.get("/opportunities")
async def list_opportunities(
    user: dict = Depends(require_permission("crm.view_opportunities")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT o.id, o.name, o.stage, o.budget, o.probability, o.expected_margin, o.risk_level, c.contact_name as client_name
        FROM crm.opportunities o
        LEFT JOIN crm.contacts c ON o.client_id = c.id
        WHERE o.organization_id = :org_id AND o.is_deleted = false
        ORDER BY o.created_at DESC
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    opportunities = [dict(row._mapping) for row in result]
    
    return {"success": True, "data": opportunities, "message": "Opportunities fetched.", "meta": {"total": len(opportunities)}}

@router.get("/tenders")
async def list_tenders(
    user: dict = Depends(require_permission("crm.view_tenders")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT id, tender_name, bid_amount, stage, submission_deadline, bid_bond_secured
        FROM crm.tenders
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    tenders = [dict(row._mapping) for row in result]
    
    return {"success": True, "data": tenders, "message": "Tenders fetched.", "meta": {"total": len(tenders)}}

@router.post("/opportunities")
async def create_opportunity(
    payload: OpportunityCreate,
    user: dict = Depends(require_permission("crm.create_opportunities")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        INSERT INTO crm.opportunities (name, stage, budget, probability, organization_id, created_by)
        VALUES (:name, :stage, :budget, :probability, :org_id, :user_id)
        RETURNING id
    """)
    result = await db.execute(query, {
        "name": payload.name,
        "stage": payload.stage,
        "budget": payload.budget,
        "probability": payload.probability,
        "org_id": user["org_id"],
        "user_id": user["sub"]
    })
    await db.commit()
    
    return {"success": True, "data": {"id": str(result.scalar())}, "message": "Opportunity created successfully.", "meta": {}}

@router.post("/tenders")
async def create_tender(
    payload: TenderCreate,
    user: dict = Depends(require_permission("crm.create_tenders")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        INSERT INTO crm.tenders (tender_name, stage, bid_amount, organization_id)
        VALUES (:name, :stage, :amount, :org_id)
        RETURNING id
    """)
    result = await db.execute(query, {
        "name": payload.tender_name,
        "stage": payload.stage,
        "amount": payload.bid_amount,
        "org_id": user["org_id"]
    })
    await db.commit()
    
    return {"success": True, "data": {"id": str(result.scalar())}, "message": "Tender created successfully.", "meta": {}}

@router.get("/subcontractors")
async def list_subcontractors(
    user: dict = Depends(require_permission("crm.view_subcontractors")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT id, name, capability_tags, compliance_status, nssa_number, praz_number, reliability_score, authorization_tier
        FROM crm.subcontractors
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY reliability_score DESC, name ASC
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    subcontractors = [dict(row._mapping) for row in result]
    
    return {"success": True, "data": subcontractors, "message": "Subcontractors fetched.", "meta": {"total": len(subcontractors)}}

@router.post("/leads/web-intake")
async def intake_web_lead(
    payload: WebIntakeLead,
    db: AsyncSession = Depends(get_db)
):
    # This is a public endpoint used by the website form. We assume organization_id logic is handled securely elsewhere or defaulted.
    # We will log it directly to crm.website_enquiries which acts as the inbox for new leads.
    query = text("""
        INSERT INTO crm.website_enquiries (name, email, company, phone, project_type, message)
        VALUES (:name, :email, :company, :phone, :project_type, :message)
        RETURNING id
    """)
    result = await db.execute(query, {
        "name": payload.name, "email": payload.email, "company": payload.company,
        "phone": payload.phone, "project_type": payload.project_type, "message": payload.message
    })
    await db.commit()
    
    return {"success": True, "data": None, "message": "Enquiry received successfully.", "meta": {}}

@router.get("/accountability")
async def get_accountability_metrics(
    user: dict = Depends(require_permission("crm.view_accountability")),
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT metric_name, target_value, current_value, period
        FROM crm.accountability_targets
        WHERE organization_id = :org_id
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    metrics = [dict(row._mapping) for row in result]
    
    return {"success": True, "data": metrics, "message": "Accountability metrics fetched.", "meta": {}}

from core.ml_engine import risk_engine

@router.get("/risk-matrices")
async def get_risk_matrices(
    user: dict = Depends(require_permission("crm.view_accountability")),
    db: AsyncSession = Depends(get_db)
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
            "win_loss_diagnostic": win_loss_diagnostic
        },
        "message": "Risk matrices generated successfully.",
        "meta": {}
    }
