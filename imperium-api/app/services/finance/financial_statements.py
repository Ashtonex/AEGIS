"""
Core GL-sourced financial statements (Phase 11A): Income Statement,
Balance Sheet, Cash Movement Statement, and AR/AP aging.

Purely additive and read-only - built entirely on top of the existing,
already-trusted finance.chart_of_accounts / journal_entries / journal_lines
tables (Phase 1) and general_ledger.get_trial_balance. This never touches
or replaces routers/financial_performance.py's GET /statements (a
genuinely different, operational-table-based department P&L) - the two
are deliberately kept parallel, matching Phase 2's established precedent
for GL-derived vs. operational-table-derived figures.

No formal period-end closing-entry mechanism exists yet in this GL (Phase
1 scoped that out), so the Balance Sheet computes its Retained Earnings
line live, from inception-to-date P&L account balances, rather than
relying on a stale/nonexistent closing entry - see get_balance_sheet's
docstring for why this is the correct treatment, not a workaround.
"""

from datetime import date, timedelta
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import get_trial_balance

_PNL_CATEGORIES = ("revenue", "direct_project_cost", "operating_expense", "other_income", "other_expense")
_BALANCE_SHEET_CATEGORIES = ("asset", "liability", "equity")
_CASH_ACCOUNT_CODE = "1000"


async def _get_period_activity(
    db: AsyncSession, *, org_id: str, period_start: date, period_end: date
) -> list[dict]:
    """Same shape as general_ledger.get_trial_balance, but bounded to a
    date range rather than cumulative-from-inception - what an Income
    Statement needs (this period's revenue/expense), as opposed to a
    Balance Sheet's as-of-date cumulative position."""
    rows = await db.execute(
        text("""
            SELECT
                a.id AS account_id, a.account_code, a.account_name, a.account_category, a.normal_balance,
                COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS total_debit,
                COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS total_credit,
                COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0)
                    - COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS net_balance
            FROM finance.chart_of_accounts a
            LEFT JOIN finance.journal_lines jl ON jl.account_id = a.id AND jl.organization_id = :org_id
            LEFT JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
                AND je.status = 'posted' AND je.entry_date BETWEEN :period_start AND :period_end
            WHERE a.organization_id = :org_id AND a.is_deleted = false
            GROUP BY a.id, a.account_code, a.account_name, a.account_category, a.normal_balance
            HAVING COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0) <> 0
                OR COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) <> 0
            ORDER BY a.account_code
        """),
        {"org_id": org_id, "period_start": period_start, "period_end": period_end},
    )
    return [dict(r) for r in rows.mappings()]


def _sum_category(rows: list[dict], category: str) -> float:
    return round(sum(float(r["net_balance"]) for r in rows if r["account_category"] == category), 2)


async def get_income_statement(db: AsyncSession, *, org_id: str, period_start: date, period_end: date) -> dict:
    rows = await _get_period_activity(db, org_id=org_id, period_start=period_start, period_end=period_end)
    by_category = {cat: [r for r in rows if r["account_category"] == cat] for cat in _PNL_CATEGORIES}

    total_revenue = -_sum_category(rows, "revenue")  # revenue is normally credit-balance; flip sign for display
    total_direct_cost = _sum_category(rows, "direct_project_cost")
    total_operating_expense = _sum_category(rows, "operating_expense")
    total_other_income = -_sum_category(rows, "other_income")
    total_other_expense = _sum_category(rows, "other_expense")

    gross_profit = round(total_revenue - total_direct_cost, 2)
    net_income = round(gross_profit - total_operating_expense + total_other_income - total_other_expense, 2)

    return {
        "period_start": period_start,
        "period_end": period_end,
        "revenue": by_category["revenue"],
        "direct_project_cost": by_category["direct_project_cost"],
        "operating_expense": by_category["operating_expense"],
        "other_income": by_category["other_income"],
        "other_expense": by_category["other_expense"],
        "total_revenue": total_revenue,
        "total_direct_cost": total_direct_cost,
        "gross_profit": gross_profit,
        "total_operating_expense": total_operating_expense,
        "total_other_income": total_other_income,
        "total_other_expense": total_other_expense,
        "net_income": net_income,
    }


async def get_balance_sheet(db: AsyncSession, *, org_id: str, as_of_date: date) -> dict:
    """Assets/Liabilities as posted, plus an explicit "Retained Earnings
    (Current + Prior Periods)" equity line computed live from every
    revenue/cost/expense account's balance from inception through
    as_of_date - since this GL has no formal period-close mechanism to
    sweep P&L into Retained Earnings, computing it live on every request
    is the correct equivalent, not a workaround. is_balanced is returned
    as a visible diagnostic so any future drift is surfaced, never hidden.
    """
    rows = await get_trial_balance(db, org_id=org_id, as_of_date=as_of_date)

    assets = [r for r in rows if r["account_category"] == "asset"]
    liabilities = [r for r in rows if r["account_category"] == "liability"]
    equity = [r for r in rows if r["account_category"] == "equity"]

    total_assets = round(sum(float(r["net_balance"]) for r in assets), 2)
    total_liabilities = round(-sum(float(r["net_balance"]) for r in liabilities), 2)
    posted_equity = round(-sum(float(r["net_balance"]) for r in equity), 2)

    # revenue/other_income are credit-normal (negative net_balance under this
    # debit-positive convention), so their contribution here must be flipped
    # positive - same sign shape as get_income_statement's net_income.
    retained_earnings = round(
        (-_sum_category(rows, "revenue")) - _sum_category(rows, "direct_project_cost")
        - _sum_category(rows, "operating_expense") + (-_sum_category(rows, "other_income"))
        - _sum_category(rows, "other_expense"),
        2,
    )

    total_equity = round(posted_equity + retained_earnings, 2)
    total_liabilities_and_equity = round(total_liabilities + total_equity, 2)

    return {
        "as_of_date": as_of_date,
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "retained_earnings_current_and_prior": retained_earnings,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "total_equity": total_equity,
        "total_liabilities_and_equity": total_liabilities_and_equity,
        "is_balanced": abs(total_assets - total_liabilities_and_equity) < 0.01,
    }


async def get_cash_movement_statement(db: AsyncSession, *, org_id: str, period_start: date, period_end: date) -> dict:
    """Direct-method statement over the single Cash and Bank GL account
    (code 1000) only - not a full indirect-method Cash Flow Statement
    (chart_of_accounts has no operating/investing/financing classification
    today; that is a separate, undecided design question, not solved
    here). Cross-checks its own closing balance against a direct
    trial-balance call for the same account/date as a correctness guard.
    """
    account_row = (
        await db.execute(
            text("SELECT id FROM finance.chart_of_accounts WHERE organization_id = :org_id AND account_code = :code"),
            {"org_id": org_id, "code": _CASH_ACCOUNT_CODE},
        )
    ).first()
    if account_row is None:
        raise ValueError(f"No chart_of_accounts row with account_code={_CASH_ACCOUNT_CODE} for this organization.")
    cash_account_id = account_row[0]

    opening_as_of = period_start - timedelta(days=1)
    opening_rows = await get_trial_balance(db, org_id=org_id, as_of_date=opening_as_of)
    opening_balance = next((float(r["net_balance"]) for r in opening_rows if r["account_id"] == cash_account_id), 0.0)

    movement_rows = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(jl.debit_amount), 0) AS inflows,
                COALESCE(SUM(jl.credit_amount), 0) AS outflows
            FROM finance.journal_lines jl
            JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
            WHERE jl.organization_id = :org_id AND jl.account_id = :account_id
              AND je.status = 'posted' AND je.entry_date BETWEEN :period_start AND :period_end
        """),
        {"org_id": org_id, "account_id": cash_account_id, "period_start": period_start, "period_end": period_end},
    )
    movement = movement_rows.mappings().first()
    inflows = float(movement["inflows"]) if movement else 0.0
    outflows = float(movement["outflows"]) if movement else 0.0
    closing_balance = round(opening_balance + inflows - outflows, 2)

    closing_check_rows = await get_trial_balance(db, org_id=org_id, as_of_date=period_end)
    closing_check = next(
        (float(r["net_balance"]) for r in closing_check_rows if r["account_id"] == cash_account_id), 0.0
    )

    return {
        "period_start": period_start,
        "period_end": period_end,
        "opening_balance": round(opening_balance, 2),
        "inflows": round(inflows, 2),
        "outflows": round(outflows, 2),
        "closing_balance": closing_balance,
        "reconciles": abs(closing_balance - round(closing_check, 2)) < 0.01,
    }


async def get_ar_aging(db: AsyncSession, *, org_id: str, as_of_date: Optional[date] = None) -> list[dict]:
    """Never infers "outstanding" from progress_claims.status - computes
    the real outstanding balance per claim against actual cash received
    (receipt_allocations) and only includes claims where that computed
    outstanding is materially non-zero."""
    as_of = as_of_date or date.today()
    rows = await db.execute(
        text("""
            SELECT
                pc.id AS claim_id, pc.project_id, p.name AS project_name,
                pc.certified_amount, pc.certified_at, pc.claim_period_end,
                COALESCE(SUM(ra.allocated_amount), 0) AS allocated_amount
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id AND p.organization_id = pc.organization_id
            LEFT JOIN finance.receipt_allocations ra
                ON ra.progress_claim_id = pc.id AND ra.organization_id = pc.organization_id
            WHERE pc.organization_id = :org_id AND pc.is_deleted = false
              AND pc.certified_amount IS NOT NULL
              AND pc.status NOT IN ('draft', 'submitted', 'disputed', 'rejected')
            GROUP BY pc.id, pc.project_id, p.name, pc.certified_amount, pc.certified_at, pc.claim_period_end
        """),
        {"org_id": org_id},
    )
    results = []
    for r in rows.mappings():
        outstanding = round(float(r["certified_amount"]) - float(r["allocated_amount"]), 2)
        if abs(outstanding) < 0.01:
            continue
        age_basis = r["certified_at"].date() if r["certified_at"] else r["claim_period_end"]
        age_days = (as_of - age_basis).days if age_basis else None
        results.append({
            "claim_id": str(r["claim_id"]),
            "project_id": str(r["project_id"]),
            "project_name": r["project_name"],
            "certified_amount": float(r["certified_amount"]),
            "outstanding_amount": outstanding,
            "age_days": age_days,
            "bucket": _age_bucket(age_days),
        })
    return results


async def get_ap_aging(db: AsyncSession, *, org_id: str, as_of_date: Optional[date] = None) -> list[dict]:
    """Same principle as get_ar_aging: computes real outstanding balance
    against actual payments made (supplier_payment_items), never infers
    from supplier_invoices.status."""
    as_of = as_of_date or date.today()
    rows = await db.execute(
        text("""
            SELECT
                si.id AS invoice_id, si.supplier_id, s.supplier_name AS supplier_name,
                si.total_amount, si.invoice_date, si.due_date,
                COALESCE(SUM(spi.amount), 0) AS paid_amount
            FROM procurement.supplier_invoices si
            JOIN procurement.suppliers s ON s.id = si.supplier_id AND s.organization_id = si.organization_id
            LEFT JOIN finance.supplier_payment_items spi
                ON spi.supplier_invoice_id = si.id AND spi.organization_id = si.organization_id
            WHERE si.organization_id = :org_id
              AND si.status NOT IN ('cancelled', 'rejected')
            GROUP BY si.id, si.supplier_id, s.supplier_name, si.total_amount, si.invoice_date, si.due_date
        """),
        {"org_id": org_id},
    )
    results = []
    for r in rows.mappings():
        outstanding = round(float(r["total_amount"]) - float(r["paid_amount"]), 2)
        if abs(outstanding) < 0.01:
            continue
        age_basis = r["due_date"] or r["invoice_date"]
        age_days = (as_of - age_basis).days if age_basis else None
        results.append({
            "invoice_id": str(r["invoice_id"]),
            "supplier_id": str(r["supplier_id"]),
            "supplier_name": r["supplier_name"],
            "total_amount": float(r["total_amount"]),
            "outstanding_amount": outstanding,
            "age_days": age_days,
            "bucket": _age_bucket(age_days),
        })
    return results


def _age_bucket(age_days: Optional[int]) -> str:
    if age_days is None:
        return "unknown"
    if age_days <= 30:
        return "0-30"
    if age_days <= 60:
        return "31-60"
    if age_days <= 90:
        return "61-90"
    return "90+"
