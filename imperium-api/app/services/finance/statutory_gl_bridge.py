"""
Statutory settlement GL bridge (Phase 8A) - kept separate from gl_bridge.py
so the existing Phase 2 regression guard
(test_statutory_liabilities_are_not_touched_by_the_bridge, which asserts
gl_bridge.py never mentions finance.statutory_liabilities/accrue_liability_line)
stays true unchanged.

Bridges a real cash event - a VAT liability settlement - into a proposed GL
journal: Debit statutory.vat_payable (8000, clearing the liability) / Credit
statutory.vat_settlement_cash (1000, the cash that left). Same
propose-then-require-approval shape as every other bridge in this
initiative; nothing here ever posts directly.

Deliberately VAT-only and cash-only in this phase: finance.statutory_liabilities
is generic across authorities/liability_types, and settle_liability lets a
settlement be recorded with no cashbook transaction at all (e.g. an offset).
PAYE/NSSA/AIDS-levy settlement bridging is the same pattern and a natural,
small follow-up - out of this phase's chosen "VAT engine" scope, not because
it's hard. A settlement with no cash leg has no cash movement to bridge, so
it is skipped, not fabricated.
"""

from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import general_ledger
from app.services.finance.general_ledger import GeneralLedgerError
from app.services.finance.gl_bridge import get_account_mapping


async def _find_period_for_date(db: AsyncSession, org_id: str, target_date) -> UUID:
    row = await db.execute(
        text("""
            SELECT id FROM finance.accounting_periods
            WHERE organization_id = :org_id AND :d BETWEEN period_start AND period_end
            ORDER BY period_start DESC LIMIT 1
        """),
        {"org_id": org_id, "d": target_date},
    )
    r = row.first()
    if not r:
        raise GeneralLedgerError(
            f"No accounting period covers {target_date} - create one before proposing this journal.",
            status_code=422,
        )
    return r.id


async def _already_proposed(db: AsyncSession, org_id: str, source_type: str, source_id: UUID) -> bool:
    row = await db.execute(
        text("""
            SELECT 1 FROM finance.journal_entries
            WHERE organization_id = :org_id AND source_type = :source_type AND source_id = :source_id
              AND origination = 'system_proposed'
        """),
        {"org_id": org_id, "source_type": source_type, "source_id": source_id},
    )
    return row.first() is not None


async def _mark_system_proposed(db: AsyncSession, journal_id: UUID) -> None:
    await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET origination = 'system_proposed', proposal_status = 'pending_review'
            WHERE id = :id
        """),
        {"id": journal_id},
    )


async def propose_journal_for_vat_settlement(
    db: AsyncSession, *, org_id: str, user_id: str, settlement_id: UUID
) -> Optional[dict]:
    if await _already_proposed(db, org_id, "statutory_settlement", settlement_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this settlement.", status_code=409)

    row = await db.execute(
        text("""
            SELECT s.id, s.payment_date, s.amount, s.cashbook_transaction_id,
                   l.liability_type
            FROM finance.statutory_settlements s
            JOIN finance.statutory_liabilities l ON l.id = s.liability_id AND l.organization_id = s.organization_id
            WHERE s.id = :id AND s.organization_id = :org_id
        """),
        {"id": settlement_id, "org_id": org_id},
    )
    settlement = row.mappings().first()
    if not settlement:
        raise GeneralLedgerError("Statutory settlement not found.", status_code=404)

    if settlement["liability_type"] != "vat" or settlement["cashbook_transaction_id"] is None:
        return None

    amount = float(settlement["amount"])
    if amount <= 0:
        raise GeneralLedgerError("Settlement has a zero amount - nothing to propose.", status_code=422)

    vat_payable_account = await get_account_mapping(db, org_id, "statutory.vat_payable")
    settlement_cash_account = await get_account_mapping(db, org_id, "statutory.vat_settlement_cash")
    period_id = await _find_period_for_date(db, org_id, settlement["payment_date"])

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=settlement["payment_date"],
        description="VAT liability settlement",
        lines=[
            {"account_id": vat_payable_account, "debit_amount": amount},
            {"account_id": settlement_cash_account, "credit_amount": amount},
        ],
        source_type="statutory_settlement",
        source_id=settlement_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])
