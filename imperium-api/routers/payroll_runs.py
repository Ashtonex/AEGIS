"""Payroll runs router — finance.payroll_runs + finance.payroll_items.

Manages payroll processing cycles. A run is created in 'draft', moves to
'approved' after review, then 'posted' which generates cashbook entries
and individual payslip records for each employee in the run.
"""
from __future__ import annotations

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()

RUN_STATUSES = ("draft", "approved", "posted", "cancelled")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PayrollItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: UUID
    project_id: Optional[UUID] = None
    regular_hours: float = Field(default=0.0, ge=0)
    overtime_hours: float = Field(default=0.0, ge=0)
    other_deduction: float = Field(default=0.0, ge=0)
    notes: Optional[str] = Field(default=None, max_length=500)


class PayrollRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: UUID
    items: List[PayrollItemInput] = Field(min_length=1)
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_dates(self) -> "PayrollRunCreate":
        if self.period_end < self.period_start:
            raise ValueError("period_end must be on or after period_start.")
        if self.payment_date < self.period_start:
            raise ValueError("payment_date cannot be before the pay period starts.")
        return self


class PayrollRunDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    action: str = Field(pattern=r"^(approve|post|cancel)$")
    notes: Optional[str] = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_org(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation linked to this account.")
    return str(org_id)


def _compute_pay(base_rate: float, pay_type: str, regular_hours: float, overtime_hours: float, overtime_rate: float) -> tuple[float, float, float]:
    """Returns (gross_pay, tax_deduction, net_pay)."""
    if pay_type == "monthly_salary":
        gross = float(base_rate)
        ot_gross = overtime_hours * float(overtime_rate) if overtime_rate else 0.0
        gross += ot_gross
    elif pay_type == "hourly":
        gross = regular_hours * float(base_rate) + overtime_hours * float(overtime_rate or base_rate * 1.5)
    elif pay_type == "daily":
        # Assume 8 hours per day
        days = regular_hours / 8.0
        gross = days * float(base_rate) + overtime_hours * float(overtime_rate or base_rate / 8 * 1.5)
    else:
        gross = float(base_rate)

    # Simple flat-rate tax (25% above threshold) — to be replaced with proper tax tables
    tax = max(0.0, gross * 0.25) if gross > 500 else 0.0
    # NSSA statutory (3% of gross, capped at $5.40/month)
    nssa = min(gross * 0.03, 5.40)
    net = gross - tax - nssa
    return round(gross, 2), round(tax + nssa, 2), round(max(0.0, net), 2)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", summary="List payroll runs")
async def list_payroll_runs(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)

    filters = ["pr.organization_id = :org_id", "pr.is_deleted = false"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}

    if status_filter and status_filter in RUN_STATUSES:
        filters.append("pr.status = :status")
        params["status"] = status_filter
    if date_from:
        filters.append("pr.period_start >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("pr.period_end <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (await db.execute(
        text(f"SELECT COUNT(*) FROM finance.payroll_runs pr WHERE {where}"),
        count_params,
    )).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                pr.*,
                ca.account_code, ca.account_name,
                COUNT(pi.id) AS employee_count
            FROM finance.payroll_runs pr
            LEFT JOIN finance.cash_accounts ca ON ca.id = pr.cash_account_id
            LEFT JOIN finance.payroll_items pi ON pi.payroll_run_id = pr.id
            WHERE {where}
            GROUP BY pr.id, ca.account_code, ca.account_name
            ORDER BY pr.period_start DESC, pr.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return paginated(items, total=total, page=page, page_size=page_size, message="Payroll runs listed.")


@router.post("/", status_code=status.HTTP_201_CREATED, summary="Create a draft payroll run")
async def create_payroll_run(
    payload: PayrollRunCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.manage")),
):
    org_id = _require_org(user)
    user_id = user.get("sub")

    # Verify cash account
    acct = await db.execute(
        text("SELECT id FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(payload.cash_account_id), "org_id": org_id},
    )
    if not acct.first():
        raise HTTPException(status_code=404, detail="Cash account not found.")

    # Fetch pay profiles for all employees in one query
    employee_ids = [str(item.employee_id) for item in payload.items]
    profiles_rows = await db.execute(
        text("""
            SELECT ep.id AS employee_id, ep.first_name, ep.last_name,
                   pp.pay_type, pp.base_rate, pp.overtime_rate
            FROM finance.employee_pay_profiles pp
            JOIN hr.employees ep ON ep.id = pp.employee_id
            WHERE pp.employee_id = ANY(:ids)
              AND pp.organization_id = :org_id
              AND pp.is_active = true
              AND pp.is_deleted = false
        """),
        {"ids": employee_ids, "org_id": org_id},
    )
    profiles = {str(r.employee_id): dict(r._mapping) for r in profiles_rows}

    missing = [eid for eid in employee_ids if eid not in profiles]
    if missing:
        raise HTTPException(status_code=422, detail=f"No active pay profile found for employees: {missing}")

    try:
        # Create the run header
        run_result = await db.execute(
            text("""
                INSERT INTO finance.payroll_runs (
                    organization_id, run_number, period_start, period_end,
                    payment_date, cash_account_id, status, created_by
                ) VALUES (
                    :org_id,
                    'PAY-' || TO_CHAR(:period_start, 'YYYYMM') || '-' || LPAD(NEXTVAL('finance.payroll_run_seq')::TEXT, 3, '0'),
                    :period_start, :period_end, :payment_date,
                    :cash_account_id, 'draft', :user_id
                )
                RETURNING id, run_number
            """),
            {
                "org_id": org_id,
                "period_start": payload.period_start,
                "period_end": payload.period_end,
                "payment_date": payload.payment_date,
                "cash_account_id": str(payload.cash_account_id),
                "user_id": user_id,
            },
        )
        run_row = run_result.first()
        run_id = str(run_row.id)

        # Insert payroll items with computed pay
        total_gross = total_deductions = total_net = 0.0
        item_results = []

        for item in payload.items:
            profile = profiles[str(item.employee_id)]
            gross, deductions, net = _compute_pay(
                base_rate=float(profile["base_rate"]),
                pay_type=profile["pay_type"],
                regular_hours=item.regular_hours,
                overtime_hours=item.overtime_hours,
                overtime_rate=float(profile.get("overtime_rate") or 0),
            )
            # Apply any additional deductions
            net = max(0.0, net - item.other_deduction)
            deductions += item.other_deduction

            total_gross += gross
            total_deductions += deductions
            total_net += net

            await db.execute(
                text("""
                    INSERT INTO finance.payroll_items (
                        organization_id, payroll_run_id, employee_id, project_id,
                        regular_hours, overtime_hours, gross_pay,
                        tax_deduction, statutory_deduction, other_deduction, net_pay
                    ) VALUES (
                        :org_id, :run_id, :employee_id, :project_id,
                        :regular_hours, :overtime_hours, :gross_pay,
                        :tax_deduction, :statutory_deduction, :other_deduction, :net_pay
                    )
                """),
                {
                    "org_id": org_id,
                    "run_id": run_id,
                    "employee_id": str(item.employee_id),
                    "project_id": str(item.project_id) if item.project_id else None,
                    "regular_hours": item.regular_hours,
                    "overtime_hours": item.overtime_hours,
                    "gross_pay": gross,
                    "tax_deduction": deductions * 0.9,   # approx PAYE portion
                    "statutory_deduction": deductions * 0.1,  # NSSA portion
                    "other_deduction": item.other_deduction,
                    "net_pay": net,
                },
            )
            item_results.append({"employee_id": str(item.employee_id), "gross": gross, "net": net})

        # Update run totals
        await db.execute(
            text("""
                UPDATE finance.payroll_runs
                SET gross_pay = :gross, total_deductions = :deductions, net_pay = :net, updated_at = NOW()
                WHERE id = :run_id
            """),
            {"gross": round(total_gross, 2), "deductions": round(total_deductions, 2), "net": round(total_net, 2), "run_id": run_id},
        )

        await db.commit()
        return ok(
            {
                "id": run_id,
                "run_number": run_row.run_number,
                "employee_count": len(payload.items),
                "gross_pay": round(total_gross, 2),
                "total_deductions": round(total_deductions, 2),
                "net_pay": round(total_net, 2),
                "items": item_results,
            },
            "Payroll run created in draft state.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        if "payroll_run_seq" in str(exc):
            raise HTTPException(status_code=500, detail="Payroll run sequence not found. Run migration 034.")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/{run_id}", summary="Get a payroll run with its items")
async def get_payroll_run(
    run_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    run = await db.execute(
        text("""
            SELECT pr.*, ca.account_code, ca.account_name
            FROM finance.payroll_runs pr
            LEFT JOIN finance.cash_accounts ca ON ca.id = pr.cash_account_id
            WHERE pr.id = :run_id AND pr.organization_id = :org_id AND pr.is_deleted = false
        """),
        {"run_id": str(run_id), "org_id": org_id},
    )
    row = run.first()
    if not row:
        raise HTTPException(status_code=404, detail="Payroll run not found.")

    items = await db.execute(
        text("""
            SELECT pi.*,
                   ep.first_name, ep.last_name, ep.employee_number,
                   p.name AS project_name
            FROM finance.payroll_items pi
            JOIN hr.employees ep ON ep.id = pi.employee_id
            LEFT JOIN projects.projects p ON p.id = pi.project_id
            WHERE pi.payroll_run_id = :run_id
            ORDER BY ep.last_name, ep.first_name
        """),
        {"run_id": str(run_id)},
    )
    return ok(
        {"run": dict(row._mapping), "items": [dict(i._mapping) for i in items]},
        "Payroll run retrieved.",
    )


@router.post("/{run_id}/decision", summary="Approve, post or cancel a payroll run")
async def decide_payroll_run(
    run_id: UUID,
    payload: PayrollRunDecision,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.post")),
):
    org_id = _require_org(user)
    user_id = user.get("sub")

    run = await db.execute(
        text("SELECT id, status, cash_account_id, payment_date, net_pay FROM finance.payroll_runs WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(run_id), "org_id": org_id},
    )
    run_row = run.first()
    if not run_row:
        raise HTTPException(status_code=404, detail="Payroll run not found.")

    current_status = run_row.status
    action = payload.action

    if current_status in ("posted", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Cannot {action} a '{current_status}' payroll run.")

    transitions = {"approve": "draft", "post": "approved", "cancel": None}
    required_from = transitions[action]
    if required_from and current_status != required_from:
        raise HTTPException(status_code=409, detail=f"Run must be '{required_from}' to {action}. Currently '{current_status}'.")

    try:
        extra_sets = ""
        extra_params: dict = {}

        if action == "post":
            # 1. Create cashbook payment transaction for the net payroll amount
            await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_date,
                        transaction_type, amount, currency, payment_method,
                        description, is_posted, posted_at, posted_by, created_by
                    ) VALUES (
                        :org_id, :cash_account_id, :payment_date,
                        'payment', :amount, 'USD', 'bank_transfer',
                        'Payroll run posting', true, NOW(), :user_id, :user_id
                    )
                """),
                {
                    "org_id": org_id,
                    "cash_account_id": str(run_row.cash_account_id),
                    "payment_date": run_row.payment_date,
                    "amount": float(run_row.net_pay),
                    "user_id": user_id,
                },
            )
            extra_sets = ", posted_by = :posted_by, posted_at = NOW()"
            extra_params = {"posted_by": user_id}

        target_status = "approved" if action == "approve" else ("posted" if action == "post" else "cancelled")
        await db.execute(
            text(f"""
                UPDATE finance.payroll_runs
                SET status = :status, updated_at = NOW() {extra_sets}
                WHERE id = :run_id AND organization_id = :org_id
            """),
            {"status": target_status, "run_id": str(run_id), "org_id": org_id, **extra_params},
        )
        await db.commit()
        return ok({"id": str(run_id), "status": target_status}, f"Payroll run {action}d successfully.")
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")
