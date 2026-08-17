"""
Project financial forecast snapshotting and margin-threat alerting.

Bridges the CCB's own quotation-time baseline into the real budget-vs-actual
tracking that already exists in the Finance module (finance.cost_transactions,
finance.commitments, finance.project_budgets, finance.variations) - these were
two disconnected systems before this: a quotation's projected margin was
persisted (finance.project_commercial_baselines) but never became the actual
project budget, and finance.project_forecasts existed in schema but nothing
ever wrote to it.

Two things happen here:
1. `refresh_project_forecast` computes the same numbers routers/financial_
   performance.py already computes live, and persists them as a dated
   snapshot so a baseline can be referenced anytime instead of only ever
   seeing "right now".
2. `check_and_alert_margin_threat` fires a real notification when the
   estimate-at-completion exceeds the approved budget by more than what an
   approved variation (formal change order) accounts for - i.e. costs
   running over WITHOUT a matching, documented reason.
"""

from typing import Any, Dict, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_role_notification
from core.security import SUPERADMIN_ROLE

COMMERCIAL_ALERT_ROLES = ["Executive (Admin)", "Finance Manager", SUPERADMIN_ROLE]

# finance.budget_lines.cost_category only accepts these values.
_DIRECT_COST_CATEGORY_MAP = {
    "materials": "materials",
    "labour": "labour",
    "equipment": "equipment",
    "subcontractors": "subcontract",
    "transport": "other",
    "waste_allowance": "other",
}


async def compute_project_financials(
    db: AsyncSession, org_id: str, project_id: str
) -> Optional[Dict[str, Any]]:
    """Live budget-vs-actual figures for one project - the same
    source-of-truth query as financial_performance.py's project detail
    endpoint, factored out so it can also feed a persisted snapshot."""
    query = text("""
        SELECT
            p.id AS project_id,
            p.name AS project_title,
            COALESCE(p.contract_value, 0) AS contract_value,
            COALESCE((
                SELECT SUM(v.cost_impact) FROM finance.variations v
                WHERE v.project_id = p.id AND v.organization_id = :org_id
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            COALESCE((
                SELECT SUM(ct.amount) FROM finance.cost_transactions ct
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
            ), 0) AS actual_cost_to_date,
            COALESCE((
                SELECT SUM(c.outstanding_amount) FROM finance.commitments c
                WHERE c.project_id = p.id AND c.organization_id = :org_id
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            COALESCE((
                SELECT SUM(pc.certified_amount) FROM finance.progress_claims pc
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            COALESCE((
                SELECT SUM(pc.net_claim_amount) FROM finance.progress_claims pc
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            COALESCE((
                SELECT pb.total_amount FROM finance.project_budgets pb
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id
                  AND pb.status = 'approved' AND pb.is_deleted = false
                LIMIT 1
            ), 0) AS approved_budget
        FROM projects.projects p
        WHERE p.id = :project_id AND p.organization_id = :org_id AND p.is_deleted = false
    """)
    row = (await db.execute(query, {"org_id": org_id, "project_id": project_id})).first()
    return dict(row._mapping) if row else None


def derive_forecast_metrics(financials: Dict[str, Any]) -> Dict[str, Any]:
    """Pure calculation, deliberately DB-free so it can be unit tested
    without a live database connection."""
    contract_value = float(financials["contract_value"])
    approved_variations = float(financials["approved_variations"])
    actual_cost_to_date = float(financials["actual_cost_to_date"])
    committed_cost = float(financials["committed_cost"])
    certified_to_date = float(financials["certified_to_date"])
    cash_collected = float(financials["cash_collected"])
    approved_budget = float(financials["approved_budget"])

    revised_contract_value = contract_value + approved_variations
    estimate_at_completion = actual_cost_to_date + committed_cost
    forecast_to_complete = max(0.0, estimate_at_completion - actual_cost_to_date)
    forecast_margin_pct = (
        (revised_contract_value - estimate_at_completion) / revised_contract_value * 100.0
        if revised_contract_value > 0 else None
    )
    cost_overrun_risk = estimate_at_completion > approved_budget and approved_budget > 0
    cashflow_deficit_risk = committed_cost > cash_collected

    # A cost overrun is only an "unexplained threat" if it isn't covered by
    # an approved variation - a documented, client-approved scope change is
    # a legitimate reason for cost to exceed the ORIGINAL budget. Give the
    # variation's cost impact to the budget ceiling before judging overrun.
    justified_ceiling = approved_budget + approved_variations
    unexplained_overrun_amount = (
        max(0.0, estimate_at_completion - justified_ceiling) if approved_budget > 0 else 0.0
    )

    return {
        "contract_value": round(contract_value, 2),
        "approved_variations": round(approved_variations, 2),
        "revised_contract_value": round(revised_contract_value, 2),
        "certified_to_date": round(certified_to_date, 2),
        "cash_collected": round(cash_collected, 2),
        "approved_budget": round(approved_budget, 2),
        "committed_cost": round(committed_cost, 2),
        "actual_cost_to_date": round(actual_cost_to_date, 2),
        "forecast_to_complete": round(forecast_to_complete, 2),
        "estimate_at_completion": round(estimate_at_completion, 2),
        "forecast_margin_pct": round(forecast_margin_pct, 2) if forecast_margin_pct is not None else None,
        "cost_overrun_risk": cost_overrun_risk,
        "cashflow_deficit_risk": cashflow_deficit_risk,
        "unexplained_overrun_amount": round(unexplained_overrun_amount, 2),
    }


async def refresh_project_forecast(
    db: AsyncSession, org_id: str, project_id: str, computed_by: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Computes and persists today's forecast snapshot. Returns the derived
    metrics (including project_title), or None if the project doesn't exist."""
    financials = await compute_project_financials(db, org_id, project_id)
    if financials is None:
        return None

    metrics = derive_forecast_metrics(financials)

    await db.execute(
        text("""
            INSERT INTO finance.project_forecasts (
                organization_id, project_id, as_at_date,
                contract_value, approved_variations, revised_contract_value,
                certified_to_date, invoiced_to_date, cash_collected,
                approved_budget, committed_cost, actual_cost_to_date,
                forecast_to_complete, estimate_at_completion,
                forecast_margin_pct, cost_overrun_risk, cashflow_deficit_risk, computed_by
            ) VALUES (
                :org_id, :project_id, CURRENT_DATE,
                :contract_value, :approved_variations, :revised_contract_value,
                :certified_to_date, 0, :cash_collected,
                :approved_budget, :committed_cost, :actual_cost_to_date,
                :forecast_to_complete, :estimate_at_completion,
                :forecast_margin_pct, :cost_overrun_risk, :cashflow_deficit_risk, :computed_by
            )
            ON CONFLICT (organization_id, project_id, as_at_date) DO UPDATE SET
                contract_value = EXCLUDED.contract_value,
                approved_variations = EXCLUDED.approved_variations,
                revised_contract_value = EXCLUDED.revised_contract_value,
                certified_to_date = EXCLUDED.certified_to_date,
                cash_collected = EXCLUDED.cash_collected,
                approved_budget = EXCLUDED.approved_budget,
                committed_cost = EXCLUDED.committed_cost,
                actual_cost_to_date = EXCLUDED.actual_cost_to_date,
                forecast_to_complete = EXCLUDED.forecast_to_complete,
                estimate_at_completion = EXCLUDED.estimate_at_completion,
                forecast_margin_pct = EXCLUDED.forecast_margin_pct,
                cost_overrun_risk = EXCLUDED.cost_overrun_risk,
                cashflow_deficit_risk = EXCLUDED.cashflow_deficit_risk,
                computed_by = EXCLUDED.computed_by,
                computed_at = NOW()
        """),
        {
            "org_id": org_id,
            "project_id": project_id,
            "contract_value": metrics["contract_value"],
            "approved_variations": metrics["approved_variations"],
            "revised_contract_value": metrics["revised_contract_value"],
            "certified_to_date": metrics["certified_to_date"],
            "cash_collected": metrics["cash_collected"],
            "approved_budget": metrics["approved_budget"],
            "committed_cost": metrics["committed_cost"],
            "actual_cost_to_date": metrics["actual_cost_to_date"],
            "forecast_to_complete": metrics["forecast_to_complete"],
            "estimate_at_completion": metrics["estimate_at_completion"],
            "forecast_margin_pct": metrics["forecast_margin_pct"],
            "cost_overrun_risk": metrics["cost_overrun_risk"],
            "cashflow_deficit_risk": metrics["cashflow_deficit_risk"],
            "computed_by": computed_by,
        },
    )

    metrics["project_title"] = financials.get("project_title")
    return metrics


async def check_and_alert_margin_threat(
    db: AsyncSession, org_id: str, project_id: str, metrics: Dict[str, Any]
) -> bool:
    """Fires a real notification when costs are running over the approved
    budget beyond what any approved variation explains. Returns True if an
    alert was raised."""
    if metrics.get("unexplained_overrun_amount", 0) <= 0:
        return False

    project_title = metrics.get("project_title") or "Project"
    justified_ceiling = metrics["approved_budget"] + metrics["approved_variations"]
    await emit_role_notification(
        db,
        org_id=org_id,
        role_names=COMMERCIAL_ALERT_ROLES,
        title=f"Margin threatened on {project_title} with no approved variation",
        message=(
            f"Estimate at completion (${metrics['estimate_at_completion']:,.2f}) exceeds the approved "
            f"budget plus approved variations (${justified_ceiling:,.2f}) by "
            f"${metrics['unexplained_overrun_amount']:,.2f}, with no matching approved change order on file. "
            "Either raise a variation to formally document the scope/cost change, or investigate the overrun."
        ),
        notification_type="budget_margin_threat",
        priority="urgent",
        action_url="/dashboard/finance",
        metadata={
            "project_id": project_id,
            "unexplained_overrun_amount": metrics["unexplained_overrun_amount"],
            "estimate_at_completion": metrics["estimate_at_completion"],
        },
    )
    return True


async def seed_project_budget_from_quotation(
    db: AsyncSession,
    org_id: str,
    project_id: str,
    quotation_id: str,
    calculation,
    created_by: Optional[str] = None,
) -> str:
    """Seeds an approved project budget from an accepted quotation's own
    cost calculation, so 'what we quoted' and 'what's actually being spent'
    become the same comparison instead of two disconnected numbers.

    The budget ceiling is direct_costs + preliminaries + overhead + contingency
    - i.e. everything the site is allowed to actually spend against -
    deliberately EXCLUDING profit_amount, which is protected margin, not
    money available for site execution costs.
    """
    await db.execute(
        text("""
            UPDATE finance.project_budgets
            SET status = 'superseded', updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
              AND status = 'approved' AND is_deleted = false
        """),
        {"project_id": project_id, "org_id": org_id},
    )

    next_version = (
        await db.execute(
            text("""
                SELECT COALESCE(MAX(budget_version), 0) + 1
                FROM finance.project_budgets
                WHERE project_id = :project_id AND organization_id = :org_id
            """),
            {"project_id": project_id, "org_id": org_id},
        )
    ).scalar()

    direct_costs = float(calculation.direct_costs)
    preliminaries = float(calculation.preliminaries)
    overhead_amount = float(calculation.overhead_amount)
    contingency_amount = float(calculation.contingency_amount)
    execution_budget_total = direct_costs + preliminaries + overhead_amount + contingency_amount

    budget_id = (
        await db.execute(
            text("""
                INSERT INTO finance.project_budgets (
                    organization_id, project_id, budget_version, status, label,
                    effective_date, total_amount, notes, approved_by, approved_at, created_by
                ) VALUES (
                    :org_id, :project_id, :version, 'approved', :label,
                    CURRENT_DATE, :total_amount, :notes, :approved_by, NOW(), :created_by
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "project_id": project_id,
                "version": next_version,
                "label": f"Seeded from accepted quotation {quotation_id}",
                "total_amount": round(execution_budget_total, 2),
                "notes": (
                    f"Auto-seeded on quotation win. Client contract value (sell price): "
                    f"${float(calculation.grand_total):,.2f}. Protected profit "
                    f"${float(calculation.profit_amount):,.2f} is excluded from this execution budget."
                ),
                "approved_by": created_by,
                "created_by": created_by,
            },
        )
    ).scalar()

    breakdown = calculation.breakdown_log.get("direct_costs_breakdown", {})
    for source_category, amount_str in breakdown.items():
        amount = float(amount_str)
        if amount <= 0:
            continue
        await db.execute(
            text("""
                INSERT INTO finance.budget_lines (
                    organization_id, budget_id, cost_category, description, amount, created_by
                ) VALUES (:org_id, :budget_id, :cost_category, :description, :amount, :created_by)
            """),
            {
                "org_id": org_id,
                "budget_id": budget_id,
                "cost_category": _DIRECT_COST_CATEGORY_MAP.get(source_category, "other"),
                "description": f"Auto-seeded {source_category} allowance from quotation {quotation_id}",
                "amount": round(amount, 2),
                "created_by": created_by,
            },
        )

    for label, amount in (
        ("Preliminaries & General allowance", preliminaries),
        ("Overhead allocation", overhead_amount),
        ("Contingency reserve", contingency_amount),
    ):
        if amount <= 0:
            continue
        await db.execute(
            text("""
                INSERT INTO finance.budget_lines (
                    organization_id, budget_id, cost_category, description, amount, created_by
                ) VALUES (:org_id, :budget_id, 'overhead', :description, :amount, :created_by)
            """),
            {
                "org_id": org_id,
                "budget_id": budget_id,
                "description": f"{label} (from quotation {quotation_id})",
                "amount": round(amount, 2),
                "created_by": created_by,
            },
        )

    return str(budget_id)


async def seed_boq_line_items_from_quotation(
    db: AsyncSession,
    org_id: str,
    project_id: str,
    quotation_id: str,
    metadata: Dict[str, Any],
    created_by: Optional[str] = None,
) -> int:
    """Gives a won quotation's BOQ lines a persistent, addressable identity
    for the first time - finance.quotations.metadata->'items' is a JSONB
    array with no per-item identity, so nothing can track "quantity measured
    to date" against it. Any prior line items from an earlier win on this
    project are superseded rather than deleted, preserving their measurement
    history. Returns the number of line items seeded.
    """
    await db.execute(
        text("""
            UPDATE finance.boq_line_items
            SET status = 'superseded', updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
              AND status = 'active' AND is_deleted = false
        """),
        {"project_id": project_id, "org_id": org_id},
    )

    items = metadata.get("items") or []
    seeded = 0
    for idx, item in enumerate(items):
        try:
            qty = float(item.get("qty") or 0)
            rate = float(item.get("rate") or 0)
        except (TypeError, ValueError):
            continue
        description = str(item.get("description") or "Unspecified item").strip()
        if not description or qty <= 0:
            continue
        await db.execute(
            text("""
                INSERT INTO finance.boq_line_items (
                    organization_id, project_id, source_quotation_id, item_no,
                    description, unit, contract_qty, rate, sort_order, created_by
                ) VALUES (
                    :org_id, :project_id, :quotation_id, :item_no,
                    :description, :unit, :contract_qty, :rate, :sort_order, :created_by
                )
            """),
            {
                "org_id": org_id,
                "project_id": project_id,
                "quotation_id": quotation_id,
                "item_no": str(item.get("item_no")) if item.get("item_no") else None,
                "description": description,
                "unit": str(item.get("unit") or "item"),
                "contract_qty": round(qty, 3),
                "rate": round(rate, 4),
                "sort_order": idx,
                "created_by": created_by,
            },
        )
        seeded += 1

    return seeded
