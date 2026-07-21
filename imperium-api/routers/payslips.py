"""Payslips router — finance.payroll_items (employee payslip view).

Provides read-only access to individual payslip records derived from
payroll runs. Each finance.payroll_item is the payslip for one employee
in one run. This router surfaces them per-employee and per-run.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_org(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation linked to this account.")
    return str(org_id)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", summary="List payslips across all runs")
async def list_payslips(
    employee_id: Optional[UUID] = Query(default=None),
    payroll_run_id: Optional[UUID] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)

    filters = ["pi.organization_id = :org_id", "pr.status = 'posted'"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}

    if employee_id:
        filters.append("pi.employee_id = :employee_id")
        params["employee_id"] = str(employee_id)
    if payroll_run_id:
        filters.append("pi.payroll_run_id = :payroll_run_id")
        params["payroll_run_id"] = str(payroll_run_id)
    if date_from:
        filters.append("pr.payment_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("pr.payment_date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (await db.execute(
        text(f"""
            SELECT COUNT(*)
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE {where}
        """),
        count_params,
    )).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                pi.id AS payslip_id,
                pi.employee_id,
                ep.employee_number,
                ep.first_name,
                ep.last_name,
                ep.job_title,
                pr.id AS payroll_run_id,
                pr.run_number,
                pr.period_start,
                pr.period_end,
                pr.payment_date,
                pi.regular_hours,
                pi.overtime_hours,
                pi.gross_pay,
                pi.tax_deduction,
                pi.statutory_deduction,
                pi.other_deduction,
                pi.net_pay,
                pp.pay_type,
                pp.base_rate,
                pp.currency,
                pp.bank_name,
                pp.bank_account_number,
                p.name AS project_name,
                pi.created_at
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            JOIN hr.employees ep ON ep.id = pi.employee_id
            LEFT JOIN finance.employee_pay_profiles pp ON pp.employee_id = pi.employee_id AND pp.organization_id = pi.organization_id
            LEFT JOIN projects.projects p ON p.id = pi.project_id
            WHERE {where}
            ORDER BY pr.payment_date DESC, ep.last_name ASC, ep.first_name ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return paginated(items, total=total, page=page, page_size=page_size, message="Payslips listed.")


@router.get("/{payslip_id}", summary="Get a single payslip")
async def get_payslip(
    payslip_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    result = await db.execute(
        text("""
            SELECT
                pi.id AS payslip_id,
                pi.employee_id,
                ep.employee_number,
                ep.first_name,
                ep.last_name,
                ep.job_title,
                ep.department,
                pr.id AS payroll_run_id,
                pr.run_number,
                pr.period_start,
                pr.period_end,
                pr.payment_date,
                pr.status AS run_status,
                pi.regular_hours,
                pi.overtime_hours,
                pi.gross_pay,
                pi.tax_deduction,
                pi.statutory_deduction,
                pi.other_deduction,
                pi.net_pay,
                pp.pay_type,
                pp.base_rate,
                pp.overtime_rate,
                pp.currency,
                pp.bank_name,
                pp.bank_account_number,
                pp.tax_number,
                pp.nssa_number,
                ca.account_name AS payment_account_name,
                p.name AS project_name,
                pi.created_at
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            JOIN hr.employees ep ON ep.id = pi.employee_id
            LEFT JOIN finance.employee_pay_profiles pp ON pp.employee_id = pi.employee_id AND pp.organization_id = pi.organization_id
            LEFT JOIN finance.cash_accounts ca ON ca.id = pr.cash_account_id
            LEFT JOIN projects.projects p ON p.id = pi.project_id
            WHERE pi.id = :payslip_id AND pi.organization_id = :org_id
        """),
        {"payslip_id": str(payslip_id), "org_id": org_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Payslip not found.")
    return ok(dict(row._mapping), "Payslip retrieved.")


@router.get("/employee/{employee_id}", summary="Get all payslips for a specific employee")
async def get_employee_payslips(
    employee_id: UUID,
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=24, ge=1, le=120),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.read")),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)

    filters = [
        "pi.organization_id = :org_id",
        "pi.employee_id = :employee_id",
        "pr.status = 'posted'",
    ]
    params: dict = {"org_id": org_id, "employee_id": str(employee_id), "limit": limit, "offset": offset}

    if date_from:
        filters.append("pr.payment_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("pr.payment_date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    # Verify employee belongs to this org
    emp_check = await db.execute(
        text("SELECT id FROM hr.employees WHERE id = :employee_id AND organization_id = :org_id AND is_deleted = false"),
        {"employee_id": str(employee_id), "org_id": org_id},
    )
    if not emp_check.first():
        raise HTTPException(status_code=404, detail="Employee not found.")

    total = (await db.execute(
        text(f"""
            SELECT COUNT(*) FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE {where}
        """),
        count_params,
    )).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                pi.id AS payslip_id,
                pr.run_number,
                pr.period_start,
                pr.period_end,
                pr.payment_date,
                pi.regular_hours,
                pi.overtime_hours,
                pi.gross_pay,
                pi.tax_deduction + pi.statutory_deduction + pi.other_deduction AS total_deductions,
                pi.net_pay,
                pp.currency
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            LEFT JOIN finance.employee_pay_profiles pp ON pp.employee_id = pi.employee_id AND pp.organization_id = pi.organization_id
            WHERE {where}
            ORDER BY pr.payment_date DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]

    # Also return YTD summary
    ytd = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(pi.gross_pay), 0) AS ytd_gross,
                COALESCE(SUM(pi.tax_deduction + pi.statutory_deduction + pi.other_deduction), 0) AS ytd_deductions,
                COALESCE(SUM(pi.net_pay), 0) AS ytd_net
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id
            WHERE pi.organization_id = :org_id
              AND pi.employee_id = :employee_id
              AND pr.status = 'posted'
              AND EXTRACT(YEAR FROM pr.payment_date) = EXTRACT(YEAR FROM NOW())
        """),
        {"org_id": org_id, "employee_id": str(employee_id)},
    )
    ytd_row = dict(ytd.first()._mapping)

    return {
        **paginated(items, total=total, page=page, page_size=page_size, message="Employee payslips listed."),
        "ytd": ytd_row,
    }
