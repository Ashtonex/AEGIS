"""Payroll runs router — finance.payroll_runs + finance.payroll_items.

Manages payroll processing cycles. A run is created in 'draft', moves to
'approved' after review, then 'posted' which generates cashbook entries
and individual payslip records for each employee in the run.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from app.services.finance import gl_bridge, payroll_allocation, payroll_service
from app.services.finance.payroll_service import ItemInput, OneOffInput, PayrollServiceError, RunInput
from app.services.finance.general_ledger import GeneralLedgerError
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()

RUN_STATUSES = ("draft", "approved", "posted", "cancelled")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PayrollOneOffInput(BaseModel):
    """A one-off earning or deduction for this run only (bonus, extra
    allowance, a one-time deduction), by pay code."""
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    code: str = Field(min_length=1, max_length=20)
    amount: Decimal = Field(ge=0, max_digits=15, decimal_places=2)


class PayrollItemInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    employee_id: UUID
    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    regular_hours: Decimal = Field(default=Decimal("0"), ge=0, max_digits=8, decimal_places=2)
    overtime_hours: Decimal = Field(default=Decimal("0"), ge=0, max_digits=8, decimal_places=2)
    other_deduction: Decimal = Field(default=Decimal("0"), ge=0, max_digits=15, decimal_places=2)
    one_offs: List[PayrollOneOffInput] = Field(default_factory=list, max_length=30)
    notes: Optional[str] = Field(default=None, max_length=500)


class PayrollRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    period_start: date
    period_end: date
    payment_date: date
    cash_account_id: UUID
    items: List[PayrollItemInput] = Field(min_length=1)
    notes: Optional[str] = Field(default=None, max_length=1000)
    # Split pay: needed only when someone on the run is paid partly in a
    # second currency (their pay profile sets the share).
    secondary_currency: Optional[str] = Field(default=None, min_length=3, max_length=3)
    exchange_rate: Optional[Decimal] = Field(default=None, gt=0, max_digits=18, decimal_places=6)
    secondary_cash_account_id: Optional[UUID] = None

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


class PayrollAllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    allocation_pct: float = Field(gt=0, le=100)


class PayrollAllocationsReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocations: List[PayrollAllocationInput] = Field(min_length=1)


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

@router.get("/", summary="List payroll runs")
async def list_payroll_runs(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    department_id: Optional[UUID] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.read")),
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
    if department_id:
        filters.append("""EXISTS (
            SELECT 1 FROM finance.payroll_items i
            WHERE i.payroll_run_id = pr.id
              AND (i.department_id = :department_id OR i.department_id IS NULL)
        )""")
        params["department_id"] = department_id

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
    """Computes every employee's pay with the payroll engine (pay codes, loans,
    taxable income, credits, bonus exemption, split currency) and writes a
    draft run. See app/services/finance/payroll_service.py."""
    org_id = _require_org(user)
    run_input = RunInput(
        period_start=payload.period_start,
        period_end=payload.period_end,
        payment_date=payload.payment_date,
        cash_account_id=str(payload.cash_account_id),
        secondary_currency=payload.secondary_currency,
        exchange_rate=payload.exchange_rate,
        secondary_cash_account_id=str(payload.secondary_cash_account_id) if payload.secondary_cash_account_id else None,
        items=[
            ItemInput(
                employee_id=str(item.employee_id),
                project_id=str(item.project_id) if item.project_id else None,
                department_id=str(item.department_id) if item.department_id else None,
                regular_hours=item.regular_hours,
                overtime_hours=item.overtime_hours,
                other_deduction=item.other_deduction,
                one_offs=[OneOffInput(code=o.code, amount=o.amount) for o in item.one_offs],
                notes=item.notes,
            )
            for item in payload.items
        ],
    )
    try:
        result = await payroll_service.create_run(db, org_id=org_id, user_id=user.get("sub"), run=run_input)
        await db.commit()
    except PayrollServiceError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc
    return ok(result, "Payroll run created in draft state.")


@router.get("/{run_id}", summary="Get a payroll run with its items")
async def get_payroll_run(
    run_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.read")),
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
                   ep.employee_name, ep.employee_number,
                   p.name AS project_name
            FROM finance.payroll_items pi
            JOIN hr.employees ep ON ep.id = pi.employee_id
            LEFT JOIN projects.projects p ON p.id = pi.project_id
            WHERE pi.payroll_run_id = :run_id AND pi.organization_id = :org_id
            ORDER BY ep.employee_name
        """),
        {"run_id": str(run_id), "org_id": org_id},
    )
    lines = await db.execute(
        text("""
            SELECT payroll_item_id, line_kind, code, name, quantity, rate, amount,
                   is_taxable, is_nssa_insurable, reduces_taxable, sort_order
            FROM finance.payroll_item_lines
            WHERE payroll_run_id = :run_id AND organization_id = :org_id
            ORDER BY sort_order, code
        """),
        {"run_id": str(run_id), "org_id": org_id},
    )
    lines_by_item: dict[str, list[dict]] = {}
    for ln in lines:
        lines_by_item.setdefault(str(ln.payroll_item_id), []).append(dict(ln._mapping))
    item_rows = []
    for i in items:
        data = dict(i._mapping)
        data["lines"] = lines_by_item.get(str(data["id"]), [])
        item_rows.append(data)
    return ok({"run": dict(row._mapping), "items": item_rows}, "Payroll run retrieved.")


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
        text("""
            SELECT id, run_number, status, cash_account_id, payment_date, net_pay,
                   base_currency, secondary_currency, exchange_rate, secondary_cash_account_id
            FROM finance.payroll_runs
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            FOR UPDATE
        """),
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

    base_currency = run_row.base_currency or "USD"
    try:
        # A closed month is locked for every change, cancellation included.
        await payroll_service.assert_period_open(db, org_id, run_row.payment_date)

        extra_sets = ""
        extra_params: dict = {}

        if action == "approve":
            extra_sets = ", approved_by = :approved_by, approved_at = NOW()"
            extra_params = {"approved_by": user_id}

        if action == "post":
            await payroll_service.assert_loan_balances_cover(db, org_id, str(run_id))
            base_cash, secondary_cash = await payroll_service.cash_postings(db, org_id, str(run_id))

            # 1. Cashbook: one payment per currency actually paid out.
            cashbook_sql = text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_date,
                    transaction_type, amount, currency, payment_method,
                    transaction_number, direction,
                    description, is_posted, posted_at, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :payment_date,
                    'payment', :amount, :currency, 'bank_transfer',
                    :transaction_number, 'outflow',
                    :description, true, NOW(), :user_id
                ) RETURNING id
            """)
            cashbook_transaction_id = None
            if base_cash > 0:
                cashbook_transaction_id = (await db.execute(cashbook_sql, {
                    "org_id": org_id,
                    "cash_account_id": str(run_row.cash_account_id),
                    "payment_date": run_row.payment_date,
                    "amount": float(base_cash),
                    "currency": base_currency,
                    "transaction_number": f"PAY-{run_row.run_number}",
                    "description": "Payroll run posting",
                    "user_id": user_id,
                })).scalar()
            if secondary_cash > 0:
                if not run_row.secondary_cash_account_id:
                    raise HTTPException(
                        status_code=422,
                        detail="This run pays part in a second currency but has no second-currency cash account.",
                    )
                await db.execute(cashbook_sql, {
                    "org_id": org_id,
                    "cash_account_id": str(run_row.secondary_cash_account_id),
                    "payment_date": run_row.payment_date,
                    "amount": float(secondary_cash),
                    "currency": run_row.secondary_currency,
                    "transaction_number": f"PAY-{run_row.run_number}-{run_row.secondary_currency}",
                    "description": f"Payroll run posting ({run_row.secondary_currency} portion)",
                    "user_id": user_id,
                })
            if cashbook_transaction_id:
                await db.execute(
                    text("""
                        UPDATE finance.payroll_items SET cashbook_transaction_id = :cb_id
                        WHERE payroll_run_id = :run_id AND organization_id = :org_id
                    """),
                    {"cb_id": cashbook_transaction_id, "run_id": str(run_id), "org_id": org_id},
                )
            extra_sets = ", posted_by = :posted_by, posted_at = NOW()"
            extra_params = {"posted_by": user_id}

            # 2. Loans: reduce each balance by the instalment paid.
            await payroll_service.apply_loan_repayments(db, org_id, str(run_id), run_row.payment_date)

            # 3. Statutory liabilities, one line per payroll item (so each
            # carries its own department for the department P&L), and per
            # currency: the second-currency share is owed in that currency.
            items_rows = await db.execute(
                text(f"""
                    SELECT {payroll_service.PAYROLL_ITEM_STATUTORY_COLUMNS}
                    FROM finance.payroll_items pi
                    JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
                    WHERE pi.payroll_run_id = :run_id AND pi.organization_id = :org_id
                """),
                {"run_id": str(run_id), "org_id": org_id},
            )
            for item in items_rows.mappings().all():
                await payroll_service.accrue_payroll_item(db, org_id, item)

        target_status = "approved" if action == "approve" else ("posted" if action == "post" else "cancelled")
        await db.execute(
            text(f"""
                UPDATE finance.payroll_runs
                SET status = :status, updated_at = NOW() {extra_sets}
                WHERE id = :run_id AND organization_id = :org_id
            """),
            {"status": target_status, "run_id": str(run_id), "org_id": org_id, **extra_params},
        )

        gl_warning: Optional[str] = None
        if action == "post":
            # A missing GL account mapping must never block payroll from
            # posting - it degrades to "no GL proposal appears yet",
            # visible as a gap in the Proposed Journals queue rather than a
            # failed payroll run. Same non-blocking pattern as every other
            # auto-propose hook in gl_bridge.py.
            try:
                await gl_bridge.propose_journal_for_payroll_run(
                    db, org_id=org_id, user_id=user_id, payroll_run_id=run_id
                )
            except GeneralLedgerError as exc:
                gl_warning = str(exc)

        await db.commit()
        result = {"id": str(run_id), "status": target_status}
        if gl_warning:
            result["gl_proposal_warning"] = gl_warning
        return ok(result, f"Payroll run {action}d successfully.")
    except PayrollServiceError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.post("/{run_id}/propose-gl", summary="Propose a GL journal for an already-posted payroll run")
async def propose_payroll_run_gl_journal(
    run_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll.post")),
):
    """On-demand backfill for a run posted before this bridge existed, or
    whose auto-proposal failed with a mapping error at post time. Idempotent
    - the underlying dedup check refuses a run that already has a proposal."""
    org_id = _require_org(user)
    user_id = user.get("sub")
    try:
        journal = await gl_bridge.propose_journal_for_payroll_run(
            db, org_id=org_id, user_id=user_id, payroll_run_id=run_id
        )
        await db.commit()
        return ok(journal, "GL journal proposed for payroll run.")
    except GeneralLedgerError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/items/{item_id}/allocations", summary="Get a payroll item's multi-project allocation split")
async def get_payroll_item_allocations(
    item_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll_allocation.read")),
):
    org_id = _require_org(user)
    allocations = await payroll_allocation.get_allocations(db, org_id=org_id, payroll_item_id=item_id)
    return ok({"allocations": allocations}, "Payroll item allocations retrieved.")


@router.put("/items/{item_id}/allocations", summary="Replace a payroll item's multi-project allocation split")
async def put_payroll_item_allocations(
    item_id: UUID,
    payload: PayrollAllocationsReplace,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.payroll_allocation.manage")),
):
    org_id = _require_org(user)
    user_id = user.get("sub")
    try:
        allocations = await payroll_allocation.replace_allocations(
            db,
            org_id=org_id,
            user_id=user_id,
            payroll_item_id=item_id,
            allocations=[a.model_dump() for a in payload.allocations],
        )
        await db.commit()
        return ok({"allocations": allocations}, "Payroll item allocations updated.")
    except GeneralLedgerError as exc:
        await db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
