"""
Project Portfolio Finance table + Project Financial Health score (Phase 11B).

Loops project_forecast.compute_project_financials/derive_forecast_metrics
per active project (no batch variant of those functions exists - see
project_forecast.py) and left-joins in CCB/retention/variation/GL-
reconciliation data via a handful of batch (one-query-across-all-projects)
lookups, not N+1 per factor.

The Financial Health score is never a single hidden number: every
factor is returned individually with its own truth_status
(SYSTEM_GENERATED / ESTIMATED / INCOMPLETE - reusing routers/executive.py's
established convention), and a composite attention_level is only a
sort/filter convenience computed transparently over the same factors,
always returned alongside the full breakdown, never in place of it.
"""

from datetime import date
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import gl_bridge, project_forecast

_ACTIVE_PROJECT_STATUSES = ("active", "in progress", "ongoing", "live", "execution")


async def _list_active_projects(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT id AS project_id, name AS project_title
            FROM projects.projects
            WHERE organization_id = :org_id AND is_deleted = false
              AND lower(COALESCE(status, '')) = ANY(:active_statuses)
            ORDER BY name
        """),
        {"org_id": org_id, "active_statuses": list(_ACTIVE_PROJECT_STATUSES)},
    )
    return [dict(r) for r in rows.mappings()]


async def _batch_ccb_findings(db: AsyncSession, *, org_id: str, project_ids: list) -> dict:
    rows = await db.execute(
        text("""
            SELECT project_id, COUNT(*) AS open_count,
                   COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
                   COUNT(*) FILTER (WHERE severity = 'high') AS high_count
            FROM finance.ccb_monitor_findings
            WHERE organization_id = :org_id AND status = 'open' AND is_deleted = false
              AND project_id = ANY(:project_ids)
            GROUP BY project_id
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    return {r["project_id"]: dict(r) for r in rows.mappings()}


async def _batch_retention(db: AsyncSession, *, org_id: str, project_ids: list) -> dict:
    """Net retention currently held per project, plus the oldest 'held'
    movement date as an APPROXIMATE age signal - this is not a precise
    FIFO release match (a real FIFO match against partial releases is a
    materially bigger computation for a marginal accuracy gain here), a
    documented simplification."""
    rows = await db.execute(
        text("""
            SELECT
                project_id,
                COALESCE(SUM(amount) FILTER (WHERE movement_type = 'held'), 0)
                    - COALESCE(SUM(amount) FILTER (WHERE movement_type = 'released'), 0) AS net_retention_held,
                MIN(movement_date) FILTER (WHERE movement_type = 'held') AS oldest_held_date
            FROM finance.retention_ledger
            WHERE organization_id = :org_id AND project_id = ANY(:project_ids)
            GROUP BY project_id
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    return {r["project_id"]: dict(r) for r in rows.mappings()}


async def _batch_pending_variations(db: AsyncSession, *, org_id: str, project_ids: list) -> dict:
    rows = await db.execute(
        text("""
            SELECT project_id, MIN(COALESCE(submitted_at, created_at)) AS oldest_pending_since
            FROM finance.variations
            WHERE organization_id = :org_id AND is_deleted = false
              AND status IN ('pending', 'submitted') AND project_id = ANY(:project_ids)
            GROUP BY project_id
        """),
        {"org_id": org_id, "project_ids": project_ids},
    )
    return {r["project_id"]: dict(r) for r in rows.mappings()}


def _age_days(as_of: date, then) -> Optional[int]:
    if then is None:
        return None
    then_date = then.date() if hasattr(then, "date") else then
    return (as_of - then_date).days


def get_project_health_factors(
    *,
    forecast: dict,
    ccb: Optional[dict],
    retention: Optional[dict],
    variation: Optional[dict],
    reconciliation: dict,
    as_of: date,
) -> dict:
    """Never returns a bare composite - always the full factor breakdown.
    Each factor is {value, truth_status, note}."""
    factors: dict[str, Any] = {}

    approved_budget = forecast.get("approved_budget") or 0
    unexplained_overrun = forecast.get("unexplained_overrun_amount") or 0
    overrun_ratio = round(unexplained_overrun / approved_budget, 4) if approved_budget > 0 else None
    factors["budget_overrun_ratio"] = {
        "value": overrun_ratio,
        "truth_status": "SYSTEM_GENERATED" if approved_budget > 0 else "INCOMPLETE",
        "note": "Unexplained overrun (EAC beyond budget+approved variations) as a fraction of approved budget."
        if approved_budget > 0 else "No approved budget on record for this project - ratio cannot be computed.",
    }

    ccb = ccb or {}
    factors["open_ccb_findings"] = {
        "value": {
            "open_count": int(ccb.get("open_count") or 0),
            "critical_count": int(ccb.get("critical_count") or 0),
            "high_count": int(ccb.get("high_count") or 0),
        },
        "truth_status": "SYSTEM_GENERATED",
        "note": "Open Commercial Control Brain findings for this project.",
    }

    retention = retention or {}
    net_retention = float(retention.get("net_retention_held") or 0)
    oldest_held_age = _age_days(as_of, retention.get("oldest_held_date"))
    factors["retention_held"] = {
        "value": {"net_retention_held": round(net_retention, 2), "oldest_held_age_days": oldest_held_age},
        "truth_status": "SYSTEM_GENERATED" if net_retention != 0 else "INCOMPLETE",
        "note": "Oldest-held-date age is an approximation (not a precise FIFO release match against partial releases).",
    }

    variation = variation or {}
    oldest_variation_age = _age_days(as_of, variation.get("oldest_pending_since"))
    factors["pending_variation_age"] = {
        "value": {"oldest_pending_age_days": oldest_variation_age},
        "truth_status": "SYSTEM_GENERATED" if oldest_variation_age is not None else "INCOMPLETE",
        "note": "Age of the oldest still-pending/submitted (not yet approved or rejected) variation.",
    }

    gl_actual = reconciliation.get("gl_actual_cost_to_date") or 0
    op_actual = reconciliation.get("operational_actual_cost_to_date") or 0
    factors["gl_reconciliation_drift"] = {
        "value": reconciliation,
        "truth_status": "INCOMPLETE" if gl_actual == 0 and op_actual > 0 else "SYSTEM_GENERATED",
        "note": "GL adoption appears incomplete for this project (no posted GL cost activity yet) - drift is not meaningful until it is."
        if gl_actual == 0 and op_actual > 0
        else "Difference between GL-posted and operational-table actual cost/certified revenue for this project.",
    }

    # Simple, documented, transparent threshold rule - a sort/filter
    # convenience only. The full factor breakdown above is always
    # returned alongside it, never replaced by it.
    risk_signals = 0
    if overrun_ratio is not None and overrun_ratio > 0.10:
        risk_signals += 1
    if int(ccb.get("critical_count") or 0) > 0:
        risk_signals += 1
    if oldest_held_age is not None and oldest_held_age > 180:
        risk_signals += 1
    if oldest_variation_age is not None and oldest_variation_age > 30:
        risk_signals += 1

    attention_level = "at_risk" if risk_signals >= 2 else ("watch" if risk_signals == 1 else "good")

    return {"factors": factors, "attention_level": attention_level}


async def list_project_portfolio(db: AsyncSession, *, org_id: str, as_of: Optional[date] = None) -> list[dict]:
    as_of = as_of or date.today()
    projects = await _list_active_projects(db, org_id=org_id)
    if not projects:
        return []
    project_ids = [p["project_id"] for p in projects]

    ccb_by_project = await _batch_ccb_findings(db, org_id=org_id, project_ids=project_ids)
    retention_by_project = await _batch_retention(db, org_id=org_id, project_ids=project_ids)
    variation_by_project = await _batch_pending_variations(db, org_id=org_id, project_ids=project_ids)

    results = []
    for p in projects:
        project_id = p["project_id"]
        financials = await project_forecast.compute_project_financials(db, org_id, str(project_id))
        if financials is None:
            continue
        forecast = project_forecast.derive_forecast_metrics(financials)
        reconciliation = await gl_bridge.get_project_gl_reconciliation(db, org_id=org_id, project_id=project_id)

        health = get_project_health_factors(
            forecast=forecast,
            ccb=ccb_by_project.get(project_id),
            retention=retention_by_project.get(project_id),
            variation=variation_by_project.get(project_id),
            reconciliation=reconciliation,
            as_of=as_of,
        )

        results.append({
            "project_id": str(project_id),
            "project_title": p["project_title"],
            **forecast,
            "health": health,
        })

    return results
