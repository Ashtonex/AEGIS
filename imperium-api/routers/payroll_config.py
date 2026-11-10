"""Payroll setup router: settings, pay codes, employee pay codes, monthly
period locks and year-to-date totals.

Mounted at /api/v1/payroll (separate from /api/v1/payroll-runs so these
paths can never collide with /payroll-runs/{run_id}).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import payroll_service
from app.services.finance.payroll_service import PayrollServiceError
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()

ELEMENT_TYPES = ("earning", "deduction", "tax_credit", "employer_contribution")
CALC_METHODS = ("fixed", "pct_of_basic", "per_hour", "per_day")


def _org(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation linked to this account.")
    return str(org_id)


def _service_error(exc: PayrollServiceError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _parse_month(value: str) -> date:
    try:
        year, month = value.split("-")
        return date(int(year), int(month), 1)
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=422, detail="Month must be YYYY-MM.") from exc


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

class PayrollSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    base_currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    split_tax_method: Optional[str] = Field(default=None, pattern=r"^(base_tables|separate_tables)$")
    nssa_reduces_taxable: Optional[bool] = None


@router.get("/settings", summary="Payroll settings")
async def get_payroll_settings(
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await payroll_service.get_settings(db, _org(user)), "Payroll settings retrieved.")


@router.put("/settings", summary="Update payroll settings")
async def put_payroll_settings(
    payload: PayrollSettingsUpdate,
    # Changes how tax is calculated, so it needs the same trust as editing a
    # tax rate table.
    user: dict = Depends(require_permission("finance.tax_rate.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    if payload.base_currency:
        open_runs = (await db.execute(
            text("""
                SELECT COUNT(*) FROM finance.payroll_runs
                WHERE organization_id = :org_id AND is_deleted = false AND status IN ('draft', 'approved')
            """),
            {"org_id": org_id},
        )).scalar() or 0
        current = await payroll_service.get_settings(db, org_id)
        if open_runs and payload.base_currency.upper() != current["base_currency"]:
            raise HTTPException(status_code=409, detail="Post or cancel open payroll runs before changing the base currency.")
    try:
        settings = await payroll_service.update_settings(db, org_id, user.get("sub"), payload.model_dump())
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _service_error(exc) from exc
    return ok(settings, "Payroll settings updated.")


# ---------------------------------------------------------------------------
# Pay codes
# ---------------------------------------------------------------------------

class PayElementBase(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    calc_method: Optional[str] = Field(default=None, pattern=r"^(fixed|pct_of_basic|per_hour|per_day)$")
    default_amount: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=4)
    is_taxable: Optional[bool] = None
    is_nssa_insurable: Optional[bool] = None
    is_bonus: Optional[bool] = None
    reduces_taxable: Optional[bool] = None
    tax_credit_pct: Optional[Decimal] = Field(default=None, ge=0, le=100, max_digits=7, decimal_places=4)
    is_loan: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = Field(default=None, ge=0, le=999)
    description: Optional[str] = Field(default=None, max_length=1000)


class PayElementCreate(PayElementBase):
    code: str = Field(min_length=1, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
    name: str = Field(min_length=1, max_length=120)
    element_type: str = Field(pattern=r"^(earning|deduction|tax_credit|employer_contribution)$")


def _check_flags(element_type: str, values: dict) -> None:
    if element_type != "earning" and (values.get("is_bonus") or values.get("is_nssa_insurable")):
        raise HTTPException(status_code=422, detail="Bonus and NSSA-insurable apply to earnings only.")
    if element_type != "deduction" and (
        values.get("reduces_taxable") or values.get("is_loan") or (values.get("tax_credit_pct") or 0) > 0
    ):
        raise HTTPException(status_code=422, detail="Pre-tax, loan and tax-credit % apply to deductions only.")


@router.get("/elements", summary="Pay codes (earnings, deductions, credits)")
async def list_pay_elements(
    include_inactive: bool = Query(default=False),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text(f"""
            SELECT pe.*,
                   (SELECT COUNT(*) FROM finance.employee_pay_elements epe
                     WHERE epe.pay_element_id = pe.id AND epe.is_deleted = false AND epe.is_active = true) AS assigned_count
            FROM finance.pay_elements pe
            WHERE pe.organization_id = :org_id AND pe.is_deleted = false
              {"" if include_inactive else "AND pe.is_active = true"}
            ORDER BY pe.sort_order, pe.code
        """),
        {"org_id": _org(user)},
    )
    return ok([dict(r._mapping) for r in rows], "Pay codes listed.")


@router.post("/elements", status_code=status.HTTP_201_CREATED, summary="Create a pay code")
async def create_pay_element(
    payload: PayElementCreate,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    _check_flags(payload.element_type, values)
    code = payload.code.upper()
    if code in payroll_service.SYSTEM_CODES:
        raise HTTPException(status_code=409, detail=f"{code} is a system code.")
    try:
        row = (await db.execute(
            text("""
                INSERT INTO finance.pay_elements (
                    organization_id, code, name, element_type, calc_method, default_amount,
                    is_taxable, is_nssa_insurable, is_bonus, reduces_taxable, tax_credit_pct, is_loan,
                    is_active, sort_order, description, created_by
                ) VALUES (
                    :org_id, :code, :name, :element_type, :calc_method, :default_amount,
                    :is_taxable, :is_nssa_insurable, :is_bonus, :reduces_taxable, :tax_credit_pct, :is_loan,
                    :is_active, :sort_order, :description, :user_id
                ) RETURNING *
            """),
            {
                "org_id": _org(user),
                "code": code,
                "name": payload.name,
                "element_type": payload.element_type,
                "calc_method": payload.calc_method or "fixed",
                "default_amount": payload.default_amount,
                # Deductions and credits are never "taxable earnings".
                "is_taxable": bool(payload.is_taxable if payload.is_taxable is not None else payload.element_type == "earning")
                and payload.element_type == "earning",
                "is_nssa_insurable": bool(payload.is_nssa_insurable),
                "is_bonus": bool(payload.is_bonus),
                "reduces_taxable": bool(payload.reduces_taxable),
                "tax_credit_pct": payload.tax_credit_pct or Decimal("0"),
                "is_loan": bool(payload.is_loan),
                "is_active": True if payload.is_active is None else payload.is_active,
                "sort_order": payload.sort_order if payload.sort_order is not None else 100,
                "description": payload.description,
                "user_id": user.get("sub"),
            },
        )).mappings().first()
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail=f"Pay code {code} already exists.") from exc
    return ok(dict(row), "Pay code created.")


@router.patch("/elements/{element_id}", summary="Edit a pay code")
async def update_pay_element(
    element_id: UUID,
    payload: PayElementBase,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    current = (await db.execute(
        text("SELECT * FROM finance.pay_elements WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(element_id), "org_id": org_id},
    )).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Pay code not found.")
    changes = {k: v for k, v in payload.model_dump().items() if v is not None}
    if not changes:
        return ok(dict(current), "Nothing to change.")
    merged = {**dict(current), **changes}
    _check_flags(current["element_type"], merged)
    if current["is_system"]:
        locked = {"is_taxable", "is_nssa_insurable", "calc_method", "is_active"} & changes.keys()
        if locked:
            raise HTTPException(status_code=409, detail=f"{current['code']} is a system code; only its name and order can change.")
    if current["element_type"] != "earning":
        changes["is_taxable"] = False
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    row = (await db.execute(
        text(f"""
            UPDATE finance.pay_elements SET {sets}, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
            RETURNING *
        """),
        {**changes, "id": str(element_id), "org_id": org_id},
    )).mappings().first()
    await db.commit()
    return ok(dict(row), "Pay code updated.")


# ---------------------------------------------------------------------------
# Employee pay codes (recurring allowances, deductions, loans, credits)
# ---------------------------------------------------------------------------

class EmployeePayElementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    employee_id: UUID
    pay_element_id: UUID
    amount: Decimal = Field(ge=0, max_digits=15, decimal_places=4)
    loan_balance: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    effective_from: date
    effective_to: Optional[date] = None
    reference: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def check_dates(self) -> "EmployeePayElementCreate":
        if self.effective_to and self.effective_to < self.effective_from:
            raise ValueError("effective_to must be on or after effective_from.")
        return self


class EmployeePayElementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    amount: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=4)
    loan_balance: Optional[Decimal] = Field(default=None, ge=0, max_digits=15, decimal_places=2)
    effective_to: Optional[date] = None
    is_active: Optional[bool] = None
    reference: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=1000)


@router.get("/employee-elements", summary="Pay codes assigned to employees")
async def list_employee_pay_elements(
    employee_id: Optional[UUID] = Query(default=None),
    include_ended: bool = Query(default=False),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    filters = ["epe.organization_id = :org_id", "epe.is_deleted = false"]
    params: dict = {"org_id": _org(user)}
    if employee_id:
        filters.append("epe.employee_id = :employee_id")
        params["employee_id"] = str(employee_id)
    if not include_ended:
        filters.append("epe.is_active = true AND (epe.effective_to IS NULL OR epe.effective_to >= CURRENT_DATE)")
    rows = await db.execute(
        text(f"""
            SELECT epe.*, pe.code, pe.name AS element_name, pe.element_type, pe.calc_method, pe.is_loan,
                   e.employee_name, e.employee_number
            FROM finance.employee_pay_elements epe
            JOIN finance.pay_elements pe ON pe.id = epe.pay_element_id
            JOIN hr.employees e ON e.id = epe.employee_id
            WHERE {" AND ".join(filters)}
            ORDER BY e.employee_name, pe.sort_order, pe.code
        """),
        params,
    )
    return ok([dict(r._mapping) for r in rows], "Employee pay codes listed.")


@router.post("/employee-elements", status_code=status.HTTP_201_CREATED, summary="Assign a pay code to an employee")
async def create_employee_pay_element(
    payload: EmployeePayElementCreate,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    element = (await db.execute(
        text("""
            SELECT code, is_loan, is_system, is_active FROM finance.pay_elements
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
        {"id": str(payload.pay_element_id), "org_id": org_id},
    )).first()
    if not element or not element.is_active:
        raise HTTPException(status_code=404, detail="Pay code not found or inactive.")
    if element.code in payroll_service.SYSTEM_CODES:
        raise HTTPException(status_code=409, detail=f"{element.code} comes from the pay profile; it cannot be assigned.")
    if element.is_loan and payload.loan_balance is None:
        raise HTTPException(status_code=422, detail=f"{element.code} is a loan: enter the balance to recover.")
    if not element.is_loan and payload.loan_balance is not None:
        raise HTTPException(status_code=422, detail=f"{element.code} is not a loan; leave the balance empty.")
    employee = (await db.execute(
        text("SELECT 1 FROM hr.employees WHERE id = :id AND organization_id = :org_id"),
        {"id": str(payload.employee_id), "org_id": org_id},
    )).first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")
    row = (await db.execute(
        text("""
            INSERT INTO finance.employee_pay_elements (
                organization_id, employee_id, pay_element_id, amount, loan_balance,
                effective_from, effective_to, reference, notes, created_by
            ) VALUES (
                :org_id, :employee_id, :pay_element_id, :amount, :loan_balance,
                :effective_from, :effective_to, :reference, :notes, :user_id
            ) RETURNING *
        """),
        {
            "org_id": org_id,
            "employee_id": str(payload.employee_id),
            "pay_element_id": str(payload.pay_element_id),
            "amount": payload.amount,
            "loan_balance": payload.loan_balance,
            "effective_from": payload.effective_from,
            "effective_to": payload.effective_to,
            "reference": payload.reference,
            "notes": payload.notes,
            "user_id": user.get("sub"),
        },
    )).mappings().first()
    await db.commit()
    return ok(dict(row), "Pay code assigned.")


@router.patch("/employee-elements/{assignment_id}", summary="Change or end an employee pay code")
async def update_employee_pay_element(
    assignment_id: UUID,
    payload: EmployeePayElementUpdate,
    user: dict = Depends(require_permission("finance.payroll.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org(user)
    changes = {k: v for k, v in payload.model_dump(exclude_unset=True).items()}
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to change.")
    current = (await db.execute(
        text("""
            SELECT epe.effective_from, pe.is_loan FROM finance.employee_pay_elements epe
            JOIN finance.pay_elements pe ON pe.id = epe.pay_element_id
            WHERE epe.id = :id AND epe.organization_id = :org_id AND epe.is_deleted = false
        """),
        {"id": str(assignment_id), "org_id": org_id},
    )).first()
    if not current:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    if "loan_balance" in changes and not current.is_loan:
        raise HTTPException(status_code=422, detail="Only loans carry a balance.")
    if changes.get("effective_to") and changes["effective_to"] < current.effective_from:
        raise HTTPException(status_code=422, detail="effective_to must be on or after effective_from.")
    sets = ", ".join(f"{k} = :{k}" for k in changes)
    row = (await db.execute(
        text(f"""
            UPDATE finance.employee_pay_elements SET {sets}, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
            RETURNING *
        """),
        {**changes, "id": str(assignment_id), "org_id": org_id},
    )).mappings().first()
    await db.commit()
    return ok(dict(row), "Assignment updated.")


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------

class ReopenPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    reason: str = Field(min_length=5, max_length=1000)


@router.get("/periods", summary="Payroll months and whether each is closed")
async def list_payroll_periods(
    year: int = Query(ge=2000, le=2100),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await payroll_service.list_periods(db, _org(user), year), "Payroll periods listed.")


@router.post("/periods/{month}/close", summary="Close (lock) a payroll month")
async def close_payroll_period(
    month: str,
    user: dict = Depends(require_permission("finance.payroll.period.close")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await payroll_service.close_period(db, _org(user), user.get("sub"), _parse_month(month))
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _service_error(exc) from exc
    return ok(result, "Payroll month closed.")


@router.post("/periods/{month}/reopen", summary="Reopen a closed payroll month")
async def reopen_payroll_period(
    month: str,
    payload: ReopenPayload,
    user: dict = Depends(require_permission("finance.payroll.period.reopen")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await payroll_service.reopen_period(db, _org(user), user.get("sub"), _parse_month(month), payload.reason)
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise _service_error(exc) from exc
    return ok(result, "Payroll month reopened.")


# ---------------------------------------------------------------------------
# Year to date
# ---------------------------------------------------------------------------

@router.get("/ytd", summary="Year-to-date pay and tax per employee (posted runs)")
async def payroll_ytd(
    year: int = Query(ge=2000, le=2100),
    employee_id: Optional[UUID] = Query(default=None),
    user: dict = Depends(require_permission("finance.payroll.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await payroll_service.ytd(db, _org(user), year, str(employee_id) if employee_id else None)
    return ok(rows, "Year-to-date totals listed.")
