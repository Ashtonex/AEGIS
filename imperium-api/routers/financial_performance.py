from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


class CostCodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(default="materials", max_length=40)


class VariationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    variation_number: str = Field(min_length=1, max_length=40)
    project_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    initiated_by: str = Field(default="client", max_length=40)
    cost_impact: float = 0.0
    time_impact_days: int = 0


@router.get("/projects")
async def list_project_financial_summaries(
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List running financial metrics for all active projects by dynamically
    aggregating budgets, actual costs, commitments, and progress claims.
    """
    query = text("""
        SELECT 
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            
            -- Variations
            COALESCE((
                SELECT SUM(v.cost_impact) 
                FROM finance.variations v 
                WHERE v.project_id = p.id AND v.organization_id = :org_id 
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            
            -- Actual Cost (posted transactions)
            COALESCE((
                SELECT SUM(ct.amount) 
                FROM finance.cost_transactions ct 
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost_to_date,
            
            -- Committed Cost (outstanding PO obligations)
            COALESCE((
                SELECT SUM(c.outstanding_amount) 
                FROM finance.commitments c 
                WHERE c.project_id = p.id AND c.organization_id = :org_id 
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            -- Certified Revenue
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            -- Cash Collected
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            -- Budget Limit
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget
            
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        ORDER BY p.name
    """)

    result = await db.execute(query, {"org_id": user["org_id"]})
    summaries = [dict(row._mapping) for row in result]
    return ok(summaries, "Project financial summaries listed.")


@router.get("/projects/{project_id}")
async def get_project_financial_detail(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed financial dashboard structure for a specific project.
    """
    query = text("""
        SELECT 
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            
            COALESCE((
                SELECT SUM(v.cost_impact) 
                FROM finance.variations v 
                WHERE v.project_id = p.id AND v.organization_id = :org_id 
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            
            COALESCE((
                SELECT SUM(ct.amount) 
                FROM finance.cost_transactions ct 
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost_to_date,
            
            COALESCE((
                SELECT SUM(c.outstanding_amount) 
                FROM finance.commitments c 
                WHERE c.project_id = p.id AND c.organization_id = :org_id 
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget
            
        FROM projects.projects p
        WHERE p.id = :project_id AND p.organization_id = :org_id AND p.is_deleted = false
    """)

    result = await db.execute(
        query, {"project_id": project_id, "org_id": user["org_id"]}
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project ledger not found.")

    detail = dict(row._mapping)

    # Check flags
    eac = detail["actual_cost_to_date"] + detail["committed_cost"]
    budget = detail["approved_budget"]
    detail["cost_overrun_risk"] = eac > budget and budget > 0
    detail["cashflow_deficit_risk"] = (
        detail["committed_cost"] > detail["cash_collected"]
    )

    return ok(detail, "Project financial detail retrieved.")


@router.get("/cost-codes")
async def list_cost_codes(
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List all cost codes in the organisation structure.
    """
    result = await db.execute(
        text("""
        SELECT * FROM finance.cost_codes
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY code
    """),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cost codes listed.")


@router.post("/cost-codes", status_code=status.HTTP_201_CREATED)
async def create_cost_code(
    payload: CostCodeCreate,
    user: dict = Depends(require_permission("finance.budget.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new cost code.
    """
    try:
        cost_code_id = (
            await db.execute(
                text("""
            INSERT INTO finance.cost_codes (organization_id, code, name, category)
            VALUES (:org_id, :code, :name, :category)
            RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "code": payload.code,
                    "name": payload.name,
                    "category": payload.category,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(cost_code_id)}, "Cost code created.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cost code already exists.")


@router.get("/variations")
async def list_variations(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("finance.variation.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List variations, optionally filtered by project or status.
    """
    query_str = """
        SELECT v.*, p.name AS project_name
        FROM finance.variations v
        JOIN projects.projects p ON p.id = v.project_id AND p.organization_id = v.organization_id
        WHERE v.organization_id = :org_id AND v.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND v.project_id = :project_id"
        params["project_id"] = project_id
    if status_filter:
        query_str += " AND v.status = :status"
        params["status"] = status_filter

    query_str += " ORDER BY v.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Variations listed.")


@router.post("/variations", status_code=status.HTTP_201_CREATED)
async def create_variation(
    payload: VariationCreate,
    user: dict = Depends(require_permission("finance.variation.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new variation order.
    """
    # Verify project
    proj = await db.execute(
        text(
            "SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"
        ),
        {"id": payload.project_id, "org_id": user["org_id"]},
    )
    if not proj.first():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        var_id = (
            await db.execute(
                text("""
            INSERT INTO finance.variations (
                organization_id, variation_number, project_id, title, description,
                initiated_by, cost_impact, time_impact_days, status
            ) VALUES (
                :org_id, :variation_number, :project_id, :title, :description,
                :initiated_by, :cost_impact, :time_impact_days, 'pending'
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "variation_number": payload.variation_number,
                    "project_id": payload.project_id,
                    "title": payload.title,
                    "description": payload.description,
                    "initiated_by": payload.initiated_by,
                    "cost_impact": payload.cost_impact,
                    "time_impact_days": payload.time_impact_days,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(var_id)}, "Variation order recorded.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Variation number already exists.")


@router.get("/progress-claims")
async def list_progress_claims(
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.claim.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List progress claims, optionally filtered by project.
    """
    query_str = """
        SELECT pc.*, p.name AS project_name
        FROM finance.progress_claims pc
        JOIN projects.projects p ON p.id = pc.project_id AND p.organization_id = pc.organization_id
        WHERE pc.organization_id = :org_id AND pc.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND pc.project_id = :project_id"
        params["project_id"] = project_id

    query_str += " ORDER BY pc.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Progress claims listed.")
