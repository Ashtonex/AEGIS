"""
Month-end close readiness + auditor source resolution (Phase 12).

get_close_readiness follows the exact transparent-factor shape Phase 11B
established (app/services/finance/project_portfolio.py's
get_project_health_factors): every factor is {value, truth_status, note},
and the composite (readiness_level) is always returned alongside the full
breakdown, never in place of it. The master spec's "month-end close
checklist" and "Finance Data Quality score" are the same underlying data
viewed two ways, so this is one function, not two.

resolve_journal_source is the auditor drill-down's "what real-world event
produced this journal" step - a small dispatcher over the exact
source_type vocabulary gl_bridge.py already writes.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import get_trial_balance

_CASH_ADVANCES_ACCOUNT_CODE = "1500"


async def _count_unposted_journals(db: AsyncSession, *, org_id: str, period_id: Optional[UUID]) -> int:
    filters = ["organization_id = :org_id", "status = 'draft'"]
    params: dict = {"org_id": org_id}
    if period_id:
        filters.append("period_id = :period_id")
        params["period_id"] = period_id
    row = await db.execute(
        text(f"SELECT COUNT(*) FROM finance.journal_entries WHERE {' AND '.join(filters)}"), params
    )
    return row.scalar() or 0


async def _count_unreconciled_bank_lines(db: AsyncSession, *, org_id: str) -> int:
    row = await db.execute(
        text("""
            SELECT COUNT(*) FROM finance.bank_statement_lines
            WHERE organization_id = :org_id AND match_status IN ('unmatched', 'suggested')
        """),
        {"org_id": org_id},
    )
    return row.scalar() or 0


async def _count_open_ccb_findings(db: AsyncSession, *, org_id: str) -> int:
    row = await db.execute(
        text("""
            SELECT COUNT(*) FROM finance.ccb_monitor_findings
            WHERE organization_id = :org_id AND status = 'open' AND is_deleted = false
        """),
        {"org_id": org_id},
    )
    return row.scalar() or 0


async def _get_cash_advances_balance(db: AsyncSession, *, org_id: str, as_of_date: date) -> Optional[float]:
    rows = await get_trial_balance(db, org_id=org_id, as_of_date=as_of_date)
    for r in rows:
        if r["account_code"] == _CASH_ADVANCES_ACCOUNT_CODE:
            return float(r["net_balance"])
    return None


async def get_close_readiness(db: AsyncSession, *, org_id: str, period_id: Optional[UUID] = None) -> dict:
    unposted = await _count_unposted_journals(db, org_id=org_id, period_id=period_id)
    unreconciled = await _count_unreconciled_bank_lines(db, org_id=org_id)
    open_findings = await _count_open_ccb_findings(db, org_id=org_id)
    advances_balance = await _get_cash_advances_balance(db, org_id=org_id, as_of_date=date.today())

    factors = {
        "unposted_journals": {
            "value": unposted,
            "truth_status": "SYSTEM_GENERATED",
            "note": "Draft journal entries not yet posted to the General Ledger.",
        },
        "unreconciled_bank_activity": {
            "value": unreconciled,
            "truth_status": "SYSTEM_GENERATED",
            "note": "Bank statement lines still unmatched or only suggested-matched against the cashbook.",
        },
        "open_ccb_findings": {
            "value": open_findings,
            "truth_status": "SYSTEM_GENERATED",
            "note": "Open Commercial Control Brain anomaly findings across all projects.",
        },
        "cash_advances_outstanding": {
            "value": advances_balance,
            "truth_status": "INCOMPLETE",
            "note": (
                "GL balance on account 1500 (Cash Advances Receivable) only - there is no operational "
                "tracking table for individual advances, so this cannot identify which specific advances "
                "are outstanding or their age. A non-zero balance means the account is worth reviewing, "
                "not a precise outstanding-advances count."
            ),
        },
    }

    # Cash advances is deliberately excluded from the composite - it can't
    # be acted on precisely (no per-advance data), so it would be dishonest
    # to let an unreliable signal gate a ready/not-ready verdict.
    if unposted > 0 or unreconciled > 0:
        readiness_level = "not_ready"
    elif open_findings > 0:
        readiness_level = "caution"
    else:
        readiness_level = "ready"

    return {"factors": factors, "readiness_level": readiness_level}


_SOURCE_RESOLVERS = {}


def _source_resolver(source_type: str):
    def decorator(fn):
        _SOURCE_RESOLVERS[source_type] = fn
        return fn
    return decorator


@_source_resolver("cost_transaction")
async def _resolve_cost_transaction(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT ct.amount, ct.cost_category, ct.description, ct.transaction_date, p.name AS project_name
            FROM finance.cost_transactions ct
            JOIN projects.projects p ON p.id = ct.project_id AND p.organization_id = ct.organization_id
            WHERE ct.id = :id AND ct.organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Cost transaction ({row['cost_category']}) on {row['project_name']}: {row['description'] or 'no description'}",
        "amount": float(row["amount"]),
        "date": str(row["transaction_date"]),
    }


@_source_resolver("progress_claim")
async def _resolve_progress_claim(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT pc.claim_number, pc.certified_amount, pc.status, p.name AS project_name
            FROM finance.progress_claims pc
            JOIN projects.projects p ON p.id = pc.project_id AND p.organization_id = pc.organization_id
            WHERE pc.id = :id AND pc.organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Progress claim {row['claim_number']} on {row['project_name']} ({row['status']})",
        "amount": float(row["certified_amount"]) if row["certified_amount"] is not None else None,
    }


@_source_resolver("retention_release")
async def _resolve_retention_release(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT rl.amount, rl.movement_date, p.name AS project_name
            FROM finance.retention_ledger rl
            JOIN projects.projects p ON p.id = rl.project_id AND p.organization_id = rl.organization_id
            WHERE rl.id = :id AND rl.organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Retention release on {row['project_name']} dated {row['movement_date']}",
        "amount": float(row["amount"]),
    }


@_source_resolver("supplier_invoice_approval")
async def _resolve_supplier_invoice_approval(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT si.total_amount, si.invoice_date, s.supplier_name
            FROM procurement.supplier_invoices si
            JOIN procurement.suppliers s ON s.id = si.supplier_id AND s.organization_id = si.organization_id
            WHERE si.id = :id AND si.organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Supplier invoice approval from {row['supplier_name']} dated {row['invoice_date']}",
        "amount": float(row["total_amount"]),
    }


@_source_resolver("supplier_payment_batch")
async def _resolve_supplier_payment_batch(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT batch_number, total_amount, payment_date
            FROM finance.supplier_payment_batches
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Supplier payment batch {row['batch_number']} dated {row['payment_date']}",
        "amount": float(row["total_amount"]),
    }


@_source_resolver("journal_reversal")
async def _resolve_journal_reversal(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    """general_ledger.py's own reverse_journal (not gl_bridge.py) writes this
    source_type - source_id is the original journal being reversed."""
    row = (await db.execute(
        text("""
            SELECT journal_number, description, total_debit
            FROM finance.journal_entries
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Reversal of journal {row['journal_number']}: {row['description']}",
        "amount": float(row["total_debit"]),
    }


@_source_resolver("payroll_run")
async def _resolve_payroll_run(db: AsyncSession, *, org_id: str, source_id: UUID) -> Optional[dict]:
    row = (await db.execute(
        text("""
            SELECT run_number, net_pay, period_start, period_end
            FROM finance.payroll_runs
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": source_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        return None
    return {
        "summary": f"Payroll run {row['run_number']} for {row['period_start']} to {row['period_end']}",
        "amount": float(row["net_pay"]),
    }


async def resolve_journal_source(db: AsyncSession, *, org_id: str, source_type: Optional[str], source_id: Optional[UUID]) -> dict:
    if not source_type or not source_id:
        return {"summary": "Manually entered journal - no linked source event.", "amount": None}
    resolver = _SOURCE_RESOLVERS.get(source_type)
    if resolver is None:
        return {"summary": f"Unrecognized source type '{source_type}' - no resolver registered.", "amount": None}
    resolved = await resolver(db, org_id=org_id, source_id=source_id)
    if resolved is None:
        return {"summary": f"Source record ({source_type}) no longer exists or is not visible.", "amount": None}
    return resolved
