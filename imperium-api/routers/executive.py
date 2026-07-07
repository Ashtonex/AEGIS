from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any

from core.database import get_db
from core.security import require_permission

router = APIRouter()

@router.get("/kpis")
async def get_executive_kpis(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Fetch high-level KPIs for the Executive Dashboard."""
    # This fetches from the new executive.kpi_snapshots table
    query = text("""
        SELECT 
            cash_survival_days,
            revenue_concentration_percent,
            active_projects_count,
            documented_workflow_percent,
            snapshot_date
        FROM executive.kpi_snapshots
        WHERE organization_id = :org_id
        ORDER BY snapshot_date DESC
        LIMIT 1
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    snapshot = result.fetchone()

    # If no snapshot, return 0s or nulls, or a generated default
    data = dict(snapshot._mapping) if snapshot else {
        "cash_survival_days": 14,
        "revenue_concentration_percent": 85.0,
        "active_projects_count": 0,
        "documented_workflow_percent": 12.5,
        "snapshot_date": None
    }

    return {
        "success": True,
        "data": data,
        "message": "Executive KPIs fetched.",
        "meta": {}
    }

@router.get("/modules")
async def get_modules_status(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Fetch status of all 26 Imperium modules."""
    query = text("SELECT id, name, status FROM core.system_modules ORDER BY name ASC")
    result = await db.execute(query)
    modules = [dict(row._mapping) for row in result]
    
    return {
        "success": True,
        "data": modules,
        "message": "System modules fetched.",
        "meta": {"total": len(modules)}
    }
