"""
Recognises a client deposit as claimed revenue and cash in hand.

Shared by the live confirm-deposit endpoint (routers/projects.py) and the
one-off backfill script (scripts/backfill_deposit_revenue_recognition.py)
for deposits confirmed before this recognition existed - both must produce
byte-identical records, so the logic lives here once.

Drives the deposit through the same progress_claims lifecycle (create ->
certify -> pay) a live billing claim uses - same shape as the
historical-revenue path in financial_performance.py, just parameterised on
`as_at` so a live call can use today and a backfill call can use the
project's real deposit_confirmed_at date instead of pretending it just
happened.
"""

from datetime import date as date_type, datetime
from datetime import time as datetime_time
from decimal import Decimal
from typing import Any, Dict, Optional
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import gl_bridge
from app.services.finance.general_ledger import GeneralLedgerError
from app.services.finance.statutory_accrual import accrue_liability_line
from app.services.finance.tax_rates import NoRateTableError, resolve_rate_table


class NoCashAccountError(RuntimeError):
    """The org has no active cash account to receipt the deposit into."""


async def pick_client_cash_account(db: AsyncSession, org_id: str, currency: str) -> str:
    account_id = (
        await db.execute(
            text("""
                SELECT id FROM finance.cash_accounts
                WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
                ORDER BY (currency = :currency) DESC, created_at ASC
                LIMIT 1
            """),
            {"org_id": org_id, "currency": currency},
        )
    ).scalar()
    if not account_id:
        raise NoCashAccountError("No active cash account is configured.")
    return str(account_id)


async def recognise_deposit_as_claimed_revenue(
    db: AsyncSession,
    *,
    org_id: str,
    project_id,
    project_name: Optional[str],
    contract_value: float,
    department_id,
    deposit_amount: float,
    deposit_reference: Optional[str],
    notes: Optional[str],
    user_id: Optional[str],
    as_at: Optional[date_type] = None,
) -> Dict[str, Any]:
    """Inserts a certified+paid progress claim, accrues output VAT on it if a
    rate table is configured, posts the cash receipt, proposes the GL
    revenue journal, and returns identifiers/warnings for the caller."""
    as_at = as_at or date_type.today()
    as_at_ts = datetime.combine(as_at, datetime_time())
    contract_value = contract_value or deposit_amount
    claim_number = f"DEP-{uuid4().hex[:8].upper()}"
    claim_notes = (
        "Deposit received"
        + (f" (ref: {deposit_reference})" if deposit_reference else "")
        + (f" - {notes}" if notes else "")
    )

    vat_amount = 0.0
    rate_table_id = None
    try:
        vat_table = await resolve_rate_table(db, org_id=org_id, tax_type="vat_output", currency="USD", as_at=as_at)
        vat_amount = float(
            (Decimal(str(deposit_amount)) * vat_table.bands[0].rate_pct / Decimal("100")).quantize(Decimal("0.01"))
        )
        rate_table_id = vat_table.id
    except NoRateTableError:
        pass

    claim_id = (
        await db.execute(
            text("""
                INSERT INTO finance.progress_claims (
                    organization_id, claim_number, project_id, claim_period_start, claim_period_end,
                    contract_value, this_claim_amount, retention_pct, retention_amount, net_claim_amount,
                    status, submitted_by, submitted_at, certified_amount, certified_by, certified_at,
                    vat_amount, vat_rate_table_id, notes, created_by
                ) VALUES (
                    :org_id, :claim_number, :project_id, :as_at, :as_at,
                    :contract_value, :amount, 0, 0, :amount,
                    'certified', :user_id, :as_at_ts, :amount, :user_id, :as_at_ts,
                    :vat_amount, :rate_table_id, :notes, :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "claim_number": claim_number,
                "project_id": project_id,
                "as_at": as_at,
                "as_at_ts": as_at_ts,
                "contract_value": contract_value,
                "amount": deposit_amount,
                "user_id": user_id,
                "vat_amount": vat_amount,
                "rate_table_id": rate_table_id,
                "notes": claim_notes,
            },
        )
    ).scalar()

    if vat_amount > 0:
        await accrue_liability_line(
            db,
            org_id=org_id,
            authority="zimra",
            liability_type="vat",
            currency="USD",
            as_at=as_at,
            direction="output",
            source_type="progress_claim",
            source_id=claim_id,
            project_id=project_id,
            department_id=department_id,
            taxable_base=deposit_amount,
            rate_table_id=rate_table_id,
            computed_amount=vat_amount,
            basis={"claim_number": claim_number},
        )

    cash_account_id = await pick_client_cash_account(db, org_id, "USD")
    cashbook_id = (
        await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, source_type, source_id, project_id,
                    counterparty_type, counterparty_name, payment_method, description,
                    amount, currency, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :as_at,
                    'receipt', 'inflow', 'progress_claim', :source_id, :project_id,
                    'client', :counterparty_name, 'bank_transfer', :description,
                    :amount, 'USD', :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "cash_account_id": cash_account_id,
                "tx_number": f"DEP-{str(claim_id)[:8].upper()}",
                "as_at": as_at,
                "source_id": claim_id,
                "project_id": project_id,
                "counterparty_name": project_name or "Client deposit",
                "description": claim_notes,
                "amount": deposit_amount,
                "user_id": user_id,
            },
        )
    ).scalar()

    await db.execute(
        text("""
            INSERT INTO finance.receipt_allocations (
                organization_id, cashbook_transaction_id, progress_claim_id, project_id, allocated_amount, allocated_by
            ) VALUES (:org_id, :cashbook_id, :claim_id, :project_id, :amount, :user_id)
        """),
        {
            "org_id": org_id,
            "cashbook_id": cashbook_id,
            "claim_id": claim_id,
            "project_id": project_id,
            "amount": deposit_amount,
            "user_id": user_id,
        },
    )

    gl_proposal_warning = None
    try:
        await gl_bridge.propose_journal_for_progress_claim(db, org_id=org_id, user_id=user_id, claim_id=claim_id)
    except GeneralLedgerError as exc:
        gl_proposal_warning = str(exc)

    await db.execute(
        text("UPDATE finance.progress_claims SET status = 'paid', updated_at = NOW() WHERE id = :id"),
        {"id": claim_id},
    )

    return {
        "claim_id": claim_id,
        "claim_number": claim_number,
        "cashbook_id": cashbook_id,
        "vat_amount": vat_amount,
        "gl_proposal_warning": gl_proposal_warning,
    }
