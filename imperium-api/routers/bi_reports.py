from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok

router = APIRouter()


async def _rows(
    db: AsyncSession, query: str, params: dict[str, Any]
) -> list[dict[str, Any]]:
    """Return an empty dataset when an optional analytics source is not migrated yet."""
    try:
        result = await db.execute(text(query), params)
        return [dict(row._mapping) for row in result]
    except Exception:
        await db.rollback()
        return []


@router.get("/projects")
async def get_project_performance_analytics(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get aggregated project financial performance metrics (EAC, actual, budget).
    """
    query = text("""
        SELECT 
            p.id,
            p.name AS project_name,
            COALESCE(p.contract_value, 0) AS budget_value,
            COALESCE((
                SELECT SUM(ct.amount) 
                FROM finance.cost_transactions ct 
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        ORDER BY p.name
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    data = [dict(row._mapping) for row in result]
    return ok(data, "Project performance analytics retrieved.")


@router.get("/equipment")
async def get_equipment_intelligence_analytics(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get fleet assets utilization ratios and cost vs revenue.
    """
    data = await _rows(
        db,
        """
        SELECT
            f.id,
            COALESCE(to_jsonb(f)->>'asset_name', to_jsonb(f)->>'name', to_jsonb(f)->>'registration_number', to_jsonb(f)->>'asset_code', f.id::text) AS asset,
            COALESCE(SUM(u.operating_hours), 0)::float AS operating_hours,
            COALESCE(SUM(u.idle_hours), 0)::float AS idle_hours,
            CASE
                WHEN COALESCE(SUM(u.operating_hours), 0) + COALESCE(SUM(u.idle_hours), 0) = 0 THEN 0
                ELSE ROUND((SUM(u.operating_hours) / NULLIF(SUM(u.operating_hours + u.idle_hours), 0) * 100)::numeric, 2)
            END AS utilisation,
            COALESCE(SUM(u.cost_amount), 0)::float AS cost,
            COALESCE(SUM(u.revenue_amount), 0)::float AS revenue,
            (COALESCE(SUM(u.revenue_amount), 0) - COALESCE(SUM(u.cost_amount), 0))::float AS margin
        FROM fleet.fleet f
        LEFT JOIN fleet.utilization_logs u ON u.fleet_id=f.id AND u.organization_id=f.organization_id AND u.is_deleted=false
        WHERE f.organization_id=:org_id AND f.is_deleted=false
        GROUP BY f.id
        ORDER BY margin ASC, asset ASC
    """,
        {"org_id": user["org_id"]},
    )
    return ok(data, "Equipment intelligence analytics retrieved.")


@router.get("/procurement")
async def get_procurement_analytics(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get procurement spend and supplier SLA stats.
    """
    data = await _rows(
        db,
        """
        SELECT
            s.id,
            COALESCE(s.trading_name, to_jsonb(s)->>'supplier_name', to_jsonb(s)->>'name', s.id::text) AS supplier,
            COUNT(po.id)::int AS pos_issued,
            COALESCE(s.on_time_delivery_pct, 0)::float AS on_time_delivery_pct,
            COUNT(inv.id) FILTER (WHERE COALESCE(inv.match_status, '') IN ('disputed', 'mismatch'))::int AS quality_issues,
            COALESCE(AVG(grn.delivery_date - po.issued_at::date), 0)::float AS avg_lead_time_days
        FROM procurement.suppliers s
        LEFT JOIN procurement.purchase_orders po ON po.supplier_id=s.id AND po.organization_id=s.organization_id AND po.is_deleted=false
        LEFT JOIN procurement.goods_received_notes grn ON grn.po_id=po.id AND grn.organization_id=po.organization_id AND grn.is_deleted=false
        LEFT JOIN procurement.supplier_invoices inv ON inv.po_id=po.id AND inv.organization_id=po.organization_id AND inv.is_deleted=false
        WHERE s.organization_id=:org_id AND COALESCE(s.is_deleted, false)=false
        GROUP BY s.id
        ORDER BY pos_issued DESC, supplier ASC
    """,
        {"org_id": user["org_id"]},
    )
    return ok(data, "Procurement analytics retrieved.")


@router.get("/workforce")
async def get_workforce_analytics(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get workforce attendance, allocation ratios, and labor cost distribution.
    """
    data = await _rows(
        db,
        """
        SELECT
            COALESCE(p.id::text, 'unassigned') AS id,
            COALESCE(p.name, 'Unassigned') AS project,
            CASE
                WHEN COUNT(a.id)=0 THEN 0
                ELSE ROUND((COUNT(a.id) FILTER (WHERE a.status IN ('present', 'late', 'half_day'))::numeric / COUNT(a.id)::numeric * 100), 2)
            END AS attendance_rate,
            COALESCE(SUM(ct.amount), 0)::float AS labour_cost,
            CASE
                WHEN COALESCE(SUM(a.regular_hours + a.overtime_hours), 0)=0 THEN 0
                ELSE ROUND((SUM(a.overtime_hours)::numeric / NULLIF(SUM(a.regular_hours + a.overtime_hours), 0)::numeric * 100), 2)
            END AS ot_ratio
        FROM hr.attendance_records a
        LEFT JOIN projects.projects p ON p.id=a.project_id AND p.organization_id=a.organization_id
        LEFT JOIN finance.cost_transactions ct ON ct.project_id=a.project_id AND ct.organization_id=a.organization_id AND ct.cost_category='labour'
        WHERE a.organization_id=:org_id AND a.is_deleted=false
        GROUP BY p.id, p.name
        ORDER BY labour_cost DESC, project ASC
    """,
        {"org_id": user["org_id"]},
    )
    return ok(data, "Workforce analytics retrieved.")
