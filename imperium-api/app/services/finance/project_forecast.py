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

from app.services.quotations.calculator import quotation_item_qty_rate
from app.shared.events import emit_role_notification
from core.security import SUPERADMIN_ROLE, user_has_permission

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


class UnpricedQuotationError(ValueError):
    """Raised instead of seeding an approved $0 execution budget."""


def execution_budget_total(calculation) -> float:
    """Everything the site may spend against: direct costs + preliminaries +
    overhead + contingency. Profit is protected margin and excluded."""
    return round(
        float(calculation.direct_costs)
        + float(calculation.preliminaries)
        + float(calculation.overhead_amount)
        + float(calculation.contingency_amount),
        2,
    )


BUDGET_BASELINE_LOCK_PERMISSION = "projects.budget_baseline.lock"


async def protected_budget_block_reason(db: AsyncSession, user: dict, project_id: str) -> Optional[str]:
    """Same rule as POST /projects/{id}/budget: once a project has an
    approved budget, replacing it is a budget-ceiling adjustment reserved
    for holders of projects.budget_baseline.lock (Finance)."""
    has_approved = (
        await db.execute(
            text("""
                SELECT 1 FROM finance.project_budgets
                WHERE project_id = CAST(:project_id AS uuid) AND organization_id = :org_id
                  AND status = 'approved' AND is_deleted = false
                LIMIT 1
            """),
            {"project_id": str(project_id), "org_id": user["org_id"]},
        )
    ).scalar()
    if not has_approved or user.get("role") == SUPERADMIN_ROLE:
        return None
    if await user_has_permission(db, user, BUDGET_BASELINE_LOCK_PERMISSION):
        return None
    return "This project already has an approved budget baseline. Only Finance can replace it."


def quotation_budget_block_reason(metadata: Optional[Dict[str, Any]], calculation) -> Optional[str]:
    """Why a project budget must not be seeded from this quotation, or None.

    Seeding supersedes the project's current approved budget and active BOQ
    lines, so an unpriced quotation (no lines, or every rate still 0 - e.g.
    a Drawing Takeoff import never priced) would replace a real budget with
    an approved $0 one.
    """
    if not (metadata or {}).get("items"):
        return "Quotation has no BOQ line items - price the BOQ before it can set the project budget."
    if execution_budget_total(calculation) <= 0:
        return "Quotation BOQ lines are unpriced ($0 execution cost) - price the BOQ before it can set the project budget."
    return None


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


def quotation_budget_lines(calculation, quotation_id: str) -> list[tuple[str, str, float]]:
    """(cost_category, description, amount) budget lines for a quotation's
    execution budget. Shared by seeding and by previews so what a user is
    shown before importing is exactly what gets written."""
    lines: list[tuple[str, str, float]] = []
    breakdown = calculation.breakdown_log.get("direct_costs_breakdown", {}) or {}
    for source_category, amount_str in breakdown.items():
        amount = round(float(amount_str or 0), 2)
        if amount > 0:
            lines.append((
                _DIRECT_COST_CATEGORY_MAP.get(source_category, "other"),
                f"Auto-seeded {source_category} allowance from quotation {quotation_id}",
                amount,
            ))
    # Lines priced with a flat rate and no buildup have no component split;
    # carry that share as 'other' so the lines add up to the budget header.
    unsplit = round(float(calculation.direct_costs) - sum(float(v or 0) for v in breakdown.values()), 2)
    if unsplit > 0:
        lines.append(("other", f"Direct costs without a component split, from quotation {quotation_id}", unsplit))
    for category, label, amount in (
        ("overhead", "Preliminaries & General allowance", float(calculation.preliminaries)),
        ("overhead", "Overhead allocation", float(calculation.overhead_amount)),
        ("contingency", "Contingency reserve", float(calculation.contingency_amount)),
    ):
        if amount > 0:
            lines.append((category, f"{label} (from quotation {quotation_id})", round(amount, 2)))
    return lines


def quotation_budget_categories(calculation) -> Dict[str, float]:
    """Per-category totals of quotation_budget_lines plus 'total'."""
    totals: Dict[str, float] = {
        k: 0.0 for k in ("materials", "labour", "equipment", "subcontract", "overhead", "contingency", "other")
    }
    for category, _desc, amount in quotation_budget_lines(calculation, ""):
        totals[category] = round(totals.get(category, 0.0) + amount, 2)
    totals["total"] = execution_budget_total(calculation)
    return totals


async def seed_project_budget_from_quotation(
    db: AsyncSession,
    org_id: str,
    project_id: str,
    quotation_id: str,
    calculation,
    created_by: Optional[str] = None,
    notes: Optional[str] = None,
) -> str:
    """Seeds an approved project budget from an accepted quotation's own
    cost calculation, so 'what we quoted' and 'what's actually being spent'
    become the same comparison instead of two disconnected numbers.

    The budget ceiling is direct_costs + preliminaries + overhead + contingency
    - i.e. everything the site is allowed to actually spend against -
    deliberately EXCLUDING profit_amount, which is protected margin, not
    money available for site execution costs.
    """
    execution_budget_total_amount = execution_budget_total(calculation)
    if execution_budget_total_amount <= 0:
        raise UnpricedQuotationError(
            f"Quotation {quotation_id} has a $0 execution cost; refusing to replace the approved budget."
        )

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
                "total_amount": execution_budget_total_amount,
                "notes": notes or (
                    f"Auto-seeded on quotation win. Client contract value (sell price): "
                    f"${float(calculation.grand_total):,.2f}. Protected profit "
                    f"${float(calculation.profit_amount):,.2f} is excluded from this execution budget."
                ),
                "approved_by": created_by,
                "created_by": created_by,
            },
        )
    ).scalar()

    for cost_category, description, amount in quotation_budget_lines(calculation, quotation_id):
        await db.execute(
            text("""
                INSERT INTO finance.budget_lines (
                    organization_id, budget_id, cost_category, description, amount, created_by
                ) VALUES (:org_id, :budget_id, :cost_category, :description, :amount, :created_by)
            """),
            {
                "org_id": org_id,
                "budget_id": budget_id,
                "cost_category": cost_category,
                "description": description,
                "amount": amount,
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

    A quotation with no measurable lines seeds nothing and leaves the
    project's current active BOQ untouched.
    """
    rows = []
    for idx, item in enumerate(metadata.get("items") or []):
        if not isinstance(item, dict) or item.get("item_type") == "note":
            continue
        raw_qty, raw_rate, unit = quotation_item_qty_rate(item)
        try:
            qty = float(raw_qty or 0)
            rate = float(raw_rate or 0)
        except (TypeError, ValueError):
            continue
        description = str(item.get("description") or "Unspecified item").strip()
        if not description or qty <= 0:
            continue
        rows.append((idx, item, qty, rate, unit, description))
    if not rows:
        return 0

    await db.execute(
        text("""
            UPDATE finance.boq_line_items
            SET status = 'superseded', updated_at = NOW()
            WHERE project_id = :project_id AND organization_id = :org_id
              AND status = 'active' AND is_deleted = false
        """),
        {"project_id": project_id, "org_id": org_id},
    )

    seeded = 0
    for idx, item, qty, rate, unit, description in rows:
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
                "unit": str(unit or "item"),
                "contract_qty": round(qty, 3),
                "rate": round(rate, 4),
                "sort_order": idx,
                "created_by": created_by,
            },
        )
        seeded += 1

    return seeded
