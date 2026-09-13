"""
Management Accounts pack lifecycle (Phase 11B).

Mirrors app/services/finance/general_ledger.py's accounting-period
lifecycle shape exactly: a shared _get_pack() loader, one function per
transition that validates the current status against an allowed-from
set (raising ManagementAccountsError otherwise) then does a single
UPDATE ... RETURNING *.

The one real difference from a period: this table also carries five
JSONB snapshot columns (income_statement, balance_sheet, cash_movement,
ar_aging, ap_aging), computed once from Phase 11A's
app/services/finance/financial_statements.py functions at creation, and
re-computable only while status='draft'. Once Reviewed/Approved/Locked,
the numbers are frozen forever - the only way to get updated figures is
to reopen (with a reason, like a period) or create the next pack.
"""

import json
from datetime import date
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import financial_statements


class ManagementAccountsError(Exception):
    """Raised for validation failures the router should surface as 4xx."""

    def __init__(self, message: str, *, status_code: int = 422, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail if detail is not None else message


async def _compute_snapshot(db: AsyncSession, *, org_id: str, period_start: date, period_end: date) -> dict:
    income_statement = await financial_statements.get_income_statement(
        db, org_id=org_id, period_start=period_start, period_end=period_end
    )
    balance_sheet = await financial_statements.get_balance_sheet(db, org_id=org_id, as_of_date=period_end)
    cash_movement = await financial_statements.get_cash_movement_statement(
        db, org_id=org_id, period_start=period_start, period_end=period_end
    )
    ar_aging = await financial_statements.get_ar_aging(db, org_id=org_id, as_of_date=period_end)
    ap_aging = await financial_statements.get_ap_aging(db, org_id=org_id, as_of_date=period_end)
    return {
        "income_statement": json.dumps(income_statement, default=str),
        "balance_sheet": json.dumps(balance_sheet, default=str),
        "cash_movement": json.dumps(cash_movement, default=str),
        "ar_aging": json.dumps(ar_aging, default=str),
        "ap_aging": json.dumps(ap_aging, default=str),
    }


async def _get_pack(db: AsyncSession, *, org_id: str, pack_id: UUID) -> dict:
    row = await db.execute(
        text("""
            SELECT * FROM finance.management_accounts_packs
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
        {"id": pack_id, "org_id": org_id},
    )
    r = row.mappings().first()
    if not r:
        raise ManagementAccountsError("Management accounts pack not found.", status_code=404)
    return dict(r)


async def create_pack(
    db: AsyncSession, *, org_id: str, user_id: Optional[str], period_start: date, period_end: date
) -> dict:
    snapshot = await _compute_snapshot(db, org_id=org_id, period_start=period_start, period_end=period_end)
    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.management_accounts_packs (
                    organization_id, period_start, period_end, status,
                    income_statement, balance_sheet, cash_movement, ar_aging, ap_aging,
                    created_by
                ) VALUES (
                    :org_id, :period_start, :period_end, 'draft',
                    CAST(:income_statement AS jsonb), CAST(:balance_sheet AS jsonb),
                    CAST(:cash_movement AS jsonb), CAST(:ar_aging AS jsonb), CAST(:ap_aging AS jsonb),
                    :user_id
                ) RETURNING *
            """),
            {
                "org_id": org_id, "period_start": period_start, "period_end": period_end,
                "user_id": user_id, **snapshot,
            },
        )
    except Exception as exc:
        raise ManagementAccountsError(
            "A management accounts pack for this exact period already exists.", status_code=409
        ) from exc
    return dict(result.mappings().first())


async def recompute_pack(db: AsyncSession, *, org_id: str, pack_id: UUID) -> dict:
    pack = await _get_pack(db, org_id=org_id, pack_id=pack_id)
    if pack["status"] != "draft":
        raise ManagementAccountsError(f"Pack is {pack['status']}, not draft - cannot recompute.")
    snapshot = await _compute_snapshot(db, org_id=org_id, period_start=pack["period_start"], period_end=pack["period_end"])
    result = await db.execute(
        text("""
            UPDATE finance.management_accounts_packs
            SET income_statement = CAST(:income_statement AS jsonb),
                balance_sheet = CAST(:balance_sheet AS jsonb),
                cash_movement = CAST(:cash_movement AS jsonb),
                ar_aging = CAST(:ar_aging AS jsonb),
                ap_aging = CAST(:ap_aging AS jsonb),
                updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": pack_id, **snapshot},
    )
    return dict(result.mappings().first())


async def submit_for_review(db: AsyncSession, *, org_id: str, user_id: Optional[str], pack_id: UUID) -> dict:
    pack = await _get_pack(db, org_id=org_id, pack_id=pack_id)
    if pack["status"] != "draft":
        raise ManagementAccountsError(f"Pack is {pack['status']}, not draft - cannot submit for review.")
    result = await db.execute(
        text("""
            UPDATE finance.management_accounts_packs
            SET status = 'reviewed', reviewed_at = NOW(), reviewed_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": pack_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def approve_pack(db: AsyncSession, *, org_id: str, user_id: Optional[str], pack_id: UUID) -> dict:
    pack = await _get_pack(db, org_id=org_id, pack_id=pack_id)
    if pack["status"] != "reviewed":
        raise ManagementAccountsError(f"Pack is {pack['status']}, not reviewed - cannot approve.")
    result = await db.execute(
        text("""
            UPDATE finance.management_accounts_packs
            SET status = 'approved', approved_at = NOW(), approved_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": pack_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def lock_pack(db: AsyncSession, *, org_id: str, user_id: Optional[str], pack_id: UUID) -> dict:
    pack = await _get_pack(db, org_id=org_id, pack_id=pack_id)
    if pack["status"] != "approved":
        raise ManagementAccountsError(f"Pack is {pack['status']} - must be approved before locking.")
    result = await db.execute(
        text("""
            UPDATE finance.management_accounts_packs
            SET status = 'locked', locked_at = NOW(), locked_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": pack_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def reopen_pack(db: AsyncSession, *, org_id: str, user_id: Optional[str], pack_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise ManagementAccountsError("A reason is required to reopen a management accounts pack.")
    pack = await _get_pack(db, org_id=org_id, pack_id=pack_id)
    if pack["status"] not in ("approved", "locked"):
        raise ManagementAccountsError(f"Pack is {pack['status']} - nothing to reopen.")
    result = await db.execute(
        text("""
            UPDATE finance.management_accounts_packs
            SET status = 'draft', reopened_at = NOW(), reopened_by = :user_id,
                reopen_reason = :reason, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": pack_id, "user_id": user_id, "reason": reason},
    )
    return dict(result.mappings().first())


async def list_packs(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT id, period_start, period_end, status, reviewed_at, approved_at, locked_at,
                   reopened_at, reopen_reason, created_at, updated_at
            FROM finance.management_accounts_packs
            WHERE organization_id = :org_id AND is_deleted = false
            ORDER BY period_start DESC
        """),
        {"org_id": org_id},
    )
    return [dict(r) for r in rows.mappings()]


async def get_pack(db: AsyncSession, *, org_id: str, pack_id: UUID) -> dict:
    return await _get_pack(db, org_id=org_id, pack_id=pack_id)
