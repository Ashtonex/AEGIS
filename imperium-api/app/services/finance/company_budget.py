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

The actuals side of variance reporting reads the general ledger (posted
journals on revenue and expense accounts), so it matches the financial
statements and includes every recognised cost - office expenses paid by
bank or cash included. Inter-department transfers are not ledger revenue or
expense, so they stay out, as before.
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
    """One row per month: revenue and cost as the general ledger records them.

    The ledger is the one place every recognised transaction lands - bank
    lines, uses of withdrawn cash, office expense vouchers, project money
    entries, payroll and supplier postings - so budget-vs-actual sees exactly
    what the financial statements see (an office cost paid by bank used to be
    invisible here because it creates no cashbook or project cost row).

    revenue = credits less debits on revenue and other-income accounts
    cost    = debits less credits on direct project cost, operating expense
              and other expense accounts
    Every posted journal counts, reversals included, so a reversed journal
    nets to nothing. department_id=None is the company-wide view; otherwise a
    line belongs to the department on the line itself, else its project's.
    """
    dept_filter = ("COALESCE(jl.department_id, p.department_id) IS NOT DISTINCT FROM :department_id"
                   if department_id else "TRUE")
    params: dict = {"org_id": org_id, "year_start": date(fiscal_year, 1, 1), "year_end": date(fiscal_year, 12, 31)}
    if department_id:
        params["department_id"] = department_id

    rows = await db.execute(
        text(f"""
            SELECT date_trunc('month', je.entry_date)::date AS month,
                   COALESCE(SUM(jl.credit_amount - jl.debit_amount)
                            FILTER (WHERE a.account_category IN ('revenue', 'other_income')), 0) AS revenue,
                   COALESCE(SUM(jl.debit_amount - jl.credit_amount)
                            FILTER (WHERE a.account_category IN ('direct_project_cost', 'operating_expense',
                                                                 'other_expense')), 0) AS cost
            FROM finance.journal_entries je
            JOIN finance.journal_lines jl ON jl.journal_entry_id = je.id
            JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            LEFT JOIN projects.projects p ON p.id = jl.project_id
            WHERE je.organization_id = :org_id AND je.status = 'posted'
              AND je.entry_date BETWEEN :year_start AND :year_end
              AND a.account_category IN ('revenue', 'other_income', 'direct_project_cost', 'operating_expense',
                                         'other_expense')
              AND {dept_filter}
            GROUP BY 1
            ORDER BY 1
        """),
        params,
    )
    return [{"month": r["month"], "revenue": float(r["revenue"] or 0), "cost": float(r["cost"] or 0)}
            for r in rows.mappings().all()]


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
