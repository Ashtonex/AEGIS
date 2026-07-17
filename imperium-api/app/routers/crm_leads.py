from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from app.database import get_db
from core.ml_engine import ml_engine

router = APIRouter(prefix="/api/crm/leads", tags=["CRM Leads"])


class LeadCreateSchema(BaseModel):
    company_name: str
    contact_name: str
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    sector: str
    estimated_budget: float
    lead_source: str
    assigned_to: Optional[str] = None
    labels: Optional[str] = None
    expected_close_date: Optional[str] = None


@router.get("/")
async def get_leads(db: AsyncSession = Depends(get_db)):
    """
    Returns all leads, ordered by AI Score descending (highest propensity first)
    """
    query = text("""
        SELECT id, organization_id, lead_source, status, company_name, contact_name, 
               contact_email, contact_phone, sector, estimated_budget, ai_score, ai_rationale,
               created_at 
        FROM crm.leads 
        WHERE is_deleted = false AND status != 'Qualified'
        ORDER BY ai_score DESC NULLS LAST, created_at DESC
    """)
    result = await db.execute(query)
    leads = result.mappings().all()
    return {"success": True, "data": [dict(lead) for lead in leads]}


@router.post("/")
async def create_and_score_lead(
    lead: LeadCreateSchema, db: AsyncSession = Depends(get_db)
):
    """
    Creates a new lead and calculates its AI Score on the fly
    """
    # 1. Run through ML Engine
    scoring_result = ml_engine.score_lead(
        sector=lead.sector,
        estimated_budget=lead.estimated_budget,
        lead_source=lead.lead_source,
    )

    ai_score = scoring_result["ai_score"]
    ai_rationale = scoring_result["ai_rationale"]

    # 2. Insert into database
    query = text("""
        INSERT INTO crm.leads (
            organization_id, company_name, contact_name, contact_email, contact_phone,
            sector, estimated_budget, lead_source, status, ai_score, ai_rationale,
            assigned_to, labels, expected_close_date
        ) VALUES (
            (SELECT id FROM core.organizations LIMIT 1), -- Default Org for MVP
            :company_name, :contact_name, :contact_email, :contact_phone,
            :sector, :estimated_budget, :lead_source, 'New', :ai_score, :ai_rationale,
            :assigned_to, :labels, :expected_close_date
        ) RETURNING id, ai_score
    """)

    result = await db.execute(
        query,
        {
            "company_name": lead.company_name,
            "contact_name": lead.contact_name,
            "contact_email": lead.contact_email,
            "contact_phone": lead.contact_phone,
            "sector": lead.sector,
            "estimated_budget": lead.estimated_budget,
            "lead_source": lead.lead_source,
            "assigned_to": lead.assigned_to,
            "labels": lead.labels,
            "expected_close_date": lead.expected_close_date,
            "ai_score": ai_score,
            "ai_rationale": ai_rationale,
        },
    )

    await db.commit()
    new_lead = result.mappings().first()

    return {
        "success": True,
        "message": "Lead created and scored successfully",
        "data": dict(new_lead),
    }


@router.post("/{lead_id}/qualify")
async def qualify_lead(lead_id: str, db: AsyncSession = Depends(get_db)):
    """
    Converts a Lead into an Opportunity
    """
    # 1. Fetch Lead
    fetch_query = text("SELECT * FROM crm.leads WHERE id = :id AND is_deleted = false")
    result = await db.execute(fetch_query, {"id": lead_id})
    lead = result.mappings().first()

    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    # 2. Create Opportunity
    opp_query = text("""
        INSERT INTO crm.opportunities (
            organization_id, name, client_name, stage, budget, probability
        ) VALUES (
            :org_id, :name, :client_name, 'Inquiry', :budget, :prob
        ) RETURNING id
    """)
    await db.execute(
        opp_query,
        {
            "org_id": lead.organization_id,
            "name": f"{lead.company_name} - {lead.sector} Project",
            "client_name": lead.company_name,
            "budget": lead.estimated_budget,
            "prob": lead.ai_score,  # We use the AI Score as the initial probability
        },
    )

    # 3. Mark lead as Qualified
    update_query = text("UPDATE crm.leads SET status = 'Qualified' WHERE id = :id")
    await db.execute(update_query, {"id": lead_id})

    await db.commit()
    return {"success": True, "message": "Lead qualified and converted to Opportunity"}
