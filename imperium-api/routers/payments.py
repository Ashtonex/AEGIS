"""Payments router — supplier payment batches (finance.supplier_payment_batches).

A payment batch groups multiple supplier invoices into a single payment run,
generating one cashbook entry and updating each invoice's match status.
"""
from __future__ import annotations

from datetime import date
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok, page_offset, paginated
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()

PAYMENT_METHODS = r"^(bank_transfer|cash|cheque|rtgs|mobile_money|card|other)$"
BATCH_STATUSES = ("draft", "approved", "posted", "cancelled")


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class PaymentBatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    cash_account_id: UUID
    payment_date: date
    payment_method: str = Field(default="bank_transfer", pattern=PAYMENT_METHODS)
    supplier_invoice_ids: List[UUID] = Field(min_length=1)
    reference: Optional[str] = Field(default=None, max_length=160)
    notes: Optional[str] = Field(default=None, max_length=1000)


class PaymentBatchDecision(BaseModel):
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


def _next_batch_number(org_id: str) -> str:
    """Generate a batch reference prefix; final number is assigned by DB sequence."""
    return f"SPB-{org_id[:8].upper()}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/", summary="List supplier payment batches")
async def list_payment_batches(
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

    filters = ["spb.organization_id = :org_id", "spb.is_deleted = false"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}

    if status_filter and status_filter in BATCH_STATUSES:
        filters.append("spb.status = :status")
        params["status"] = status_filter
    if date_from:
        filters.append("spb.payment_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("spb.payment_date <= :date_to")
        params["date_to"] = date_to

    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (await db.execute(
        text(f"SELECT COUNT(*) FROM finance.supplier_payment_batches spb WHERE {where}"),
        count_params,
    )).scalar() or 0

    rows = await db.execute(
        text(f"""
            SELECT
                spb.*,
                ca.account_code,
                ca.account_name,
                COUNT(spi.id) AS invoice_count,
                COALESCE(SUM(spi.amount), 0) AS total_amount
            FROM finance.supplier_payment_batches spb
            LEFT JOIN finance.cash_accounts ca ON ca.id = spb.cash_account_id
            LEFT JOIN finance.supplier_payment_items spi ON spi.batch_id = spb.id
            WHERE {where}
            GROUP BY spb.id, ca.account_code, ca.account_name
            ORDER BY spb.payment_date DESC, spb.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    items = [dict(r._mapping) for r in rows]
    return paginated(items, total=total, page=page, page_size=page_size, message="Payment batches listed.")


@router.post("/", status_code=status.HTTP_201_CREATED, summary="Create a supplier payment batch")
async def create_payment_batch(
    payload: PaymentBatchCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.supplier_payment.post")),
):
    org_id = _require_org(user)
    user_id = user.get("sub")

    # Verify the cash account
    acct = await db.execute(
        text("SELECT id FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(payload.cash_account_id), "org_id": org_id},
    )
    if not acct.first():
        raise HTTPException(status_code=404, detail="Cash account not found.")

    # Resolve invoices and check they're approvable
    invoice_ids = [str(i) for i in payload.supplier_invoice_ids]
    inv_rows = await db.execute(
        text("""
            SELECT id, supplier_id, total_amount, match_status
            FROM procurement.supplier_invoices
            WHERE id = ANY(:ids) AND organization_id = :org_id AND is_deleted = false
        """),
        {"ids": invoice_ids, "org_id": org_id},
    )
    invoices = [dict(r._mapping) for r in inv_rows]
    if len(invoices) != len(invoice_ids):
        raise HTTPException(status_code=404, detail="One or more invoices not found or already deleted.")

    already_paid = [i["id"] for i in invoices if i["match_status"] == "paid"]
    if already_paid:
        raise HTTPException(status_code=409, detail=f"Invoices already paid: {already_paid}")

    total_amount = sum(float(i["total_amount"]) for i in invoices)

    try:
        # Create the batch
        batch = await db.execute(
            text("""
                INSERT INTO finance.supplier_payment_batches (
                    organization_id, batch_number, cash_account_id,
                    payment_date, payment_method, reference, notes,
                    status, created_by
                ) VALUES (
                    :org_id,
                    'SPB-' || LPAD(NEXTVAL('finance.supplier_payment_batch_seq')::TEXT, 5, '0'),
                    :cash_account_id, :payment_date, :payment_method,
                    :reference, :notes, 'draft', :user_id
                )
                RETURNING id, batch_number, status
            """),
            {
                "org_id": org_id,
                "cash_account_id": str(payload.cash_account_id),
                "payment_date": payload.payment_date,
                "payment_method": payload.payment_method,
                "reference": payload.reference,
                "notes": payload.notes,
                "user_id": user_id,
            },
        )
        batch_row = batch.first()
        batch_id = str(batch_row.id)

        # Insert payment items
        for inv in invoices:
            await db.execute(
                text("""
                    INSERT INTO finance.supplier_payment_items (
                        organization_id, batch_id, supplier_invoice_id,
                        supplier_id, amount
                    ) VALUES (
                        :org_id, :batch_id, :invoice_id, :supplier_id, :amount
                    )
                """),
                {
                    "org_id": org_id,
                    "batch_id": batch_id,
                    "invoice_id": str(inv["id"]),
                    "supplier_id": str(inv["supplier_id"]),
                    "amount": float(inv["total_amount"]),
                },
            )

        await db.commit()
        return ok(
            {"id": batch_id, "batch_number": batch_row.batch_number, "total_amount": total_amount, "invoice_count": len(invoices)},
            "Payment batch created in draft state.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        if "supplier_payment_batch_seq" in str(exc):
            raise HTTPException(status_code=500, detail="Batch number sequence not found. Run migration 034.")
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")


@router.get("/{batch_id}", summary="Get a payment batch with its items")
async def get_payment_batch(
    batch_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org(user)
    batch = await db.execute(
        text("""
            SELECT spb.*, ca.account_code, ca.account_name
            FROM finance.supplier_payment_batches spb
            LEFT JOIN finance.cash_accounts ca ON ca.id = spb.cash_account_id
            WHERE spb.id = :batch_id AND spb.organization_id = :org_id AND spb.is_deleted = false
        """),
        {"batch_id": str(batch_id), "org_id": org_id},
    )
    row = batch.first()
    if not row:
        raise HTTPException(status_code=404, detail="Payment batch not found.")

    items = await db.execute(
        text("""
            SELECT spi.*, si.invoice_number, si.total_amount AS invoice_total,
                   s.name AS supplier_name
            FROM finance.supplier_payment_items spi
            JOIN procurement.supplier_invoices si ON si.id = spi.supplier_invoice_id
            JOIN procurement.suppliers s ON s.id = spi.supplier_id
            WHERE spi.batch_id = :batch_id
        """),
        {"batch_id": str(batch_id)},
    )
    return ok(
        {"batch": dict(row._mapping), "items": [dict(i._mapping) for i in items]},
        "Payment batch retrieved.",
    )


@router.post("/{batch_id}/decision", summary="Approve, post or cancel a payment batch")
async def decide_payment_batch(
    batch_id: UUID,
    payload: PaymentBatchDecision,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("finance.supplier_payment.post")),
):
    org_id = _require_org(user)
    user_id = user.get("sub")

    batch = await db.execute(
        text("SELECT id, status, cash_account_id, payment_date, payment_method FROM finance.supplier_payment_batches WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": str(batch_id), "org_id": org_id},
    )
    batch_row = batch.first()
    if not batch_row:
        raise HTTPException(status_code=404, detail="Payment batch not found.")

    current_status = batch_row.status
    action = payload.action

    transitions: dict = {
        "approve": ("draft", "approved"),
        "post":    ("approved", "posted"),
        "cancel":  (None, "cancelled"),  # None means any non-posted
    }
    allowed_from, target_status = transitions[action]
    if current_status == "cancelled" or current_status == "posted":
        raise HTTPException(status_code=409, detail=f"Cannot {action} a batch in '{current_status}' state.")
    if allowed_from and current_status != allowed_from:
        raise HTTPException(status_code=409, detail=f"Batch must be '{allowed_from}' to {action}. Currently '{current_status}'.")

    try:
        extra_sets = ""
        extra_params: dict = {}

        if action == "post":
            # 1. Create cashbook transaction
            items_rows = await db.execute(
                text("SELECT COALESCE(SUM(amount), 0) AS total FROM finance.supplier_payment_items WHERE batch_id = :batch_id"),
                {"batch_id": str(batch_id)},
            )
            total_amount = float(items_rows.scalar() or 0)

            txn = await db.execute(
                text("""
                    INSERT INTO finance.cashbook_transactions (
                        organization_id, cash_account_id, transaction_date,
                        transaction_type, amount, currency, payment_method,
                        description, is_posted, posted_at, posted_by, created_by
                    ) VALUES (
                        :org_id, :cash_account_id, :payment_date,
                        'payment', :amount, 'USD', :payment_method,
                        'Supplier payment batch posting', true, NOW(), :user_id, :user_id
                    )
                    RETURNING id
                """),
                {
                    "org_id": org_id,
                    "cash_account_id": str(batch_row.cash_account_id),
                    "payment_date": batch_row.payment_date,
                    "amount": total_amount,
                    "payment_method": batch_row.payment_method,
                    "user_id": user_id,
                },
            )
            cashbook_txn_id = str(txn.scalar())

            # 2. Update supplier invoices to 'paid'
            await db.execute(
                text("""
                    UPDATE procurement.supplier_invoices si
                    SET match_status = 'paid', updated_at = NOW()
                    FROM finance.supplier_payment_items spi
                    WHERE spi.batch_id = :batch_id AND spi.supplier_invoice_id = si.id
                """),
                {"batch_id": str(batch_id)},
            )

            extra_sets = ", posted_by = :posted_by, posted_at = NOW()"
            extra_params = {"posted_by": user_id}

        await db.execute(
            text(f"""
                UPDATE finance.supplier_payment_batches
                SET status = :status, updated_at = NOW() {extra_sets}
                WHERE id = :batch_id AND organization_id = :org_id
            """),
            {"status": target_status, "batch_id": str(batch_id), "org_id": org_id, **extra_params},
        )
        await db.commit()
        return ok({"id": str(batch_id), "status": target_status}, f"Payment batch {action}d successfully.")
    except HTTPException:
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")
