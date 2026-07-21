"""Bank transactions router — finance.cashbook_transactions.

Records every movement of money in or out of a cash/bank account.
Transactions are created in a pending state and must be posted to
update the running balance.
"""
from __future__ import annotations

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

TRANSACTION_TYPES = r"^(receipt|payment|transfer_in|transfer_out|bank_charge|interest|adjustment)$"
PAYMENT_METHODS = r"^(bank_transfer|cash|cheque|rtgs|mobile_money|card|other)$"


class CashbookTransactionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    cash_account_id: UUID
    transaction_date: date
    transaction_type: str = Field(pattern=TRANSACTION_TYPES)
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    counterparty_name: Optional[str] = Field(default=None, max_length=255)
    project_id: Optional[UUID] = None
    payment_method: str = Field(default="bank_transfer", pattern=PAYMENT_METHODS)
    reference: Optional[str] = Field(default=None, max_length=160)
    description: Optional[str] = Field(default=None, max_length=1000)
    supplier_invoice_id: Optional[UUID] = None
    progress_claim_id: Optional[UUID] = None


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


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", summary="List cashbook transactions")
async def list_transactions(
    cash_account_id: Optional[UUID] = Query(default=None),
    transaction_type: Optional[str] = Query(default=None),
    project_id: Optional[UUID] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    is_posted: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
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

    total = (await db.execute(
        text(f"SELECT COUNT(*) FROM finance.cashbook_transactions ct WHERE {where}"),
        count_params,
    )).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                ct.*,
                ca.account_code,
                ca.account_name,
                p.project_number,
                p.name AS project_name
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

    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_date,
                    transaction_type, amount, currency, counterparty_name,
                    project_id, payment_method, reference, description,
                    supplier_invoice_id, progress_claim_id, created_by,
                    is_posted, posted_at, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :transaction_date,
                    :transaction_type, :amount, :currency, :counterparty_name,
                    :project_id, :payment_method, :reference, :description,
                    :supplier_invoice_id, :progress_claim_id, :user_id,
                    true, NOW(), :user_id
                )
                RETURNING id, transaction_date, transaction_type, amount
            """),
            {
                "org_id": org_id,
                "cash_account_id": str(payload.cash_account_id),
                "transaction_date": payload.transaction_date,
                "transaction_type": payload.transaction_type,
                "amount": payload.amount,
                "currency": payload.currency.upper(),
                "counterparty_name": payload.counterparty_name,
                "project_id": str(payload.project_id) if payload.project_id else None,
                "payment_method": payload.payment_method,
                "reference": payload.reference,
                "description": payload.description,
                "supplier_invoice_id": str(payload.supplier_invoice_id) if payload.supplier_invoice_id else None,
                "progress_claim_id": str(payload.progress_claim_id) if payload.progress_claim_id else None,
                "user_id": user.get("sub"),
            },
        )
        await db.commit()
        row = result.first()
        return ok(dict(row._mapping), "Transaction posted to cashbook.")
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/{transaction_id}", summary="Get a single cashbook transaction")
async def get_transaction(
    transaction_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    result = await db.execute(
        text("""
            SELECT ct.*, ca.account_code, ca.account_name,
                   p.project_number, p.name AS project_name
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
            text(f"UPDATE finance.cashbook_transactions SET {set_clause}, updated_at = NOW() WHERE id = :txn_id AND organization_id = :org_id"),
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
            SET is_deleted = true, updated_at = NOW()
            WHERE id = :txn_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"txn_id": str(transaction_id), "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Transaction not found.")
    await db.commit()
    return ok(None, "Transaction voided.")
