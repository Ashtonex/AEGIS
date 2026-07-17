from fastapi import APIRouter, Depends, Request
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime, timedelta
from typing import Dict, Any, List

from core.database import get_db
from core.security import require_permission
from app.shared.sql import tenant_relation_summary_sql

router = APIRouter()


async def _rows(
    db: AsyncSession, query: str, params: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Return an empty list when an optional ERP relation is not available yet."""
    try:
        result = await db.execute(text(query), params)
        return [dict(row._mapping) for row in result]
    except Exception:
        return []


@router.get("/kpis")
async def get_executive_kpis(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
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

    return {
        "success": True,
        "data": data,
        "message": "Executive KPIs fetched.",
        "meta": {"source_status": "available" if snapshot else "unavailable"},
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
    for route in request.app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/v1/"):
            continue
        for tag in route.tags:
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
                "route": route.path,
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
    """Aggregate the regional footprint from project records; no seeded locations."""
    org_id = user["org_id"]
    projects = await _rows(
        db,
        """
        SELECT p.id, p.name, p.status, pp.latitude, pp.longitude,
               COALESCE(NULLIF(pp.region, ''), NULLIF(pp.province, ''), NULLIF(pp.site_location, ''),
                        NULLIF(to_jsonb(p)->>'region', ''), NULLIF(to_jsonb(p)->>'province', ''),
                        NULLIF(to_jsonb(p)->>'location', ''), NULLIF(to_jsonb(p)->>'site_location', ''),
                        'Unassigned') AS region
        FROM projects.projects p
        LEFT JOIN projects.project_profiles pp ON pp.project_id = p.id AND pp.organization_id = p.organization_id
        WHERE organization_id = :org_id AND is_deleted = false
    """,
        {"org_id": org_id},
    )

    grouped: Dict[str, Dict[str, Any]] = {}
    for project in projects:
        region = project.pop("region") or "Unassigned"
        bucket = grouped.setdefault(
            region,
            {
                "name": region,
                "projects": [],
                "active_projects": 0,
                "latitude": project.get("latitude"),
                "longitude": project.get("longitude"),
            },
        )
        bucket["projects"].append(project)
        if str(project.get("status", "")).lower() in {
            "active",
            "in progress",
            "ongoing",
            "live",
            "execution",
        }:
            bucket["active_projects"] += 1

    return {
        "success": True,
        "data": list(grouped.values()),
        "message": "Regional footprint fetched.",
        "meta": {"total": len(grouped)},
    }


@router.get("/projects/active")
async def get_active_projects(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    items = await _rows(
        db,
        """
        SELECT to_jsonb(p) AS project
        FROM projects.projects p
        WHERE organization_id = :org_id AND is_deleted = false
          AND lower(COALESCE(status, '')) IN ('active', 'in progress', 'ongoing', 'live', 'execution')
        ORDER BY updated_at DESC
    """,
        {"org_id": user["org_id"]},
    )
    return {
        "success": True,
        "data": [item["project"] for item in items],
        "message": "Active projects fetched.",
        "meta": {"total": len(items)},
    }


@router.get("/projects/{project_id}/detail")
async def get_project_detail(
    project_id: str,
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    params = {"org_id": user["org_id"], "project_ref": project_id}
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
        ),
        "tests_and_checks": await _rows(
            db,
            "SELECT to_jsonb(pc) AS item FROM projects.project_checks pc WHERE pc.project_id = :project_id AND pc.organization_id = :org_id ORDER BY pc.completed_at DESC NULLS LAST",
            params,
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
        ),
        "material_records": await _rows(
            db,
            """
            SELECT to_jsonb(m)
                || jsonb_build_object(
                    'report_date', r.report_date,
                    'report_status', r.status,
                    'item_name', i.name,
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
        ),
        "quotations": await _rows(
            db,
            "SELECT to_jsonb(q) AS item FROM finance.quotations q WHERE q.organization_id = :org_id AND q.is_deleted = false AND COALESCE(to_jsonb(q)->>'project_id', '') = :project_id",
            params,
        ),
        "procurement_orders": await _rows(
            db,
            "SELECT to_jsonb(o) AS item FROM procurement.procurement_orders o WHERE o.organization_id = :org_id AND o.is_deleted = false AND COALESCE(to_jsonb(o)->>'project_id', '') = :project_id",
            params,
        ),
        "tenders": await _rows(
            db,
            "SELECT to_jsonb(t) AS item FROM crm.tenders t WHERE t.organization_id = :org_id AND t.is_deleted = false AND COALESCE(to_jsonb(t)->>'project_id', '') = :project_id",
            params,
        ),
        "subcontractors": await _rows(
            db,
            "SELECT to_jsonb(c) AS item FROM crm.contacts c WHERE c.organization_id = :org_id AND c.is_deleted = false AND COALESCE(to_jsonb(c)->>'project_id', '') = :project_id",
            params,
        ),
    }
    return {
        "success": True,
        "data": {
            "project": project_rows[0]["project"],
            **{key: [row["item"] for row in values] for key, values in related.items()},
        },
        "message": "Project executive detail fetched.",
        "meta": {},
    }


@router.get("/stats")
async def get_executive_stats(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Fetch live counts across different schemas to populate the Operational Intelligence card."""
    org_id = user.get("org_id") or "00000000-0000-0000-0000-000000000001"

    # 1. Projects count
    try:
        proj_query = text(
            "SELECT COUNT(*) FROM projects.projects WHERE organization_id = :org_id AND is_deleted = false"
        )
        proj_res = await db.execute(proj_query, {"org_id": org_id})
        projects_count = proj_res.scalar() or 0
    except Exception:
        projects_count = 0

    # 2. Fleet machinery count
    try:
        fleet_query = text(
            "SELECT COUNT(*) FROM fleet.fleet WHERE organization_id = :org_id AND is_deleted = false"
        )
        fleet_res = await db.execute(fleet_query, {"org_id": org_id})
        machinery_count = fleet_res.scalar() or 0
    except Exception:
        machinery_count = 0

    # 3. HR Workforce count
    try:
        workforce_query = text(
            "SELECT COUNT(*) FROM hr.employees WHERE organization_id = :org_id AND is_deleted = false"
        )
        workforce_res = await db.execute(workforce_query, {"org_id": org_id})
        workforce_count = workforce_res.scalar() or 0
    except Exception:
        workforce_count = 0

    # 4. Procurement orders count
    try:
        orders_query = text(
            "SELECT COUNT(*) FROM procurement.procurement_orders WHERE organization_id = :org_id AND is_deleted = false"
        )
        orders_res = await db.execute(orders_query, {"org_id": org_id})
        orders_count = orders_res.scalar() or 0
    except Exception:
        orders_count = 0

    # 5. Inventory value
    try:
        inv_query = text(
            "SELECT COALESCE(SUM(quantity * unit_price), 0) FROM procurement.inventory_items WHERE organization_id = :org_id AND is_deleted = false"
        )
        inv_res = await db.execute(inv_query, {"org_id": org_id})
        inventory_value = inv_res.scalar() or 0.0
    except Exception:
        inventory_value = 0.0

    # 6. HSE incidents count
    try:
        incidents_query = text(
            "SELECT COUNT(*) FROM projects.hse_incidents WHERE organization_id = :org_id AND is_deleted = false"
        )
        incidents_res = await db.execute(incidents_query, {"org_id": org_id})
        incidents_count = incidents_res.scalar() or 0
    except Exception:
        incidents_count = 0

    return {
        "success": True,
        "data": {
            "live_projects": projects_count,
            "deployed_machinery": machinery_count,
            "active_workforce": workforce_count,
            "open_purchase_orders": orders_count,
            "materials_in_stock": f"${inventory_value:,.2f}",
            "safety_incidents": incidents_count,
        },
        "message": "Executive stats fetched.",
        "meta": {},
    }


async def _source_health(
    db: AsyncSession, org_id: str, name: str, relation: str
) -> Dict[str, Any]:
    """Report source state without treating an unavailable relation as a zero."""
    allowed_relations = {
        "projects.projects",
        "projects.hse_incidents",
        "procurement.procurement_orders",
        "hr.employees",
        "crm.leads",
    }
    try:
        result = await db.execute(
            tenant_relation_summary_sql(relation, allowed_relations),
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
        return {
            "source": name,
            "status": "unavailable",
            "record_count": None,
            "last_updated": None,
        }


@router.get("/data-health")
async def get_executive_data_health(
    user: dict = Depends(require_permission("executive.view_dashboard")),
    db: AsyncSession = Depends(get_db),
):
    """Data confidence for the sources used by the command centre."""
    org_id = user["org_id"]
    sources = [
        _source_health(db, org_id, "Projects", "projects.projects"),
        _source_health(db, org_id, "HSE", "projects.hse_incidents"),
        _source_health(db, org_id, "Procurement", "procurement.procurement_orders"),
        _source_health(db, org_id, "Workforce", "hr.employees"),
        _source_health(db, org_id, "CRM", "crm.leads"),
    ]
    sources = [await source for source in sources]
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
    )
    compliance = await _rows(
        db,
        """
        SELECT id, certificate_name AS title, expiry_date, 'Compliance expiry' AS category,
               'Renew or resolve certificate' AS action
        FROM projects.compliance_items
        WHERE organization_id = :org_id AND is_deleted = false
          AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY expiry_date ASC LIMIT 20
    """,
        params,
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
            *site_report_risk,
        ],
        "message": "Executive exceptions fetched.",
        "meta": {
            "total": len(incidents)
            + len(compliance)
            + len(viability)
            + len(finance_risk)
            + len(supplier_risk)
            + len(equipment_risk)
            + len(site_report_risk)
        },
    }
