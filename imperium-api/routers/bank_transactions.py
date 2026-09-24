"""Bank transactions router — finance.cashbook_transactions.

Records every movement of money in or out of a cash/bank account.
Transactions are created in a pending state and must be posted to
update the running balance.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from core.database import get_db
from core.security import get_current_user, require_permission
from app.services.finance import bank_reconciliation as reconciliation
from app.services.finance.general_ledger import GeneralLedgerError

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

TRANSACTION_TYPES = r"^(receipt|payment|transfer_in|transfer_out|bank_charge|adjustment)$"
DIRECTIONS = r"^(inflow|outflow)$"
PAYMENT_METHODS = r"^(bank_transfer|cash|cheque|rtgs|mobile_money|card|other)$"


class CashbookTransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    cash_account_id: UUID
    transaction_date: date
    transaction_type: str = Field(pattern=TRANSACTION_TYPES)
    direction: str = Field(pattern=DIRECTIONS)
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    counterparty_type: Optional[str] = Field(default=None, max_length=40)
    counterparty_name: Optional[str] = Field(default=None, max_length=255)
    project_id: Optional[UUID] = None
    department_id: Optional[UUID] = None
    payment_method: str = Field(default="bank_transfer", pattern=PAYMENT_METHODS)
    reference: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=1000)


class CashbookTransactionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    counterparty_name: Optional[str] = Field(default=None, max_length=255)
    reference: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=1000)
    payment_method: Optional[str] = Field(default=None, pattern=PAYMENT_METHODS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _require_org(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="No organisation linked to this account.")
    return str(org_id)


async def _next_cashbook_transaction_number(db: AsyncSession, org_id: str) -> str:
    row = await db.execute(
        text("""
            INSERT INTO core.sequences (organization_id, sequence_name, last_value)
            VALUES (:org_id, 'cashbook_transaction', 1)
            ON CONFLICT (organization_id, sequence_name)
            DO UPDATE SET last_value = core.sequences.last_value + 1, updated_at = NOW()
            RETURNING last_value
        """),
        {"org_id": org_id},
    )
    return f"CB-{int(row.scalar()):06d}"


def _raise(exc: GeneralLedgerError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", summary="List cashbook transactions")
async def list_transactions(
    cash_account_id: Optional[UUID] = Query(default=None),
    transaction_type: Optional[str] = Query(default=None),
    project_id: Optional[UUID] = Query(default=None),
    department_id: Optional[UUID] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    is_posted: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.read")),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)

    filters = ["ct.organization_id = :org_id", "ct.is_deleted = false"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}

    if cash_account_id:
        filters.append("ct.cash_account_id = :cash_account_id")
        params["cash_account_id"] = str(cash_account_id)
    if transaction_type:
        filters.append("ct.transaction_type = :transaction_type")
        params["transaction_type"] = transaction_type
    if project_id:
        filters.append("ct.project_id = :project_id")
        params["project_id"] = str(project_id)
    if department_id:
        filters.append("(ct.department_id = :department_id OR ct.department_id IS NULL)")
        params["department_id"] = str(department_id)
    if date_from:
        filters.append("ct.transaction_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("ct.transaction_date <= :date_to")
        params["date_to"] = date_to
    if is_posted is not None:
        filters.append("ct.is_posted = :is_posted")
        params["is_posted"] = is_posted

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    rows = await db.execute(
        text(f"""
            SELECT
                ct.*,
                ca.account_code,
                ca.account_name,
                p.project_code AS project_number,
                p.name AS project_name,
                COUNT(*) OVER() AS _total_count
            FROM finance.cashbook_transactions ct
            LEFT JOIN finance.cash_accounts ca ON ca.id = ct.cash_account_id
            LEFT JOIN projects.projects p ON p.id = ct.project_id
            WHERE {where}
            ORDER BY ct.transaction_date DESC, ct.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]

    if items:
        total = items[0]["_total_count"]
        for item in items:
            item.pop("_total_count", None)
    else:
        total = (await db.execute(
            text(f"SELECT COUNT(*) FROM finance.cashbook_transactions ct WHERE {where}"),
            count_params,
        )).scalar() or 0

    return paginated(items, total=total, page=page, page_size=page_size, message="Cashbook transactions listed.")


@router.post("/", status_code=status.HTTP_201_CREATED, summary="Record a cashbook transaction")
async def create_transaction(
    payload: CashbookTransactionCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.post")),
):
    org_id = _require_org(user)

    # Verify the cash account belongs to this org
    acct = await db.execute(
        text("SELECT id FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(payload.cash_account_id), "org_id": org_id},
    )
    if not acct.first():
        raise HTTPException(status_code=404, detail="Cash account not found.")

    transaction_number = await _next_cashbook_transaction_number(db, org_id)

    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, amount, currency, counterparty_type, counterparty_name,
                    project_id, department_id, payment_method, reference, description, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :transaction_number, :transaction_date,
                    :transaction_type, :direction, :amount, :currency, :counterparty_type, :counterparty_name,
                    :project_id, :department_id, :payment_method, :reference, :description, :user_id
                )
                RETURNING id, transaction_number, transaction_date, transaction_type, amount
            """),
            {
                "org_id": org_id,
                "cash_account_id": str(payload.cash_account_id),
                "transaction_number": transaction_number,
                "transaction_date": payload.transaction_date,
                "transaction_type": payload.transaction_type,
                "direction": payload.direction,
                "amount": payload.amount,
                "currency": payload.currency.upper(),
                "counterparty_type": payload.counterparty_type,
                "counterparty_name": payload.counterparty_name,
                "project_id": str(payload.project_id) if payload.project_id else None,
                "department_id": str(payload.department_id) if payload.department_id else None,
                "payment_method": payload.payment_method,
                "reference": payload.reference,
                "description": payload.description,
                "user_id": user.get("sub"),
            },
        )
        await db.commit()
        row = result.first()
        # current_balance is maintained by the cashbook_transactions_sync_balance
        # trigger, which just fired on this INSERT (is_posted defaults true).
        return ok(dict(row._mapping), "Transaction posted to cashbook.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/{transaction_id}", summary="Get a single cashbook transaction")
async def get_transaction(
    transaction_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.read")),
):
    org_id = _require_org(user)
    result = await db.execute(
        text("""
            SELECT ct.*, ca.account_code, ca.account_name,
                   p.project_code AS project_number, p.name AS project_name
            FROM finance.cashbook_transactions ct
            LEFT JOIN finance.cash_accounts ca ON ca.id = ct.cash_account_id
            LEFT JOIN projects.projects p ON p.id = ct.project_id
            WHERE ct.id = :txn_id AND ct.organization_id = :org_id AND ct.is_deleted = false
        """),
        {"txn_id": str(transaction_id), "org_id": org_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    return ok(dict(row._mapping), "Transaction retrieved.")


@router.patch("/{transaction_id}", summary="Update a cashbook transaction (unposted only)")
async def update_transaction(
    transaction_id: UUID,
    payload: CashbookTransactionUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.post")),
):
    org_id = _require_org(user)

    # Only allow editing unposted transactions
    check = await db.execute(
        text("SELECT is_posted FROM finance.cashbook_transactions WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(transaction_id), "org_id": org_id},
    )
    row = check.first()
    if not row:
        raise HTTPException(status_code=404, detail="Transaction not found.")
    if row.is_posted:
        raise HTTPException(status_code=409, detail="Posted transactions cannot be edited. Create a reversal entry.")

    fields = payload.model_dump(exclude_none=True)
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    params = {**fields, "txn_id": str(transaction_id), "org_id": org_id}

    try:
        await db.execute(
            text(f"UPDATE finance.cashbook_transactions SET {set_clause} WHERE id = :txn_id AND organization_id = :org_id"),
            params,
        )
        await db.commit()
        return ok({"id": str(transaction_id)}, "Transaction updated.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.delete("/{transaction_id}", summary="Void (soft-delete) a cashbook transaction")
async def void_transaction(
    transaction_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.post")),
):
    org_id = _require_org(user)
    result = await db.execute(
        text("""
            UPDATE finance.cashbook_transactions
            SET is_deleted = true
            WHERE id = :txn_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"txn_id": str(transaction_id), "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Transaction not found.")
    await db.commit()
    return ok(None, "Transaction voided.")


# ---------------------------------------------------------------------------
# Bank reconciliation (Phase 4) - matches an uploaded bank statement CSV
# against finance.cashbook_transactions. See app/services/finance/
# bank_reconciliation.py for the matching engine itself.
# ---------------------------------------------------------------------------

class ConfirmMatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    cashbook_transaction_id: UUID


class ReopenMatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=1000)


class CreateCashbookEntryFromLineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    transaction_type: str = Field(pattern=TRANSACTION_TYPES)
    project_id: Optional[UUID] = None
    description: Optional[str] = Field(default=None, max_length=1000)


@router.post("/reconciliation/imports", status_code=status.HTTP_201_CREATED, summary="Upload a bank statement CSV")
async def create_bank_statement_import(
    cash_account_id: UUID = Form(...),
    column_mapping: str = Form(..., description='JSON, e.g. {"date":"Date","description":"Description","amount":"Amount"}'),
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("finance.reconciliation.import")),
    db: AsyncSession = Depends(get_db),
):
    import json
    org_id = _require_org(user)
    try:
        mapping = json.loads(column_mapping)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="column_mapping must be valid JSON.")

    content = (await file.read()).decode("utf-8-sig", errors="replace")
    try:
        summary = await reconciliation.create_import(
            db, org_id=org_id, user_id=user["sub"], cash_account_id=cash_account_id,
            filename=file.filename or "statement.csv", csv_content=content, column_mapping=mapping,
        )
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(summary, "Bank statement imported and parsed.")


@router.get("/reconciliation/imports", summary="List bank statement imports")
async def list_bank_statement_imports(
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    items = await reconciliation.list_imports(db, org_id=org_id)
    return ok(items, "Bank statement imports listed.")


@router.get("/reconciliation/imports/{import_id}", summary="Get a bank statement import")
async def get_bank_statement_import(
    import_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    summary = await reconciliation.get_import_summary(db, org_id=org_id, import_id=import_id)
    if not summary:
        raise HTTPException(status_code=404, detail="Bank statement import not found.")
    return ok(summary, "Bank statement import retrieved.")


@router.post("/reconciliation/imports/{import_id}/run-matching", summary="Run the matching engine over an import")
async def run_bank_statement_matching(
    import_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.import")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        counts = await reconciliation.run_matching(db, org_id=org_id, user_id=user["sub"], import_id=import_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(counts, "Matching completed.")


@router.get("/reconciliation/imports/{import_id}/lines", summary="List an import's statement lines")
async def list_bank_statement_lines(
    import_id: UUID,
    match_status: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    items = await reconciliation.list_lines(db, org_id=org_id, import_id=import_id, match_status=match_status)
    return ok(items, "Bank statement lines listed.")


@router.post("/reconciliation/lines/{line_id}/confirm", summary="Confirm a suggested match")
async def confirm_bank_statement_match(
    line_id: UUID,
    payload: ConfirmMatchRequest,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await reconciliation.confirm_match(
            db, org_id=org_id, user_id=user["sub"], line_id=line_id, cashbook_transaction_id=payload.cashbook_transaction_id
        )
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Match confirmed.")


@router.post("/reconciliation/lines/{line_id}/reject", summary="Reject a suggested or duplicate match")
async def reject_bank_statement_match(
    line_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await reconciliation.reject_match(db, org_id=org_id, line_id=line_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Match rejected.")


@router.post("/reconciliation/lines/{line_id}/reopen", summary="Reopen a confirmed match")
async def reopen_bank_statement_match(
    line_id: UUID,
    payload: ReopenMatchRequest,
    user: dict = Depends(require_permission("finance.reconciliation.reopen")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await reconciliation.reopen_match(db, org_id=org_id, user_id=user["sub"], line_id=line_id, reason=payload.reason)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Match reopened.")


@router.post("/reconciliation/lines/{line_id}/create-cashbook-entry", summary="Create a cashbook entry from an unmatched bank line")
async def create_cashbook_entry_from_bank_line(
    line_id: UUID,
    payload: CreateCashbookEntryFromLineRequest,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await reconciliation.create_cashbook_entry_from_line(
            db, org_id=org_id, user_id=user["sub"], line_id=line_id,
            transaction_type=payload.transaction_type, project_id=payload.project_id, description=payload.description,
        )
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Cashbook entry created from bank statement line.")


# ---------------------------------------------------------------------------
# Statement line tagging - allocate bank lines to projects / counterparties /
# categories. Never posts to the cashbook or moves a balance.
# ---------------------------------------------------------------------------

LINE_DIRECTIONS = r"^(in|out)$"
TAG_STATUSES = r"^(untagged|tagged|no_project)$"


class StatementLineFilter(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    cash_account_id: Optional[UUID] = None
    import_id: Optional[UUID] = None
    q: Optional[str] = Field(default=None, max_length=200)
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    direction: Optional[str] = Field(default=None, pattern=LINE_DIRECTIONS)
    tag_status: Optional[str] = Field(default=None, pattern=TAG_STATUSES)
    project_id: Optional[UUID] = None
    category: Optional[str] = Field(default=None, max_length=60)
    match_status: Optional[str] = Field(default=None, max_length=20)


class TagStatementLinesRequest(BaseModel):
    """Only the tag fields actually sent are changed; sending one as null clears it.
    Target either explicit `line_ids` or every line matching `filter`."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    line_ids: Optional[list[UUID]] = Field(default=None, max_length=5000)
    filter: Optional[StatementLineFilter] = None
    project_id: Optional[UUID] = None
    counterparty_name: Optional[str] = Field(default=None, max_length=200)
    category: Optional[str] = Field(default=None, max_length=60)
    notes: Optional[str] = Field(default=None, max_length=2000)


@router.get("/reconciliation/statement-lines", summary="Search bank statement lines across imports")
async def search_bank_statement_lines(
    filters: StatementLineFilter = Depends(),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)
    rows, totals = await reconciliation.search_lines(
        db, org_id=org_id, filters=filters.model_dump(exclude_none=True), limit=limit, offset=offset,
    )
    response = paginated(rows, total=int(totals["total"]), page=page, page_size=limit, message="Statement lines listed.")
    response["meta"]["money_in"] = totals["money_in"]
    response["meta"]["money_out"] = totals["money_out"]
    return response


@router.post("/reconciliation/statement-lines/tag", summary="Tag statement lines with a project, counterparty, category or note")
async def tag_bank_statement_lines(
    payload: TagStatementLinesRequest,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    updates = {
        name: getattr(payload, name) or None
        for name in reconciliation.TAGGABLE_FIELDS
        if name in payload.model_fields_set
    }
    filters = payload.filter.model_dump(exclude_none=True) if payload.filter is not None else None
    if not payload.line_ids and not filters:
        # An empty filter would tag every line the organisation has.
        raise HTTPException(status_code=422, detail="Select lines, or narrow the filter before tagging all matches.")
    try:
        result = await reconciliation.tag_lines(
            db, org_id=org_id, user_id=user["sub"], updates=updates, line_ids=payload.line_ids, filters=filters,
        )
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, f"{result['updated']} statement line(s) tagged.")


@router.get("/reconciliation/allocation-summary", summary="Bank statement totals by project and category")
async def bank_statement_allocation_summary(
    cash_account_id: Optional[UUID] = Query(default=None),
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    summary = await reconciliation.allocation_summary(db, org_id=org_id, cash_account_id=cash_account_id)
    summary["counterparties"] = await reconciliation.list_counterparties(db, org_id=org_id)
    return ok(summary, "Allocation summary retrieved.")
