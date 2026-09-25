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
from app.services.finance import bank_books
from app.services.finance import bank_rules
from app.services.jobs.queue import enqueue_background_job
from app.services.microsoft import bank_workbook
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


async def _queue_workbook_publish(org_id: str) -> None:
    """Refresh the Teams workbook about a minute after a change. The job id
    is bucketed per minute so a burst of tagging collapses into one publish
    (arq ignores a duplicate id), while later changes still get their own."""
    import time
    await enqueue_background_job(
        "publish_bank_workbook_job", org_id=org_id,
        _job_id=f"bank-workbook-{org_id}-{int(time.time() // 60)}", _defer_by=60,
    )


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
    # New lines go straight into the books: auto-tagging rules fill what they
    # can, then every line gets its ledger journal (untagged ones in Suspense).
    # The import itself is already committed - a failure here is reported,
    # not fatal, and "Sync books" can finish the job later.
    try:
        new_ids = [r.id for r in await db.execute(
            text("SELECT id FROM finance.bank_statement_lines WHERE import_id = :i"), {"i": summary["import_id"]})]
        summary["auto_tagged"] = (await bank_rules.apply(db, org_id=org_id, user_id=user["sub"], line_ids=new_ids))["lines_tagged"]
        summary["books"] = await bank_books.sync(db, org_id=org_id, user_id=user["sub"], line_ids=new_ids)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        summary["books_error"] = exc.detail
    await _queue_workbook_publish(org_id)
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
    unallocated_cash: Optional[bool] = None


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
        # Keep claims, costs, petty cash and the GL in step with the tags, in
        # the same transaction.
        result["books"] = await bank_books.sync(db, org_id=org_id, user_id=user["sub"], line_ids=result.pop("line_ids"))
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    await _queue_workbook_publish(org_id)
    return ok(result, f"{result['updated']} statement line(s) tagged.")


@router.post("/reconciliation/statement-lines/sync-books", summary="Bring project books in line with statement line tags")
async def sync_bank_statement_project_books(
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        counts = await bank_books.sync(db, org_id=org_id, user_id=user["sub"])
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    await _queue_workbook_publish(org_id)
    return ok(counts, "Project books synced with bank statement tags.")


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


# ---------------------------------------------------------------------------
# Splitting a line / recording how withdrawn cash was used, the project
# workspace, and the completeness audit.
# ---------------------------------------------------------------------------

class LineAllocationItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    id: Optional[UUID] = None
    project_id: Optional[UUID] = None
    category: Optional[str] = Field(default=None, max_length=60)
    amount: float = Field(gt=0)
    description: Optional[str] = Field(default=None, max_length=2000)
    allocation_date: Optional[date] = None


class LineAllocationsReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    allocations: list[LineAllocationItem] = Field(default_factory=list, max_length=200)


@router.get("/reconciliation/lines/{line_id}/allocations", summary="List a statement line's splits / cash uses")
async def get_line_allocations(
    line_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    return ok(await bank_books.list_allocations(db, org_id=org_id, line_id=line_id), "Allocations listed.")


@router.put("/reconciliation/lines/{line_id}/allocations", summary="Replace a statement line's splits / cash uses")
async def put_line_allocations(
    line_id: UUID,
    payload: LineAllocationsReplace,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        counts = await bank_books.replace_allocations(
            db, org_id=org_id, user_id=user["sub"], line_id=line_id,
            allocations=[a.model_dump() for a in payload.allocations],
        )
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    await _queue_workbook_publish(org_id)
    return ok({"books": counts, "allocations": await bank_books.list_allocations(db, org_id=org_id, line_id=line_id)},
              "Allocations saved.")


@router.get("/reconciliation/projects/{project_id}/workspace", summary="Everything about one project's money")
async def get_project_money_workspace(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    workspace = await bank_books.project_workspace(db, org_id=org_id, project_id=project_id)
    if workspace is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return ok(workspace, "Project workspace retrieved.")


@router.get("/reconciliation/audit", summary="Prove the bank statement is fully carried into the books")
async def get_bank_books_audit(
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    return ok(await bank_books.audit(db, org_id=org_id), "Bank books audit completed.")


@router.get("/reconciliation/workbook", summary="Where the Teams workbook lives and when it was last published")
async def get_bank_workbook_status(
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    info = await bank_workbook.status(db, org_id) or {"last_status": "never", "file_name": bank_workbook.WORKBOOK_FILE_NAME}
    info["recent_changes"] = await bank_workbook.recent_changes(db, org_id)
    return ok(info, "Workbook status retrieved.")


@router.post("/reconciliation/workbook/publish", summary="Rebuild the Teams workbook now")
async def publish_bank_workbook_now(
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    row = await bank_workbook.sync(db, org_id=org_id, force=True)
    if row is None:
        raise HTTPException(status_code=409, detail="The workbook is being updated right now - try again in a minute.")
    if row.get("last_status") == "failed":
        raise HTTPException(status_code=502, detail=f"Publishing to SharePoint failed: {row.get('last_error')}")
    return ok(row, "Workbook published.")


# ---------------------------------------------------------------------------
# Auto-tagging rules
# ---------------------------------------------------------------------------

RULE_DIRECTIONS = r"^(any|in|out)$"


class TagRuleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120)
    match_text: str = Field(min_length=3, max_length=200)
    direction: str = Field(default="any", pattern=RULE_DIRECTIONS)
    amount_min: Optional[float] = Field(default=None, ge=0)
    amount_max: Optional[float] = Field(default=None, ge=0)
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    set_category: Optional[str] = Field(default=None, max_length=60)
    set_project_id: Optional[UUID] = None
    set_counterparty: Optional[str] = Field(default=None, max_length=200)
    set_note: Optional[str] = Field(default=None, max_length=2000)
    priority: int = Field(default=100, ge=0, le=10000)
    is_active: bool = True


class TagRuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    match_text: Optional[str] = Field(default=None, min_length=3, max_length=200)
    direction: Optional[str] = Field(default=None, pattern=RULE_DIRECTIONS)
    amount_min: Optional[float] = Field(default=None, ge=0)
    amount_max: Optional[float] = Field(default=None, ge=0)
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    set_category: Optional[str] = Field(default=None, max_length=60)
    set_project_id: Optional[UUID] = None
    set_counterparty: Optional[str] = Field(default=None, max_length=200)
    set_note: Optional[str] = Field(default=None, max_length=2000)
    priority: Optional[int] = Field(default=None, ge=0, le=10000)
    is_active: Optional[bool] = None


class ApplyRulesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rule_ids: Optional[list[UUID]] = Field(default=None, max_length=500)


@router.get("/reconciliation/rules", summary="List auto-tagging rules")
async def list_tag_rules(
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await bank_rules.list_rules(db, org_id=_require_org(user)), "Rules listed.")


@router.get("/reconciliation/rules/suggestions", summary="Rules suggested from how lines are already tagged")
async def suggest_tag_rules(
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await bank_rules.suggest(db, org_id=_require_org(user)), "Suggestions computed.")


@router.post("/reconciliation/rules/preview-draft", summary="What an unsaved rule would tag")
async def preview_draft_tag_rule(
    payload: TagRuleCreate,
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await bank_rules.preview(db, org_id=_require_org(user), rule=payload.model_dump()), "Preview computed.")


@router.post("/reconciliation/rules/preview", summary="What applying saved rules would tag")
async def preview_tag_rules(
    payload: ApplyRulesRequest,
    user: dict = Depends(require_permission("finance.reconciliation.read")),
    db: AsyncSession = Depends(get_db),
):
    return ok(await bank_rules.preview(db, org_id=_require_org(user), rule_ids=payload.rule_ids), "Preview computed.")


@router.post("/reconciliation/rules", status_code=status.HTTP_201_CREATED, summary="Create an auto-tagging rule")
async def create_tag_rule(
    payload: TagRuleCreate,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await bank_rules.create_rule(db, org_id=org_id, user_id=user["sub"], values=payload.model_dump())
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Rule created.")


@router.patch("/reconciliation/rules/{rule_id}", summary="Change an auto-tagging rule")
async def update_tag_rule(
    rule_id: UUID,
    payload: TagRuleUpdate,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await bank_rules.update_rule(db, org_id=org_id, rule_id=rule_id,
                                              values=payload.model_dump(exclude_unset=True))
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(result, "Rule updated.")


@router.delete("/reconciliation/rules/{rule_id}", summary="Delete an auto-tagging rule (lines it tagged keep their tags)")
async def delete_tag_rule(
    rule_id: UUID,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        await bank_rules.delete_rule(db, org_id=org_id, rule_id=rule_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok({"id": str(rule_id)}, "Rule deleted.")


@router.post("/reconciliation/rules/apply", summary="Apply rules to lines that still have empty tags")
async def apply_tag_rules(
    payload: ApplyRulesRequest,
    user: dict = Depends(require_permission("finance.reconciliation.match")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    try:
        result = await bank_rules.apply(db, org_id=org_id, user_id=user["sub"], rule_ids=payload.rule_ids)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    if result["lines_tagged"]:
        await _queue_workbook_publish(org_id)
    return ok(result, f"{result['lines_tagged']} line(s) tagged by rules.")
