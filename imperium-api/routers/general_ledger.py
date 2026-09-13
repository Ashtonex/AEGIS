from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok, page_offset, paginated
from app.services.finance import general_ledger as gl

router = APIRouter()


class ChartOfAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_code: str = Field(min_length=1, max_length=20)
    account_name: str = Field(min_length=1, max_length=200)
    account_category: str = Field(min_length=1, max_length=30)
    normal_balance: str = Field(pattern="^(debit|credit)$")
    parent_account_id: Optional[UUID] = None
    is_control_account: bool = False
    currency_code: str = Field(default="USD", max_length=3)
    description: Optional[str] = None


class ChartOfAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_name: Optional[str] = Field(default=None, max_length=200)
    account_category: Optional[str] = Field(default=None, max_length=30)
    normal_balance: Optional[str] = Field(default=None, pattern="^(debit|credit)$")
    parent_account_id: Optional[UUID] = None
    is_control_account: Optional[bool] = None
    is_active: Optional[bool] = None
    description: Optional[str] = None


class AccountingPeriodCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    period_start: date
    period_end: date


class PeriodReopenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=1000)


class JournalLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_id: UUID
    debit_amount: float = Field(default=0, ge=0)
    credit_amount: float = Field(default=0, ge=0)
    description: Optional[str] = None
    department_id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    cost_code_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    client_id: Optional[UUID] = None
    employee_id: Optional[UUID] = None
    currency_code: str = Field(default="USD", max_length=3)


class JournalEntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    period_id: UUID
    entry_date: date
    description: str = Field(min_length=1)
    lines: list[JournalLineIn] = Field(min_length=2)
    source_type: Optional[str] = Field(default=None, max_length=120)
    source_id: Optional[UUID] = None


class JournalEntryUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    entry_date: Optional[date] = None
    description: Optional[str] = None
    lines: Optional[list[JournalLineIn]] = Field(default=None, min_length=2)


class JournalReverseRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reversal_date: date
    reason: str = Field(min_length=1, max_length=1000)


def _raise(exc: gl.GeneralLedgerError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

@router.get("/accounts")
async def list_accounts(
    category: Optional[str] = None,
    active_only: bool = False,
    user: dict = Depends(require_permission("finance.coa.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await gl.list_chart_of_accounts(db, org_id=user["org_id"], category=category, active_only=active_only)
    return ok(items, "Chart of accounts listed.")


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
async def create_account(
    payload: ChartOfAccountCreate,
    user: dict = Depends(require_permission("finance.coa.write")),
    db: AsyncSession = Depends(get_db),
):
    try:
        account = await gl.create_chart_of_account(
            db, org_id=user["org_id"], user_id=user["sub"], **payload.model_dump()
        )
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(account, "Account created.")


@router.get("/accounts/{account_id}")
async def get_account(
    account_id: UUID,
    user: dict = Depends(require_permission("finance.coa.read")),
    db: AsyncSession = Depends(get_db),
):
    account = await gl.get_chart_of_account(db, org_id=user["org_id"], account_id=account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Account not found.")
    return ok(account, "Account retrieved.")


@router.patch("/accounts/{account_id}")
async def update_account(
    account_id: UUID,
    payload: ChartOfAccountUpdate,
    user: dict = Depends(require_permission("finance.coa.write")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True)
    try:
        account = await gl.update_chart_of_account(db, org_id=user["org_id"], user_id=user["sub"], account_id=account_id, values=values)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(account, "Account updated.")


@router.get("/accounts/{account_id}/ledger")
async def account_ledger(
    account_id: UUID,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    lines = await gl.get_account_ledger(db, org_id=user["org_id"], account_id=account_id, date_from=date_from, date_to=date_to)
    return ok(lines, "Account ledger retrieved.")


@router.get("/trial-balance")
async def trial_balance(
    as_of_date: Optional[date] = None,
    period_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await gl.get_trial_balance(db, org_id=user["org_id"], as_of_date=as_of_date, period_id=period_id)
    return ok(rows, "Trial balance retrieved.")


# ---------------------------------------------------------------------------
# Accounting Periods
# ---------------------------------------------------------------------------

@router.get("/periods")
async def list_periods(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    user: dict = Depends(require_permission("finance.period.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await gl.list_accounting_periods(db, org_id=user["org_id"], status_filter=status_filter)
    return ok(items, "Accounting periods listed.")


@router.post("/periods", status_code=status.HTTP_201_CREATED)
async def create_period(
    payload: AccountingPeriodCreate,
    user: dict = Depends(require_permission("finance.period.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        period = await gl.create_accounting_period(db, org_id=user["org_id"], user_id=user["sub"], **payload.model_dump())
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(period, "Accounting period created.")


@router.post("/periods/{period_id}/soft-close")
async def soft_close(
    period_id: UUID,
    user: dict = Depends(require_permission("finance.period.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        period = await gl.soft_close_period(db, org_id=user["org_id"], user_id=user["sub"], period_id=period_id)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(period, "Period soft-closed.")


@router.post("/periods/{period_id}/close")
async def close(
    period_id: UUID,
    user: dict = Depends(require_permission("finance.period.close")),
    db: AsyncSession = Depends(get_db),
):
    try:
        period = await gl.close_period(db, org_id=user["org_id"], user_id=user["sub"], period_id=period_id)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(period, "Period closed.")


@router.post("/periods/{period_id}/reopen")
async def reopen(
    period_id: UUID,
    payload: PeriodReopenRequest,
    user: dict = Depends(require_permission("finance.period.reopen")),
    db: AsyncSession = Depends(get_db),
):
    try:
        period = await gl.reopen_period(db, org_id=user["org_id"], user_id=user["sub"], period_id=period_id, reason=payload.reason)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(period, "Period reopened.")


@router.post("/periods/{period_id}/lock")
async def lock(
    period_id: UUID,
    user: dict = Depends(require_permission("finance.period.lock")),
    db: AsyncSession = Depends(get_db),
):
    try:
        period = await gl.lock_period(db, org_id=user["org_id"], user_id=user["sub"], period_id=period_id)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(period, "Period locked.")


# ---------------------------------------------------------------------------
# Journal Entries
# ---------------------------------------------------------------------------

@router.get("/journals")
async def list_journals(
    period_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    source_type: Optional[str] = None,
    source_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    limit, offset = page_offset(page, page_size)
    items, total = await gl.list_journals(
        db, org_id=user["org_id"], period_id=period_id, status_filter=status_filter,
        source_type=source_type, source_id=source_id, project_id=project_id,
        date_from=date_from, date_to=date_to, limit=limit, offset=offset,
    )
    return paginated(items, total=total, page=page, page_size=page_size, message="Journal entries listed.")


@router.post("/journals", status_code=status.HTTP_201_CREATED)
async def create_journal(
    payload: JournalEntryCreate,
    user: dict = Depends(require_permission("finance.journal.create")),
    db: AsyncSession = Depends(get_db),
):
    try:
        journal = await gl.create_journal(
            db,
            org_id=user["org_id"],
            user_id=user["sub"],
            period_id=payload.period_id,
            entry_date=payload.entry_date,
            description=payload.description,
            lines=[line.model_dump() for line in payload.lines],
            source_type=payload.source_type,
            source_id=payload.source_id,
        )
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "Journal entry created.")


@router.get("/journals/{journal_id}")
async def get_journal(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    journal = await gl.get_journal(db, org_id=user["org_id"], journal_id=journal_id)
    if not journal:
        raise HTTPException(status_code=404, detail="Journal entry not found.")
    return ok(journal, "Journal entry retrieved.")


@router.patch("/journals/{journal_id}")
async def update_journal(
    journal_id: UUID,
    payload: JournalEntryUpdate,
    user: dict = Depends(require_permission("finance.journal.create")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude={"lines"}, exclude_unset=True)
    lines = [line.model_dump() for line in payload.lines] if payload.lines is not None else None
    try:
        journal = await gl.update_journal(db, org_id=user["org_id"], journal_id=journal_id, values=values, lines=lines)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "Journal entry updated.")


@router.delete("/journals/{journal_id}")
async def delete_journal(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.journal.create")),
    db: AsyncSession = Depends(get_db),
):
    try:
        await gl.delete_journal(db, org_id=user["org_id"], journal_id=journal_id)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok({"id": str(journal_id)}, "Journal entry deleted.")


@router.post("/journals/{journal_id}/post")
async def post_journal(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.journal.post")),
    db: AsyncSession = Depends(get_db),
):
    try:
        journal = await gl.post_journal(db, org_id=user["org_id"], user_id=user["sub"], journal_id=journal_id)
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "Journal entry posted.")


@router.post("/journals/{journal_id}/reverse")
async def reverse_journal(
    journal_id: UUID,
    payload: JournalReverseRequest,
    user: dict = Depends(require_permission("finance.journal.reverse")),
    db: AsyncSession = Depends(get_db),
):
    try:
        reversal = await gl.reverse_journal(
            db, org_id=user["org_id"], user_id=user["sub"], journal_id=journal_id,
            reversal_date=payload.reversal_date, reason=payload.reason,
        )
        await db.commit()
    except gl.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(reversal, "Journal entry reversed.")


@router.get("/journals/{journal_id}/audit-history")
async def journal_audit_history(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await gl.get_audit_history(db, table_name="finance.journal_entries", record_id=journal_id)
    return ok(rows, "Journal audit history retrieved.")
