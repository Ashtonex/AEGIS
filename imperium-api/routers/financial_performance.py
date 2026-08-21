import calendar
from datetime import date, datetime, timedelta
from datetime import time as datetime_time
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from typing import Optional, List, Any, Dict
from uuid import UUID, uuid4
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.events import emit_notification
from app.shared.pagination import ok
from app.services.finance.payroll_tax import compute_statutory
from app.services.finance.tax_rates import NoRateTableError, resolve_rate_table
from app.services.finance.statutory_accrual import accrue_liability_line
from routers.payroll_runs import _compute_gross

router = APIRouter()


class CostCodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(default="materials", max_length=40)
    department_id: Optional[UUID] = None


class VariationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    variation_number: str = Field(min_length=1, max_length=40)
    project_id: UUID
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    initiated_by: str = Field(default="client", max_length=40)
    cost_impact: float = 0.0
    time_impact_days: int = 0


class CashAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    account_code: str = Field(min_length=1, max_length=40)
    account_name: str = Field(min_length=1, max_length=255)
    account_type: str = Field(min_length=1, max_length=24)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    branch_name: Optional[str] = Field(default=None, max_length=160)
    account_number: Optional[str] = Field(default=None, max_length=120)
    currency: str = Field(default="USD", max_length=3)
    opening_balance: float = 0.0


class CashbookTransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cash_account_id: UUID
    transaction_number: str = Field(min_length=1, max_length=40)
    transaction_date: date = Field(default_factory=date.today)
    transaction_type: str = Field(min_length=1, max_length=24)
    direction: str = Field(min_length=1, max_length=8)
    amount: float = Field(gt=0)
    description: str
    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    counterparty_type: Optional[str] = Field(default=None, max_length=40)
    counterparty_name: Optional[str] = Field(default=None, max_length=255)
    payment_method: str = Field(default="bank_transfer", max_length=40)
    reference: Optional[str] = Field(default=None, max_length=160)


class ReceiptAllocationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cashbook_transaction_id: UUID
    progress_claim_id: UUID
    project_id: UUID
    allocated_amount: float = Field(gt=0)


class SupplierPaymentItem(BaseModel):
    supplier_invoice_id: UUID
    supplier_id: UUID
    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    amount: float = Field(gt=0)
    payment_reference: Optional[str] = Field(default=None, max_length=160)


class SupplierPaymentBatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    batch_number: str = Field(min_length=1, max_length=40)
    cash_account_id: UUID
    payment_date: date = Field(default_factory=date.today)
    payment_method: str = Field(default="bank_transfer", max_length=40)
    reference: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = None
    items: List[SupplierPaymentItem]


class EmployeePayProfileUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    pay_type: str = Field(min_length=1, max_length=24)
    base_rate: float = Field(ge=0)
    overtime_rate: float = Field(default=0.0, ge=0)
    currency: str = Field(default="USD", max_length=3)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    bank_account_number: Optional[str] = Field(default=None, max_length=120)
    tax_number: Optional[str] = Field(default=None, max_length=80)
    nssa_number: Optional[str] = Field(default=None, max_length=80)
    is_active: bool = True


class PayrollItemPayload(BaseModel):
    # gross_pay/tax_deduction/statutory_deduction/net_pay are deliberately
    # NOT accepted here - they used to be trusted verbatim from the client
    # with zero server-side validation, which became a real hole once real
    # PAYE/NSSA computation existed elsewhere: a client could submit
    # fabricated tax figures through this router while payroll_runs.py
    # validated correctly. Both routers now compute pay identically (see
    # create_payroll_run below), so neither accepts a client-supplied
    # figure for any of it.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    employee_id: UUID
    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    regular_hours: float = 0.0
    overtime_hours: float = 0.0
    other_deduction: float = 0.0


class PayrollRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    run_number: str = Field(min_length=1, max_length=40)
    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: Optional[UUID] = None
    items: List[PayrollItemPayload]


class PayrollDecisionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: str = Field(min_length=1, max_length=24)


@router.get("/projects")
async def list_project_financial_summaries(
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List running financial metrics for all active projects by dynamically
    aggregating budgets, actual costs, commitments, and progress claims.

    Optionally scoped to a department. Projects with no department assigned
    yet are always included alongside a matching department so nothing
    silently disappears from view - they just won't count toward a specific
    department's rollup (that decision is made client-side/at the summary
    layer, not by hiding rows here).
    """
    query = text("""
        SELECT
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            p.department_id,
            d.name AS department_name,

            -- Variations
            COALESCE((
                SELECT SUM(v.cost_impact) 
                FROM finance.variations v 
                WHERE v.project_id = p.id AND v.organization_id = :org_id 
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,
            
            -- Actual Cost = ordinary posted cost_transactions (excluding any
            -- row superseded by a posted internal-transfer charge, e.g. an
            -- internal plant hire's internal operating-cost row, so the
            -- same usage isn't counted twice) PLUS internal-transfer
            -- charges against this project (e.g. the hire rate it was
            -- actually billed) - so a project using hired equipment shows
            -- its real cost, not the internal operating cost.
            COALESCE((
                SELECT SUM(ct.amount)
                FROM finance.cost_transactions ct
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
                  AND NOT EXISTS (
                      SELECT 1 FROM finance.department_transfers dt
                      WHERE dt.organization_id = ct.organization_id
                        AND dt.source_type = ct.source_type AND dt.source_id = ct.source_id
                        AND dt.status = 'posted'
                  )
            ), 0)
            + COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'charge'
            ), 0) AS actual_cost_to_date,

            -- Internal transfer legs charged/credited to this project, broken
            -- out for transparency (already folded into actual_cost_to_date above)
            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'charge'
            ), 0) AS internal_transfer_charges,
            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'credit'
            ), 0) AS internal_transfer_credits,

            -- Committed Cost (outstanding PO obligations)
            COALESCE((
                SELECT SUM(c.outstanding_amount) 
                FROM finance.commitments c 
                WHERE c.project_id = p.id AND c.organization_id = :org_id 
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            -- Certified Revenue
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            -- Cash Collected
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            -- Budget Limit
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget

        FROM projects.projects p
        LEFT JOIN finance.departments d ON d.id = p.department_id
        WHERE p.organization_id = :org_id AND p.is_deleted = false
          AND (:department_filter_active = false OR p.department_id = :department_id OR p.department_id IS NULL)
        ORDER BY p.name
    """)

    result = await db.execute(
        query,
        {
            "org_id": user["org_id"],
            "department_id": department_id,
            "department_filter_active": department_id is not None,
        },
    )
    summaries = [dict(row._mapping) for row in result]
    return ok(summaries, "Project financial summaries listed.")


@router.get("/projects/{project_id}")
async def get_project_financial_detail(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed financial dashboard structure for a specific project.
    """
    query = text("""
        SELECT 
            p.id AS project_id,
            p.project_code,
            p.name AS project_name,
            p.status AS project_status,
            COALESCE(p.contract_value, 0) AS contract_value,
            
            COALESCE((
                SELECT SUM(v.cost_impact)
                FROM finance.variations v
                WHERE v.project_id = p.id AND v.organization_id = :org_id
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_variations,

            COALESCE((
                SELECT SUM(v.time_impact_days)
                FROM finance.variations v
                WHERE v.project_id = p.id AND v.organization_id = :org_id
                  AND v.status = 'approved' AND v.is_deleted = false
            ), 0) AS approved_time_impact_days,

            COALESCE((
                SELECT SUM(ct.amount)
                FROM finance.cost_transactions ct
                WHERE ct.project_id = p.id AND ct.organization_id = :org_id
                  AND NOT EXISTS (
                      SELECT 1 FROM finance.department_transfers dt
                      WHERE dt.organization_id = ct.organization_id
                        AND dt.source_type = ct.source_type AND dt.source_id = ct.source_id
                        AND dt.status = 'posted'
                  )
            ), 0)
            + COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'charge'
            ), 0) AS actual_cost_to_date,

            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'charge'
            ), 0) AS internal_transfer_charges,
            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers dt ON dt.id = l.transfer_id AND dt.status = 'posted'
                WHERE l.project_id = p.id AND l.organization_id = :org_id AND l.leg_type = 'credit'
            ), 0) AS internal_transfer_credits,

            COALESCE((
                SELECT SUM(c.outstanding_amount)
                FROM finance.commitments c
                WHERE c.project_id = p.id AND c.organization_id = :org_id
                  AND c.status = 'active' AND c.is_deleted = false
            ), 0) AS committed_cost,
            
            COALESCE((
                SELECT SUM(pc.certified_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
            ), 0) AS certified_to_date,
            
            COALESCE((
                SELECT SUM(pc.net_claim_amount) 
                FROM finance.progress_claims pc 
                WHERE pc.project_id = p.id AND pc.organization_id = :org_id 
                  AND pc.status = 'paid' AND pc.is_deleted = false
            ), 0) AS cash_collected,
            
            COALESCE((
                SELECT pb.total_amount 
                FROM finance.project_budgets pb 
                WHERE pb.project_id = p.id AND pb.organization_id = :org_id 
                  AND pb.status = 'approved' AND pb.is_deleted = false 
                LIMIT 1
            ), 0) AS approved_budget
            
        FROM projects.projects p
        WHERE p.id = :project_id AND p.organization_id = :org_id AND p.is_deleted = false
    """)

    result = await db.execute(
        query, {"project_id": project_id, "org_id": user["org_id"]}
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Project ledger not found.")

    detail = dict(row._mapping)

    # Check flags
    eac = detail["actual_cost_to_date"] + detail["committed_cost"]
    budget = detail["approved_budget"]
    detail["cost_overrun_risk"] = eac > budget and budget > 0
    detail["cashflow_deficit_risk"] = (
        detail["committed_cost"] > detail["cash_collected"]
    )

    return ok(detail, "Project financial detail retrieved.")


async def _compute_department_pnl(db: AsyncSession, org_id: str, date_from: Optional[date], date_to: Optional[date]) -> dict:
    """
    Revenue and cost per department, plus an "Unassigned" row for anything
    without a department yet and an org-wide total - this is what actually
    answers "revenue per department and revenue for the entire business."

    Combines: external client revenue (progress claims, via the project's
    department), internal transfer revenue/cost (department_transfer_legs,
    directly tagged), project-committed cost (cost_transactions, via the
    project's department, excluding rows superseded by a posted transfer),
    and non-project direct cost (cashbook/payroll/supplier-payment rows
    that already carry their own department_id from Phase 1 but were never
    rolled up anywhere until now). All five legs are date-bound identically
    when date_from/date_to are supplied - shared by both /departments/pnl
    and /statements so a fix here benefits both.
    """
    date_filters = ""
    revenue_date_filter = ""
    cost_date_filter = ""
    cashbook_date_filter = ""
    payroll_date_filter = ""
    supplier_payment_date_filter = ""
    params: dict = {"org_id": org_id}
    if date_from:
        date_filters += " AND t.transfer_date >= :date_from"
        revenue_date_filter += " AND pc.certified_at >= :date_from"
        cost_date_filter += " AND ct.transaction_date >= :date_from"
        cashbook_date_filter += " AND cb.transaction_date >= :date_from"
        payroll_date_filter += " AND pr.payment_date >= :date_from"
        supplier_payment_date_filter += " AND spb.payment_date >= :date_from"
        params["date_from"] = date_from
    if date_to:
        date_filters += " AND t.transfer_date <= :date_to"
        revenue_date_filter += " AND pc.certified_at <= :date_to"
        cost_date_filter += " AND ct.transaction_date <= :date_to"
        cashbook_date_filter += " AND cb.transaction_date <= :date_to"
        payroll_date_filter += " AND pr.payment_date <= :date_to"
        supplier_payment_date_filter += " AND spb.payment_date <= :date_to"
        params["date_to"] = date_to

    query = text(f"""
        WITH depts AS (
            SELECT id, name FROM finance.departments
            WHERE organization_id = :org_id AND is_deleted = false
            UNION ALL
            SELECT NULL::uuid, 'Unassigned'
        )
        SELECT
            d.id AS department_id,
            d.name AS department_name,

            COALESCE((
                SELECT SUM(pc.certified_amount)
                FROM finance.progress_claims pc
                JOIN projects.projects p ON p.id = pc.project_id
                WHERE p.organization_id = :org_id AND p.department_id IS NOT DISTINCT FROM d.id
                  AND pc.status IN ('certified', 'paid') AND pc.is_deleted = false
                  {revenue_date_filter}
            ), 0) AS external_revenue,

            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers t ON t.id = l.transfer_id AND t.status = 'posted'
                WHERE l.organization_id = :org_id AND l.department_id IS NOT DISTINCT FROM d.id AND l.leg_type = 'credit'
                {date_filters}
            ), 0) AS internal_revenue,

            COALESCE((
                SELECT SUM(ct.amount)
                FROM finance.cost_transactions ct
                JOIN projects.projects p ON p.id = ct.project_id
                WHERE ct.organization_id = :org_id AND p.department_id IS NOT DISTINCT FROM d.id
                  AND NOT EXISTS (
                      SELECT 1 FROM finance.department_transfers dt2
                      WHERE dt2.organization_id = ct.organization_id
                        AND dt2.source_type = ct.source_type AND dt2.source_id = ct.source_id
                        AND dt2.status = 'posted'
                  )
                  {cost_date_filter}
            ), 0) AS project_cost,

            COALESCE((
                SELECT SUM(l.amount) FROM finance.department_transfer_legs l
                JOIN finance.department_transfers t ON t.id = l.transfer_id AND t.status = 'posted'
                WHERE l.organization_id = :org_id AND l.department_id IS NOT DISTINCT FROM d.id AND l.leg_type = 'charge'
                {date_filters}
            ), 0) AS internal_cost,

            COALESCE((
                SELECT SUM(cb.amount) FROM finance.cashbook_transactions cb
                WHERE cb.organization_id = :org_id AND cb.department_id IS NOT DISTINCT FROM d.id
                  AND cb.project_id IS NULL AND cb.direction = 'outflow' AND cb.is_deleted = false
                  {cashbook_date_filter}
            ), 0)
            + COALESCE((
                SELECT SUM(pi.net_pay) FROM finance.payroll_items pi
                JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.status = 'posted'
                WHERE pi.organization_id = :org_id AND pi.department_id IS NOT DISTINCT FROM d.id AND pi.project_id IS NULL
                {payroll_date_filter}
            ), 0)
            + COALESCE((
                SELECT SUM(spi.amount) FROM finance.supplier_payment_items spi
                JOIN finance.supplier_payment_batches spb ON spb.id = spi.batch_id
                WHERE spi.organization_id = :org_id AND spi.department_id IS NOT DISTINCT FROM d.id AND spi.project_id IS NULL
                {supplier_payment_date_filter}
            ), 0) AS direct_cost_non_project

        FROM depts d
        ORDER BY d.name
    """)

    result = await db.execute(query, params)
    rows = [dict(r._mapping) for r in result]

    org_totals = {"external_revenue": 0, "internal_revenue": 0, "project_cost": 0, "internal_cost": 0, "direct_cost_non_project": 0}
    for row in rows:
        revenue = float(row["external_revenue"]) + float(row["internal_revenue"])
        cost = float(row["project_cost"]) + float(row["internal_cost"]) + float(row["direct_cost_non_project"])
        row["total_revenue"] = revenue
        row["total_cost"] = cost
        row["net"] = revenue - cost
        for key in org_totals:
            org_totals[key] += float(row[key])

    org_revenue = org_totals["external_revenue"] + org_totals["internal_revenue"]
    org_cost = org_totals["project_cost"] + org_totals["internal_cost"] + org_totals["direct_cost_non_project"]
    org_row = {
        "department_id": None,
        "department_name": "Consolidated (whole business)",
        **org_totals,
        "total_revenue": org_revenue,
        "total_cost": org_cost,
        "net": org_revenue - org_cost,
    }

    return {"departments": rows, "consolidated": org_row}


@router.get("/departments/pnl")
async def get_department_pnl(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.cost.read")),
    db: AsyncSession = Depends(get_db),
):
    data = await _compute_department_pnl(db, user["org_id"], date_from, date_to)
    return ok(data, "Department P&L retrieved.")


PERIOD_TYPES = ("day", "week", "month", "quarter", "year")


def _resolve_period(period: Optional[str], anchor_date: Optional[date]) -> tuple[date, date]:
    """Resolves a period keyword + anchor date into a (date_from, date_to)
    pair. anchor_date defaults to today - callers pass a past date to view
    a historical period (e.g. anchor_date=2026-03-15, period=month -> all
    of March 2026)."""
    anchor = anchor_date or date.today()
    if period == "day":
        return anchor, anchor
    if period == "week":
        start = anchor - timedelta(days=anchor.weekday())
        return start, start + timedelta(days=6)
    if period == "quarter":
        quarter_start_month = ((anchor.month - 1) // 3) * 3 + 1
        start = date(anchor.year, quarter_start_month, 1)
        end_month = quarter_start_month + 2
        end_day = calendar.monthrange(anchor.year, end_month)[1]
        return start, date(anchor.year, end_month, end_day)
    if period == "year":
        return date(anchor.year, 1, 1), date(anchor.year, 12, 31)
    # default / "month"
    last_day = calendar.monthrange(anchor.year, anchor.month)[1]
    return date(anchor.year, anchor.month, 1), date(anchor.year, anchor.month, last_day)


@router.get("/statements")
async def get_financial_statements(
    period: Optional[str] = Query(default=None, pattern=r"^(day|week|month|quarter|year)$"),
    anchor_date: Optional[date] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.statement.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Period- and segment-filterable financial statement. If explicit
    date_from/date_to aren't supplied, `period` (+ optional anchor_date,
    defaulting to today) resolves them server-side - `period=month` with no
    anchor is the current calendar month, `period=month&anchor_date=2026-03-15`
    is all of March 2026, etc. Built on the same department P&L computation
    /departments/pnl uses (now properly date-bound on every leg, not just
    internal transfers), plus a cash-position snapshot.
    """
    if not date_from or not date_to:
        date_from, date_to = _resolve_period(period, anchor_date)

    pnl = await _compute_department_pnl(db, user["org_id"], date_from, date_to)

    if department_id:
        row = next((d for d in pnl["departments"] if str(d["department_id"]) == str(department_id)), None)
        segment = row or {"department_id": department_id, "department_name": "Unknown", "total_revenue": 0, "total_cost": 0, "net": 0}
    else:
        segment = pnl["consolidated"]

    cash_row = (
        await db.execute(
            text("""
            SELECT COALESCE(SUM(current_balance), 0) AS total_cash
            FROM finance.cash_accounts
            WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
        """),
            {"org_id": user["org_id"]},
        )
    ).first()
    total_cash = float(cash_row.total_cash) if cash_row else 0.0

    burn_row = (
        await db.execute(
            text("""
            SELECT COALESCE(SUM(amount), 0) AS total_outflow
            FROM finance.cashbook_transactions
            WHERE organization_id = :org_id AND direction = 'outflow' AND is_deleted = false
              AND transaction_date >= (CURRENT_DATE - INTERVAL '90 days')
        """),
            {"org_id": user["org_id"]},
        )
    ).first()
    monthly_burn = (float(burn_row.total_outflow) / 3.0) if burn_row else 0.0
    runway_months = round(total_cash / monthly_burn, 1) if monthly_burn > 0 else None

    return ok(
        {
            "period": {"date_from": date_from, "date_to": date_to, "type": period or "month"},
            "departments": pnl["departments"],
            "consolidated": pnl["consolidated"],
            "segment": segment,
            "cash_position": {
                "total_cash": total_cash,
                "trailing_monthly_burn": round(monthly_burn, 2),
                "runway_months": runway_months,
            },
        },
        "Financial statement retrieved.",
    )


@router.get("/cost-codes")
async def list_cost_codes(
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.budget.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List all cost codes in the organisation structure, optionally scoped to
    a department. Cost codes with no department assigned always show
    alongside a matching department.
    """
    query_str = """
        SELECT * FROM finance.cost_codes
        WHERE organization_id = :org_id AND is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if department_id:
        query_str += " AND (department_id = :department_id OR department_id IS NULL)"
        params["department_id"] = department_id
    query_str += " ORDER BY code"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cost codes listed.")


@router.post("/cost-codes", status_code=status.HTTP_201_CREATED)
async def create_cost_code(
    payload: CostCodeCreate,
    user: dict = Depends(require_permission("finance.budget.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new cost code.
    """
    try:
        cost_code_id = (
            await db.execute(
                text("""
            INSERT INTO finance.cost_codes (organization_id, code, name, category, department_id)
            VALUES (:org_id, :code, :name, :category, :department_id)
            RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "code": payload.code,
                    "name": payload.name,
                    "category": payload.category,
                    "department_id": payload.department_id,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(cost_code_id)}, "Cost code created.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cost code already exists.")


@router.get("/variations")
async def list_variations(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.variation.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List variations, optionally filtered by project, status, or department
    (derived from the variation's project - a variation with no department
    assigned via its project always shows alongside a matching department).
    """
    query_str = """
        SELECT v.*, p.name AS project_name, p.department_id
        FROM finance.variations v
        JOIN projects.projects p ON p.id = v.project_id AND p.organization_id = v.organization_id
        WHERE v.organization_id = :org_id AND v.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND v.project_id = :project_id"
        params["project_id"] = project_id
    if status_filter:
        query_str += " AND v.status = :status"
        params["status"] = status_filter
    if department_id:
        query_str += " AND (p.department_id = :department_id OR p.department_id IS NULL)"
        params["department_id"] = department_id

    query_str += " ORDER BY v.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Variations listed.")


@router.post("/variations", status_code=status.HTTP_201_CREATED)
async def create_variation(
    payload: VariationCreate,
    user: dict = Depends(require_permission("finance.variation.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new variation order.
    """
    # Verify project
    proj = await db.execute(
        text(
            "SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"
        ),
        {"id": payload.project_id, "org_id": user["org_id"]},
    )
    if not proj.first():
        raise HTTPException(status_code=404, detail="Project not found.")

    try:
        var_id = (
            await db.execute(
                text("""
            INSERT INTO finance.variations (
                organization_id, variation_number, project_id, title, description,
                initiated_by, cost_impact, time_impact_days, status
            ) VALUES (
                :org_id, :variation_number, :project_id, :title, :description,
                :initiated_by, :cost_impact, :time_impact_days, 'pending'
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "variation_number": payload.variation_number,
                    "project_id": payload.project_id,
                    "title": payload.title,
                    "description": payload.description,
                    "initiated_by": payload.initiated_by,
                    "cost_impact": payload.cost_impact,
                    "time_impact_days": payload.time_impact_days,
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(var_id)}, "Variation order recorded.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Variation number already exists.")


class VariationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    decision: str = Field(pattern=r"^(approve|reject)$")
    rejection_reason: Optional[str] = Field(default=None, max_length=1000)


@router.post("/variations/{variation_id}/decision")
async def decide_variation(
    variation_id: UUID,
    payload: VariationDecision,
    user: dict = Depends(require_permission("finance.variation.approve")),
    db: AsyncSession = Depends(get_db),
):
    """
    Approve or reject a variation. Approving immediately affects the
    project's financial detail view (GET /projects/{project_id}) - both
    approved_variations (cost) and approved_time_impact_days sum approved
    rows live, so no separate propagation step is needed.
    """
    row = (
        await db.execute(
            text("""
            SELECT id, status FROM finance.variations
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
            {"id": variation_id, "org_id": user["org_id"]},
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Variation not found.")
    if row.status not in ("pending", "submitted"):
        raise HTTPException(status_code=409, detail=f"Cannot decide a variation in '{row.status}' state.")
    if payload.decision == "reject" and not payload.rejection_reason:
        raise HTTPException(status_code=422, detail="A rejection reason is required.")

    new_status = "approved" if payload.decision == "approve" else "rejected"
    await db.execute(
        text("""
        UPDATE finance.variations
        SET status = :status, approved_by = :user_id, approved_at = NOW(),
            rejection_reason = :rejection_reason, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {
            "status": new_status, "user_id": user["user_id"], "rejection_reason": payload.rejection_reason,
            "id": variation_id, "org_id": user["org_id"],
        },
    )
    await db.commit()
    return ok({"id": str(variation_id), "status": new_status}, f"Variation {payload.decision}d.")


# ---------------------------------------------------------------------------
# Client payment requests - AEGIS-initiated "client owes us" requests, raised
# by internal staff and clearable by either the client (via their portal,
# see routers/portals.py) or Finance, always with a receipt. Complements
# finance.progress_claims rather than replacing it.
# ---------------------------------------------------------------------------

class ClientPaymentRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: UUID
    progress_claim_id: Optional[UUID] = None
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", max_length=3)
    due_date: Optional[date] = None


class ClientPaymentRequestClearByFinance(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    receipt_document_id: UUID
    notes: Optional[str] = Field(default=None, max_length=1000)


async def _pick_client_cash_account(db: AsyncSession, org_id: str, currency: str) -> str:
    account_id = (
        await db.execute(
            text("""
            SELECT id FROM finance.cash_accounts
            WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
            ORDER BY (currency = :currency) DESC, created_at ASC
            LIMIT 1
        """),
            {"org_id": org_id, "currency": currency},
        )
    ).scalar()
    if not account_id:
        raise HTTPException(status_code=422, detail="No active cash account is configured.")
    return str(account_id)


@router.get("/client-payment-requests")
async def list_client_payment_requests(
    project_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("finance.client_payment.create")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["cpr.organization_id = :org_id", "cpr.is_deleted = false"]
    params: dict = {"org_id": user["org_id"]}
    if project_id:
        filters.append("cpr.project_id = :project_id")
        params["project_id"] = project_id
    if status_filter:
        filters.append("cpr.status = :status")
        params["status"] = status_filter

    rows = await db.execute(
        text(f"""
            SELECT cpr.*, p.name AS project_name
            FROM finance.client_payment_requests cpr
            JOIN projects.projects p ON p.id = cpr.project_id AND p.organization_id = cpr.organization_id
            WHERE {' AND '.join(filters)}
            ORDER BY cpr.created_at DESC
        """),
        params,
    )
    return ok([dict(r._mapping) for r in rows], "Client payment requests listed.")


@router.post("/client-payment-requests", status_code=status.HTTP_201_CREATED)
async def create_client_payment_request(
    payload: ClientPaymentRequestCreate,
    user: dict = Depends(require_permission("finance.client_payment.create")),
    db: AsyncSession = Depends(get_db),
):
    project = (
        await db.execute(
            text("SELECT client_org_id FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.project_id, "org_id": user["org_id"]},
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    row = (
        await db.execute(
            text("""
            INSERT INTO finance.client_payment_requests (
                organization_id, project_id, progress_claim_id, title, description,
                amount, currency, due_date, created_by
            ) VALUES (
                :org_id, :project_id, :progress_claim_id, :title, :description,
                :amount, :currency, :due_date, :user_id
            ) RETURNING *
        """),
            {
                "org_id": user["org_id"], "project_id": payload.project_id,
                "progress_claim_id": payload.progress_claim_id, "title": payload.title,
                "description": payload.description, "amount": payload.amount, "currency": payload.currency,
                "due_date": payload.due_date, "user_id": user["user_id"],
            },
        )
    ).first()

    portal_users = await db.execute(
        text("""
            SELECT cpa.user_id
            FROM crm.client_portal_access cpa
            JOIN crm.contacts c ON c.id = cpa.contact_id AND c.organization_id = cpa.organization_id
            WHERE cpa.organization_id = :org_id AND c.client_org_id = :client_org_id AND cpa.is_active = true
        """),
        {"org_id": user["org_id"], "client_org_id": project.client_org_id},
    )
    for portal_user in portal_users:
        await emit_notification(
            db, org_id=user["org_id"], user_id=str(portal_user.user_id),
            title="New payment request", message=f"{payload.title}: {payload.currency} {payload.amount:,.2f}",
            notification_type="client_payment_request", action_url="/portal/client",
        )

    await db.commit()
    return ok(dict(row._mapping), "Client payment request created.")


@router.post("/client-payment-requests/{request_id}/clear")
async def clear_client_payment_request_as_finance(
    request_id: UUID,
    payload: ClientPaymentRequestClearByFinance,
    user: dict = Depends(require_permission("finance.client_payment.clear")),
    db: AsyncSession = Depends(get_db),
):
    req = (
        await db.execute(
            text("""
            SELECT id, amount, currency, status, project_id, progress_claim_id, title
            FROM finance.client_payment_requests
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
            {"id": request_id, "org_id": user["org_id"]},
        )
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Payment request not found.")
    if req.status in ("cleared", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Payment request already '{req.status}'.")

    doc = (
        await db.execute(
            text("SELECT id FROM core.documents WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.receipt_document_id, "org_id": user["org_id"]},
        )
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Receipt document not found.")

    cash_account_id = await _pick_client_cash_account(db, user["org_id"], req.currency)
    tx_number = f"CPR-{str(req.id)[:8].upper()}"
    cashbook_row = await db.execute(
        text("""
            INSERT INTO finance.cashbook_transactions (
                organization_id, cash_account_id, transaction_number, transaction_date,
                transaction_type, direction, source_type, source_id, project_id,
                counterparty_type, counterparty_name, payment_method, description,
                amount, currency, posted_by
            ) VALUES (
                :org_id, :cash_account_id, :tx_number, CURRENT_DATE,
                'receipt', 'inflow', 'client_payment_request', :source_id, :project_id,
                'client', :counterparty_name, 'bank_transfer', :description,
                :amount, :currency, :user_id
            ) RETURNING id
        """),
        {
            "org_id": user["org_id"], "cash_account_id": cash_account_id, "tx_number": tx_number,
            "source_id": str(req.id), "project_id": str(req.project_id),
            "counterparty_name": req.title, "description": f"Client payment: {req.title}",
            "amount": float(req.amount), "currency": req.currency, "user_id": user["user_id"],
        },
    )
    cashbook_id = str(cashbook_row.scalar())

    await db.execute(
        text("""
            UPDATE finance.client_payment_requests
            SET status = 'cleared', cleared_by_party = 'finance', cleared_by = :user_id, cleared_at = NOW(),
                cashbook_transaction_id = :cashbook_id, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
        {"user_id": user["user_id"], "cashbook_id": cashbook_id, "id": request_id, "org_id": user["org_id"]},
    )
    if req.progress_claim_id:
        await db.execute(
            text("""
                INSERT INTO finance.receipt_allocations (organization_id, cashbook_transaction_id, progress_claim_id, project_id, allocated_amount, allocated_by)
                VALUES (:org_id, :cashbook_id, :progress_claim_id, :project_id, :amount, :user_id)
            """),
            {
                "org_id": user["org_id"], "cashbook_id": cashbook_id, "progress_claim_id": req.progress_claim_id,
                "project_id": req.project_id, "amount": float(req.amount), "user_id": user["user_id"],
            },
        )
        await db.execute(
            text("UPDATE finance.progress_claims SET status = 'paid', updated_at = NOW() WHERE id = :id AND organization_id = :org_id"),
            {"id": req.progress_claim_id, "org_id": user["org_id"]},
        )
    await db.execute(
        text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            VALUES (:org_id, :document_id, 'client_payment_request', :entity_id, 'receipt', :user_id)
            ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
        """),
        {"org_id": user["org_id"], "document_id": payload.receipt_document_id, "entity_id": request_id, "user_id": user["user_id"]},
    )
    await db.commit()
    return ok({"id": str(request_id), "status": "cleared"}, "Payment request cleared.")


# ---------------------------------------------------------------------------
# Historical (pre-AEGIS) backfill - lets a Finance Manager seed months of
# past project history into the real tables the live system already reads,
# rather than a parallel/shadow record. Revenue is driven through the exact
# same progress_claims lifecycle (create -> certify -> pay) a live claim
# uses, just backdated and without the receipt-document requirement that
# makes sense for a live transaction but not a bulk historical entry.
# ---------------------------------------------------------------------------

class HistoricalProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=255)
    department_id: UUID
    project_code: Optional[str] = Field(default=None, max_length=80)
    project_type: Optional[str] = Field(default=None, max_length=100)
    start_date: Optional[date] = None
    client_org_id: Optional[UUID] = None
    new_client_name: Optional[str] = Field(default=None, max_length=255)
    new_contact_name: Optional[str] = Field(default=None, max_length=255)
    new_contact_email: Optional[str] = Field(default=None, max_length=255)


class HistoricalRevenueCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: UUID
    amount: float = Field(gt=0)
    historical_date: date
    description: Optional[str] = Field(default=None, max_length=500)


class HistoricalCostActivityCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: UUID
    cost_category: str = Field(pattern=r"^(labour|equipment|materials|subcontract|overhead|other)$")
    description: str = Field(min_length=1, max_length=500)
    amount: float = Field(gt=0)
    historical_date: date
    paid: bool = True


@router.post("/historical/projects", status_code=status.HTTP_201_CREATED)
async def create_historical_project(
    payload: HistoricalProjectCreate,
    user: dict = Depends(require_permission("finance.historical_entry.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick-creates a project for historical backfill, mirroring the INSERT
    shape mark_opportunity_won uses (crm.py) minus the opportunity/quotation
    linkage - there is no opportunity behind pre-AEGIS history. Mirrors the
    opportunity-create modal's pick-existing-or-create-inline pattern for
    the client organization/contact (aegis-web crm/opportunities/page.tsx).
    department_id is required (not optional) - it's what makes the
    Construction/Plant & Equipment/Commercial segment filter on the
    financial-statements page mean anything for this project.
    """
    org_id = user["org_id"]

    dept = await db.execute(
        text("SELECT 1 FROM finance.departments WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(payload.department_id), "org_id": org_id},
    )
    if not dept.first():
        raise HTTPException(status_code=404, detail="Department (segment) not found.")

    client_org_id = str(payload.client_org_id) if payload.client_org_id else None
    if not client_org_id and payload.new_client_name:
        client_org_id = (
            await db.execute(
                text("""
                INSERT INTO crm.organizations (organization_id, created_by, name)
                VALUES (:org_id, :user_id, :name)
                RETURNING id
            """),
                {"org_id": org_id, "user_id": user["user_id"], "name": payload.new_client_name},
            )
        ).scalar()
        client_org_id = str(client_org_id)

    if payload.new_contact_name:
        email = (payload.new_contact_email or "").strip()
        contact_id = None
        if email:
            contact_id = (
                await db.execute(
                    text("""
                    SELECT id FROM crm.contacts
                    WHERE organization_id = :org_id AND lower(email) = lower(:email) AND is_deleted = false
                    LIMIT 1
                """),
                    {"org_id": org_id, "email": email},
                )
            ).scalar()
        if not contact_id:
            await db.execute(
                text("""
                INSERT INTO crm.contacts (organization_id, created_by, contact_name, email, client_org_id)
                VALUES (:org_id, :user_id, :contact_name, :email, :client_org_id)
            """),
                {
                    "org_id": org_id, "user_id": user["user_id"], "contact_name": payload.new_contact_name,
                    "email": email or None, "client_org_id": client_org_id,
                },
            )

    project_row = (
        await db.execute(
            text("""
            INSERT INTO projects.projects (
                organization_id, created_by, name, status, project_code, project_type,
                client_name, start_date, client_org_id, department_id
            ) VALUES (
                :org_id, :user_id, :name, 'active', :project_code, :project_type,
                :client_name, :start_date, :client_org_id, :department_id
            ) RETURNING id, name, status, project_code, department_id, client_org_id
        """),
            {
                "org_id": org_id, "user_id": user["user_id"], "name": payload.name,
                "project_code": payload.project_code, "project_type": payload.project_type,
                "client_name": payload.new_client_name, "start_date": payload.start_date,
                "client_org_id": client_org_id, "department_id": str(payload.department_id),
            },
        )
    ).first()

    await db.commit()
    return ok(dict(project_row._mapping), "Historical project created.")


@router.post("/historical/revenue", status_code=status.HTTP_201_CREATED)
async def create_historical_revenue(
    payload: HistoricalRevenueCreate,
    user: dict = Depends(require_permission("finance.historical_entry.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Records historical project revenue by driving a progress claim straight
    through its real lifecycle (create -> certify -> pay) in one atomic
    call, backdated to historical_date wherever the live endpoints would
    normally use NOW()/date.today() - so certified_to_date/cash_collected
    on the existing project views are correct with no separate plumbing.
    No receipt document is required (unlike a live client-payment-request
    clearing) since there's nothing to upload for a transaction that
    happened months ago.
    """
    org_id = user["org_id"]
    project = (
        await db.execute(
            text("SELECT id FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": str(payload.project_id), "org_id": org_id},
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    claim_number = f"HIST-{uuid4().hex[:8].upper()}"
    description = payload.description or "Historical backfill entry"

    vat_amount = 0.0
    rate_table_id = None
    try:
        vat_table = await resolve_rate_table(db, org_id=org_id, tax_type="vat_output", currency="USD", as_at=payload.historical_date)
        vat_amount = float((Decimal(str(payload.amount)) * vat_table.bands[0].rate_pct / Decimal("100")).quantize(Decimal("0.01")))
        rate_table_id = vat_table.id
    except NoRateTableError:
        pass

    # progress_claims has no department_id column - join via project instead.
    claim_row = (
        await db.execute(
            text("""
            INSERT INTO finance.progress_claims (
                organization_id, claim_number, project_id, claim_period_start, claim_period_end,
                contract_value, this_claim_amount, retention_pct, retention_amount, net_claim_amount,
                status, submitted_by, submitted_at, certified_amount, certified_by, certified_at,
                vat_amount, vat_rate_table_id, notes, created_by
            ) VALUES (
                :org_id, :claim_number, :project_id, :historical_date, :historical_date,
                :amount, :amount, 0, 0, :amount,
                'certified', :user_id, :historical_timestamp, :amount, :user_id, :historical_timestamp,
                :vat_amount, :rate_table_id, :notes, :user_id
            ) RETURNING id, project_id
        """),
            {
                "org_id": org_id, "claim_number": claim_number, "project_id": str(payload.project_id),
                "historical_date": payload.historical_date,
                "historical_timestamp": datetime.combine(payload.historical_date, datetime_time()),
                "amount": payload.amount,
                "user_id": user["user_id"], "vat_amount": vat_amount, "rate_table_id": rate_table_id,
                "notes": f"{description} (historical backfill, recorded {date.today().isoformat()})",
            },
        )
    ).first()
    claim_id = claim_row.id

    if vat_amount > 0:
        dept_row = (
            await db.execute(
                text("SELECT department_id FROM projects.projects WHERE id = :id"),
                {"id": str(payload.project_id)},
            )
        ).first()
        await accrue_liability_line(
            db, org_id=org_id, authority="zimra", liability_type="vat", currency="USD",
            as_at=payload.historical_date, direction="output", source_type="progress_claim", source_id=claim_id,
            project_id=str(payload.project_id), department_id=str(dept_row.department_id) if dept_row and dept_row.department_id else None,
            taxable_base=payload.amount, rate_table_id=rate_table_id, computed_amount=vat_amount,
            basis={"claim_number": claim_number},
        )

    cash_account_id = await _pick_client_cash_account(db, org_id, "USD")
    tx_number = f"HIST-{str(claim_id)[:8].upper()}"
    cashbook_row = await db.execute(
        text("""
        INSERT INTO finance.cashbook_transactions (
            organization_id, cash_account_id, transaction_number, transaction_date,
            transaction_type, direction, source_type, source_id, project_id,
            counterparty_type, counterparty_name, payment_method, description,
            amount, currency, posted_by
        ) VALUES (
            :org_id, :cash_account_id, :tx_number, :historical_date,
            'receipt', 'inflow', 'historical_backfill', :source_id, :project_id,
            'client', :counterparty_name, 'bank_transfer', :description,
            :amount, 'USD', :user_id
        ) RETURNING id
    """),
        {
            "org_id": org_id, "cash_account_id": cash_account_id, "tx_number": tx_number,
            "historical_date": payload.historical_date, "source_id": str(claim_id),
            "project_id": str(payload.project_id), "counterparty_name": description, "description": description,
            "amount": payload.amount, "user_id": user["user_id"],
        },
    )
    cashbook_id = str(cashbook_row.scalar())

    await db.execute(
        text("""
        INSERT INTO finance.receipt_allocations (organization_id, cashbook_transaction_id, progress_claim_id, project_id, allocated_amount, allocated_by)
        VALUES (:org_id, :cashbook_id, :claim_id, :project_id, :amount, :user_id)
    """),
        {
            "org_id": org_id, "cashbook_id": cashbook_id, "claim_id": str(claim_id),
            "project_id": str(payload.project_id), "amount": payload.amount, "user_id": user["user_id"],
        },
    )
    await db.execute(
        text("UPDATE finance.progress_claims SET status = 'paid', updated_at = NOW() WHERE id = :id"),
        {"id": str(claim_id)},
    )

    await db.commit()
    return ok(
        {"id": str(claim_id), "claim_number": claim_number, "status": "paid", "amount": payload.amount, "vat_amount": vat_amount},
        "Historical revenue recorded.",
    )


@router.post("/historical/cost-activities", status_code=status.HTTP_201_CREATED)
async def create_historical_cost_activity(
    payload: HistoricalCostActivityCreate,
    user: dict = Depends(require_permission("finance.historical_entry.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Records a single historical cost/activity line item against a project.
    Writes into finance.cost_transactions - the same table every live cost
    writer (inventory issues, approved site reports, fleet usage) posts to -
    using a new source_type so it flows into actual_cost_to_date/committed
    project summaries automatically. `paid` (default true, since backfilled
    history is by definition money already spent) additionally posts a
    matching cashbook outflow so it affects cash position, not just project
    cost; leaving it false records the cost without touching cash, for a
    genuinely still-outstanding historical liability.
    """
    org_id = user["org_id"]
    project = (
        await db.execute(
            text("SELECT id, department_id FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": str(payload.project_id), "org_id": org_id},
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    source_id = uuid4()
    await db.execute(
        text("""
        INSERT INTO finance.cost_transactions (
            organization_id, project_id, source_type, source_id, cost_category,
            description, amount, transaction_date, status, posted_by, posted_at
        ) VALUES (
            :org_id, :project_id, 'historical_backfill', :source_id, :cost_category,
            :description, :amount, :historical_date, 'posted', :user_id, NOW()
        )
    """),
        {
            "org_id": org_id, "project_id": str(payload.project_id), "source_id": str(source_id),
            "cost_category": payload.cost_category, "description": payload.description,
            "amount": payload.amount, "historical_date": payload.historical_date, "user_id": user["user_id"],
        },
    )

    cashbook_id = None
    if payload.paid:
        cash_account_id = await _pick_client_cash_account(db, org_id, "USD")
        tx_number = f"HIST-{str(source_id)[:8].upper()}"
        cashbook_row = await db.execute(
            text("""
            INSERT INTO finance.cashbook_transactions (
                organization_id, cash_account_id, transaction_number, transaction_date,
                transaction_type, direction, source_type, source_id, project_id,
                counterparty_type, counterparty_name, payment_method, description,
                amount, currency, posted_by
            ) VALUES (
                :org_id, :cash_account_id, :tx_number, :historical_date,
                'payment', 'outflow', 'historical_backfill', :source_id, :project_id,
                'supplier', :counterparty_name, 'bank_transfer', :description,
                :amount, 'USD', :user_id
            ) RETURNING id
        """),
            {
                "org_id": org_id, "cash_account_id": cash_account_id, "tx_number": tx_number,
                "historical_date": payload.historical_date, "source_id": str(source_id),
                "project_id": str(payload.project_id), "counterparty_name": payload.description, "description": payload.description,
                "amount": payload.amount, "user_id": user["user_id"],
            },
        )
        cashbook_id = str(cashbook_row.scalar())

    await db.commit()
    return ok(
        {"source_id": str(source_id), "cashbook_transaction_id": cashbook_id, "paid": payload.paid},
        "Historical cost activity recorded.",
    )


@router.get("/progress-claims")
async def list_progress_claims(
    project_id: Optional[UUID] = None,
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.claim.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List progress claims, optionally filtered by project or department
    (derived from the claim's project).
    """
    query_str = """
        SELECT pc.*, p.name AS project_name, p.department_id
        FROM finance.progress_claims pc
        JOIN projects.projects p ON p.id = pc.project_id AND p.organization_id = pc.organization_id
        WHERE pc.organization_id = :org_id AND pc.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if project_id:
        query_str += " AND pc.project_id = :project_id"
        params["project_id"] = project_id
    if department_id:
        query_str += " AND (p.department_id = :department_id OR p.department_id IS NULL)"
        params["department_id"] = department_id

    query_str += " ORDER BY pc.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Progress claims listed.")


class ProgressClaimCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    claim_number: str = Field(min_length=1, max_length=40)
    project_id: UUID
    claim_period_start: date
    claim_period_end: date
    contract_value: float = Field(ge=0)
    previous_certified: float = Field(default=0, ge=0)
    this_claim_amount: float = Field(gt=0)
    retention_pct: float = Field(default=10, ge=0, le=100)
    notes: Optional[str] = None


@router.post("/progress-claims", status_code=status.HTTP_201_CREATED)
async def create_progress_claim(
    payload: ProgressClaimCreate,
    user: dict = Depends(require_permission("finance.claim.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Drafts a progress claim. There was previously no write path for this
    table at all - claims could only be read, never created via the API -
    which is also what made a real VAT-accrual trigger point (certification,
    below) impossible to wire up.
    """
    proj = await db.execute(
        text("SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.project_id, "org_id": user["org_id"]},
    )
    if not proj.first():
        raise HTTPException(status_code=404, detail="Project not found.")

    retention_amount = round(payload.this_claim_amount * payload.retention_pct / 100, 2)
    net_claim_amount = round(payload.this_claim_amount - retention_amount, 2)

    try:
        claim_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.progress_claims (
                        organization_id, claim_number, project_id, claim_period_start, claim_period_end,
                        contract_value, previous_certified, this_claim_amount, retention_pct,
                        retention_amount, net_claim_amount, status, submitted_by, submitted_at, notes, created_by
                    ) VALUES (
                        :org_id, :claim_number, :project_id, :claim_period_start, :claim_period_end,
                        :contract_value, :previous_certified, :this_claim_amount, :retention_pct,
                        :retention_amount, :net_claim_amount, 'submitted', :user_id, NOW(), :notes, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "claim_number": payload.claim_number,
                    "project_id": payload.project_id,
                    "claim_period_start": payload.claim_period_start,
                    "claim_period_end": payload.claim_period_end,
                    "contract_value": payload.contract_value,
                    "previous_certified": payload.previous_certified,
                    "this_claim_amount": payload.this_claim_amount,
                    "retention_pct": payload.retention_pct,
                    "retention_amount": retention_amount,
                    "net_claim_amount": net_claim_amount,
                    "notes": payload.notes,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(claim_id)}, "Progress claim submitted.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Claim number already exists.")


@router.post("/progress-claims/{claim_id}/certify")
async def certify_progress_claim(
    claim_id: UUID,
    certified_amount: Optional[float] = None,
    user: dict = Depends(require_permission("finance.claim.certify")),
    db: AsyncSession = Depends(get_db),
):
    """
    Certifies a submitted claim and accrues output VAT for it - this is
    the real trigger point for VAT (owed on the billed supply, not on
    contract signature at quotation-win time), using whatever vat_output
    rate table is active as of the certification date. No VAT rate table
    configured -> the claim still certifies (unlike payroll, a missing VAT
    table doesn't block billing the client) but vat_amount stays 0 and
    nothing accrues, since there's nothing to accrue accurately.
    """
    claim = await db.execute(
        text("""
            SELECT pc.*, p.department_id FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id
            WHERE pc.id = :id AND pc.organization_id = :org_id AND pc.is_deleted = false AND pc.status = 'submitted'
        """),
        {"id": claim_id, "org_id": user["org_id"]},
    )
    claim_row = claim.mappings().first()
    if not claim_row:
        raise HTTPException(status_code=404, detail="Submitted progress claim not found.")

    amount = certified_amount if certified_amount is not None else float(claim_row["this_claim_amount"])
    certified_at = date.today()

    vat_amount = 0.0
    rate_table_id = None
    try:
        vat_table = await resolve_rate_table(db, org_id=user["org_id"], tax_type="vat_output", currency="USD", as_at=certified_at)
        vat_amount = float((Decimal(str(amount)) * vat_table.bands[0].rate_pct / Decimal("100")).quantize(Decimal("0.01")))
        rate_table_id = vat_table.id
    except NoRateTableError:
        pass

    await db.execute(
        text("""
            UPDATE finance.progress_claims
            SET status = 'certified', certified_amount = :amount, certified_by = :user_id, certified_at = NOW(),
                vat_amount = :vat_amount, vat_rate_table_id = :rate_table_id, updated_at = NOW()
            WHERE id = :id
        """),
        {"amount": amount, "user_id": user["sub"], "vat_amount": vat_amount, "rate_table_id": rate_table_id, "id": claim_id},
    )

    if vat_amount > 0:
        await accrue_liability_line(
            db, org_id=user["org_id"], authority="zimra", liability_type="vat", currency="USD",
            as_at=certified_at, direction="output", source_type="progress_claim", source_id=claim_id,
            project_id=claim_row["project_id"], department_id=claim_row["department_id"],
            taxable_base=amount, rate_table_id=rate_table_id, computed_amount=vat_amount,
            basis={"claim_number": claim_row["claim_number"]},
        )

    await db.commit()
    return ok({"id": str(claim_id), "certified_amount": amount, "vat_amount": vat_amount}, "Progress claim certified.")


@router.get("/cash-accounts")
async def get_cash_accounts(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.cash_accounts WHERE organization_id = :org_id AND is_deleted = false ORDER BY account_code"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cash accounts retrieved.")


@router.post("/cash-accounts", status_code=status.HTTP_201_CREATED)
async def create_cash_account(
    payload: CashAccountCreate,
    user: dict = Depends(require_permission("finance.cash.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        acc_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.cash_accounts (
                        organization_id, account_code, account_name, account_type,
                        bank_name, branch_name, account_number, currency,
                        opening_balance, current_balance, created_by
                    ) VALUES (
                        :org_id, :account_code, :account_name, :account_type,
                        :bank_name, :branch_name, :account_number, :currency,
                        :opening_balance, :opening_balance, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "account_code": payload.account_code,
                    "account_name": payload.account_name,
                    "account_type": payload.account_type,
                    "bank_name": payload.bank_name,
                    "branch_name": payload.branch_name,
                    "account_number": payload.account_number,
                    "currency": payload.currency,
                    "opening_balance": payload.opening_balance,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(acc_id)}, "Cash account created successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Cash account code already exists.")


@router.delete("/cash-accounts/{cash_account_id}")
async def delete_cash_account(
    cash_account_id: UUID,
    user: dict = Depends(require_permission("finance.cash.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Soft-deletes a cash account - it drops out of listings and out of the
    auto-picked account for new transactions, but existing cashbook_transactions
    rows keep referencing it (the FK is ON DELETE RESTRICT, so this never
    hard-deletes rather than risk orphaning real financial history)."""
    result = await db.execute(
        text("""
            UPDATE finance.cash_accounts SET is_deleted = true, is_active = false, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"id": cash_account_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Cash account not found.")
    await db.commit()
    return ok({"id": str(cash_account_id)}, "Cash account deleted.")


@router.get("/cashbook")
async def get_cashbook(
    cash_account_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    query = "SELECT * FROM finance.cashbook_transactions WHERE organization_id = :org_id AND is_deleted = false"
    params = {"org_id": user["org_id"]}
    if cash_account_id:
        query += " AND cash_account_id = :cash_account_id"
        params["cash_account_id"] = cash_account_id
    if project_id:
        query += " AND project_id = :project_id"
        params["project_id"] = project_id
    if department_id:
        query += " AND (department_id = :department_id OR department_id IS NULL)"
        params["department_id"] = department_id
    query += " ORDER BY transaction_date DESC, created_at DESC"
    
    result = await db.execute(text(query), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Cashbook transactions retrieved.")


@router.post("/cashbook", status_code=status.HTTP_201_CREATED)
async def post_cashbook_transaction(
    payload: CashbookTransactionCreate,
    user: dict = Depends(require_permission("finance.cash.post")),
    db: AsyncSession = Depends(get_db),
):
    try:
        # Verify cash account exists
        acc_check = await db.execute(
            text("SELECT 1 FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.cash_account_id, "org_id": user["org_id"]},
        )
        if not acc_check.first():
            raise HTTPException(status_code=404, detail="Cash account not found.")

        tx_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_number, transaction_date,
                        transaction_type, direction, amount, currency, description,
                        project_id, department_id, counterparty_type, counterparty_name, payment_method,
                        reference, posted_by
                    ) VALUES (
                        :org_id, :cash_account_id, :transaction_number, :transaction_date,
                        :transaction_type, :direction, :amount, :currency, :description,
                        :project_id, :department_id, :counterparty_type, :counterparty_name, :payment_method,
                        :reference, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "cash_account_id": payload.cash_account_id,
                    "transaction_number": payload.transaction_number,
                    "transaction_date": payload.transaction_date,
                    "transaction_type": payload.transaction_type,
                    "direction": payload.direction,
                    "amount": payload.amount,
                    "currency": "USD",
                    "description": payload.description,
                    "project_id": payload.project_id,
                    "department_id": payload.department_id,
                    "counterparty_type": payload.counterparty_type,
                    "counterparty_name": payload.counterparty_name,
                    "payment_method": payload.payment_method,
                    "reference": payload.reference,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        
        # Update account balance
        balance_adj = payload.amount if payload.direction == "inflow" else -payload.amount
        await db.execute(
            text("UPDATE finance.cash_accounts SET current_balance = current_balance + :adj WHERE id = :id"),
            {"adj": balance_adj, "id": payload.cash_account_id},
        )
        
        await db.commit()
        return ok({"id": str(tx_id)}, "Cashbook transaction posted.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Transaction number already exists.")


@router.post("/receipts/allocate", status_code=status.HTTP_201_CREATED)
async def allocate_receipt(
    payload: ReceiptAllocationCreate,
    user: dict = Depends(require_permission("finance.receipt.allocate")),
    db: AsyncSession = Depends(get_db),
):
    try:
        alloc_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.receipt_allocations (
                        organization_id, cashbook_transaction_id, progress_claim_id,
                        project_id, allocated_amount, allocated_by
                    ) VALUES (
                        :org_id, :cashbook_transaction_id, :progress_claim_id,
                        :project_id, :allocated_amount, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "cashbook_transaction_id": payload.cashbook_transaction_id,
                    "progress_claim_id": payload.progress_claim_id,
                    "project_id": payload.project_id,
                    "allocated_amount": payload.allocated_amount,
                    "user_id": user["sub"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(alloc_id)}, "Receipt allocated successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Allocation already exists or invalid references.")


@router.get("/supplier-payments")
async def get_supplier_payments(
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = "SELECT * FROM finance.supplier_payment_batches b WHERE b.organization_id = :org_id AND b.is_deleted = false"
    params = {"org_id": user["org_id"]}
    if department_id:
        query_str += """ AND EXISTS (
            SELECT 1 FROM finance.supplier_payment_items i
            WHERE i.batch_id = b.id
              AND (i.department_id = :department_id OR i.department_id IS NULL)
        )"""
        params["department_id"] = department_id
    query_str += " ORDER BY b.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Supplier payment batches retrieved.")


@router.post("/supplier-payments", status_code=status.HTTP_201_CREATED)
async def post_supplier_payment_batch(
    payload: SupplierPaymentBatchCreate,
    user: dict = Depends(require_permission("finance.supplier_payment.post")),
    db: AsyncSession = Depends(get_db),
):
    try:
        total_amt = sum(item.amount for item in payload.items)
        batch_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.supplier_payment_batches (
                        organization_id, batch_number, cash_account_id, payment_date,
                        status, total_amount, payment_method, reference, notes, created_by
                    ) VALUES (
                        :org_id, :batch_number, :cash_account_id, :payment_date,
                        'posted', :total_amount, :payment_method, :reference, :notes, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "batch_number": payload.batch_number,
                    "cash_account_id": payload.cash_account_id,
                    "payment_date": payload.payment_date,
                    "total_amount": total_amt,
                    "payment_method": payload.payment_method,
                    "reference": payload.reference,
                    "notes": payload.notes,
                    "user_id": user["sub"],
                },
            )
        ).scalar()

        for item in payload.items:
            tx_number = f"PMT-{payload.batch_number}-{str(item.supplier_invoice_id)[:8]}"
            tx_id = (
                await db.execute(
                    text("""
                        INSERT INTO finance.cashbook_transactions (
                            organization_id, cash_account_id, transaction_number, transaction_date,
                            transaction_type, direction, amount, currency, description,
                            project_id, department_id, counterparty_type, counterparty_name, payment_method,
                            reference, posted_by
                        ) VALUES (
                            :org_id, :cash_account_id, :tx_number, :payment_date,
                            'payment', 'outflow', :amount, 'USD', :desc,
                            :project_id, :department_id, 'supplier', '', :payment_method,
                            :reference, :user_id
                        ) RETURNING id
                    """),
                    {
                        "org_id": user["org_id"],
                        "cash_account_id": payload.cash_account_id,
                        "tx_number": tx_number,
                        "payment_date": payload.payment_date,
                        "amount": item.amount,
                        "desc": f"Supplier payment batch item. Invoice {item.supplier_invoice_id}",
                        "project_id": item.project_id,
                        "department_id": item.department_id,
                        "payment_method": payload.payment_method,
                        "reference": item.payment_reference or payload.reference,
                        "user_id": user["sub"],
                    }
                )
            ).scalar()

            await db.execute(
                text("""
                    INSERT INTO finance.supplier_payment_items (
                        organization_id, batch_id, supplier_invoice_id, supplier_id,
                        project_id, department_id, amount, payment_reference, cashbook_transaction_id
                    ) VALUES (
                        :org_id, :batch_id, :supplier_invoice_id, :supplier_id,
                        :project_id, :department_id, :amount, :payment_ref, :tx_id
                    )
                """),
                {
                    "org_id": user["org_id"],
                    "batch_id": batch_id,
                    "supplier_invoice_id": item.supplier_invoice_id,
                    "supplier_id": item.supplier_id,
                    "project_id": item.project_id,
                    "department_id": item.department_id,
                    "amount": item.amount,
                    "payment_ref": item.payment_reference,
                    "tx_id": tx_id,
                  }
              )

            await db.execute(
                text("UPDATE finance.cash_accounts SET current_balance = current_balance - :amount WHERE id = :id"),
                {"amount": item.amount, "id": payload.cash_account_id},
            )

        await db.commit()
        return ok({"id": str(batch_id)}, "Supplier payment batch posted successfully.")
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Supplier payment batch number or items duplicate conflict.")


@router.get("/payroll/profiles")
async def get_payroll_profiles(
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("SELECT * FROM finance.employee_pay_profiles WHERE organization_id = :org_id AND is_deleted = false"),
        {"org_id": user["org_id"]},
    )
    items = [dict(row._mapping) for row in result]
    return ok(items, "Payroll profiles retrieved.")


@router.post("/payroll/profiles", status_code=status.HTTP_201_CREATED)
async def upsert_payroll_profile(
    payload: EmployeePayProfileUpsert,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        check = await db.execute(
            text("SELECT id FROM finance.employee_pay_profiles WHERE employee_id = :emp_id AND organization_id = :org_id AND is_deleted = false"),
            {"emp_id": payload.employee_id, "org_id": user["org_id"]},
        )
        row = check.first()
        if row:
            profile_id = row[0]
            await db.execute(
                text("""
                    UPDATE finance.employee_pay_profiles
                    SET pay_type = :pay_type, base_rate = :base_rate, overtime_rate = :overtime_rate,
                        currency = :currency, bank_name = :bank_name, bank_account_number = :bank_account_number,
                        tax_number = :tax_number, nssa_number = :nssa_number, is_active = :is_active,
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {
                    "pay_type": payload.pay_type,
                    "base_rate": payload.base_rate,
                    "overtime_rate": payload.overtime_rate,
                    "currency": payload.currency,
                    "bank_name": payload.bank_name,
                    "bank_account_number": payload.bank_account_number,
                    "tax_number": payload.tax_number,
                    "nssa_number": payload.nssa_number,
                    "is_active": payload.is_active,
                    "id": profile_id,
                }
            )
            msg = "Payroll profile updated."
        else:
            profile_id = (
                await db.execute(
                    text("""
                        INSERT INTO finance.employee_pay_profiles (
                            organization_id, employee_id, pay_type, base_rate, overtime_rate,
                            currency, bank_name, bank_account_number, tax_number, nssa_number,
                            is_active, created_by
                        ) VALUES (
                            :org_id, :employee_id, :pay_type, :base_rate, :overtime_rate,
                            :currency, :bank_name, :bank_account_number, :tax_number, :nssa_number,
                            :is_active, :user_id
                        ) RETURNING id
                    """),
                    {
                        "org_id": user["org_id"],
                        "employee_id": payload.employee_id,
                        "pay_type": payload.pay_type,
                        "base_rate": payload.base_rate,
                        "overtime_rate": payload.overtime_rate,
                        "currency": payload.currency,
                        "bank_name": payload.bank_name,
                        "bank_account_number": payload.bank_account_number,
                        "tax_number": payload.tax_number,
                        "nssa_number": payload.nssa_number,
                        "is_active": payload.is_active,
                        "user_id": user["sub"],
                    }
                )
            ).scalar()
            msg = "Payroll profile created."

        await db.commit()
        return ok({"id": str(profile_id)}, msg)
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/payroll/runs")
async def get_payroll_runs(
    department_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    List payroll runs, optionally scoped to a department. A run is included
    if any of its items belong to that department or have no department
    assigned yet - department lives on payroll_items, not the run itself,
    since a single run can span multiple departments.
    """
    query_str = "SELECT * FROM finance.payroll_runs r WHERE r.organization_id = :org_id AND r.is_deleted = false"
    params = {"org_id": user["org_id"]}
    if department_id:
        query_str += """ AND EXISTS (
            SELECT 1 FROM finance.payroll_items i
            WHERE i.payroll_run_id = r.id
              AND (i.department_id = :department_id OR i.department_id IS NULL)
        )"""
        params["department_id"] = department_id
    query_str += " ORDER BY r.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Payroll runs retrieved.")


@router.post("/payroll/runs", status_code=status.HTTP_201_CREATED, deprecated=True)
async def create_payroll_run(
    payload: PayrollRunCreate,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    """
    Computes pay identically to POST /api/v1/payroll-runs (same gross-pay
    formula, same real PAYE/NSSA rate-table lookup) rather than trusting
    client-supplied figures - see the note on PayrollItemPayload.
    """
    org_id = user["org_id"]
    employee_ids = [str(item.employee_id) for item in payload.items]
    profiles_rows = await db.execute(
        text("""
            SELECT pp.employee_id, pp.pay_type, pp.base_rate, pp.overtime_rate, pp.currency
            FROM finance.employee_pay_profiles pp
            WHERE pp.employee_id = ANY(:ids) AND pp.organization_id = :org_id
              AND pp.is_active = true AND pp.is_deleted = false
        """),
        {"ids": employee_ids, "org_id": org_id},
    )
    profiles = {str(r.employee_id): dict(r._mapping) for r in profiles_rows}
    missing = [eid for eid in employee_ids if eid not in profiles]
    if missing:
        raise HTTPException(status_code=422, detail=f"No active pay profile found for employees: {missing}")

    try:
        gross_total = deductions_total = net_total = 0.0
        computed_items = []

        for item in payload.items:
            profile = profiles[str(item.employee_id)]
            gross = _compute_gross(
                base_rate=float(profile["base_rate"]),
                pay_type=profile["pay_type"],
                regular_hours=item.regular_hours,
                overtime_hours=item.overtime_hours,
                overtime_rate=float(profile.get("overtime_rate") or 0),
            )
            try:
                statutory = await compute_statutory(
                    db, org_id=org_id, currency=profile.get("currency") or "USD",
                    as_at=payload.payment_date, gross_pay=Decimal(str(gross)),
                )
            except NoRateTableError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc

            net = max(0.0, float(statutory.net_pay) - item.other_deduction)
            deductions = float(statutory.paye) + float(statutory.nssa_employee) + item.other_deduction
            gross_total += gross
            deductions_total += deductions
            net_total += net
            computed_items.append((item, gross, net, statutory))

        run_id = (
            await db.execute(
                text("""
                    INSERT INTO finance.payroll_runs (
                        organization_id, run_number, period_start, period_end, payment_date,
                        status, gross_pay, total_deductions, net_pay, created_by
                    ) VALUES (
                        :org_id, :run_number, :period_start, :period_end, :payment_date,
                        'draft', :gross, :deductions, :net, :user_id
                    ) RETURNING id
                """),
                {
                    "org_id": org_id,
                    "run_number": payload.run_number,
                    "period_start": payload.period_start,
                    "period_end": payload.period_end,
                    "payment_date": payload.payment_date,
                    "gross": round(gross_total, 2),
                    "deductions": round(deductions_total, 2),
                    "net": round(net_total, 2),
                    "user_id": user["sub"],
                }
            )
        ).scalar()

        for item, gross, net, statutory in computed_items:
            await db.execute(
                text("""
                    INSERT INTO finance.payroll_items (
                        organization_id, payroll_run_id, employee_id, project_id, department_id,
                        regular_hours, overtime_hours, gross_pay, tax_deduction,
                        statutory_deduction, other_deduction, net_pay,
                        paye_amount, nssa_employee_amount, nssa_employer_amount, aids_levy_amount,
                        taxable_gross, rate_table_id
                    ) VALUES (
                        :org_id, :run_id, :employee_id, :project_id, :department_id,
                        :regular_hours, :overtime_hours, :gross_pay, :tax_deduction,
                        :statutory_deduction, :other_deduction, :net_pay,
                        :paye_amount, :nssa_employee_amount, :nssa_employer_amount, :aids_levy_amount,
                        :taxable_gross, :rate_table_id
                    )
                """),
                {
                    "org_id": org_id,
                    "run_id": run_id,
                    "employee_id": item.employee_id,
                    "project_id": item.project_id,
                    "department_id": item.department_id,
                    "regular_hours": item.regular_hours,
                    "overtime_hours": item.overtime_hours,
                    "gross_pay": gross,
                    "tax_deduction": float(statutory.paye) + float(statutory.aids_levy),
                    "statutory_deduction": float(statutory.nssa_employee),
                    "other_deduction": item.other_deduction,
                    "net_pay": net,
                    "paye_amount": float(statutory.paye),
                    "nssa_employee_amount": float(statutory.nssa_employee),
                    "nssa_employer_amount": float(statutory.nssa_employer),
                    "aids_levy_amount": float(statutory.aids_levy),
                    "taxable_gross": gross,
                    "rate_table_id": statutory.paye_rate_table_id,
                }
            )

        await db.commit()
        return ok({"id": str(run_id)}, "Payroll run generated in draft.")
    except HTTPException:
        await db.rollback()
        raise
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Payroll run number already exists.")


@router.post("/payroll/runs/{run_id}/decision", deprecated=True)
async def decide_payroll_run(
    run_id: UUID,
    payload: PayrollDecisionPayload,
    user: dict = Depends(require_permission("finance.payroll.post")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE finance.payroll_runs
            SET status = :status, approved_by = :user_id, approved_at = NOW(), updated_at = NOW()
            WHERE id = :run_id AND organization_id = :org_id AND is_deleted = false AND status = 'draft'
            RETURNING id
        """),
        {
            "status": payload.status,
            "user_id": user["sub"],
            "run_id": run_id,
            "org_id": user["org_id"],
        }
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Draft payroll run not found.")

    await db.commit()
    return ok({"id": str(run_id)}, f"Payroll run status updated to {payload.status}.")


@router.post("/payroll/runs/{run_id}/post", deprecated=True)
async def post_payroll_run(
    run_id: UUID,
    user: dict = Depends(require_permission("finance.payroll.post")),
    db: AsyncSession = Depends(get_db),
):
    run_result = await db.execute(
        text("SELECT * FROM finance.payroll_runs WHERE id = :id AND organization_id = :org_id AND is_deleted = false AND status = 'approved'"),
        {"id": run_id, "org_id": user["org_id"]},
    )
    run = run_result.first()
    if not run:
        raise HTTPException(status_code=404, detail="Approved payroll run not found.")

    run_data = dict(run._mapping)
    cash_account_id = run_data["cash_account_id"]
    if not cash_account_id:
        acc_check = await db.execute(
            text("SELECT id FROM finance.cash_accounts WHERE organization_id = :org_id AND is_active = true AND is_deleted = false LIMIT 1"),
            {"org_id": user["org_id"]},
        )
        acc_row = acc_check.first()
        if not acc_row:
            raise HTTPException(status_code=400, detail="No active cash account available to post payroll.")
        cash_account_id = acc_row[0]

    tx_number = f"PAY-{run_data['run_number']}"
    tx_id = (
        await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, amount, currency, description,
                    posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :payment_date,
                    'payment', 'outflow', :amount, 'USD', :desc, :user_id
                ) RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "cash_account_id": cash_account_id,
                "tx_number": tx_number,
                "payment_date": run_data["payment_date"],
                "amount": run_data["net_pay"],
                "desc": f"Payroll posting for run {run_data['run_number']}",
                "user_id": user["sub"],
            }
        )
    ).scalar()

    await db.execute(
        text("""
            UPDATE finance.payroll_runs
            SET status = 'posted', posted_by = :user_id, posted_at = NOW(),
                cash_account_id = :cash_account_id, updated_at = NOW()
            WHERE id = :run_id
        """),
        {
            "user_id": user["sub"],
            "cash_account_id": cash_account_id,
            "run_id": run_id,
        }
    )

    await db.execute(
        text("""
            UPDATE finance.payroll_items
            SET cashbook_transaction_id = :tx_id
            WHERE payroll_run_id = :run_id
        """),
        {"tx_id": tx_id, "run_id": run_id}
    )

    await db.execute(
        text("UPDATE finance.cash_accounts SET current_balance = current_balance - :amount WHERE id = :id"),
        {"amount": run_data["net_pay"], "id": cash_account_id},
    )

    # Accrue PAYE/NSSA into the statutory liability ledger - same as the
    # payroll_runs.py posting path, so it doesn't matter which of the two
    # parallel routers actually posted this run.
    items_rows = await db.execute(
        text("""
            SELECT id, employee_id, department_id, paye_amount, nssa_employee_amount,
                   nssa_employer_amount, taxable_gross, rate_table_id
            FROM finance.payroll_items WHERE payroll_run_id = :run_id
        """),
        {"run_id": run_id},
    )
    for item in items_rows.mappings():
        common = {
            "db": db, "org_id": user["org_id"], "currency": "USD", "as_at": run_data["payment_date"],
            "source_type": "payroll_item", "source_id": item["id"], "direction": "output",
            "department_id": item["department_id"], "employee_id": item["employee_id"],
            "taxable_base": float(item["taxable_gross"]) if item["taxable_gross"] is not None else None,
            "rate_table_id": item["rate_table_id"],
        }
        if item["paye_amount"] and float(item["paye_amount"]) > 0:
            await accrue_liability_line(authority="zimra", liability_type="paye", computed_amount=float(item["paye_amount"]), **common)
        if item["nssa_employee_amount"] and float(item["nssa_employee_amount"]) > 0:
            await accrue_liability_line(authority="nssa", liability_type="nssa_employee", computed_amount=float(item["nssa_employee_amount"]), **common)
        if item["nssa_employer_amount"] and float(item["nssa_employer_amount"]) > 0:
            await accrue_liability_line(authority="nssa", liability_type="nssa_employer", computed_amount=float(item["nssa_employer_amount"]), **common)

    await db.commit()
    return ok({"id": str(run_id)}, "Payroll run posted and cashbook outflow recorded.")
