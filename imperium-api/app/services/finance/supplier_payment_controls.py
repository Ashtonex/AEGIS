"""Gates every supplier payment path goes through before money is recorded
as leaving (finance_ops /payables/pay and its held-payment release, and
payments.py batch posting).

* A suspended or blacklisted supplier can't be paid.
* A supplier whose bank details were added or changed can't be paid until
  someone other than the person who changed them confirms them.
* A payment can't be dated in the future, or inside an accounting period
  that has been closed, audited or locked.
"""

from __future__ import annotations

from datetime import date
from typing import Iterable

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

BLOCKED_SUPPLIER_STATUSES = ("suspended", "blacklisted")
# Periods a payment may still be dated in (same rule as GL journal posting).
POSTABLE_PERIOD_STATUSES = ("open", "soft_closed")

# A supplier's bank details are unconfirmed when they changed after the last
# confirmation. bank_updated_at is NULL for suppliers untouched since the
# change stamp was introduced: those count as confirmed.
BANK_UNCONFIRMED_SQL = (
    "(s.bank_updated_at IS NOT NULL AND (s.bank_confirmed_at IS NULL OR s.bank_confirmed_at < s.bank_updated_at))"
)


async def assert_suppliers_payable(db: AsyncSession, org_id: str, supplier_ids: Iterable) -> None:
    ids = sorted({str(i) for i in supplier_ids if i})
    if not ids:
        return
    rows = (await db.execute(
        text(f"""
            SELECT s.supplier_name, s.status, {BANK_UNCONFIRMED_SQL} AS bank_unconfirmed
            FROM procurement.suppliers s
            WHERE s.organization_id = :org_id AND s.id = ANY(CAST(:ids AS uuid[]))
        """),
        {"org_id": org_id, "ids": ids},
    )).mappings().all()
    blocked = sorted(f"{r['supplier_name']} ({r['status']})" for r in rows if r["status"] in BLOCKED_SUPPLIER_STATUSES)
    if blocked:
        raise HTTPException(
            status_code=409,
            detail="These suppliers are blocked and can't be paid: " + ", ".join(blocked) + ".",
        )
    unconfirmed = sorted(r["supplier_name"] for r in rows if r["bank_unconfirmed"])
    if unconfirmed:
        raise HTTPException(
            status_code=409,
            detail=(
                "Bank details changed and not yet confirmed for: " + ", ".join(unconfirmed)
                + ". Someone other than the person who changed them must confirm them on the supplier record first."
            ),
        )


async def assert_payment_date_allowed(db: AsyncSession, org_id: str, payment_date: date) -> None:
    if payment_date > date.today():
        raise HTTPException(
            status_code=422,
            detail="A payment can't be dated in the future. Record it on the day it is made.",
        )
    period = (await db.execute(
        text("""
            SELECT period_code, status FROM finance.accounting_periods
            WHERE organization_id = :org_id AND :d BETWEEN period_start AND period_end
            ORDER BY period_start DESC LIMIT 1
        """),
        {"org_id": org_id, "d": payment_date},
    )).first()
    if period and period.status not in POSTABLE_PERIOD_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"Accounting period {period.period_code} is {period.status}. Date the payment in an open period, or have Finance reopen it.",
        )
