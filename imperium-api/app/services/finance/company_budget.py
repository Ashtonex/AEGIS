"""
Company & Department Budgeting (Phase 5A).

A fresh, richer versioning layer for company/department-level budgets,
deliberately separate from finance.project_budgets (which keeps its own
proven draft/approved/superseded/cancelled supersede pattern untouched -
see migration 023 and its two live call sites). This module follows the
master spec's own budget-versioning vocabulary literally: Draft, Submitted,
Under Review, Approved Baseline, Revision, Superseded, Frozen, plus a
practical Cancelled escape hatch.

Never posts to the General Ledger and never touches finance.project_budgets
or finance.project_forecasts - this is a planning layer compared against
existing actuals for variance reporting only.

Known, flagged simplification: the actuals side of variance reporting
covers external revenue (certified progress claims), project cost
(cost_transactions), and non-project direct cost (cashbook/payroll/supplier
-payment rows tagged directly with a department) - the same core legs as
routers/financial_performance.py::_compute_department_pnl, but omitting
inter-department transfer legs (an internal, company-wide-zero-sum item)
since a budget-vs-actual comparison is about external performance, not
internal recharges. This is a deliberate scope boundary, not an oversight.
"""

from datetime import date
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import GeneralLedgerError

COST_CATEGORIES = ("labour", "equipment", "materials", "subcontract", "overhead", "other")
REVENUE_CATEGORIES = ("contract_revenue", "other_income")

_TRANSITIONS = {
    "submit": {"from": ("draft", "revision"), "to": "submitted"},
    "start_review": {"from": ("submitted",), "to": "under_review"},
    "reject": {"from": ("under_review",), "to": "draft"},
    "cancel": {"from": ("draft", "submitted", "under_review", "revision"), "to": "cancelled"},
    "freeze": {"from": ("approved_baseline",), "to": "frozen"},
}


async def create_budget(db: AsyncSession, *, org_id: str, user_id: str, fiscal_year: int, label: str, notes: Optional[str] = None) -> dict:
    row = await db.execute(
        text("""
            INSERT INTO finance.company_budgets (organization_id, fiscal_year, label, status, notes, created_by)
            VALUES (:org_id, :fiscal_year, :label, 'draft', :notes, :user_id)
            RETURNING *
        """),
        {"org_id": org_id, "fiscal_year": fiscal_year, "label": label, "notes": notes, "user_id": user_id},
    )
    return dict(row.mappings().first())


async def get_budget(db: AsyncSession, *, org_id: str, budget_id: UUID) -> Optional[dict]:
    row = await db.execute(
        text("SELECT * FROM finance.company_budgets WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": budget_id, "org_id": org_id},
    )
    budget = row.mappings().first()
    if not budget:
        return None
    budget = dict(budget)
    lines = await db.execute(
        text("""
            SELECT bl.*, d.name AS department_name FROM finance.company_budget_lines bl
            LEFT JOIN finance.departments d ON d.id = bl.department_id
            WHERE bl.budget_id = :budget_id AND bl.organization_id = :org_id AND bl.is_deleted = false
            ORDER BY bl.period_month, bl.line_type, bl.category
        """),
        {"budget_id": budget_id, "org_id": org_id},
    )
    budget["lines"] = [dict(r._mapping) for r in lines]
    return budget


async def list_budgets(db: AsyncSession, *, org_id: str, fiscal_year: Optional[int] = None) -> list[dict]:
    filters = ["organization_id = :org_id", "is_deleted = false"]
    params: dict = {"org_id": org_id}
    if fiscal_year:
        filters.append("fiscal_year = :fiscal_year")
        params["fiscal_year"] = fiscal_year
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"SELECT * FROM finance.company_budgets WHERE {where} ORDER BY fiscal_year DESC, created_at DESC"),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def replace_budget_lines(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID, lines: list[dict[str, Any]]) -> dict:
    budget = await _require_budget(db, org_id, budget_id)
    if budget["status"] not in ("draft", "revision"):
        raise GeneralLedgerError(f"Cannot edit lines while budget is '{budget['status']}' - only draft/revision budgets are editable.", status_code=409)

    for line in lines:
        line_type = line.get("line_type")
        category = line.get("category")
        if line_type == "cost" and category not in COST_CATEGORIES:
            raise GeneralLedgerError(f"Invalid cost category '{category}'.", status_code=422)
        if line_type == "revenue" and category not in REVENUE_CATEGORIES:
            raise GeneralLedgerError(f"Invalid revenue category '{category}'.", status_code=422)
        if line_type not in ("cost", "revenue"):
            raise GeneralLedgerError(f"Invalid line_type '{line_type}'.", status_code=422)

    await db.execute(
        text("UPDATE finance.company_budget_lines SET is_deleted = true WHERE budget_id = :budget_id AND organization_id = :org_id"),
        {"budget_id": budget_id, "org_id": org_id},
    )
    for line in lines:
        await db.execute(
            text("""
                INSERT INTO finance.company_budget_lines (
                    organization_id, budget_id, department_id, line_type, category, period_month, amount, notes, created_by
                ) VALUES (
                    :org_id, :budget_id, :department_id, :line_type, :category, :period_month, :amount, :notes, :user_id
                )
            """),
            {
                "org_id": org_id, "budget_id": budget_id, "department_id": line.get("department_id"),
                "line_type": line["line_type"], "category": line["category"],
                "period_month": _month_start(line["period_month"]), "amount": line["amount"],
                "notes": line.get("notes"), "user_id": user_id,
            },
        )
    return await get_budget(db, org_id=org_id, budget_id=budget_id)


def _month_start(value) -> date:
    d = value if isinstance(value, date) else date.fromisoformat(str(value))
    return d.replace(day=1)


async def _require_budget(db: AsyncSession, org_id: str, budget_id: UUID) -> dict:
    row = await db.execute(
        text("SELECT * FROM finance.company_budgets WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": budget_id, "org_id": org_id},
    )
    budget = row.mappings().first()
    if not budget:
        raise GeneralLedgerError("Company budget not found.", status_code=404)
    return dict(budget)


async def _apply_transition(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID, action: str, extra_set: str = "", extra_params: Optional[dict] = None) -> dict:
    budget = await _require_budget(db, org_id, budget_id)
    rule = _TRANSITIONS[action]
    if budget["status"] not in rule["from"]:
        raise GeneralLedgerError(f"Cannot {action} a budget in '{budget['status']}' state.", status_code=409)
    params = {"id": budget_id, "org_id": org_id, "status": rule["to"], **(extra_params or {})}
    await db.execute(
        text(f"""
            UPDATE finance.company_budgets SET status = :status, updated_at = NOW() {extra_set}
            WHERE id = :id AND organization_id = :org_id
        """),
        params,
    )
    return await get_budget(db, org_id=org_id, budget_id=budget_id)


async def submit_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID) -> dict:
    return await _apply_transition(db, org_id=org_id, user_id=user_id, budget_id=budget_id, action="submit",
                                    extra_set=", submitted_by = :user_id, submitted_at = NOW()", extra_params={"user_id": user_id})


async def start_review(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID) -> dict:
    return await _apply_transition(db, org_id=org_id, user_id=user_id, budget_id=budget_id, action="start_review",
                                    extra_set=", reviewed_by = :user_id, reviewed_at = NOW()", extra_params={"user_id": user_id})


async def reject_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reject a budget.")
    return await _apply_transition(db, org_id=org_id, user_id=user_id, budget_id=budget_id, action="reject",
                                    extra_set=", rejection_reason = :reason", extra_params={"reason": reason})


async def cancel_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID) -> dict:
    return await _apply_transition(db, org_id=org_id, user_id=user_id, budget_id=budget_id, action="cancel",
                                    extra_set=", cancelled_by = :user_id, cancelled_at = NOW()", extra_params={"user_id": user_id})


async def freeze_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID, reason: Optional[str] = None) -> dict:
    return await _apply_transition(db, org_id=org_id, user_id=user_id, budget_id=budget_id, action="freeze",
                                    extra_set=", frozen_by = :user_id, frozen_at = NOW(), freeze_reason = :reason",
                                    extra_params={"user_id": user_id, "reason": reason})


async def approve_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID) -> dict:
    budget = await _require_budget(db, org_id, budget_id)
    if budget["status"] != "under_review":
        raise GeneralLedgerError(f"Cannot approve a budget in '{budget['status']}' state - it must be under review.", status_code=409)

    if budget["revises_budget_id"]:
        # Atomically supersede the prior baseline in the same transaction -
        # the exact finance.project_budgets pattern, applied here.
        await db.execute(
            text("""
                UPDATE finance.company_budgets SET status = 'superseded', updated_at = NOW()
                WHERE id = :id AND organization_id = :org_id AND status = 'approved_baseline'
            """),
            {"id": budget["revises_budget_id"], "org_id": org_id},
        )

    await db.execute(
        text("""
            UPDATE finance.company_budgets
            SET status = 'approved_baseline', approved_by = :user_id, approved_at = NOW(), updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": budget_id, "org_id": org_id, "user_id": user_id},
    )
    return await get_budget(db, org_id=org_id, budget_id=budget_id)


async def reopen_budget(db: AsyncSession, *, org_id: str, user_id: str, budget_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reopen a frozen budget.")
    budget = await _require_budget(db, org_id, budget_id)
    if budget["status"] != "frozen":
        raise GeneralLedgerError("Only a frozen budget can be reopened.", status_code=409)
    await db.execute(
        text("""
            UPDATE finance.company_budgets
            SET status = 'approved_baseline', reopen_reason = :reason, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": budget_id, "org_id": org_id, "reason": reason},
    )
    return await get_budget(db, org_id=org_id, budget_id=budget_id)


async def create_revision(db: AsyncSession, *, org_id: str, user_id: str, source_budget_id: UUID, label: Optional[str] = None) -> dict:
    source = await _require_budget(db, org_id, source_budget_id)
    if source["status"] != "approved_baseline":
        raise GeneralLedgerError("Only an approved baseline can be revised.", status_code=409)

    new_id = (
        await db.execute(
            text("""
                INSERT INTO finance.company_budgets (organization_id, fiscal_year, label, status, revises_budget_id, created_by)
                VALUES (:org_id, :fiscal_year, :label, 'revision', :source_id, :user_id)
                RETURNING id
            """),
            {
                "org_id": org_id, "fiscal_year": source["fiscal_year"],
                "label": label or f"{source['label']} (revision)", "source_id": source_budget_id, "user_id": user_id,
            },
        )
    ).scalar()

    await db.execute(
        text("""
            INSERT INTO finance.company_budget_lines (organization_id, budget_id, department_id, line_type, category, period_month, amount, notes, created_by)
            SELECT organization_id, :new_id, department_id, line_type, category, period_month, amount, notes, :user_id
            FROM finance.company_budget_lines
            WHERE budget_id = :source_id AND organization_id = :org_id AND is_deleted = false
        """),
        {"new_id": new_id, "source_id": source_budget_id, "org_id": org_id, "user_id": user_id},
    )
    return await get_budget(db, org_id=org_id, budget_id=new_id)


async def _get_department_actuals_by_month(db: AsyncSession, org_id: str, department_id: Optional[UUID], fiscal_year: int) -> list[dict]:
    """One row per (month, revenue|cost). department_id=None aggregates
    across every department (the company-wide view)."""
    dept_filter = "p.department_id IS NOT DISTINCT FROM :department_id" if department_id else "TRUE"
    dept_filter_direct = "cb.department_id IS NOT DISTINCT FROM :department_id" if department_id else "TRUE"
    params: dict = {"org_id": org_id, "year_start": date(fiscal_year, 1, 1), "year_end": date(fiscal_year, 12, 31)}
    if department_id:
        params["department_id"] = department_id

    revenue_rows = await db.execute(
        text(f"""
            SELECT date_trunc('month', pc.certified_at)::date AS month, SUM(pc.certified_amount) AS amount
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            WHERE p.organization_id = :org_id AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
              AND pc.certified_at BETWEEN :year_start AND :year_end AND {dept_filter}
            GROUP BY 1
        """),
        params,
    )
    cost_rows = await db.execute(
        text(f"""
            SELECT date_trunc('month', ct.transaction_date)::date AS month, SUM(ct.amount) AS amount
            FROM finance.cost_transactions ct
            JOIN projects.projects p ON p.id = ct.project_id
            WHERE ct.organization_id = :org_id AND ct.transaction_date BETWEEN :year_start AND :year_end AND {dept_filter}
            GROUP BY 1
        """),
        params,
    )
    dept_filter_payroll = "pi.department_id IS NOT DISTINCT FROM :department_id" if department_id else "TRUE"
    dept_filter_supplier = "spi.department_id IS NOT DISTINCT FROM :department_id" if department_id else "TRUE"
    direct_cost_rows = await db.execute(
        text(f"""
            SELECT month, SUM(amount) AS amount FROM (
                SELECT date_trunc('month', cb.transaction_date)::date AS month, cb.amount
                FROM finance.cashbook_transactions cb
                WHERE cb.organization_id = :org_id AND cb.project_id IS NULL AND cb.direction = 'outflow'
                  AND cb.is_deleted = false AND cb.transaction_date BETWEEN :year_start AND :year_end AND {dept_filter_direct}
                UNION ALL
                SELECT date_trunc('month', pr.payment_date)::date AS month, pi.net_pay
                FROM finance.payroll_items pi
                JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.status = 'posted'
                WHERE pi.organization_id = :org_id AND pi.project_id IS NULL
                  AND pr.payment_date BETWEEN :year_start AND :year_end AND {dept_filter_payroll}
                UNION ALL
                SELECT date_trunc('month', spb.payment_date)::date AS month, spi.amount
                FROM finance.supplier_payment_items spi
                JOIN finance.supplier_payment_batches spb ON spb.id = spi.batch_id
                WHERE spi.organization_id = :org_id AND spi.project_id IS NULL
                  AND spb.payment_date BETWEEN :year_start AND :year_end AND {dept_filter_supplier}
            ) combined
            GROUP BY month
        """),
        params,
    )

    by_month: dict[date, dict[str, float]] = {}
    for row in revenue_rows.mappings().all():
        by_month.setdefault(row["month"], {"revenue": 0.0, "cost": 0.0})["revenue"] += float(row["amount"] or 0)
    for row in cost_rows.mappings().all():
        by_month.setdefault(row["month"], {"revenue": 0.0, "cost": 0.0})["cost"] += float(row["amount"] or 0)
    for row in direct_cost_rows.mappings().all():
        by_month.setdefault(row["month"], {"revenue": 0.0, "cost": 0.0})["cost"] += float(row["amount"] or 0)

    return [{"month": month, **totals} for month, totals in sorted(by_month.items())]


async def _get_budget_lines_by_month(db: AsyncSession, org_id: str, budget_id: UUID, department_id: Optional[UUID]) -> list[dict]:
    dept_filter = "department_id IS NOT DISTINCT FROM :department_id" if department_id else "TRUE"
    params: dict = {"org_id": org_id, "budget_id": budget_id}
    if department_id:
        params["department_id"] = department_id
    rows = await db.execute(
        text(f"""
            SELECT period_month AS month, line_type, SUM(amount) AS amount
            FROM finance.company_budget_lines
            WHERE organization_id = :org_id AND budget_id = :budget_id AND is_deleted = false AND {dept_filter}
            GROUP BY period_month, line_type
        """),
        params,
    )
    by_month: dict[date, dict[str, float]] = {}
    for row in rows.mappings().all():
        bucket = by_month.setdefault(row["month"], {"revenue": 0.0, "cost": 0.0})
        bucket[row["line_type"]] += float(row["amount"] or 0)
    return [{"month": month, **totals} for month, totals in sorted(by_month.items())]


async def _find_baseline_or_latest(db: AsyncSession, org_id: str, fiscal_year: int) -> Optional[dict]:
    row = await db.execute(
        text("""
            SELECT * FROM finance.company_budgets
            WHERE organization_id = :org_id AND fiscal_year = :fiscal_year AND is_deleted = false
              AND status = 'approved_baseline'
            LIMIT 1
        """),
        {"org_id": org_id, "fiscal_year": fiscal_year},
    )
    baseline = row.mappings().first()
    return dict(baseline) if baseline else None


async def _get_variance(db: AsyncSession, org_id: str, department_id: Optional[UUID], fiscal_year: int) -> dict:
    baseline = await _find_baseline_or_latest(db, org_id, fiscal_year)
    actuals = await _get_department_actuals_by_month(db, org_id, department_id, fiscal_year)
    actuals_by_month = {row["month"]: row for row in actuals}

    if not baseline:
        return {
            "fiscal_year": fiscal_year, "department_id": str(department_id) if department_id else None,
            "no_baseline_budget": True, "budget_id": None, "months": [
                {"month": str(row["month"]), "budget_revenue": None, "actual_revenue": row["revenue"], "revenue_variance": None,
                 "budget_cost": None, "actual_cost": row["cost"], "cost_variance": None,
                 "budget_net": None, "actual_net": row["revenue"] - row["cost"], "net_variance": None}
                for row in actuals
            ],
        }

    budget_lines = await _get_budget_lines_by_month(db, org_id, baseline["id"], department_id)
    budget_by_month = {row["month"]: row for row in budget_lines}

    all_months = sorted(set(actuals_by_month) | set(budget_by_month))
    months = []
    for month in all_months:
        b = budget_by_month.get(month, {"revenue": 0.0, "cost": 0.0})
        a = actuals_by_month.get(month, {"revenue": 0.0, "cost": 0.0})
        budget_net = b["revenue"] - b["cost"]
        actual_net = a["revenue"] - a["cost"]
        months.append({
            "month": str(month),
            "budget_revenue": b["revenue"], "actual_revenue": a["revenue"], "revenue_variance": a["revenue"] - b["revenue"],
            "budget_cost": b["cost"], "actual_cost": a["cost"], "cost_variance": a["cost"] - b["cost"],
            "budget_net": budget_net, "actual_net": actual_net, "net_variance": actual_net - budget_net,
        })

    return {
        "fiscal_year": fiscal_year, "department_id": str(department_id) if department_id else None,
        "no_baseline_budget": False, "budget_id": str(baseline["id"]), "budget_label": baseline["label"], "months": months,
    }


async def get_department_variance(db: AsyncSession, *, org_id: str, department_id: UUID, fiscal_year: int) -> dict:
    return await _get_variance(db, org_id, department_id, fiscal_year)


async def get_company_variance(db: AsyncSession, *, org_id: str, fiscal_year: int) -> dict:
    return await _get_variance(db, org_id, None, fiscal_year)
