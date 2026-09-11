"""
GL Bridge — turns existing project cost/revenue records into human-reviewed
proposed General Ledger journals.

Per the master pipeline this whole initiative follows, operational tables
must never silently mutate the GL: Operational Event -> Financial
Interpretation -> Validation -> Proposed Journal -> Approval -> Posting.
This module is the "Financial Interpretation" + "Proposed Journal" step for
three existing, pre-Phase-1 tables:

  - finance.cost_transactions (the actuals feed - 7 existing writers,
    on-demand/bulk proposal only, see sync_project_cost_transactions)
  - finance.progress_claims certification (revenue recognition - 1 writer,
    auto-proposed inline from routers/financial_performance.py)
  - finance.retention_ledger 'released' movements (1 writer, auto-proposed
    inline from routers/final_accounts.py)

Deliberately NOT bridged here: finance.commitments and finance.variations.
Both represent exposure/budget-ceiling changes, not realized transactions -
posting either would double-count once the real cost lands as a
cost_transactions row or a certified claim. This mirrors standard
encumbrance accounting and is a permanent design decision, not a gap.

Every proposal is a draft finance.journal_entries row tagged
origination='system_proposed', proposal_status='pending_review'. A human
must call approve_proposal (which posts it, unchanged Phase 1 logic) or
reject_proposal (which leaves it as an un-postable draft forever, for audit)
before anything reaches the ledger. Nothing in this module ever calls
post_journal directly except approve_proposal.
"""

from datetime import date
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import general_ledger
from app.services.finance.general_ledger import GeneralLedgerError
from app.services.finance.project_forecast import compute_project_financials


async def get_account_mapping(db: AsyncSession, org_id: str, mapping_key: str) -> UUID:
    row = await db.execute(
        text("SELECT account_id FROM finance.gl_account_mappings WHERE organization_id = :org_id AND mapping_key = :key"),
        {"org_id": org_id, "key": mapping_key},
    )
    r = row.first()
    if not r:
        raise GeneralLedgerError(
            f"No GL account mapping configured for '{mapping_key}'. Configure it under GL Bridge settings before proposing this journal.",
            status_code=422,
        )
    return r.account_id


async def list_mappings(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT m.*, a.account_code, a.account_name
            FROM finance.gl_account_mappings m
            JOIN finance.chart_of_accounts a ON a.id = m.account_id
            WHERE m.organization_id = :org_id
            ORDER BY m.mapping_key
        """),
        {"org_id": org_id},
    )
    return [dict(r._mapping) for r in rows]


async def update_mapping(db: AsyncSession, *, org_id: str, mapping_key: str, account_id: UUID) -> dict:
    result = await db.execute(
        text("""
            UPDATE finance.gl_account_mappings
            SET account_id = :account_id, updated_at = NOW()
            WHERE organization_id = :org_id AND mapping_key = :key
            RETURNING *
        """),
        {"org_id": org_id, "key": mapping_key, "account_id": account_id},
    )
    row = result.mappings().first()
    if not row:
        raise GeneralLedgerError(f"Mapping key '{mapping_key}' not found.", status_code=404)
    return dict(row)


async def _find_period_for_date(db: AsyncSession, org_id: str, target_date: date) -> UUID:
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


async def _mark_system_proposed(db: AsyncSession, journal_id: UUID) -> None:
    await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET origination = 'system_proposed', proposal_status = 'pending_review'
            WHERE id = :id
        """),
        {"id": journal_id},
    )


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


async def propose_journal_for_cost_transaction(
    db: AsyncSession, *, org_id: str, user_id: str, cost_transaction_id: UUID
) -> dict:
    if await _already_proposed(db, org_id, "cost_transaction", cost_transaction_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this cost transaction.", status_code=409)

    row = await db.execute(
        text("SELECT * FROM finance.cost_transactions WHERE id = :id AND organization_id = :org_id"),
        {"id": cost_transaction_id, "org_id": org_id},
    )
    txn = row.mappings().first()
    if not txn:
        raise GeneralLedgerError("Cost transaction not found.", status_code=404)
    amount = float(txn["amount"])
    if amount <= 0:
        raise GeneralLedgerError("Cost transaction has a zero amount - nothing to propose.", status_code=422)

    debit_account_id = await get_account_mapping(db, org_id, f"cost_category.{txn['cost_category']}")
    credit_account_id = await get_account_mapping(db, org_id, "cost_transaction.credit_control")
    period_id = await _find_period_for_date(db, org_id, txn["transaction_date"])

    description = f"Cost transaction ({txn['source_type']}, {txn['cost_category']})"
    if txn["description"]:
        description += f": {txn['description']}"

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=txn["transaction_date"],
        description=description,
        lines=[
            {"account_id": debit_account_id, "debit_amount": amount, "project_id": txn["project_id"], "cost_code_id": txn["cost_code_id"], "description": txn["description"]},
            {"account_id": credit_account_id, "credit_amount": amount, "project_id": txn["project_id"], "cost_code_id": txn["cost_code_id"]},
        ],
        source_type="cost_transaction",
        source_id=cost_transaction_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])


async def propose_journal_for_progress_claim(
    db: AsyncSession, *, org_id: str, user_id: str, claim_id: UUID
) -> Optional[dict]:
    if await _already_proposed(db, org_id, "progress_claim", claim_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this progress claim.", status_code=409)

    row = await db.execute(
        text("""
            SELECT * FROM finance.progress_claims
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false AND status = 'certified'
        """),
        {"id": claim_id, "org_id": org_id},
    )
    claim = row.mappings().first()
    if not claim:
        raise GeneralLedgerError("Certified progress claim not found.", status_code=404)

    certified_amount = float(claim["certified_amount"] or 0)
    if certified_amount <= 0:
        raise GeneralLedgerError("Progress claim has no certified amount - nothing to propose.", status_code=422)

    retention_portion = float(
        (Decimal(str(certified_amount)) * Decimal(str(claim["retention_pct"])) / Decimal("100")).quantize(Decimal("0.01"))
    )
    receivable_portion = round(certified_amount - retention_portion, 2)

    receivable_account_id = await get_account_mapping(db, org_id, "progress_claim.receivable")
    retention_account_id = await get_account_mapping(db, org_id, "progress_claim.retention_receivable")
    revenue_account_id = await get_account_mapping(db, org_id, "progress_claim.revenue")

    entry_date = claim["certified_at"].date() if claim["certified_at"] else date.today()
    period_id = await _find_period_for_date(db, org_id, entry_date)

    lines = [{"account_id": receivable_account_id, "debit_amount": receivable_portion, "project_id": claim["project_id"]}]
    if retention_portion > 0:
        lines.append({"account_id": retention_account_id, "debit_amount": retention_portion, "project_id": claim["project_id"]})
    lines.append({"account_id": revenue_account_id, "credit_amount": certified_amount, "project_id": claim["project_id"]})

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=entry_date,
        description=f"Certified progress claim {claim['claim_number']}",
        lines=lines,
        source_type="progress_claim",
        source_id=claim_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])


async def propose_journal_for_retention_release(
    db: AsyncSession, *, org_id: str, user_id: str, retention_ledger_id: UUID
) -> Optional[dict]:
    if await _already_proposed(db, org_id, "retention_release", retention_ledger_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this retention release.", status_code=409)

    row = await db.execute(
        text("""
            SELECT * FROM finance.retention_ledger
            WHERE id = :id AND organization_id = :org_id AND movement_type = 'released'
        """),
        {"id": retention_ledger_id, "org_id": org_id},
    )
    release = row.mappings().first()
    if not release:
        raise GeneralLedgerError("Retention release record not found.", status_code=404)

    amount = float(release["amount"])
    if amount <= 0:
        raise GeneralLedgerError("Retention release has a zero amount - nothing to propose.", status_code=422)

    receivable_account_id = await get_account_mapping(db, org_id, "progress_claim.receivable")
    retention_account_id = await get_account_mapping(db, org_id, "progress_claim.retention_receivable")
    period_id = await _find_period_for_date(db, org_id, release["movement_date"])

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=release["movement_date"],
        description="Retention released - reclassified to receivable",
        lines=[
            {"account_id": receivable_account_id, "debit_amount": amount, "project_id": release["project_id"]},
            {"account_id": retention_account_id, "credit_amount": amount, "project_id": release["project_id"]},
        ],
        source_type="retention_release",
        source_id=retention_ledger_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])


async def propose_journal_for_supplier_invoice_approval(
    db: AsyncSession, *, org_id: str, user_id: str, invoice_id: UUID
) -> Optional[dict]:
    """Invoice approved for payment -> Debit Accrued Project Costs / Credit
    Accounts Payable. Reclassifies the generic accrual already recognized
    via cost_transactions (when stock was issued) into a specific payable to
    this supplier. Known simplification: uses the full invoice amount rather
    than precisely reconciling against quantity actually issued-to-project -
    precise inventory-to-AP reconciliation is a later-phase concern."""
    if await _already_proposed(db, org_id, "supplier_invoice_approval", invoice_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this invoice approval.", status_code=409)

    row = await db.execute(
        text("""
            SELECT id, project_id, total_amount, invoice_date, supplier_invoice_ref
            FROM procurement.supplier_invoices
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false AND status = 'approved'
        """),
        {"id": invoice_id, "org_id": org_id},
    )
    invoice = row.mappings().first()
    if not invoice:
        raise GeneralLedgerError("Approved supplier invoice not found.", status_code=404)

    amount = float(invoice["total_amount"])
    if amount <= 0:
        raise GeneralLedgerError("Supplier invoice has a zero amount - nothing to propose.", status_code=422)

    accrued_account_id = await get_account_mapping(db, org_id, "cost_transaction.credit_control")
    payable_account_id = await get_account_mapping(db, org_id, "supplier_invoice.accounts_payable")
    period_id = await _find_period_for_date(db, org_id, invoice["invoice_date"])

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=invoice["invoice_date"],
        description=f"Supplier invoice {invoice['supplier_invoice_ref']} approved for payment",
        lines=[
            {"account_id": accrued_account_id, "debit_amount": amount, "project_id": invoice["project_id"]},
            {"account_id": payable_account_id, "credit_amount": amount, "project_id": invoice["project_id"]},
        ],
        source_type="supplier_invoice_approval",
        source_id=invoice_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])


async def propose_journal_for_supplier_payment(
    db: AsyncSession, *, org_id: str, user_id: str, payment_batch_id: UUID
) -> Optional[dict]:
    """Payment batch posted -> Debit Accounts Payable / Credit Cash and
    Bank. A standard cash-clearing entry."""
    if await _already_proposed(db, org_id, "supplier_payment_batch", payment_batch_id):
        raise GeneralLedgerError("A GL journal has already been proposed for this payment batch.", status_code=409)

    row = await db.execute(
        text("""
            SELECT b.id, b.payment_date, b.batch_number, b.total_amount,
                   (SELECT project_id FROM finance.supplier_payment_items WHERE batch_id = b.id AND project_id IS NOT NULL LIMIT 1) AS project_id
            FROM finance.supplier_payment_batches b
            WHERE b.id = :id AND b.organization_id = :org_id AND b.is_deleted = false AND b.status = 'posted'
        """),
        {"id": payment_batch_id, "org_id": org_id},
    )
    batch = row.mappings().first()
    if not batch:
        raise GeneralLedgerError("Posted supplier payment batch not found.", status_code=404)

    amount = float(batch["total_amount"] or 0)
    if amount <= 0:
        raise GeneralLedgerError("Payment batch has a zero amount - nothing to propose.", status_code=422)

    payable_account_id = await get_account_mapping(db, org_id, "supplier_invoice.accounts_payable")
    cash_account_id = await get_account_mapping(db, org_id, "supplier_payment.cash_account")
    period_id = await _find_period_for_date(db, org_id, batch["payment_date"])

    journal = await general_ledger.create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period_id,
        entry_date=batch["payment_date"],
        description=f"Supplier payment batch {batch['batch_number']} posted",
        lines=[
            {"account_id": payable_account_id, "debit_amount": amount, "project_id": batch["project_id"]},
            {"account_id": cash_account_id, "credit_amount": amount, "project_id": batch["project_id"]},
        ],
        source_type="supplier_payment_batch",
        source_id=payment_batch_id,
    )
    await _mark_system_proposed(db, journal["id"])
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal["id"])


async def list_proposals(db: AsyncSession, *, org_id: str, proposal_status: Optional[str] = "pending_review") -> list[dict]:
    filters = ["je.organization_id = :org_id", "je.origination = 'system_proposed'"]
    params: dict = {"org_id": org_id}
    if proposal_status:
        filters.append("je.proposal_status = :status")
        params["status"] = proposal_status
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT je.*, ap.period_code
            FROM finance.journal_entries je
            JOIN finance.accounting_periods ap ON ap.id = je.period_id
            WHERE {where}
            ORDER BY je.entry_date DESC, je.journal_number DESC
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def approve_proposal(db: AsyncSession, *, org_id: str, user_id: str, journal_id: UUID) -> dict:
    journal = await general_ledger.get_journal(db, org_id=org_id, journal_id=journal_id)
    if not journal:
        raise GeneralLedgerError("Proposed journal not found.", status_code=404)
    if journal["origination"] != "system_proposed":
        raise GeneralLedgerError("Only system-proposed journals go through this approval flow.", status_code=409)
    if journal["proposal_status"] != "pending_review":
        raise GeneralLedgerError(f"Proposal is already {journal['proposal_status']}.", status_code=409)

    await db.execute(
        text("UPDATE finance.journal_entries SET proposal_status = 'approved' WHERE id = :id"),
        {"id": journal_id},
    )
    return await general_ledger.post_journal(db, org_id=org_id, user_id=user_id, journal_id=journal_id)


async def reject_proposal(db: AsyncSession, *, org_id: str, user_id: str, journal_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reject a proposed journal.")

    journal = await general_ledger.get_journal(db, org_id=org_id, journal_id=journal_id)
    if not journal:
        raise GeneralLedgerError("Proposed journal not found.", status_code=404)
    if journal["origination"] != "system_proposed":
        raise GeneralLedgerError("Only system-proposed journals go through this rejection flow.", status_code=409)
    if journal["proposal_status"] != "pending_review":
        raise GeneralLedgerError(f"Proposal is already {journal['proposal_status']}.", status_code=409)

    await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET proposal_status = 'rejected', description = description || ' [REJECTED: ' || :reason || ']',
                updated_by = :user_id, updated_at = NOW()
            WHERE id = :id
        """),
        {"id": journal_id, "reason": reason, "user_id": user_id},
    )
    return await general_ledger.get_journal(db, org_id=org_id, journal_id=journal_id)


async def sync_project_cost_transactions(db: AsyncSession, *, org_id: str, user_id: str, project_id: UUID) -> dict:
    rows = await db.execute(
        text("""
            SELECT ct.id FROM finance.cost_transactions ct
            WHERE ct.organization_id = :org_id AND ct.project_id = :project_id
              AND NOT EXISTS (
                SELECT 1 FROM finance.journal_entries je
                WHERE je.organization_id = ct.organization_id AND je.source_type = 'cost_transaction'
                  AND je.source_id = ct.id AND je.origination = 'system_proposed'
              )
            ORDER BY ct.transaction_date
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    candidate_ids = [r.id for r in rows]

    proposed: list[str] = []
    failed: list[dict[str, Any]] = []
    for cost_transaction_id in candidate_ids:
        try:
            journal = await propose_journal_for_cost_transaction(
                db, org_id=org_id, user_id=user_id, cost_transaction_id=cost_transaction_id
            )
            proposed.append(str(journal["id"]))
        except GeneralLedgerError as exc:
            failed.append({"cost_transaction_id": str(cost_transaction_id), "reason": str(exc)})

    return {"total_candidates": len(candidate_ids), "proposed": proposed, "failed": failed}


async def get_project_ledger(
    db: AsyncSession, *, org_id: str, project_id: UUID, date_from: Optional[date] = None, date_to: Optional[date] = None
) -> list[dict]:
    filters = ["jl.organization_id = :org_id", "jl.project_id = :project_id", "je.status = 'posted'"]
    params: dict = {"org_id": org_id, "project_id": project_id}
    if date_from:
        filters.append("je.entry_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("je.entry_date <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT jl.id, jl.debit_amount, jl.credit_amount, jl.description AS line_description,
                   a.account_code, a.account_name, a.account_category,
                   je.id AS journal_entry_id, je.journal_number, je.entry_date, je.description AS journal_description,
                   je.source_type, je.source_id
            FROM finance.journal_lines jl
            JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
            JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            WHERE {where}
            ORDER BY je.entry_date, je.journal_number, jl.line_number
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def get_project_gl_reconciliation(db: AsyncSession, *, org_id: str, project_id: UUID) -> dict:
    gl_row = await db.execute(
        text("""
            SELECT
                COALESCE(SUM(jl.debit_amount) FILTER (WHERE a.account_category = 'direct_project_cost'), 0) AS gl_actual_cost_to_date,
                COALESCE(SUM(jl.credit_amount) FILTER (WHERE a.account_code = '4100'), 0) AS gl_certified_to_date
            FROM finance.journal_lines jl
            JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
            JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            WHERE jl.organization_id = :org_id AND jl.project_id = :project_id
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    gl = gl_row.mappings().first() or {"gl_actual_cost_to_date": 0, "gl_certified_to_date": 0}

    operational = await compute_project_financials(db, org_id, str(project_id)) or {}

    gl_actual = float(gl["gl_actual_cost_to_date"] or 0)
    gl_certified = float(gl["gl_certified_to_date"] or 0)
    op_actual = float(operational.get("actual_cost_to_date") or 0)
    op_certified = float(operational.get("certified_to_date") or 0)

    return {
        "gl_actual_cost_to_date": gl_actual,
        "operational_actual_cost_to_date": op_actual,
        "actual_cost_delta": round(gl_actual - op_actual, 2),
        "gl_certified_to_date": gl_certified,
        "operational_certified_to_date": op_certified,
        "certified_delta": round(gl_certified - op_certified, 2),
    }
