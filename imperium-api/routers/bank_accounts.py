"""Bank accounts router — finance.cash_accounts.

Manages the organisation's bank/cash accounts (the funding pots).
Each account has a running balance maintained through cashbook postings.
"""
from __future__ import annotations

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

_RESERVE = frozenset({"id", "created_at", "updated_at", "organization_id", "created_by", "is_deleted"})


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class CashAccountCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_code: str = Field(min_length=1, max_length=30)
    account_name: str = Field(min_length=1, max_length=160)
    account_type: str = Field(default="bank", pattern=r"^(bank|petty_cash|savings|money_market)$")
    bank_name: Optional[str] = Field(default=None, max_length=160)
    branch_name: Optional[str] = Field(default=None, max_length=160)
    account_number: Optional[str] = Field(default=None, max_length=80)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    opening_balance: float = Field(default=0.0, ge=0)
    notes: Optional[str] = Field(default=None, max_length=1000)


class CashAccountUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    bank_name: Optional[str] = Field(default=None, max_length=160)
    branch_name: Optional[str] = Field(default=None, max_length=160)
    account_number: Optional[str] = Field(default=None, max_length=80)
    notes: Optional[str] = Field(default=None, max_length=1000)
    is_active: Optional[bool] = None


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

@router.get("/", summary="List cash/bank accounts")
async def list_cash_accounts(
    account_type: Optional[str] = Query(default=None),
    currency: Optional[str] = Query(default=None),
    is_active: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    limit, offset = page_offset(page, page_size)

    filters = ["ca.organization_id = :org_id", "ca.is_deleted = false"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}

    if account_type:
        filters.append("ca.account_type = :account_type")
        params["account_type"] = account_type
    if currency:
        filters.append("ca.currency = :currency")
        params["currency"] = currency.upper()
    if is_active is not None:
        filters.append("ca.is_active = :is_active")
        params["is_active"] = is_active

    where = " AND ".join(filters)

    count_q = await db.execute(
        text(f"SELECT COUNT(*) FROM finance.cash_accounts ca WHERE {where}"),
        {k: v for k, v in params.items() if k not in ("limit", "offset")},
    )
    total = count_q.scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                ca.*,
                COALESCE(
                    (SELECT SUM(CASE WHEN ct.transaction_type = 'receipt' THEN ct.amount
                                     WHEN ct.transaction_type = 'payment' THEN -ct.amount
                                     ELSE 0 END)
                     FROM finance.cashbook_transactions ct
                     WHERE ct.cash_account_id = ca.id
                       AND ct.is_deleted = false
                       AND ct.is_posted = true),
                    0
                ) + ca.opening_balance AS running_balance
            FROM finance.cash_accounts ca
            WHERE {where}
            ORDER BY ca.account_code ASC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return paginated(items, total=total, page=page, page_size=page_size, message="Cash accounts listed.")


@router.post("/", status_code=status.HTTP_201_CREATED, summary="Create a cash/bank account")
async def create_cash_account(
    payload: CashAccountCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.manage")),
):
    org_id = _require_org(user)
    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.cash_accounts (
                    organization_id, account_code, account_name, account_type,
                    bank_name, branch_name, account_number, currency,
                    opening_balance, notes, created_by
                ) VALUES (
                    :org_id, :account_code, :account_name, :account_type,
                    :bank_name, :branch_name, :account_number, :currency,
                    :opening_balance, :notes, :user_id
                )
                RETURNING id, account_code, account_name, account_type, currency, opening_balance
            """),
            {
                "org_id": org_id,
                "account_code": payload.account_code,
                "account_name": payload.account_name,
                "account_type": payload.account_type,
                "bank_name": payload.bank_name,
                "branch_name": payload.branch_name,
                "account_number": payload.account_number,
                "currency": payload.currency.upper(),
                "opening_balance": payload.opening_balance,
                "notes": payload.notes,
                "user_id": user.get("sub"),
            },
        )
        await db.commit()
        row = result.first()
        return ok(dict(row._mapping), "Cash account created.")
    except Exception as exc:
        await db.rollback()
        if "unique" in str(exc).lower():
            raise HTTPException(status_code=409, detail="Account code already exists for this organisation.")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/{account_id}", summary="Get a single cash/bank account")
async def get_cash_account(
    account_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    result = await db.execute(
        text("""
            SELECT
                ca.*,
                COALESCE(
                    (SELECT SUM(CASE WHEN ct.transaction_type = 'receipt' THEN ct.amount
                                     WHEN ct.transaction_type = 'payment' THEN -ct.amount
                                     ELSE 0 END)
                     FROM finance.cashbook_transactions ct
                     WHERE ct.cash_account_id = ca.id
                       AND ct.is_deleted = false AND ct.is_posted = true),
                    0
                ) + ca.opening_balance AS running_balance
            FROM finance.cash_accounts ca
            WHERE ca.id = :account_id AND ca.organization_id = :org_id AND ca.is_deleted = false
        """),
        {"account_id": str(account_id), "org_id": org_id},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Cash account not found.")
    return ok(dict(row._mapping), "Cash account retrieved.")


@router.patch("/{account_id}", summary="Update a cash/bank account")
async def update_cash_account(
    account_id: UUID,
    payload: CashAccountUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.manage")),
):
    org_id = _require_org(user)
    fields = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    set_clause = ", ".join(f"{k} = :{k}" for k in fields)
    params = {**fields, "account_id": str(account_id), "org_id": org_id}

    try:
        result = await db.execute(
            text(f"""
                UPDATE finance.cash_accounts
                SET {set_clause}, updated_at = NOW()
                WHERE id = :account_id AND organization_id = :org_id AND is_deleted = false
                RETURNING id
            """),
            params,
        )
        if not result.first():
            raise HTTPException(status_code=404, detail="Cash account not found.")
        await db.commit()
        return ok({"id": str(account_id)}, "Cash account updated.")
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.delete("/{account_id}", summary="Deactivate (soft-delete) a cash/bank account")
async def delete_cash_account(
    account_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.cash.manage")),
):
    org_id = _require_org(user)
    # Prevent deletion if unposted transactions exist
    check = await db.execute(
        text("""
            SELECT COUNT(*) FROM finance.cashbook_transactions
            WHERE cash_account_id = :account_id AND is_posted = false AND is_deleted = false
        """),
        {"account_id": str(account_id)},
    )
    if (check.scalar() or 0) > 0:
        raise HTTPException(
            status_code=409,
            detail="Cannot deactivate an account with unposted transactions. Post or void them first."
        )

    result = await db.execute(
        text("""
            UPDATE finance.cash_accounts
            SET is_deleted = true, is_active = false, updated_at = NOW()
            WHERE id = :account_id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),
        {"account_id": str(account_id), "org_id": org_id},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Cash account not found.")
    await db.commit()
    return ok(None, "Cash account deactivated.")
