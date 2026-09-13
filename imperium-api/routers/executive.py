from fastapi import APIRouter, Depends, Request, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timedelta
from typing import Dict, Any, List

from app.shared.events import emit_role_notification
from core.database import get_db
from core.logging import logger
from core.security import SUPERADMIN_ROLE, require_permission
from core.analytics_ml import ml_engine
router = APIRouter()

PROJECT_TERMINAL_STATUSES = (
    "cancelled",
    "canceled",
    "closed",
    "complete",
    "completed",
    "archived",
    "lost",
)
PROJECT_OPEN_STATUS_SQL = (
    "lower(COALESCE(p.status, '')) NOT IN "
    "('cancelled', 'canceled', 'closed', 'complete', 'completed', 'archived', 'lost')"
)
EXECUTIVE_HEALTH_SOURCES: Dict[str, Dict[str, str | None]] = {
    "projects.projects": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "projects.project_profiles": {"updated_column": "updated_at", "deleted_filter": None},
    "projects.daily_site_reports": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "projects.hse_incidents": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "crm.leads": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "crm.opportunities": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "crm.tenders": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "crm.activities": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "finance.quotations": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "finance.progress_claims": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "finance.cost_transactions": {"updated_column": "created_at", "deleted_filter": None},
    "finance.project_forecasts": {"updated_column": "computed_at", "deleted_filter": None},
    "procurement.purchase_orders": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "procurement.suppliers": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "procurement.inventory_items": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "hr.employees": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "fleet.fleet": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "fleet.plant_requests": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "fleet.plant_incidents": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
    "core.compliance_items": {"updated_column": "updated_at", "deleted_filter": "is_deleted = false"},
}
EXECUTIVE_DATA_HEALTH_ALERT_ROLES = ["Executive (Admin)", SUPERADMIN_ROLE]
EXECUTIVE_DATA_HEALTH_NOTIFICATION_TYPE = "executive_data_health"

ZIMBABWE_REGIONS: List[Dict[str, Any]] = [
    {"name": "Bulawayo", "latitude": -20.1325, "longitude": 28.6265},
    {"name": "Harare", "latitude": -17.8252, "longitude": 31.0335},
    {"name": "Manicaland", "latitude": -18.9216, "longitude": 32.1746},
    {"name": "Mashonaland Central", "latitude": -16.7644, "longitude": 31.0794},
    {"name": "Mashonaland East", "latitude": -18.5872, "longitude": 31.2626},
    {"name": "Mashonaland West", "latitude": -17.4851, "longitude": 29.7889},
    {"name": "Masvingo", "latitude": -20.0744, "longitude": 30.8327},
    {"name": "Matabeleland North", "latitude": -18.5332, "longitude": 27.5496},
    {"name": "Matabeleland South", "latitude": -21.0523, "longitude": 29.0459},
    {"name": "Midlands", "latitude": -19.0552, "longitude": 29.6035},
]


async def _rows(
    db: AsyncSession,
    query: str,
    params: Dict[str, Any],
    *,
    source: str,
    source_errors: List[Dict[str, Any]] | None = None,
) -> List[Dict[str, Any]]:
    """Return an empty list for optional ERP relations while reporting degraded sources."""
    try:
        result = await db.execute(text(query), params)
        return [dict(row._mapping) for row in result]
    except Exception as exc:
        await db.rollback()
        logger.warning(
            "executive_source_query_failed",
            source=source,
            error_type=exc.__class__.__name__,
        )
        if source_errors is not None:
            source_errors.append(
                {
                    "source": source,
                    "status": "degraded",
                    "reason": exc.__class__.__name__,
                }
            )
        return []


@router.get("/kpis")
async def get_executive_kpis(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Fetch high-level KPIs for the Executive Dashboard."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []
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
    result = await db.execute(query, {"org_id": org_id})
    snapshot = result.fetchone()

    # A missing snapshot is not a zero-performance result. Keep it explicit so
    # the executive UI can distinguish unavailable data from a real zero.
    data = (
        dict(snapshot._mapping)
        if snapshot
        else {
            "cash_survival_days": None,
            "revenue_concentration_percent": None,
            "active_projects_count": None,
            "documented_workflow_percent": None,
            "snapshot_date": None,
        }
    )

    if not snapshot:
        data["_notices"] = [
            {
                "source": "executive.kpi_snapshots",
                "status": "no_data",
                "reason": "No executive KPI snapshot rows found; live module fallbacks are being used.",
            }
        ]

    live_rows = await _rows(
        db,
        f"""
        SELECT
            COUNT(*) FILTER (WHERE {PROJECT_OPEN_STATUS_SQL}) AS open_projects,
            NULLIF(COALESCE(SUM(COALESCE(p.contract_value, 0)) FILTER (WHERE {PROJECT_OPEN_STATUS_SQL}), 0), 0) AS portfolio_value
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
        """,
        {"org_id": org_id},
        source="kpis.projects",
        source_errors=source_errors,
    )
    if live_rows:
        data["active_projects_count"] = int(live_rows[0].get("open_projects") or 0)
        data["active_project_portfolio_value"] = float(live_rows[0].get("portfolio_value") or 0)

    pipeline_rows = await _rows(
        db,
        """
        SELECT
            COALESCE(SUM(opportunity_value), 0) AS opportunity_value,
            COALESCE(SUM(tender_value), 0) AS tender_value,
            COALESCE(SUM(opportunity_count), 0) AS opportunity_count,
            COALESCE(SUM(tender_count), 0) AS tender_count
        FROM (
            SELECT
                COALESCE(SUM(COALESCE(deal_value, budget)), 0) AS opportunity_value,
                0::numeric AS tender_value,
                COUNT(*) AS opportunity_count,
                0::bigint AS tender_count
            FROM crm.opportunities
            WHERE organization_id = :org_id
              AND is_deleted = false
              AND COALESCE(win_loss_status, '') <> 'lost'
              AND lower(COALESCE(stage, '')) NOT IN ('contract', 'lost')
            UNION ALL
            SELECT
                0::numeric AS opportunity_value,
                COALESCE(SUM(bid_amount), 0) AS tender_value,
                0::bigint AS opportunity_count,
                COUNT(*) AS tender_count
            FROM crm.tenders
            WHERE organization_id = :org_id
              AND is_deleted = false
              AND lower(COALESCE(stage, '')) NOT IN ('lost', 'withdrawn', 'cancelled', 'canceled')
        ) pipeline_parts
        """,
        {"org_id": org_id},
        source="kpis.pipeline",
        source_errors=source_errors,
    )
    if pipeline_rows:
        opportunity_value = float(pipeline_rows[0].get("opportunity_value") or 0)
        tender_value = float(pipeline_rows[0].get("tender_value") or 0)
        data["pipeline_opportunity_value"] = opportunity_value
        data["pipeline_tender_value"] = tender_value
        data["pipeline_opportunity_count"] = int(pipeline_rows[0].get("opportunity_count") or 0)
        data["pipeline_tender_count"] = int(pipeline_rows[0].get("tender_count") or 0)
        data["pipeline"] = f"${opportunity_value + tender_value:,.2f}"

    finance_rows = await _rows(
        db,
        """
        SELECT
            NULLIF(COALESCE(SUM(COALESCE(certified_amount, net_claim_amount, this_claim_amount)), 0), 0) AS revenue_ytd
        FROM finance.progress_claims
        WHERE organization_id = :org_id
          AND is_deleted = false
          AND COALESCE(claim_period_end, claim_period_start, created_at::date) >= date_trunc('year', CURRENT_DATE)::date
          AND lower(COALESCE(status, '')) NOT IN ('rejected', 'cancelled', 'canceled')
        """,
        {"org_id": org_id},
        source="kpis.progress_claims",
        source_errors=source_errors,
    )
    cost_rows = await _rows(
        db,
        """
        SELECT NULLIF(COALESCE(SUM(amount), 0), 0) AS cost_ytd
        FROM finance.cost_transactions
        WHERE organization_id = :org_id
          AND transaction_date >= date_trunc('year', CURRENT_DATE)::date
          AND lower(COALESCE(status, '')) NOT IN ('void', 'cancelled', 'canceled', 'rejected')
        """,
        {"org_id": org_id},
        source="kpis.cost_transactions",
        source_errors=source_errors,
    )
    revenue_ytd = float(finance_rows[0].get("revenue_ytd") or 0) if finance_rows else 0
    cost_ytd = float(cost_rows[0].get("cost_ytd") or 0) if cost_rows else 0
    data["revenue_ytd"] = revenue_ytd
    data["cost_ytd"] = cost_ytd
    data["gross_profit_ytd"] = revenue_ytd - cost_ytd
    if revenue_ytd > 0:
        data["revenue"] = f"${revenue_ytd:,.2f}"
        margin_percent = ((revenue_ytd - cost_ytd) / revenue_ytd) * 100
        data["margin_percent"] = round(margin_percent, 2)
        data["margin"] = f"{margin_percent:.2f}%"

    concentration_rows = await _rows(
        db,
        f"""
        WITH client_totals AS (
            SELECT COALESCE(NULLIF(client_name, ''), client_org_id::text, 'Unassigned') AS client_key,
                   SUM(COALESCE(contract_value, 0)) AS contract_value
            FROM projects.projects p
            WHERE p.organization_id = :org_id
              AND p.is_deleted = false
              AND {PROJECT_OPEN_STATUS_SQL}
            GROUP BY 1
        )
        SELECT
            MAX(contract_value) AS top_client_contract_value,
            SUM(contract_value) AS portfolio_contract_value,
            CASE WHEN SUM(contract_value) > 0
                 THEN ROUND(MAX(contract_value) / SUM(contract_value) * 100, 2)
                 ELSE NULL
            END AS concentration_percent
        FROM client_totals
        """,
        {"org_id": org_id},
        source="kpis.client_concentration",
        source_errors=source_errors,
    )
    if (
        data.get("revenue_concentration_percent") is None
        and concentration_rows
        and concentration_rows[0].get("concentration_percent") is not None
    ):
        data["revenue_concentration_percent"] = concentration_rows[0]["concentration_percent"]
    if concentration_rows:
        data["top_client_contract_value"] = float(concentration_rows[0].get("top_client_contract_value") or 0)
        data["portfolio_contract_value"] = float(concentration_rows[0].get("portfolio_contract_value") or 0)

    return {
        "success": True,
        "data": data,
        "message": "Executive KPIs fetched.",
        "meta": {
            "source_status": "snapshot" if snapshot else "live_fallback",
            "source_errors": source_errors,
        },
    }


@router.get("/modules")
async def get_modules_status(
    request: Request,
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Report modules from the routes actually registered in this running API."""
    query = text("SELECT id, name, status FROM core.system_modules ORDER BY name ASC")
    try:
        result = await db.execute(query)
        modules = [dict(row._mapping) for row in result]
    except Exception:
        modules = []

    registry = {str(module["name"]): module for module in modules}
    discovered: Dict[str, Dict[str, Any]] = {}
    # request.app.routes only lists routes defined directly on the app - every
    # router mounted via include_router() is wrapped in a private, lazily-
    # resolved object that doesn't flatten into it (confirmed live: this walk
    # silently found zero routes, degrading the whole Module Gateway to empty
    # with no error surfaced anywhere). app.openapi() is FastAPI's public,
    # stable contract for the fully-resolved route table - it's what powers
    # /docs, so paths and merged tags are guaranteed correct here.
    for path, operations in request.app.openapi().get("paths", {}).items():
        if not path.startswith("/api/v1/"):
            continue
        for operation in operations.values():
            for tag in operation.get("tags", []):
                if tag in {"Authentication", "Users"}:
                    continue
                name = str(tag)
                configured = registry.get(name)
                configured_status = (
                    str(configured.get("status", "")).lower() if configured else ""
                )
                discovered[name] = {
                    "id": str(configured.get("id", name.lower().replace(" ", "-")))
                    if configured
                    else name.lower().replace(" ", "-"),
                    "name": name,
                    "status": "Not Built"
                    if configured_status in {"not built", "not_built"}
                    else "Online",
                    "available": configured_status not in {"not built", "not_built"},
                    "route": path,
                }

    # Retain a deliberately configured not-built module even when no route exists yet.
    for name, configured in registry.items():
        if (
            str(configured.get("status", "")).lower() in {"not built", "not_built"}
            and name not in discovered
        ):
            discovered[name] = {
                "id": str(configured["id"]),
                "name": name,
                "status": "Not Built",
                "available": False,
                "route": None,
            }
    modules = sorted(discovered.values(), key=lambda module: module["name"])

    return {
        "success": True,
        "data": modules,
        "message": "System modules fetched.",
        "meta": {"total": len(modules)},
    }


@router.get("/regions")
async def get_regional_footprint(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Aggregate the regional footprint from project records over all Zimbabwe provinces."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []
    projects = await _rows(
        db,
        """
        SELECT p.id, p.name, p.status,
               pp.latitude::float AS latitude, pp.longitude::float AS longitude,
               'project' AS source_type,
               COALESCE(NULLIF(pp.region, ''), NULLIF(pp.province, ''), NULLIF(pp.site_location, ''),
                        NULLIF(to_jsonb(p)->>'region', ''), NULLIF(to_jsonb(p)->>'province', ''),
                        NULLIF(to_jsonb(p)->>'location', ''), NULLIF(to_jsonb(p)->>'site_location', ''),
                        'Unassigned') AS region
        FROM projects.projects p
        LEFT JOIN projects.project_profiles pp ON pp.project_id = p.id AND pp.organization_id = p.organization_id
        WHERE p.organization_id = :org_id AND p.is_deleted = false
    """,
        {"org_id": org_id},
        source="regional_projects",
        source_errors=source_errors,
    )
    opportunities = await _rows(
        db,
        """
        SELECT o.id, o.name, o.stage AS status,
               o.latitude::float AS latitude, o.longitude::float AS longitude,
               'opportunity' AS source_type,
               COALESCE(NULLIF(o.region, ''), 'Unassigned') AS region
        FROM crm.opportunities o
        WHERE o.organization_id = :org_id AND o.is_deleted = false
          AND (o.region IS NOT NULL OR (o.latitude IS NOT NULL AND o.longitude IS NOT NULL))
    """,
        {"org_id": org_id},
        source="regional_crm_opportunities",
        source_errors=source_errors,
    )
    tenders = await _rows(
        db,
        """
        SELECT t.id, t.tender_name AS name, t.stage AS status,
               t.latitude::float AS latitude, t.longitude::float AS longitude,
               'tender' AS source_type,
               COALESCE(NULLIF(t.region, ''), 'Unassigned') AS region
        FROM crm.tenders t
        WHERE t.organization_id = :org_id AND t.is_deleted = false
          AND (t.region IS NOT NULL OR (t.latitude IS NOT NULL AND t.longitude IS NOT NULL))
    """,
        {"org_id": org_id},
        source="regional_crm_tenders",
        source_errors=source_errors,
    )

    grouped: Dict[str, Dict[str, Any]] = {
        region["name"]: {
            "name": region["name"],
            "projects": [],
            "crm_records": [],
            "active_projects": 0,
            "latitude": region["latitude"],
            "longitude": region["longitude"],
            "is_seeded_region": True,
        }
        for region in ZIMBABWE_REGIONS
    }
    for record in [*projects, *opportunities, *tenders]:
        region = record.pop("region") or "Unassigned"
        bucket = grouped.setdefault(
            region,
            {
                "name": region,
                "projects": [],
                "crm_records": [],
                "active_projects": 0,
                "latitude": None,
                "longitude": None,
                "is_seeded_region": False,
            },
        )
        if bucket["latitude"] is None and record.get("latitude") is not None:
            bucket["latitude"] = record.get("latitude")
            bucket["longitude"] = record.get("longitude")
        if record.get("source_type") == "project":
            bucket["projects"].append(record)
        else:
            bucket["crm_records"].append(record)
        if (
            record.get("source_type") == "project"
            and str(record.get("status", "")).lower() not in PROJECT_TERMINAL_STATUSES
        ):
            bucket["active_projects"] += 1

    return {
        "success": True,
        "data": sorted(grouped.values(), key=lambda item: str(item["name"])),
        "message": "Regional footprint fetched.",
        "meta": {"total": len(grouped), "source_errors": source_errors},
    }


@router.get("/projects/active")
async def get_active_projects(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    source_errors: List[Dict[str, Any]] = []
    items = await _rows(
        db,
        """
        SELECT to_jsonb(p) AS project
        FROM projects.projects p
        WHERE organization_id = :org_id AND is_deleted = false
          AND lower(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'closed', 'complete', 'completed', 'archived', 'lost')
        ORDER BY updated_at DESC
    """,
        {"org_id": user["org_id"]},
        source="active_projects",
        source_errors=source_errors,
    )
    return {
        "success": True,
        "data": [item["project"] for item in items],
        "message": "Active projects fetched.",
        "meta": {"total": len(items), "source_errors": source_errors},
    }


@router.get("/projects/{project_id}/detail")
async def get_project_detail(
    project_id: str,
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    params = {"org_id": user["org_id"], "project_ref": project_id}
    source_errors: List[Dict[str, Any]] = []
    project_rows = await _rows(
        db,
        """
        SELECT to_jsonb(p) AS project FROM projects.projects p
        WHERE organization_id = :org_id AND is_deleted = false
          AND (
            id::text = :project_ref
            OR project_code = :project_ref
            OR to_jsonb(p)->>'project_code' = :project_ref
            OR to_jsonb(p)->>'slug' = :project_ref
            OR lower(name) = lower(:project_ref)
            OR lower(COALESCE(to_jsonb(p)->>'title', '')) = lower(:project_ref)
          )
    """,
        params,
        source="project_detail.project",
        source_errors=source_errors,
    )
    if not project_rows:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Project not found")
    params["project_id"] = project_rows[0]["project"]["id"]

    # Each query is isolated because older ERP deployments may not yet have every relationship.
    related = {
        "viability": await _rows(
            db,
            "SELECT to_jsonb(pp) || jsonb_build_object('delivery_manager', u.email) AS item FROM projects.project_profiles pp LEFT JOIN core.users u ON u.id = pp.delivery_manager_id WHERE pp.project_id = :project_id AND pp.organization_id = :org_id",
            params,
            source="project_detail.viability",
            source_errors=source_errors,
        ),
        "tests_and_checks": await _rows(
            db,
            "SELECT to_jsonb(pc) AS item FROM projects.project_checks pc WHERE pc.project_id = :project_id AND pc.organization_id = :org_id ORDER BY pc.completed_at DESC NULLS LAST",
            params,
            source="project_detail.tests_and_checks",
            source_errors=source_errors,
        ),
        "site_reports": await _rows(
            db,
            """
            SELECT to_jsonb(r) AS item
            FROM projects.daily_site_reports r
            WHERE r.project_id = :project_id
              AND r.organization_id = :org_id
              AND r.is_deleted = false
            ORDER BY r.report_date DESC, r.updated_at DESC
            LIMIT 50
        """,
            params,
            source="project_detail.site_reports",
            source_errors=source_errors,
        ),
        "material_records": await _rows(
            db,
            """
            SELECT to_jsonb(m)
                || jsonb_build_object(
                    'report_date', r.report_date,
                    'report_status', r.status,
                    'item_name', i.item_name,
                    'item_code', COALESCE(to_jsonb(i)->>'item_code', to_jsonb(i)->>'sku', to_jsonb(i)->>'code'),
                    'unit_of_measure', COALESCE(to_jsonb(i)->>'unit_of_measure', to_jsonb(i)->>'uom'),
                    'store_name', s.name
                ) AS item
            FROM projects.daily_report_materials m
            JOIN projects.daily_site_reports r
              ON r.id = m.report_id
             AND r.organization_id = m.organization_id
             AND r.is_deleted = false
            LEFT JOIN procurement.inventory_items i
              ON i.id = m.item_id
             AND i.organization_id = m.organization_id
            LEFT JOIN procurement.stores s
              ON s.id = m.store_id
             AND s.organization_id = m.organization_id
            WHERE r.project_id = :project_id
              AND m.organization_id = :org_id
              AND m.is_deleted = false
            ORDER BY r.report_date DESC, m.created_at DESC
            LIMIT 100
        """,
            params,
            source="project_detail.material_records",
            source_errors=source_errors,
        ),
        "quotations": await _rows(
            db,
            "SELECT to_jsonb(q) AS item FROM finance.quotations q WHERE q.organization_id = :org_id AND q.is_deleted = false AND COALESCE(to_jsonb(q)->>'project_id', '') = :project_id",
            params,
            source="project_detail.quotations",
            source_errors=source_errors,
        ),
        "procurement_orders": await _rows(
            db,
            "SELECT to_jsonb(o) AS item FROM procurement.purchase_orders o WHERE o.organization_id = :org_id AND o.is_deleted = false AND COALESCE(to_jsonb(o)->>'project_id', '') = :project_id",
            params,
            source="project_detail.procurement_orders",
            source_errors=source_errors,
        ),
        "tenders": await _rows(
            db,
            "SELECT to_jsonb(t) AS item FROM crm.tenders t WHERE t.organization_id = :org_id AND t.is_deleted = false AND COALESCE(to_jsonb(t)->>'project_id', '') = :project_id",
            params,
            source="project_detail.tenders",
            source_errors=source_errors,
        ),
        "subcontractors": await _rows(
            db,
            "SELECT to_jsonb(c) AS item FROM crm.contacts c WHERE c.organization_id = :org_id AND c.is_deleted = false AND COALESCE(to_jsonb(c)->>'project_id', '') = :project_id",
            params,
            source="project_detail.subcontractors",
            source_errors=source_errors,
        ),
    }
    return {
        "success": True,
        "data": {
            "project": project_rows[0]["project"],
            **{key: [row["item"] for row in values] for key, values in related.items()},
        },
        "message": "Project executive detail fetched.",
        "meta": {"source_errors": source_errors},
    }


async def _stat_scalar(db: AsyncSession, query_sql: str, params: Dict[str, Any], *, source: str, source_errors: List[Dict[str, Any]]):
    """A genuine COUNT/SUM of 0 and a failed query must never look the
    same to the caller - returns the query's real scalar (0 kept as a
    true result) on success, or None (plus a source_errors entry, same
    shape _rows() already uses elsewhere in this file) if the query
    itself failed. Every /stats field used to collapse both cases to a
    hardcoded 0 with no record anywhere that a query had failed."""
    try:
        result = await db.execute(text(query_sql), params)
        return result.scalar() or 0
    except Exception as exc:
        await db.rollback()
        source_errors.append({"source": source, "status": "degraded", "reason": exc.__class__.__name__})
        return None


@router.get("/stats")
async def get_executive_stats(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Fetch live counts across different schemas to populate the Operational Intelligence card.

    Every field here used to fall back to a hardcoded 0 (or "$0.00") on
    any query failure, indistinguishable from a genuine real zero, with
    no error recorded anywhere - the canonical AEGIS truth-rule violation
    ("Outstanding Debtors: $0" when the real answer is unknown, not
    zero). Each field is now None on failure instead, which the frontend's
    existing displayValue() already renders as "Not recorded" rather than
    a fake zero, and every failure is now recorded in meta.source_errors
    like every other endpoint in this file."""
    org_id = user.get("org_id") or "00000000-0000-0000-0000-000000000001"
    source_errors: List[Dict[str, Any]] = []
    params = {"org_id": org_id}

    projects_count = await _stat_scalar(
        db, f"SELECT COUNT(*) FROM projects.projects p WHERE p.organization_id = :org_id AND p.is_deleted = false AND {PROJECT_OPEN_STATUS_SQL}",
        params, source="projects.projects", source_errors=source_errors
    )
    machinery_count = await _stat_scalar(
        db, "SELECT COUNT(*) FROM fleet.fleet WHERE organization_id = :org_id AND is_deleted = false",
        params, source="fleet.fleet", source_errors=source_errors
    )
    workforce_count = await _stat_scalar(
        db, "SELECT COUNT(*) FROM hr.employees WHERE organization_id = :org_id AND is_deleted = false",
        params, source="hr.employees", source_errors=source_errors
    )
    orders_count = await _stat_scalar(
        db, "SELECT COUNT(*) FROM procurement.purchase_orders WHERE organization_id = :org_id AND is_deleted = false",
        params, source="procurement.purchase_orders", source_errors=source_errors
    )
    inventory_value = await _stat_scalar(
        db,
        """
            SELECT COALESCE(SUM(sl.quantity * COALESCE(sl.unit_cost, i.standard_cost, 0)), 0)
            FROM procurement.stock_ledger sl
            JOIN procurement.inventory_items i
              ON i.id = sl.item_id AND i.organization_id = sl.organization_id AND i.is_deleted = false
            WHERE sl.organization_id = :org_id
        """,
        params, source="procurement.stock_ledger", source_errors=source_errors
    )
    incidents_count = await _stat_scalar(
        db, "SELECT COUNT(*) FROM projects.hse_incidents WHERE organization_id = :org_id AND is_deleted = false",
        params, source="projects.hse_incidents", source_errors=source_errors
    )

    # CRM open pipeline (deal count + value, excluding won/lost) - a shared
    # query, so both derived fields become None together on failure rather
    # than one silently staying a stale/fake 0 while the other is flagged.
    try:
        pipeline_query = text(
            """
            SELECT
                COUNT(*) AS open_deal_count,
                COALESCE(SUM(COALESCE(deal_value, budget)), 0) AS open_pipeline_value
            FROM crm.opportunities
            WHERE organization_id = :org_id AND is_deleted = false
              AND stage NOT IN ('Contract', 'Lost')
            """
        )
        pipeline_res = (await db.execute(pipeline_query, params)).one()
        open_deal_count = pipeline_res.open_deal_count or 0
        open_pipeline_value = float(pipeline_res.open_pipeline_value or 0)
    except Exception as exc:
        await db.rollback()
        source_errors.append({"source": "crm.opportunities", "status": "degraded", "reason": exc.__class__.__name__})
        open_deal_count = None
        open_pipeline_value = None

    open_leads_count = await _stat_scalar(
        db, "SELECT COUNT(*) FROM crm.leads WHERE organization_id = :org_id AND is_deleted = false AND status NOT IN ('converted', 'disqualified')",
        params, source="crm.leads", source_errors=source_errors
    )
    recent_activity_last_7_days = await _stat_scalar(
        db, "SELECT COUNT(*) FROM crm.activities WHERE organization_id = :org_id AND activity_date >= NOW() - INTERVAL '7 days'",
        params, source="crm.activities", source_errors=source_errors
    )

    # Plant & Equipment lifecycle control spine - one shared query, so all
    # 5 derived fields become None together on failure.
    try:
        plant_query = text(
            """
            SELECT
                COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled','rejected')) AS open_requests,
                COUNT(*) FILTER (WHERE status IN ('approved','reserved','ready_for_dispatch')) AS dispatch_queue,
                COUNT(*) FILTER (WHERE status IN ('dispatched','active')) AS active_deployments,
                COUNT(*) FILTER (WHERE status IN ('off_hire_requested','returned','under_reconciliation')) AS closure_queue,
                COALESCE(SUM(contribution_margin) FILTER (WHERE status NOT IN ('cancelled','rejected')), 0) AS contribution_margin
            FROM fleet.plant_requests
            WHERE organization_id = :org_id AND is_deleted = false
            """
        )
        plant_res = (await db.execute(plant_query, params)).one()
        plant_open_requests = plant_res.open_requests or 0
        plant_dispatch_queue = plant_res.dispatch_queue or 0
        plant_active_deployments = plant_res.active_deployments or 0
        plant_closure_queue = plant_res.closure_queue or 0
        plant_contribution_margin = float(plant_res.contribution_margin or 0)
    except Exception as exc:
        await db.rollback()
        source_errors.append({"source": "fleet.plant_requests", "status": "degraded", "reason": exc.__class__.__name__})
        plant_open_requests = None
        plant_dispatch_queue = None
        plant_active_deployments = None
        plant_closure_queue = None
        plant_contribution_margin = None

    plant_serious_incidents = await _stat_scalar(
        db,
        "SELECT COUNT(*) FROM fleet.plant_incidents WHERE organization_id = :org_id AND is_deleted = false AND status NOT IN ('closed','cancelled') AND severity IN ('high','critical')",
        params, source="fleet.plant_incidents", source_errors=source_errors
    )

    return {
        "success": True,
        "data": {
            "live_projects": projects_count,
            "deployed_machinery": machinery_count,
            "active_workforce": workforce_count,
            "open_purchase_orders": orders_count,
            "materials_in_stock": f"${inventory_value:,.2f}" if inventory_value is not None else None,
            "safety_incidents": incidents_count,
            "open_deals": open_deal_count,
            "open_pipeline_value": f"${open_pipeline_value:,.2f}" if open_pipeline_value is not None else None,
            "open_leads": open_leads_count,
            "recent_activity_last_7_days": recent_activity_last_7_days,
            "plant_open_requests": plant_open_requests,
            "plant_dispatch_queue": plant_dispatch_queue,
            "plant_active_deployments": plant_active_deployments,
            "plant_closure_queue": plant_closure_queue,
            "plant_serious_incidents": plant_serious_incidents,
            "plant_contribution_margin": f"${plant_contribution_margin:,.2f}" if plant_contribution_margin is not None else None,
        },
        "message": "Executive stats fetched." if not source_errors else "Executive stats fetched with some sources degraded.",
        "meta": {"source_errors": source_errors},
    }


async def _source_health(
    db: AsyncSession, org_id: str, name: str, relation: str
) -> Dict[str, Any]:
    """Report source state without treating an unavailable relation as a zero."""
    source_config = EXECUTIVE_HEALTH_SOURCES[relation]
    updated_column = source_config["updated_column"]
    deleted_filter = source_config["deleted_filter"]
    deletion_clause = f" AND {deleted_filter}" if deleted_filter else ""
    try:
        result = await db.execute(
            text(
                f"""
                SELECT COUNT(*) AS record_count, MAX({updated_column}) AS last_updated
                FROM {relation}
                WHERE organization_id = :org_id{deletion_clause}
                """
            ),
            {"org_id": org_id},
        )
        row = result.one()
        last_updated = row.last_updated
        if not row.record_count:
            status = "no_data"
        elif last_updated and (
            last_updated.tzinfo is None
            or last_updated >= datetime.now(last_updated.tzinfo) - timedelta(days=7)
        ):
            status = "current"
        else:
            status = "stale"
        return {
            "source": name,
            "status": status,
            "record_count": row.record_count,
            "last_updated": last_updated,
        }
    except Exception:
        # A failed statement leaves the session's transaction aborted;
        # without a rollback every source checked after this one in the
        # same request would also raise and be misreported as unavailable.
        await db.rollback()
        return {
            "source": name,
            "status": "unavailable",
            "record_count": None,
            "last_updated": None,
        }


def _executive_health_status_label(status: str) -> str:
    if status == "stale":
        return "needs recent records"
    if status == "unavailable":
        return "is unavailable"
    return status.replace("_", " ")


def _is_executive_health_attention_issue(source: Dict[str, Any]) -> bool:
    status = str(source.get("status") or "").lower()
    name = str(source.get("source") or "").lower()
    if status in {"current", "no_data"}:
        return False
    if name == "finance costs" and status == "stale":
        return False
    return True


async def _emit_executive_data_health_notification(
    db: AsyncSession, org_id: str, sources: List[Dict[str, Any]]
) -> None:
    issues = [source for source in sources if _is_executive_health_attention_issue(source)]
    if not issues:
        return

    issue_keys = sorted(
        f"{source.get('source')}:{str(source.get('status') or '').lower()}"
        for source in issues
    )
    fingerprint = f"executive-data-health:{'|'.join(issue_keys)}"
    existing = await db.execute(
        text(
            """
            SELECT 1
            FROM core.notifications
            WHERE organization_id = :org_id
              AND notification_type = :notification_type
              AND metadata ->> 'fingerprint' = :fingerprint
              AND created_at >= NOW() - INTERVAL '24 hours'
            LIMIT 1
            """
        ),
        {
            "org_id": org_id,
            "notification_type": EXECUTIVE_DATA_HEALTH_NOTIFICATION_TYPE,
            "fingerprint": fingerprint,
        },
    )
    if existing.first():
        return

    message = " · ".join(
        f"{source.get('source')} {_executive_health_status_label(str(source.get('status') or '').lower())}"
        for source in issues
    )
    await emit_role_notification(
        db,
        org_id=org_id,
        role_names=EXECUTIVE_DATA_HEALTH_ALERT_ROLES,
        title="Executive data needs attention",
        message=message,
        notification_type=EXECUTIVE_DATA_HEALTH_NOTIFICATION_TYPE,
        priority="normal",
        action_url="/dashboard/executive",
        metadata={
            "fingerprint": fingerprint,
            "sources": [
                {
                    "source": source.get("source"),
                    "status": source.get("status"),
                    "record_count": source.get("record_count"),
                    "last_updated": source.get("last_updated"),
                }
                for source in issues
            ],
        },
    )
    await db.commit()


@router.get("/data-health")
async def get_executive_data_health(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Data confidence for the sources used by the command centre."""
    org_id = user["org_id"]
    sources = [
        _source_health(db, org_id, "Projects", "projects.projects"),
        _source_health(db, org_id, "Project Profiles", "projects.project_profiles"),
        _source_health(db, org_id, "Site Reports", "projects.daily_site_reports"),
        _source_health(db, org_id, "HSE", "projects.hse_incidents"),
        _source_health(db, org_id, "CRM Leads", "crm.leads"),
        _source_health(db, org_id, "CRM Deals", "crm.opportunities"),
        _source_health(db, org_id, "CRM Tenders", "crm.tenders"),
        _source_health(db, org_id, "CRM Activity", "crm.activities"),
        _source_health(db, org_id, "Finance Quotes", "finance.quotations"),
        _source_health(db, org_id, "Finance Progress Claims", "finance.progress_claims"),
        _source_health(db, org_id, "Finance Costs", "finance.cost_transactions"),
        _source_health(db, org_id, "Finance Forecasts", "finance.project_forecasts"),
        _source_health(db, org_id, "Procurement Orders", "procurement.purchase_orders"),
        _source_health(db, org_id, "Suppliers", "procurement.suppliers"),
        _source_health(db, org_id, "Inventory", "procurement.inventory_items"),
        _source_health(db, org_id, "Workforce", "hr.employees"),
        _source_health(db, org_id, "Fleet", "fleet.fleet"),
        _source_health(db, org_id, "Plant Requests", "fleet.plant_requests"),
        _source_health(db, org_id, "Plant Incidents", "fleet.plant_incidents"),
        _source_health(db, org_id, "Compliance", "core.compliance_items"),
    ]
    sources = [await source for source in sources]
    try:
        await _emit_executive_data_health_notification(db, org_id, sources)
    except Exception as exc:
        await db.rollback()
        logger.warning(
            "executive_data_health_notification_failed",
            error_type=exc.__class__.__name__,
        )
    return {
        "success": True,
        "data": sources,
        "message": "Executive data health fetched.",
        "meta": {},
    }


@router.get("/exceptions")
async def get_executive_exceptions(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """A deliberately small, source-backed list of conditions needing executive attention."""
    params = {"org_id": user["org_id"]}
    source_errors: List[Dict[str, Any]] = []
    incidents = await _rows(
        db,
        """
        SELECT id, severity, incident_date, 'HSE incident' AS category,
               'Review high-severity incident' AS action
        FROM projects.hse_incidents
        WHERE organization_id = :org_id AND is_deleted = false
          AND lower(COALESCE(severity, '')) IN ('high', 'critical')
        ORDER BY incident_date DESC NULLS LAST LIMIT 20
    """,
        params,
        source="exceptions.hse_incidents",
        source_errors=source_errors,
    )
    compliance = await _rows(
        db,
        """
        SELECT id, certificate_name AS title, expiry_date, 'Compliance expiry' AS category,
               'Renew or resolve certificate' AS action
        FROM core.compliance_items
        WHERE organization_id = :org_id AND is_deleted = false
          AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY expiry_date ASC LIMIT 20
    """,
        params,
        source="exceptions.compliance_items",
        source_errors=source_errors,
    )
    viability = await _rows(
        db,
        """
        SELECT pp.project_id AS id, p.name AS title, pp.viability_status, 'Project viability' AS category,
               'Review delivery and commercial recovery plan' AS action
        FROM projects.project_profiles pp
        JOIN projects.projects p ON p.id = pp.project_id AND p.organization_id = pp.organization_id
        WHERE pp.organization_id = :org_id AND p.is_deleted = false
          AND lower(COALESCE(pp.viability_status, '')) IN ('at risk', 'blocked', 'critical')
        ORDER BY pp.updated_at DESC LIMIT 20
    """,
        params,
        source="exceptions.project_profiles",
        source_errors=source_errors,
    )
    finance_risk = await _rows(
        db,
        """
        SELECT f.project_id AS id, p.name AS title,
               CASE
                 WHEN f.cost_overrun_risk AND f.cashflow_deficit_risk THEN 'critical'
                 WHEN f.cost_overrun_risk OR f.cashflow_deficit_risk THEN 'warning'
                 ELSE 'info'
               END AS severity,
               'Financial forecast' AS category,
               CASE
                 WHEN f.cost_overrun_risk AND f.cashflow_deficit_risk THEN 'Review recovery plan: cost overrun and cash-flow deficit risks are both active'
                 WHEN f.cost_overrun_risk THEN 'Review forecast-to-complete and cost recovery plan'
                 WHEN f.cashflow_deficit_risk THEN 'Review near-term cash requirement and collection plan'
                 ELSE 'Review financial forecast'
               END AS action,
               f.as_at_date AS evidence_date,
               jsonb_build_object(
                 'forecast_margin_pct', f.forecast_margin_pct,
                 'estimate_at_completion', f.estimate_at_completion,
                 'approved_budget', f.approved_budget,
                 'committed_cost', f.committed_cost,
                 'actual_cost_to_date', f.actual_cost_to_date
               ) AS evidence
        FROM finance.project_forecasts f
        JOIN projects.projects p ON p.id=f.project_id AND p.organization_id=f.organization_id
        WHERE f.organization_id=:org_id AND p.is_deleted=false
          AND (f.cost_overrun_risk = true OR f.cashflow_deficit_risk = true OR COALESCE(f.forecast_margin_pct, 1) < 0.12)
        ORDER BY f.as_at_date DESC LIMIT 20
    """,
        params,
        source="exceptions.project_forecasts",
        source_errors=source_errors,
    )
    supplier_risk = await _rows(
        db,
        """
        SELECT s.id, COALESCE(s.trading_name, to_jsonb(s)->>'supplier_name', to_jsonb(s)->>'name', s.id::text) AS title,
               CASE WHEN COALESCE(s.on_time_delivery_pct, 100) < 70 THEN 'critical' ELSE 'warning' END AS severity,
               'Supplier performance' AS category,
               'Review supplier delivery performance and procurement mitigation plan' AS action,
               jsonb_build_object('on_time_delivery_pct', s.on_time_delivery_pct, 'performance_score', s.performance_score, 'compliance_status', s.compliance_status) AS evidence
        FROM procurement.suppliers s
        WHERE s.organization_id=:org_id AND COALESCE(s.is_deleted, false)=false
          AND (COALESCE(s.on_time_delivery_pct, 100) < 85 OR lower(COALESCE(s.compliance_status, '')) = 'non_compliant')
        ORDER BY COALESCE(s.on_time_delivery_pct, 100) ASC NULLS LAST LIMIT 20
    """,
        params,
        source="exceptions.suppliers",
        source_errors=source_errors,
    )
    equipment_risk = await _rows(
        db,
        """
        SELECT f.id, COALESCE(to_jsonb(f)->>'asset_name', to_jsonb(f)->>'name', to_jsonb(f)->>'registration_number', to_jsonb(f)->>'asset_code', f.id::text) AS title,
               'warning' AS severity,
               'Equipment utilisation' AS category,
               'Review asset deployment: assigned equipment has no recent utilisation record' AS action,
               jsonb_build_object('current_project_id', f.current_project_id, 'monthly_ownership_cost', f.monthly_ownership_cost) AS evidence
        FROM fleet.fleet f
        WHERE f.organization_id=:org_id AND f.is_deleted=false AND f.current_project_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM fleet.utilization_logs u
            WHERE u.fleet_id=f.id AND u.organization_id=f.organization_id AND u.is_deleted=false
              AND u.occurred_on >= CURRENT_DATE - INTERVAL '7 days'
        )
        ORDER BY f.updated_at DESC NULLS LAST LIMIT 20
    """,
        params,
        source="exceptions.equipment_utilisation",
        source_errors=source_errors,
    )
    plant_request_risk = await _rows(
        db,
        """
        SELECT pr.id,
               pr.request_number || ' - ' || pr.required_asset_type AS title,
               CASE WHEN pr.risk_level='critical' OR pr.priority='emergency' THEN 'critical' ELSE 'warning' END AS severity,
               'Plant request control' AS category,
               CASE
                 WHEN pr.status IN ('submitted','under_validation','returned_for_correction') THEN 'Validate Plant request before any asset leaves the yard'
                 WHEN pr.status IN ('availability_check','awaiting_cost_review','awaiting_risk_review','awaiting_approval') THEN 'Complete availability, cost, risk and approval controls'
                 WHEN pr.status IN ('off_hire_requested','returned','under_reconciliation') THEN 'Complete off-hire return and financial reconciliation'
                 ELSE 'Review Plant request control state'
               END AS action,
               pr.start_date AS evidence_date,
               jsonb_build_object(
                 'status', pr.status,
                 'request_type', pr.request_type,
                 'priority', pr.priority,
                 'risk_level', pr.risk_level,
                 'work_location', pr.work_location,
                 'expected_revenue', pr.expected_revenue,
                 'estimated_cost', pr.estimated_cost,
                 'contribution_margin', pr.contribution_margin
               ) AS evidence
        FROM fleet.plant_requests pr
        WHERE pr.organization_id=:org_id AND pr.is_deleted=false
          AND pr.status NOT IN ('closed','cancelled','rejected')
          AND (
            pr.priority IN ('urgent','emergency')
            OR pr.risk_level IN ('high','critical')
            OR pr.status IN ('off_hire_requested','returned','under_reconciliation')
          )
        ORDER BY
          CASE WHEN pr.risk_level='critical' OR pr.priority='emergency' THEN 0 ELSE 1 END,
          pr.updated_at DESC
        LIMIT 20
    """,
        params,
        source="exceptions.plant_requests",
        source_errors=source_errors,
    )
    plant_incident_risk = await _rows(
        db,
        """
        SELECT pi.id,
               COALESCE(f.asset_code, f.vehicle_registration, pi.fleet_id::text) AS title,
               CASE WHEN pi.severity='critical' THEN 'critical' ELSE 'warning' END AS severity,
               'Plant incident' AS category,
               CASE
                 WHEN pi.work_order_id IS NULL AND pi.incident_type='breakdown' THEN 'Open and track maintenance work order for plant breakdown'
                 WHEN pi.escalation_required THEN 'Escalate Plant incident to Risk/HSE/executive review'
                 ELSE 'Review open Plant incident'
               END AS action,
               pi.occurred_at AS evidence_date,
               jsonb_build_object(
                 'incident_type', pi.incident_type,
                 'severity', pi.severity,
                 'status', pi.status,
                 'plant_request_id', pi.plant_request_id,
                 'work_order_id', pi.work_order_id,
                 'location', pi.location
               ) AS evidence
        FROM fleet.plant_incidents pi
        JOIN fleet.fleet f ON f.id=pi.fleet_id AND f.organization_id=pi.organization_id
        WHERE pi.organization_id=:org_id AND pi.is_deleted=false
          AND pi.status NOT IN ('closed','cancelled')
          AND (pi.severity IN ('high','critical') OR pi.escalation_required=true)
        ORDER BY pi.occurred_at DESC
        LIMIT 20
    """,
        params,
        source="exceptions.plant_incidents",
        source_errors=source_errors,
    )
    site_report_risk = await _rows(
        db,
        """
        SELECT r.id,
               r.project_id,
               p.name AS title,
               r.report_date AS evidence_date,
               'Site report exception' AS category,
               CASE
                 WHEN COALESCE(r.cost_exposure, 0) > 0 THEN 'Review approved site report cost exposure'
                 WHEN NULLIF(TRIM(COALESCE(r.delays, '')), '') IS NOT NULL THEN 'Review approved site report delay'
                 WHEN NULLIF(TRIM(COALESCE(r.safety_notes, '')), '') IS NOT NULL THEN 'Review approved site report safety note'
                 ELSE 'Review approved site report operational variance'
               END AS action,
               jsonb_build_object(
                 'daily_site_report_id', r.id,
                 'report_date', r.report_date,
                 'cost_exposure', r.cost_exposure,
                 'delays', r.delays,
                 'safety_notes', r.safety_notes,
                 'labour_lines', COALESCE(lines.labour_lines, 0),
                 'equipment_lines', COALESCE(lines.equipment_lines, 0),
                 'material_lines', COALESCE(lines.material_lines, 0),
                 'material_wastage', COALESCE(lines.material_wastage, 0)
               ) AS evidence
        FROM projects.daily_site_reports r
        JOIN projects.projects p
          ON p.id = r.project_id
         AND p.organization_id = r.organization_id
         AND p.is_deleted = false
        LEFT JOIN LATERAL (
          SELECT
            (SELECT COUNT(*) FROM projects.daily_report_labour l WHERE l.organization_id=r.organization_id AND l.report_id=r.id AND l.is_deleted=false) AS labour_lines,
            (SELECT COUNT(*) FROM projects.daily_report_equipment e WHERE e.organization_id=r.organization_id AND e.report_id=r.id AND e.is_deleted=false) AS equipment_lines,
            (SELECT COUNT(*) FROM projects.daily_report_materials m WHERE m.organization_id=r.organization_id AND m.report_id=r.id AND m.is_deleted=false) AS material_lines,
            (SELECT COALESCE(SUM(m.wastage_quantity), 0) FROM projects.daily_report_materials m WHERE m.organization_id=r.organization_id AND m.report_id=r.id AND m.is_deleted=false) AS material_wastage
        ) lines ON true
        WHERE r.organization_id=:org_id
          AND r.is_deleted=false
          AND r.status='approved'
          AND (
            COALESCE(r.cost_exposure, 0) > 0
            OR NULLIF(TRIM(COALESCE(r.delays, '')), '') IS NOT NULL
            OR NULLIF(TRIM(COALESCE(r.safety_notes, '')), '') IS NOT NULL
            OR COALESCE(lines.material_wastage, 0) > 0
          )
        ORDER BY r.report_date DESC, r.approved_at DESC NULLS LAST
        LIMIT 20
    """,
        params,
        source="exceptions.site_reports",
        source_errors=source_errors,
    )
    site_variance_risk = await _rows(
        db,
        """
        SELECT v.id,
               v.project_id,
               COALESCE(v.variation_number || ' - ' || v.title, v.id::text) AS title,
               CASE
                 WHEN v.proceed_at_risk THEN 'critical'
                 WHEN v.execution_blocked THEN 'warning'
                 ELSE 'info'
               END AS severity,
               'Site variance gate' AS category,
               CASE
                 WHEN v.proceed_at_risk THEN 'Monitor proceed-at-risk work until formal written authority is attached'
                 WHEN v.execution_blocked THEN 'Clear QS/client/internal approval before released execution or procurement'
                 WHEN v.qs_review_status != 'reviewed' THEN 'Complete QS entitlement and pricing review'
                 ELSE 'Review unresolved site-originated variance'
               END AS action,
               COALESCE(v.formal_approval_deadline, v.submitted_at::date, v.created_at::date) AS evidence_date,
               jsonb_build_object(
                 'variation_number', v.variation_number,
                 'classification', v.variance_classification,
                 'approval_route', v.approval_route,
                 'qs_review_status', v.qs_review_status,
                 'client_approval_status', v.client_approval_status,
                 'proceed_at_risk', v.proceed_at_risk,
                 'execution_blocked', v.execution_blocked,
                 'formal_approval_deadline', v.formal_approval_deadline,
                 'cost_impact', v.cost_impact,
                 'time_impact_days', v.time_impact_days
               ) AS evidence
        FROM finance.variations v
        WHERE v.organization_id=:org_id
          AND v.is_deleted=false
          AND v.source_type='weekly_budget_item'
          AND (
            v.status NOT IN ('approved','rejected','cancelled')
            OR v.proceed_at_risk=true
            OR v.execution_blocked=true
          )
        ORDER BY
          CASE WHEN v.proceed_at_risk THEN 0 WHEN v.execution_blocked THEN 1 ELSE 2 END,
          v.updated_at DESC NULLS LAST
        LIMIT 30
    """,
        params,
        source="exceptions.site_variance_gates",
        source_errors=source_errors,
    )
    blocked_material_risk = await _rows(
        db,
        """
        SELECT mr.id,
               mr.project_id,
               mr.request_number || ' - ' || COALESCE(i.item_name, i.item_code, mr.item_id::text) AS title,
               'warning' AS severity,
               'Blocked execution item' AS category,
               'Resolve weekly allowance, variance approval, or proceed-at-risk override before stock/procurement action' AS action,
               mr.required_by_date AS evidence_date,
               jsonb_build_object(
                 'request_number', mr.request_number,
                 'requested_quantity', mr.requested_quantity,
                 'execution_gate_status', mr.execution_gate_status,
                 'engineer_review_status', mr.engineer_review_status,
                 'weekly_budget_item_id', mr.weekly_budget_item_id,
                 'variance_id', mr.variance_id
               ) AS evidence
        FROM procurement.material_requests mr
        LEFT JOIN procurement.inventory_items i ON i.id=mr.item_id AND i.organization_id=mr.organization_id
        WHERE mr.organization_id=:org_id
          AND mr.is_deleted=false
          AND mr.execution_gate_status='blocked'
        ORDER BY mr.required_by_date ASC NULLS LAST, mr.updated_at DESC NULLS LAST
        LIMIT 30
    """,
        params,
        source="exceptions.blocked_material_requests",
        source_errors=source_errors,
    )
    return {
        "success": True,
        "data": [
            *incidents,
            *compliance,
            *viability,
            *finance_risk,
            *supplier_risk,
            *equipment_risk,
            *plant_request_risk,
            *plant_incident_risk,
            *site_report_risk,
            *site_variance_risk,
            *blocked_material_risk,
        ],
        "message": "Executive exceptions fetched.",
        "meta": {
            "total": len(incidents)
            + len(compliance)
            + len(viability)
            + len(finance_risk)
            + len(supplier_risk)
            + len(equipment_risk)
            + len(plant_request_risk)
            + len(plant_incident_risk)
            + len(site_report_risk)
            + len(site_variance_risk)
            + len(blocked_material_risk),
            "source_errors": source_errors,
        },
    }


@router.get("/projects/{project_id}/schedule-risk")
async def get_project_schedule_risk(
    project_id: str,
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Calculates project schedule risk using Monte Carlo simulation on the
    project's own real milestones (projects.project_milestones). Used to
    run the identical simulation for every project in the organization off
    4 hardcoded "standard civil engineering milestones" with fixed
    durations - a Part-51 violation worse than a fallback, since it was
    the only code path and never varied by project at all.

    Each incomplete milestone becomes one Monte Carlo task with a real
    three-point duration estimate in weeks, all derived from dates already
    on the milestone record - nothing invented:
      optimistic (a)   = weeks from today to baseline_date (the original plan)
      most likely (m)  = weeks from today to forecast_date, or baseline_date
                          if no forecast has been entered
      pessimistic (b)  = m plus whatever slippage already exists between
                          baseline_date and forecast_date on that same
                          milestone (0 if the milestone is on or ahead of
                          baseline) - a real, project-specific track record,
                          not an arbitrary multiplier
    A milestone with neither date on file contributes no task (it cannot be
    estimated) and is counted separately rather than silently dropped. If
    no milestone yields a usable task at all, this returns UNKNOWN with a
    stated reason instead of falling back to fabricated data."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []

    project_rows = await _rows(
        db,
        "SELECT id, name FROM projects.projects WHERE id::text = :project_id AND organization_id = :org_id AND is_deleted = false",
        {"project_id": project_id, "org_id": org_id},
        source="projects.projects",
        source_errors=source_errors
    )
    if not project_rows:
        raise HTTPException(status_code=404, detail="Project not found")

    project = project_rows[0]

    milestone_rows = await _rows(
        db,
        """
            SELECT name, baseline_date, forecast_date
            FROM projects.project_milestones
            WHERE project_id::text = :project_id AND organization_id = :org_id
              AND is_deleted = false
              AND status NOT IN ('complete', 'cancelled')
            ORDER BY COALESCE(forecast_date, baseline_date) ASC NULLS LAST
        """,
        {"project_id": project_id, "org_id": org_id},
        source="projects.project_milestones",
        source_errors=source_errors
    )

    today = datetime.now().date()

    def _weeks_from_today(target) -> float | None:
        if not target:
            return None
        return max((target - today).days / 7.0, 0.1)

    tasks: List[Dict[str, Any]] = []
    excluded_no_dates = 0
    for row in milestone_rows:
        baseline = row["baseline_date"]
        forecast = row["forecast_date"]
        a = _weeks_from_today(baseline)
        m = _weeks_from_today(forecast) or a
        if a is None and m is None:
            excluded_no_dates += 1
            continue
        a = a if a is not None else m
        m = m if m is not None else a
        slippage_weeks = 0.0
        if baseline and forecast and forecast > baseline:
            slippage_weeks = (forecast - baseline).days / 7.0
        b = m + slippage_weeks
        tasks.append({"name": row["name"], "a": round(a, 2), "m": round(m, 2), "b": round(b, 2)})

    if not tasks:
        return {
            "success": True,
            "data": {
                "project_id": str(project["id"]),
                "project_name": project["name"],
                "truth_status": "UNKNOWN",
                "reason": (
                    f"No remaining milestone on this project has a baseline or forecast date to "
                    f"estimate from ({excluded_no_dates} incomplete milestone(s) found, none dated)."
                    if milestone_rows else
                    "No incomplete milestones are recorded for this project - schedule risk "
                    "cannot be simulated without any milestone data."
                ),
            },
            "message": "Schedule risk could not be calculated.",
            "meta": {"source_errors": source_errors}
        }

    sim_result = ml_engine.run_monte_carlo_schedule(tasks, iterations=2000)
    return {
        "success": True,
        "data": {
            "project_id": str(project["id"]),
            "project_name": project["name"],
            "truth_status": "SYSTEM_GENERATED",
            "milestones_included": len(tasks),
            "milestones_excluded_no_dates": excluded_no_dates,
            "task_basis": tasks,
            **sim_result
        },
        "message": "Monte Carlo schedule simulation executed on real project milestones.",
        "meta": {"source_errors": source_errors}
    }


@router.get("/materials/forecast-alerts")
async def get_material_forecast_alerts(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Forecasts prices for real materials in the organization's own
    procurement catalog and flags inflation trends, from real price
    observations only.

    Two separate bugs are fixed here. First, the query selected columns
    that don't exist on procurement.inventory_items (`name`, `unit_price`
    - the real columns are `item_name` and `standard_cost`/
    `unit_price_ex_vat`), so it has always thrown on every call in
    production; _rows() swallows that exception and returns [], which is
    why the fallback below fired unconditionally, for every organization,
    every time - it was never really a "fallback for short history," it
    was the only code path that ever ran. Second, once fixed to query the
    real columns, procurement.inventory_items turns out to be a one-row-
    per-SKU catalog (confirmed live: 23 real materials, each with exactly
    one price observation, ever) - there is no real price history in this
    schema yet at all, so no material can honestly be given a trend today.
    Real materials with fewer than 2 dated price points are now returned
    with truth_status="INCOMPLETE" and trend="unknown" instead of being
    replaced by 3 entirely fabricated commodities (cement/rebar/diesel
    with invented dates and prices) that used to be injected regardless of
    what the organization actually stocks."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []

    rows = await _rows(
        db,
        """
            SELECT item_name, COALESCE(standard_cost, unit_price_ex_vat, 0) as price, created_at
            FROM procurement.inventory_items
            WHERE organization_id = :org_id AND is_deleted = false
            ORDER BY item_name ASC, created_at ASC
        """,
        {"org_id": org_id},
        source="procurement.inventory_items",
        source_errors=source_errors
    )

    histories: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        histories.setdefault(r["item_name"], []).append({
            "date": str(r["created_at"].date()) if isinstance(r["created_at"], datetime) else str(r["created_at"]),
            "price": float(r["price"])
        })

    alerts: List[Dict[str, Any]] = []
    for name, history in histories.items():
        if len(history) < 2:
            alerts.append({
                "material": name,
                "current_price": history[-1]["price"],
                "trend": "unknown",
                "status": "UNKNOWN",
                "truth_status": "INCOMPLETE",
                "observations": len(history),
                "reason": f"Only {len(history)} price observation on file - a trend needs at least 2 dated price points.",
            })
            continue

        forecast_res = ml_engine.forecast_rate_trend(history, forecast_steps=3)
        if forecast_res.get("success", False):
            trend = forecast_res["trend_direction"]
            alerts.append({
                "material": name,
                "current_price": history[-1]["price"],
                "forecast_prices": forecast_res["forecast"],
                "trend": trend,
                "slope": forecast_res["slope"],
                "status": "warning" if trend == "upward" else "stable",
                "truth_status": "SYSTEM_GENERATED",
                "observations": len(history),
            })

    materials_with_trend = sum(1 for a in alerts if a.get("truth_status") == "SYSTEM_GENERATED")
    materials_incomplete = sum(1 for a in alerts if a.get("truth_status") == "INCOMPLETE")
    if materials_with_trend:
        message = f"Commodity inflation trend forecasts completed for {materials_with_trend} material(s)."
    elif materials_incomplete:
        message = (
            f"{materials_incomplete} material(s) on file, but none has enough dated price history "
            "yet to forecast a trend."
        )
    else:
        message = "No procurement catalog items are on file to forecast."

    return {
        "success": True,
        "data": alerts,
        "message": message,
        "meta": {
            "source_errors": source_errors,
            "materials_with_trend": materials_with_trend,
            "materials_incomplete_history": materials_incomplete,
        }
    }


@router.get("/approvals/pending")
async def get_pending_approvals(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Aggregates items genuinely awaiting a decision in their own
    authoritative module - purchase_orders.status='draft' is the real
    pending-approval state procurement.py's own decision endpoint checks
    (see decide_purchase_order in routers/procurement.py), not a value
    invented here. This endpoint is a read-only aggregation layer: it does
    NOT expose a decide action of its own (see removal note below) - the
    decision must be made via the module that owns the approval rule
    (self-approval / independent-approval checks live there, not here),
    so action_url always points at the real place to act.

    Two categories that used to appear here were removed rather than kept
    as fake data (AEGIS truth rule: no dummy data): quotations have no
    margin-approval field anywhere in the schema, so every quotation ever
    created showed up here forever with no way to resolve it; and expired
    compliance certificates have no override-request workflow attached to
    core.compliance_items (compliance.deployment_gate_checks has a real
    override audit trail, but for site-deployment gates, not certificate
    renewal) - that data is already surfaced honestly, as an exception
    rather than a fabricated decision, by GET /executive/exceptions.
    """
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []

    pos_res = await _rows(
        db,
        """
            SELECT id, po_number, total_amount, created_at, created_by
            FROM procurement.purchase_orders
            WHERE organization_id = :org_id AND is_deleted = false AND status = 'draft'
            ORDER BY total_amount DESC, created_at ASC
        """,
        {"org_id": org_id},
        source="procurement.purchase_orders",
        source_errors=source_errors
    )
    pending_pos = [
        {
            "id": str(r["id"]),
            "type": "purchase_order",
            "reference": r["po_number"],
            "amount": float(r["total_amount"]),
            "created_at": str(r["created_at"]),
            "reason": "Draft purchase order awaiting independent approval before it can be issued.",
            "action_url": "/dashboard/procurement?tab=purchase-orders",
            "decide_via": "POST /api/v1/procurement/purchase-orders/{id}/decision",
        }
        for r in pos_res
    ]

    return {
        "success": True,
        "data": pending_pos,
        "message": "Pending executive approval queue retrieved."
            if pending_pos else "No items currently awaiting executive-visible approval.",
        "meta": {"source_errors": source_errors}
    }


@router.get("/financial-runway")
async def get_financial_runway(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Computes rolling cash burn rate vs real cash reserves to project
    operational runway. cash_reserves is the real sum of active cash
    account balances (finance.cash_accounts.current_balance, which is
    trigger-maintained as opening_balance + posted cashbook deltas) - not
    a hardcoded constant. total_burn is the trailing-3-month average of
    real cashbook outflows when any exist.

    When no cashbook history exists yet, a payroll/fleet/procurement
    estimate is still computed and returned - but explicitly marked
    truth_status="ESTIMATED" with its assumptions spelled out in
    estimation_basis, never silently blended in as if it were the real
    figure. payroll_burn_monthly in particular used to be employee_count *
    a hardcoded $3,500 with no disclosure - that constant has no basis in
    actual payroll data, so it is now only ever surfaced under the
    ESTIMATED label. If cash reserves are unavailable (source query
    failed) or there is no burn signal of any kind (real or estimable),
    runway_months and status come back None/"UNKNOWN" rather than the old
    99.0-months sentinel, which read as a real calculated figure."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []

    cash_res = await _rows(
        db,
        "SELECT COALESCE(SUM(current_balance), 0) as total FROM finance.cash_accounts WHERE organization_id = :org_id AND is_active = true AND is_deleted = false",
        {"org_id": org_id},
        source="finance.cash_accounts",
        source_errors=source_errors
    )
    cash_unavailable = any(e["source"] == "finance.cash_accounts" for e in source_errors)
    cash_reserves = float(cash_res[0]["total"]) if cash_res else 0.0

    burn_res = await _rows(
        db,
        """
        SELECT COALESCE(SUM(amount), 0) as total
        FROM finance.cashbook_transactions
        WHERE organization_id = :org_id AND direction = 'outflow' AND is_deleted = false
          AND transaction_date >= (CURRENT_DATE - INTERVAL '90 days')
        """,
        {"org_id": org_id},
        source="finance.cashbook_transactions",
        source_errors=source_errors
    )
    real_monthly_burn = (float(burn_res[0]["total"]) / 3.0) if burn_res else 0.0

    # Outflow 1: payroll burn - ESTIMATE ONLY, not sourced from actual payroll data.
    emp_res = await _rows(
        db,
        "SELECT COUNT(*) as total FROM hr.employees WHERE organization_id = :org_id AND is_deleted = false",
        {"org_id": org_id},
        source="hr.employees",
        source_errors=source_errors
    )
    emp_count = emp_res[0]["total"] if emp_res else 0
    payroll_burn = emp_count * 3500.00

    # Outflow 2: fleet lease/ownership costs - real figure, used only inside the estimate blend.
    fleet_res = await _rows(
        db,
        "SELECT COALESCE(SUM(monthly_ownership_cost), 0) as total FROM fleet.fleet WHERE organization_id = :org_id AND is_deleted = false",
        {"org_id": org_id},
        source="fleet.fleet",
        source_errors=source_errors
    )
    fleet_burn = float(fleet_res[0]["total"]) if fleet_res else 0.0

    # Outflow 3: ESTIMATE ONLY - total historical PO value, not an actual monthly figure.
    po_res = await _rows(
        db,
        "SELECT COALESCE(SUM(total_amount), 0) as total FROM procurement.purchase_orders WHERE organization_id = :org_id AND is_deleted = false",
        {"org_id": org_id},
        source="procurement.purchase_orders",
        source_errors=source_errors
    )
    procurement_burn = float(po_res[0]["total"]) if po_res else 0.0

    estimated_burn = payroll_burn + fleet_burn + procurement_burn
    using_real_burn = real_monthly_burn > 0
    total_burn = real_monthly_burn if using_real_burn else estimated_burn

    if cash_unavailable or total_burn <= 0:
        return {
            "success": True,
            "data": {
                "total_burn_monthly": round(total_burn, 2) if total_burn > 0 else None,
                "burn_source": "cashbook_trailing_90_days" if using_real_burn else (
                    "estimated_payroll_fleet_procurement" if total_burn > 0 else None
                ),
                "payroll_burn_monthly": round(payroll_burn, 2),
                "fleet_burn_monthly": round(fleet_burn, 2),
                "procurement_burn_monthly": round(procurement_burn, 2),
                "cash_reserves": None if cash_unavailable else round(cash_reserves, 2),
                "runway_months": None,
                "status": "UNKNOWN",
                "truth_status": "UNKNOWN",
                "reason": (
                    "Cash reserves source (finance.cash_accounts) is unavailable."
                    if cash_unavailable else
                    "No cashbook outflows and no payroll/fleet/procurement activity to "
                    "estimate a burn rate from - there is nothing to project a runway from."
                ),
            },
            "message": "Financial runway could not be calculated.",
            "meta": {"source_errors": source_errors}
        }

    runway_months = cash_reserves / total_burn

    return {
        "success": True,
        "data": {
            "total_burn_monthly": round(total_burn, 2),
            "burn_source": "cashbook_trailing_90_days" if using_real_burn else "estimated_payroll_fleet_procurement",
            "payroll_burn_monthly": round(payroll_burn, 2),
            "fleet_burn_monthly": round(fleet_burn, 2),
            "procurement_burn_monthly": round(procurement_burn, 2),
            "cash_reserves": round(cash_reserves, 2),
            "runway_months": round(runway_months, 1),
            "status": "healthy" if runway_months > 6.0 else "critical",
            "truth_status": "SYSTEM_GENERATED" if using_real_burn else "ESTIMATED",
            "estimation_basis": None if using_real_burn else [
                "payroll_burn_monthly assumes $3,500/employee/month - not sourced from actual payroll runs or payslips.",
                "procurement_burn_monthly is the total historical purchase order value, not a monthly average.",
                "Used only because no real cashbook outflow history exists yet for this organization.",
            ],
        },
        "message": "Financial runway analysis complete."
            if using_real_burn else "Financial runway estimated - no real cashbook history on file yet.",
        "meta": {"source_errors": source_errors}
    }


@router.get("/hse/ltifr")
async def get_safety_index(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db)
):
    """Calculates Lost Time Injury Frequency Rate (LTIFR) from real HSE
    incident and timesheet-hours data only. Used to fall back to a
    hardcoded 85,000 man-hour "operational baseline" whenever
    hr.timesheets had no rows - silently turning an unknown denominator
    into a specific, confident-looking LTIFR number, exactly what the
    AEGIS truth rule forbids (an estimate must never be presented as a
    verified fact). Now returns ltifr=None / status="UNKNOWN" with a
    stated reason instead of fabricating a denominator, and does the same
    when either source query itself failed (a degraded source is not the
    same thing as a genuine zero)."""
    org_id = user["org_id"]
    source_errors: List[Dict[str, Any]] = []

    incidents_res = await _rows(
        db,
        """
            SELECT COUNT(*) as total FROM projects.hse_incidents
            WHERE organization_id = :org_id AND is_deleted = false
              AND lower(COALESCE(severity, '')) IN ('high', 'critical')
        """,
        {"org_id": org_id},
        source="projects.hse_incidents",
        source_errors=source_errors
    )
    incidents_unavailable = any(e["source"] == "projects.hse_incidents" for e in source_errors)
    incidents = incidents_res[0]["total"] if incidents_res else 0

    hours_res = await _rows(
        db,
        """
            SELECT COALESCE(SUM(regular_hours + overtime_hours), 0) as total
            FROM hr.timesheets
            WHERE organization_id = :org_id AND is_deleted = false
        """,
        {"org_id": org_id},
        source="hr.timesheets",
        source_errors=source_errors
    )
    hours_unavailable = any(e["source"] == "hr.timesheets" for e in source_errors)
    total_hours = float(hours_res[0]["total"]) if hours_res else 0.0

    if incidents_unavailable or hours_unavailable or total_hours <= 0:
        if incidents_unavailable:
            reason = "HSE incident source (projects.hse_incidents) is unavailable."
        elif hours_unavailable:
            reason = "Timesheet hours source (hr.timesheets) is unavailable."
        else:
            reason = (
                "No workforce hours recorded in hr.timesheets - LTIFR cannot be "
                "calculated without a real man-hours denominator."
            )
        return {
            "success": True,
            "data": {
                "critical_hse_incidents": None if incidents_unavailable else incidents,
                "total_man_hours": None,
                "ltifr": None,
                "status": "UNKNOWN",
                "truth_status": "UNKNOWN",
                "reason": reason,
            },
            "message": "Lost Time Injury Frequency Rate could not be calculated.",
            "meta": {"source_errors": source_errors}
        }

    ltifr = (incidents * 1000000.0) / total_hours

    return {
        "success": True,
        "data": {
            "critical_hse_incidents": incidents,
            "total_man_hours": total_hours,
            "ltifr": round(ltifr, 3),
            "status": "compliant" if ltifr < 1.5 else "non_compliant",
            "truth_status": "SYSTEM_GENERATED",
        },
        "message": "Lost Time Injury Frequency Rate calculated.",
        "meta": {"source_errors": source_errors}
    }
