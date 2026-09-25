"""
Bank books - turns the tagged bank statement into everything downstream.

The bank statement lines (with their tags and split allocations) are the
source of truth. sync() makes four places agree with them, and is safe to
re-run at any time (it only changes what is out of step):

1. Project books the Finance dashboard reads
     money in to a project   -> a paid historical progress claim
     money out to a project  -> a finance.cost_transactions row
2. HQ Petty Cash (a cash account)
     a cash withdrawal line  -> transfer_in to HQ Petty Cash
     a use of that cash      -> payment out of HQ Petty Cash (+ project cost)
     handing cash to a site  -> transfer from HQ Petty Cash to the project's
                                own petty cash float
3. The general ledger (GL-sourced financial statements)
     every bank line         -> one posted journal: Cash and Bank (1000)
                                against what the line was
     every use of cash       -> one posted journal against HQ Petty Cash (1010)
   A line whose tags change has its journal reversed and a new one posted.
4. Nothing else: no cashbook entry for the bank side (the statement import
   is already the cash record, so the reconciled account balance must not
   move), no VAT accrual, no AR aging entries.

How a line is split into "parts":
  - no allocations: one part = the line's own tag (project, category)
  - allocations on an ordinary line: each allocation is a part, and any
    unallocated remainder stays with the line's own tag
  - a cash withdrawal line: the line itself is always cash moving from the
    bank into HQ Petty Cash; its allocations are the uses of that cash
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import GeneralLedgerError

CASH_WITHDRAWAL = "cash_withdrawal"
SITE_PETTY_CASH = "site_petty_cash"   # a use of HQ cash: handed to a project's petty cash float
EXCLUDED_FROM_PROJECT_BOOKS = ("reversal", "internal_transfer", SITE_PETTY_CASH)
HQ_PETTY_CASH_CODE = "HQPC"
HQ_PETTY_CASH_NAME = "HQ Petty Cash"

# GL account codes (see migration 228 for 1010/1060/5950/6900/7800)
BANK, HQ_PETTY, RECEIVABLE, INTER_ACCOUNT, SUSPENSE = "1000", "1010", "1100", "1060", "1900"
DIRECTORS, SHAREHOLDERS, REVENUE, OTHER_INCOME = "3200", "3300", "4100", "4900"
UNCLASSIFIED_PROJECT_COST = "5950"

_MONEY_OUT_ACCOUNTS = {
    "supplier_payment": "5000",
    "subcontractor": "5200",
    "equipment_hire": "5300",
    "fuel_transport": "5400",
    "tax_statutory": "6900",
    "bank_charges": "6800",
    "tithe_donation": "7800",
    "owner_drawings": DIRECTORS,
    "internal_transfer": INTER_ACCOUNT,
    "reversal": SUSPENSE,
    "refund": "7900",
    "other": "7900",
    CASH_WITHDRAWAL: HQ_PETTY,
    SITE_PETTY_CASH: HQ_PETTY,
    "client_receipt": SUSPENSE,
    "capital_injection": SUSPENSE,
}

_COST_CATEGORY = {
    "supplier_payment": "materials",
    "card_purchase": "materials",
    "subcontractor": "subcontract",
    "equipment_hire": "equipment",
    "fuel_transport": "equipment",
    "salaries_wages": "labour",
    "tax_statutory": "overhead",
    "bank_charges": "overhead",
}


def money_out_account(category: Optional[str], has_project: bool) -> str:
    if category == "salaries_wages":
        return "5100" if has_project else "6000"
    if category == "card_purchase":
        return "5000" if has_project else "6600"
    if category in _MONEY_OUT_ACCOUNTS:
        return _MONEY_OUT_ACCOUNTS[category]
    return UNCLASSIFIED_PROJECT_COST if has_project else SUSPENSE


def money_in_account(category: Optional[str], has_project: bool) -> str:
    if category == "reversal":
        return SUSPENSE
    if category == "internal_transfer":
        return INTER_ACCOUNT
    if category == "capital_injection":
        return SHAREHOLDERS
    if category in ("refund", "other"):
        return OTHER_INCOME
    if category == "client_receipt" or has_project:
        return REVENUE
    return SUSPENSE


def cost_category(category: Optional[str]) -> str:
    return _COST_CATEGORY.get(category or "", "other")


@dataclass
class Part:
    key: str                          # 'line' or the allocation id
    allocation_id: Optional[UUID]
    project_id: Optional[UUID]
    category: Optional[str]
    amount: Decimal                   # always positive
    description: Optional[str]
    books_claim_id: Optional[UUID] = None


@dataclass
class Line:
    row: dict
    allocations: list[dict] = field(default_factory=list)

    @property
    def id(self) -> UUID:
        return self.row["id"]

    @property
    def amount(self) -> Decimal:
        return Decimal(str(self.row["amount"]))

    @property
    def is_cash_withdrawal(self) -> bool:
        return self.row["category"] == CASH_WITHDRAWAL and self.amount < 0

    def parts(self) -> list[Part]:
        """How the line itself is accounted for (for a cash withdrawal that
        is always one part: the whole amount into HQ Petty Cash)."""
        whole = abs(self.amount)
        own = Part("line", None, self.row["project_id"], self.row["category"], whole,
                   self.row["description"], self.row["books_claim_id"])
        if self.is_cash_withdrawal:
            own.project_id = None
            return [own]
        if not self.allocations:
            return [own]
        parts = [
            Part(str(a["id"]), a["id"], a["project_id"], a["category"], Decimal(str(a["amount"])),
                 a["description"], a["books_claim_id"])
            for a in self.allocations
        ]
        remainder = whole - sum((p.amount for p in parts), Decimal("0"))
        if remainder > 0:
            own.amount = remainder
            parts.append(own)
        return parts

    def cash_uses(self) -> list[Part]:
        """Uses of withdrawn cash. With no allocations, a project tag on the
        withdrawal line itself counts as one use of the whole amount."""
        if not self.is_cash_withdrawal:
            return []
        if self.allocations:
            return [
                Part(str(a["id"]), a["id"], a["project_id"], a["category"], Decimal(str(a["amount"])),
                     a["description"], a["books_claim_id"])
                for a in self.allocations
            ]
        if self.row["project_id"]:
            return [Part("line-use", None, self.row["project_id"], None, abs(self.amount), self.row["description"])]
        return []


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

async def _load_lines(db: AsyncSession, org_id: str, line_ids: Optional[list[UUID]]) -> list[Line]:
    where = "bsl.organization_id = :org_id"
    params: dict[str, Any] = {"org_id": org_id}
    if line_ids is not None:
        where += " AND bsl.id = ANY(:line_ids)"
        params["line_ids"] = list(line_ids)
    rows = await db.execute(
        text(f"""
            SELECT bsl.id, bsl.transaction_date, bsl.amount, bsl.category, bsl.project_id, bsl.counterparty_name,
                   left(regexp_replace(COALESCE(bsl.description, ''), '\\s+', ' ', 'g'), 400) AS description,
                   bsl.reference, bsl.books_claim_id, bsl.gl_journal_id, bsl.gl_signature,
                   EXISTS (
                       SELECT 1 FROM finance.cashbook_transactions ct
                       WHERE ct.id = bsl.matched_cashbook_transaction_id
                         AND (ct.source_type = 'progress_claim' OR EXISTS (
                             SELECT 1 FROM finance.receipt_allocations ra WHERE ra.cashbook_transaction_id = ct.id))
                   ) AS receipt_already_in_books
            FROM finance.bank_statement_lines bsl
            WHERE {where}
            ORDER BY bsl.transaction_date, bsl.line_number
        """),
        params,
    )
    lines = {r["id"]: Line(dict(r)) for r in rows.mappings()}
    if lines:
        allocs = await db.execute(
            text("""
                SELECT * FROM finance.bank_line_allocations
                WHERE organization_id = :org_id AND line_id = ANY(:ids)
                ORDER BY created_at
            """),
            {"org_id": org_id, "ids": list(lines)},
        )
        for a in allocs.mappings():
            lines[a["line_id"]].allocations.append(dict(a))
    return list(lines.values())


async def _account_ids(db: AsyncSession, org_id: str) -> dict[str, UUID]:
    rows = await db.execute(
        text("SELECT account_code, id FROM finance.chart_of_accounts WHERE organization_id = :org_id AND is_deleted = false"),
        {"org_id": org_id},
    )
    return {r.account_code: r.id for r in rows}


async def ensure_hq_petty_cash(db: AsyncSession, org_id: str, user_id: str) -> UUID:
    existing = await db.execute(
        text("""
            SELECT id FROM finance.cash_accounts
            WHERE organization_id = :org_id AND account_code = :code AND is_deleted = false
        """),
        {"org_id": org_id, "code": HQ_PETTY_CASH_CODE},
    )
    found = existing.scalar()
    if found:
        return found
    return (
        await db.execute(
            text("""
                INSERT INTO finance.cash_accounts (
                    organization_id, account_code, account_name, account_type, currency,
                    opening_balance, current_balance, is_petty_cash, created_by
                ) VALUES (:org_id, :code, :name, 'cash', 'USD', 0, 0, true, :user_id)
                RETURNING id
            """),
            {"org_id": org_id, "code": HQ_PETTY_CASH_CODE, "name": HQ_PETTY_CASH_NAME, "user_id": user_id},
        )
    ).scalar()


async def ensure_project_petty_cash(db: AsyncSession, org_id: str, user_id: str, project_id: UUID) -> UUID:
    existing = await db.execute(
        text("""
            SELECT id FROM finance.cash_accounts
            WHERE organization_id = :org_id AND project_id = :project_id AND is_petty_cash = true AND is_deleted = false
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    found = existing.scalar()
    if found:
        return found
    name = (await db.execute(text("SELECT name FROM projects.projects WHERE id = :id"), {"id": project_id})).scalar() or "Project"
    return (
        await db.execute(
            text("""
                INSERT INTO finance.cash_accounts (
                    organization_id, account_code, account_name, account_type, currency, opening_balance,
                    current_balance, is_petty_cash, project_id, created_by
                ) VALUES (:org_id, :code, :name, 'cash', 'USD', 0, 0, true, :project_id, :user_id)
                RETURNING id
            """),
            {"org_id": org_id, "code": f"PC-{uuid4().hex[:6].upper()}", "name": f"{name[:80]} Petty Cash",
             "project_id": project_id, "user_id": user_id},
        )
    ).scalar()


# ---------------------------------------------------------------------------
# Project books: claims and costs
# ---------------------------------------------------------------------------

def _claim_wanted(line: Line, part: Part) -> bool:
    return (
        line.amount > 0 and part.project_id is not None
        and (part.category or "") not in EXCLUDED_FROM_PROJECT_BOOKS
        and not line.row["receipt_already_in_books"]
    )


async def _sync_claim(db: AsyncSession, org_id: str, user_id: str, line: Line, part: Part, wanted: bool, counts: dict) -> None:
    holder_table = "bank_line_allocations" if part.allocation_id else "bank_statement_lines"
    holder_id = part.allocation_id or line.id
    claim = None
    if part.books_claim_id:
        claim = (await db.execute(
            text("SELECT project_id, this_claim_amount, is_deleted FROM finance.progress_claims WHERE id = :id"),
            {"id": part.books_claim_id},
        )).mappings().first()
    live = claim is not None and not claim["is_deleted"]
    if live and wanted and claim["project_id"] == part.project_id and Decimal(str(claim["this_claim_amount"])) == part.amount:
        return
    if live:
        await db.execute(text("UPDATE finance.progress_claims SET is_deleted = true, updated_at = NOW() WHERE id = :id"),
                         {"id": part.books_claim_id})
        counts["claims_retired"] += 1
    if part.books_claim_id:
        await db.execute(text(f"UPDATE finance.{holder_table} SET books_claim_id = NULL WHERE id = :id"), {"id": holder_id})
    if not wanted:
        return
    paid_on = line.row["transaction_date"]
    who = line.row["counterparty_name"]
    claim_id = (await db.execute(
        text("""
            INSERT INTO finance.progress_claims (
                organization_id, claim_number, project_id, claim_period_start, claim_period_end,
                contract_value, this_claim_amount, retention_pct, retention_amount, net_claim_amount,
                status, submitted_by, submitted_at, certified_amount, certified_by, certified_at,
                notes, created_by, evidence_quality
            ) VALUES (
                :org_id, :claim_number, :project_id, :paid_on, :paid_on,
                :amount, :amount, 0, 0, :amount,
                'paid', :user_id, :paid_at, :amount, :user_id, :paid_at,
                :notes, :user_id, 'B'
            ) RETURNING id
        """),
        {
            "org_id": org_id, "claim_number": f"BANK-{uuid4().hex[:8].upper()}", "project_id": part.project_id,
            "paid_on": paid_on, "paid_at": datetime.combine(paid_on, datetime.min.time()), "amount": part.amount,
            "user_id": user_id,
            "notes": (f"Bank statement receipt {paid_on} ref {line.row['reference'] or '-'}"
                      f"{' from ' + who if who else ''}. Posted from Bank Statement Review; no VAT accrued."),
        },
    )).scalar()
    await db.execute(text(f"UPDATE finance.{holder_table} SET books_claim_id = :c WHERE id = :id"), {"c": claim_id, "id": holder_id})
    counts["claims_created"] += 1


async def _sync_costs(db: AsyncSession, org_id: str, user_id: str, lines: list[Line], full: bool, counts: dict) -> None:
    """cost_transactions keyed by (source_type, source_id): the line itself
    ('bank_statement_line') or an allocation ('bank_line_allocation')."""
    wanted: dict[tuple[str, UUID], dict] = {}
    for line in lines:
        if line.amount >= 0:
            continue
        parts = line.cash_uses() if line.is_cash_withdrawal else line.parts()
        for part in parts:
            if part.project_id is None or (part.category or "") in EXCLUDED_FROM_PROJECT_BOOKS:
                continue
            key = ("bank_line_allocation", part.allocation_id) if part.allocation_id else ("bank_statement_line", line.id)
            wanted[key] = {
                "project_id": part.project_id, "amount": part.amount, "cost_category": cost_category(part.category),
                "transaction_date": line.row["transaction_date"],
                "description": (part.description or line.row["description"] or "")[:500],
            }
    scope_ids = [l.id for l in lines] + [a["id"] for l in lines for a in l.allocations]
    existing_sql = """
        SELECT id, source_type, source_id, project_id, amount, cost_category FROM finance.cost_transactions
        WHERE organization_id = :org_id AND source_type IN ('bank_statement_line', 'bank_line_allocation')
    """
    params: dict[str, Any] = {"org_id": org_id}
    if not full:
        existing_sql += " AND source_id = ANY(:ids)"
        params["ids"] = scope_ids
    existing = {(r.source_type, r.source_id): r for r in (await db.execute(text(existing_sql), params))}
    for key, row in existing.items():
        want = wanted.get(key)
        if want and want["project_id"] == row.project_id and Decimal(str(row.amount)) == want["amount"] \
                and row.cost_category == want["cost_category"]:
            wanted.pop(key)
            continue
        await db.execute(text("DELETE FROM finance.cost_transactions WHERE id = :id"), {"id": row.id})
        counts["costs_removed"] += 1
    for (source_type, source_id), w in wanted.items():
        await db.execute(
            text("""
                INSERT INTO finance.cost_transactions (
                    organization_id, project_id, source_type, source_id, cost_category, description,
                    quantity, unit_cost, amount, transaction_date, status, posted_by, evidence_quality
                ) VALUES (:org_id, :project_id, :source_type, :source_id, :cost_category, :description,
                          1, :amount, :amount, :transaction_date, 'posted', :user_id, 'B')
            """),
            {"org_id": org_id, "source_type": source_type, "source_id": source_id, "user_id": user_id, **w},
        )
        counts["costs_created"] += 1


# ---------------------------------------------------------------------------
# HQ Petty Cash
# ---------------------------------------------------------------------------

async def _cashbook_row(db: AsyncSession, *, org_id: str, user_id: str, cash_account_id: UUID, tx_type: str,
                        direction: str, amount: Decimal, on: date, description: str, reference: Optional[str],
                        project_id: Optional[UUID], source_type: str, source_id: UUID) -> UUID:
    return (await db.execute(
        text("""
            INSERT INTO finance.cashbook_transactions (
                organization_id, cash_account_id, transaction_number, transaction_date, transaction_type, direction,
                amount, currency, description, reference, project_id, payment_method, source_type, source_id,
                reconciliation_status, posted_by
            ) VALUES (
                :org_id, :cash_account_id, :number, :on, :tx_type, :direction,
                :amount, 'USD', :description, :reference, :project_id, 'cash', :source_type, :source_id,
                'reconciled', :user_id
            ) RETURNING id
        """),
        {"org_id": org_id, "cash_account_id": cash_account_id, "number": f"PC-{uuid4().hex[:10].upper()}", "on": on,
         "tx_type": tx_type, "direction": direction, "amount": amount, "description": description[:1000],
         "reference": (reference or "")[:160] or None, "project_id": project_id, "source_type": source_type,
         "source_id": source_id, "user_id": user_id},
    )).scalar()


async def _void_cashbook(db: AsyncSession, ids: list[UUID]) -> None:
    if ids:
        await db.execute(text("UPDATE finance.cashbook_transactions SET is_deleted = true WHERE id = ANY(:ids)"), {"ids": ids})


async def _sync_petty_cash(db: AsyncSession, org_id: str, user_id: str, lines: list[Line], counts: dict) -> None:
    hq = await ensure_hq_petty_cash(db, org_id, user_id)
    ids = [l.id for l in lines]
    alloc_ids = [a["id"] for l in lines for a in l.allocations]

    # a) withdrawals into HQ Petty Cash (one transfer_in per withdrawal line)
    existing_in = {
        r.source_id: r for r in await db.execute(
            text("""
                SELECT id, source_id, amount FROM finance.cashbook_transactions
                WHERE cash_account_id = :hq AND source_type = 'bank_statement_line' AND source_id = ANY(:ids)
                  AND is_deleted = false
            """),
            {"hq": hq, "ids": ids},
        )
    }
    for line in lines:
        have = existing_in.get(line.id)
        want = line.is_cash_withdrawal
        if have and want and Decimal(str(have.amount)) == abs(line.amount):
            continue
        if have:
            await _void_cashbook(db, [have.id])
            counts["petty_cash_removed"] += 1
        if want:
            await _cashbook_row(
                db, org_id=org_id, user_id=user_id, cash_account_id=hq, tx_type="transfer_in", direction="inflow",
                amount=abs(line.amount), on=line.row["transaction_date"],
                description=f"Cash withdrawn from bank: {line.row['description']}", reference=line.row["reference"],
                project_id=None, source_type="bank_statement_line", source_id=line.id,
            )
            counts["petty_cash_created"] += 1

    # b) uses of that cash: HQ payment (+ transfer into a site float)
    existing_use: dict[UUID, list] = {}
    if alloc_ids:
        for r in await db.execute(
            text("""
                SELECT id, source_id, cash_account_id, amount, project_id, transaction_type
                FROM finance.cashbook_transactions
                WHERE source_type = 'bank_line_allocation' AND source_id = ANY(:ids) AND is_deleted = false
            """),
            {"ids": alloc_ids},
        ):
            existing_use.setdefault(r.source_id, []).append(r)
    for line in lines:
        for a in line.allocations:
            rows = existing_use.pop(a["id"], [])
            if not line.is_cash_withdrawal:
                await _void_cashbook(db, [r.id for r in rows])
                continue
            amount = Decimal(str(a["amount"]))
            to_site = a["category"] == SITE_PETTY_CASH and a["project_id"] is not None
            site = await ensure_project_petty_cash(db, org_id, user_id, a["project_id"]) if to_site else None
            expected = {(hq, "transfer_out" if to_site else "payment")}
            if to_site:
                expected.add((site, "transfer_in"))
            current = {(r.cash_account_id, r.transaction_type) for r in rows}
            if current == expected and all(Decimal(str(r.amount)) == amount for r in rows) \
                    and all(r.project_id == a["project_id"] for r in rows if r.transaction_type != "transfer_out"):
                continue
            await _void_cashbook(db, [r.id for r in rows])
            label = a["description"] or ("Cash handed to site petty cash" if to_site else "Cash spend")
            common = dict(org_id=org_id, user_id=user_id, amount=amount, on=a["allocation_date"],
                          reference=line.row["reference"], source_type="bank_line_allocation", source_id=a["id"])
            hq_row = await _cashbook_row(
                db, cash_account_id=hq, tx_type="transfer_out" if to_site else "payment", direction="outflow",
                description=label, project_id=None if to_site else a["project_id"], **common,
            )
            if to_site:
                await _cashbook_row(db, cash_account_id=site, tx_type="transfer_in", direction="inflow",
                                    description=label, project_id=a["project_id"], **common)
            await db.execute(text("UPDATE finance.bank_line_allocations SET petty_cashbook_id = :c WHERE id = :id"),
                             {"c": hq_row, "id": a["id"]})
            counts["petty_cash_created"] += 1
    for rows in existing_use.values():   # allocations that no longer exist
        await _void_cashbook(db, [r.id for r in rows])


# ---------------------------------------------------------------------------
# General ledger
# ---------------------------------------------------------------------------

async def _period_id(db: AsyncSession, org_id: str, on: date, cache: dict) -> UUID:
    key = (on.year, on.month)
    if key not in cache:
        row = (await db.execute(
            text("""
                SELECT id, status FROM finance.accounting_periods
                WHERE organization_id = :org_id AND :d BETWEEN period_start AND period_end
                ORDER BY period_start DESC LIMIT 1
            """),
            {"org_id": org_id, "d": on},
        )).first()
        if not row:
            raise GeneralLedgerError(f"No accounting period covers {on} - create one first.", status_code=422)
        if row.status not in ("open", "soft_closed"):
            raise GeneralLedgerError(f"The accounting period covering {on} is {row.status}.", status_code=409)
        cache[key] = row.id
    return cache[key]


async def _post_journal(db: AsyncSession, *, org_id: str, user_id: str, entry_date: date, description: str,
                        lines: list[dict], source_type: str, source_id: UUID, periods: dict,
                        reverses: Optional[UUID] = None) -> UUID:
    """Same records general_ledger.create_journal + gl_bridge.approve_proposal
    produce (a system-proposed, approved, posted journal) in fewer round trips."""
    debit = sum((Decimal(str(l.get("debit_amount") or 0)) for l in lines), Decimal("0"))
    credit = sum((Decimal(str(l.get("credit_amount") or 0)) for l in lines), Decimal("0"))
    if debit != credit or debit <= 0:
        raise GeneralLedgerError(f"Bank journal does not balance ({debit} vs {credit}).")
    period_id = await _period_id(db, org_id, entry_date, periods)
    seq = (await db.execute(text("SELECT NEXTVAL('finance.journal_entry_seq')"))).scalar()
    journal_id = (await db.execute(
        text("""
            INSERT INTO finance.journal_entries (
                organization_id, journal_number, journal_type, period_id, entry_date, description,
                source_type, source_id, reverses_journal_id, created_by, updated_by, origination, proposal_status
            ) VALUES (
                :org_id, :number, :journal_type, :period_id, :entry_date, :description,
                :source_type, :source_id, :reverses, :user_id, :user_id, 'system_proposed', 'approved'
            ) RETURNING id
        """),
        {"org_id": org_id, "number": f"JE-{entry_date.strftime('%Y%m')}-{seq:06d}",
         "journal_type": "reversal" if reverses else "standard", "period_id": period_id, "entry_date": entry_date,
         "description": description[:1000], "source_type": source_type, "source_id": source_id,
         "reverses": reverses, "user_id": user_id},
    )).scalar()
    values, params = [], {"journal_id": journal_id, "org_id": org_id}
    for i, l in enumerate(lines, start=1):
        values.append(f"(:journal_id, :org_id, {i}, :a{i}, :d{i}, :c{i}, :desc{i}, :p{i}, 'USD')")
        params.update({f"a{i}": l["account_id"], f"d{i}": l.get("debit_amount") or 0, f"c{i}": l.get("credit_amount") or 0,
                       f"desc{i}": (l.get("description") or "")[:500] or None, f"p{i}": l.get("project_id")})
    await db.execute(
        text(f"""
            INSERT INTO finance.journal_lines (
                journal_entry_id, organization_id, line_number, account_id, debit_amount, credit_amount,
                description, project_id, currency_code
            ) VALUES {', '.join(values)}
        """),
        params,
    )
    await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET status = 'posted', posted_at = NOW(), posted_by = :user_id, updated_by = :user_id, updated_at = NOW()
            WHERE id = :id
        """),
        {"id": journal_id, "user_id": user_id},
    )
    return journal_id


async def _reverse_journal(db: AsyncSession, *, org_id: str, user_id: str, journal_id: UUID, reason: str,
                           periods: dict) -> None:
    original = (await db.execute(
        text("""
            SELECT journal_number, entry_date, status, reversed_by_journal_id FROM finance.journal_entries
            WHERE id = :id AND organization_id = :org_id
        """),
        {"id": journal_id, "org_id": org_id},
    )).mappings().first()
    if not original or original["status"] != "posted" or original["reversed_by_journal_id"]:
        return
    lines = [
        {"account_id": r.account_id, "debit_amount": r.credit_amount, "credit_amount": r.debit_amount,
         "description": r.description, "project_id": r.project_id}
        for r in await db.execute(
            text("""
                SELECT account_id, debit_amount, credit_amount, description, project_id FROM finance.journal_lines
                WHERE journal_entry_id = :id ORDER BY line_number
            """),
            {"id": journal_id},
        )
    ]
    reversal_id = await _post_journal(
        db, org_id=org_id, user_id=user_id, entry_date=original["entry_date"],
        description=f"Reversal of {original['journal_number']}: {reason}", lines=lines,
        source_type="journal_reversal", source_id=journal_id, periods=periods, reverses=journal_id,
    )
    await db.execute(text("UPDATE finance.journal_entries SET reversed_by_journal_id = :r WHERE id = :id"),
                     {"r": reversal_id, "id": journal_id})


def _line_journal(line: Line, accounts: dict[str, UUID]) -> tuple[list[dict], str]:
    amount = abs(line.amount)
    who = line.row["counterparty_name"]
    label = f"Bank {line.row['transaction_date']} {line.row['reference'] or ''}".strip()
    detail = f"{label}: {who + ' - ' if who else ''}{line.row['description']}"
    gl: list[dict] = []
    if line.amount > 0:
        gl.append({"code": BANK, "debit_amount": amount, "description": detail})
        for part in line.parts():
            code = RECEIVABLE if line.row["receipt_already_in_books"] and part.project_id else \
                money_in_account(part.category, part.project_id is not None)
            gl.append({"code": code, "credit_amount": part.amount, "project_id": part.project_id,
                       "description": part.description or detail})
    else:
        for part in line.parts():
            gl.append({"code": money_out_account(part.category, part.project_id is not None),
                       "debit_amount": part.amount, "project_id": part.project_id,
                       "description": part.description or detail})
        gl.append({"code": BANK, "credit_amount": amount, "description": detail})
    return _resolve(gl, accounts), detail


def _use_journal(line: Line, use: Part, accounts: dict[str, UUID]) -> Optional[list[dict]]:
    if use.category == SITE_PETTY_CASH:
        return None   # HQ petty cash -> site petty cash: both sit in 1010, nothing to journal
    code = money_out_account(use.category, use.project_id is not None)
    if code in (HQ_PETTY, SUSPENSE) and use.project_id is None:
        code = SUSPENSE
    desc = use.description or f"Use of cash withdrawn {line.row['transaction_date']}"
    return _resolve([
        {"code": code, "debit_amount": use.amount, "project_id": use.project_id, "description": desc},
        {"code": HQ_PETTY, "credit_amount": use.amount, "description": desc},
    ], accounts)


def _resolve(gl: list[dict], accounts: dict[str, UUID]) -> list[dict]:
    out = []
    for l in gl:
        code = l.pop("code")
        if code not in accounts:
            raise GeneralLedgerError(f"Chart of accounts has no account {code} - run migration 228.", status_code=422)
        out.append({"account_id": accounts[code], **l})
    return out


def _signature(entry_date: date, lines: list[dict]) -> str:
    return json.dumps(
        [str(entry_date)] + [
            [str(l["account_id"]), str(l.get("debit_amount") or 0), str(l.get("credit_amount") or 0),
             str(l.get("project_id") or "")] for l in lines
        ],
        sort_keys=True,
    )


async def _bulk_post(db: AsyncSession, *, org_id: str, user_id: str, journals: list[dict],
                     periods: dict) -> dict[tuple[str, UUID], UUID]:
    """Post many balanced journals in a handful of statements (header insert,
    line insert, post) instead of several round trips each - the same rows
    _post_journal writes. Returns {(source_type, source_id): journal_id}."""
    if not journals:
        return {}
    headers = []
    for j in journals:
        debit = sum((Decimal(str(l.get("debit_amount") or 0)) for l in j["lines"]), Decimal("0"))
        credit = sum((Decimal(str(l.get("credit_amount") or 0)) for l in j["lines"]), Decimal("0"))
        if debit != credit or debit <= 0:
            raise GeneralLedgerError(f"Bank journal does not balance ({debit} vs {credit}).")
        headers.append({
            "journal_type": "reversal" if j.get("reverses") else "standard",
            "period_id": str(await _period_id(db, org_id, j["entry_date"], periods)),
            "entry_date": str(j["entry_date"]), "description": j["description"][:1000],
            "source_type": j["source_type"], "source_id": str(j["source_id"]),
            "reverses": str(j["reverses"]) if j.get("reverses") else None,
        })
    inserted = await db.execute(
        text("""
            INSERT INTO finance.journal_entries (
                organization_id, journal_number, journal_type, period_id, entry_date, description,
                source_type, source_id, reverses_journal_id, created_by, updated_by, origination, proposal_status
            )
            SELECT :org_id,
                   'JE-' || to_char(x.entry_date, 'YYYYMM') || '-' || lpad(CAST(nextval('finance.journal_entry_seq') AS text), 6, '0'),
                   x.journal_type, x.period_id, x.entry_date, x.description, x.source_type, x.source_id, x.reverses,
                   :user_id, :user_id, 'system_proposed', 'approved'
            FROM jsonb_to_recordset(CAST(:headers AS jsonb)) AS x(
                journal_type text, period_id uuid, entry_date date, description text,
                source_type text, source_id uuid, reverses uuid)
            RETURNING id, source_type, source_id
        """),
        {"org_id": org_id, "user_id": user_id, "headers": json.dumps(headers)},
    )
    ids = {(r.source_type, r.source_id): r.id for r in inserted}
    journal_lines = []
    for j in journals:
        jid = ids[(j["source_type"], j["source_id"] if isinstance(j["source_id"], UUID) else UUID(str(j["source_id"])))]
        for n, l in enumerate(j["lines"], start=1):
            journal_lines.append({
                "journal_entry_id": str(jid), "line_number": n, "account_id": str(l["account_id"]),
                "debit": str(l.get("debit_amount") or 0), "credit": str(l.get("credit_amount") or 0),
                "description": (l.get("description") or "")[:500] or None,
                "project_id": str(l["project_id"]) if l.get("project_id") else None,
            })
    await db.execute(
        text("""
            INSERT INTO finance.journal_lines (
                journal_entry_id, organization_id, line_number, account_id, debit_amount, credit_amount,
                description, project_id, currency_code
            )
            SELECT x.journal_entry_id, :org_id, x.line_number, x.account_id, x.debit, x.credit, x.description, x.project_id, 'USD'
            FROM jsonb_to_recordset(CAST(:lines AS jsonb)) AS x(
                journal_entry_id uuid, line_number int, account_id uuid, debit numeric, credit numeric,
                description text, project_id uuid)
        """),
        {"org_id": org_id, "lines": json.dumps(journal_lines)},
    )
    await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET status = 'posted', posted_at = NOW(), posted_by = :user_id, updated_by = :user_id, updated_at = NOW()
            WHERE id = ANY(:ids)
        """),
        {"ids": list(ids.values()), "user_id": user_id},
    )
    return ids


async def _bulk_reverse(db: AsyncSession, *, org_id: str, user_id: str, originals: list[tuple[UUID, str]],
                        periods: dict) -> int:
    """Reverse many posted journals at once (reason per journal)."""
    if not originals:
        return 0
    reasons = dict(originals)
    heads = {
        r.id: r for r in await db.execute(
            text("""
                SELECT id, journal_number, entry_date FROM finance.journal_entries
                WHERE id = ANY(:ids) AND organization_id = :org_id AND status = 'posted' AND reversed_by_journal_id IS NULL
            """),
            {"ids": list(reasons), "org_id": org_id},
        )
    }
    if not heads:
        return 0
    lines_by_journal: dict[UUID, list[dict]] = {}
    for r in await db.execute(
        text("""
            SELECT journal_entry_id, account_id, debit_amount, credit_amount, description, project_id
            FROM finance.journal_lines WHERE journal_entry_id = ANY(:ids) ORDER BY journal_entry_id, line_number
        """),
        {"ids": list(heads)},
    ):
        lines_by_journal.setdefault(r.journal_entry_id, []).append({
            "account_id": r.account_id, "debit_amount": r.credit_amount, "credit_amount": r.debit_amount,
            "description": r.description, "project_id": r.project_id,
        })
    posted = await _bulk_post(db, org_id=org_id, user_id=user_id, periods=periods, journals=[
        {"source_type": "journal_reversal", "source_id": jid, "reverses": jid, "entry_date": h.entry_date,
         "description": f"Reversal of {h.journal_number}: {reasons[jid]}", "lines": lines_by_journal[jid]}
        for jid, h in heads.items()
    ])
    await db.execute(
        text("""
            UPDATE finance.journal_entries je SET reversed_by_journal_id = x.reversal
            FROM jsonb_to_recordset(CAST(:links AS jsonb)) AS x(original uuid, reversal uuid)
            WHERE je.id = x.original
        """),
        {"links": json.dumps([{"original": str(src), "reversal": str(rid)} for (_, src), rid in posted.items()])},
    )
    return len(posted)


async def _sync_ledger(db: AsyncSession, org_id: str, user_id: str, lines: list[Line], counts: dict) -> None:
    accounts = await _account_ids(db, org_id)
    periods: dict = {}
    to_reverse: list[tuple[UUID, str]] = []
    to_post: list[dict] = []
    clear_allocs: list[UUID] = []
    for line in lines:
        gl, detail = _line_journal(line, accounts)
        sig = _signature(line.row["transaction_date"], gl)
        if line.row["gl_signature"] != sig or not line.row["gl_journal_id"]:
            if line.row["gl_journal_id"]:
                to_reverse.append((line.row["gl_journal_id"], "bank statement line re-tagged"))
            to_post.append({"table": "bank_statement_lines", "holder": line.id, "sig": sig,
                            "source_type": "bank_statement_line", "source_id": line.id,
                            "entry_date": line.row["transaction_date"], "description": detail, "lines": gl})

        uses = {u.allocation_id: u for u in line.cash_uses() if u.allocation_id}
        for a in line.allocations:
            use = uses.get(a["id"])
            use_gl = _use_journal(line, use, accounts) if use else None
            use_sig = _signature(a["allocation_date"], use_gl) if use_gl else None
            if a["gl_signature"] == use_sig and (a["gl_journal_id"] or not use_gl):
                continue
            if a["gl_journal_id"]:
                to_reverse.append((a["gl_journal_id"], "cash use changed"))
            if use_gl:
                to_post.append({"table": "bank_line_allocations", "holder": a["id"], "sig": use_sig,
                                "source_type": "bank_line_allocation", "source_id": a["id"],
                                "entry_date": a["allocation_date"],
                                "description": use.description or "Use of withdrawn cash", "lines": use_gl})
            else:
                clear_allocs.append(a["id"])

    counts["journals_reversed"] += await _bulk_reverse(db, org_id=org_id, user_id=user_id, originals=to_reverse, periods=periods)
    posted = await _bulk_post(db, org_id=org_id, user_id=user_id, journals=to_post, periods=periods)
    counts["journals_posted"] += len(posted)
    for table in ("bank_statement_lines", "bank_line_allocations"):
        links = [{"id": str(p["holder"]), "j": str(posted[(p["source_type"], p["source_id"])]), "s": p["sig"]}
                 for p in to_post if p["table"] == table]
        if links:
            await db.execute(
                text(f"""
                    UPDATE finance.{table} t SET gl_journal_id = x.j, gl_signature = x.s
                    FROM jsonb_to_recordset(CAST(:links AS jsonb)) AS x(id uuid, j uuid, s text)
                    WHERE t.id = x.id
                """),
                {"links": json.dumps(links)},
            )
    if clear_allocs:
        await db.execute(
            text("UPDATE finance.bank_line_allocations SET gl_journal_id = NULL, gl_signature = NULL WHERE id = ANY(:ids)"),
            {"ids": clear_allocs},
        )


async def reverse_allocation_journal(db: AsyncSession, *, org_id: str, user_id: str, allocation: dict) -> None:
    """Before an allocation row is deleted: undo everything hanging off it."""
    if allocation.get("gl_journal_id"):
        await _reverse_journal(db, org_id=org_id, user_id=user_id, journal_id=allocation["gl_journal_id"],
                               reason="cash use removed", periods={})
    if allocation.get("books_claim_id"):
        await db.execute(text("UPDATE finance.progress_claims SET is_deleted = true, updated_at = NOW() WHERE id = :id"),
                         {"id": allocation["books_claim_id"]})
    await db.execute(
        text("DELETE FROM finance.cost_transactions WHERE source_type = 'bank_line_allocation' AND source_id = :id"),
        {"id": allocation["id"]},
    )
    await db.execute(
        text("""
            UPDATE finance.cashbook_transactions SET is_deleted = true
            WHERE source_type = 'bank_line_allocation' AND source_id = :id AND is_deleted = false
        """),
        {"id": allocation["id"]},
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def _new_counts() -> dict:
    return {"claims_created": 0, "claims_retired": 0, "costs_created": 0, "costs_removed": 0,
            "petty_cash_created": 0, "petty_cash_removed": 0, "journals_posted": 0, "journals_reversed": 0}


async def sync(db: AsyncSession, *, org_id: str, user_id: str, line_ids: Optional[list[UUID]] = None,
               ledger: bool = True) -> dict:
    """Bring claims, costs, petty cash and (optionally) the GL in line with
    the lines' tags and allocations. line_ids=None means every line."""
    counts = _new_counts()
    lines = await _load_lines(db, org_id, line_ids)
    if not lines:
        return counts
    for line in lines:
        for part in line.parts():
            await _sync_claim(db, org_id, user_id, line, part, _claim_wanted(line, part), counts)
    await _sync_costs(db, org_id, user_id, lines, full=line_ids is None, counts=counts)
    await _sync_petty_cash(db, org_id, user_id, lines, counts)
    if ledger:
        # claims above may have changed books_claim_id etc.; the ledger only
        # needs amounts/tags, so the loaded rows are still current for it.
        await _sync_ledger(db, org_id, user_id, lines, counts)
    return counts


# ---------------------------------------------------------------------------
# Allocations (splits of a line / uses of withdrawn cash)
# ---------------------------------------------------------------------------

async def replace_allocations(db: AsyncSession, *, org_id: str, user_id: str, line_id: UUID,
                              allocations: list[dict]) -> dict:
    line = (await db.execute(
        text("SELECT id, amount, transaction_date, category FROM finance.bank_statement_lines WHERE id = :id AND organization_id = :org_id"),
        {"id": line_id, "org_id": org_id},
    )).mappings().first()
    if not line:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    total = sum((Decimal(str(a["amount"])) for a in allocations), Decimal("0"))
    if total > abs(Decimal(str(line["amount"]))):
        raise GeneralLedgerError(
            f"Allocations total {total} but the line is only {abs(Decimal(str(line['amount'])))}.", status_code=422)
    project_ids = {a["project_id"] for a in allocations if a.get("project_id")}
    if project_ids:
        found = (await db.execute(
            text("SELECT count(*) FROM projects.projects WHERE id = ANY(:ids) AND organization_id = :org_id AND is_deleted = false"),
            {"ids": list(project_ids), "org_id": org_id},
        )).scalar()
        if found != len(project_ids):
            raise GeneralLedgerError("One of the projects was not found.", status_code=404)

    existing = {r["id"]: dict(r) for r in (await db.execute(
        text("SELECT * FROM finance.bank_line_allocations WHERE line_id = :id AND organization_id = :org_id"),
        {"id": line_id, "org_id": org_id},
    )).mappings()}
    keep: set = set()
    for a in allocations:
        values = {
            "project_id": a.get("project_id"), "category": a.get("category") or None, "amount": a["amount"],
            "description": a.get("description") or None, "allocation_date": a.get("allocation_date") or line["transaction_date"],
        }
        if a.get("id") and a["id"] in existing:
            keep.add(a["id"])
            await db.execute(
                text("""
                    UPDATE finance.bank_line_allocations
                    SET project_id = :project_id, category = :category, amount = :amount, description = :description,
                        allocation_date = :allocation_date, updated_at = NOW()
                    WHERE id = :id
                """),
                {"id": a["id"], **values},
            )
        else:
            await db.execute(
                text("""
                    INSERT INTO finance.bank_line_allocations (
                        organization_id, line_id, project_id, category, amount, description, allocation_date, created_by
                    ) VALUES (:org_id, :line_id, :project_id, :category, :amount, :description, :allocation_date, :user_id)
                """),
                {"org_id": org_id, "line_id": line_id, "user_id": user_id, **values},
            )
    for alloc_id, row in existing.items():
        if alloc_id not in keep:
            await reverse_allocation_journal(db, org_id=org_id, user_id=user_id, allocation=row)
            await db.execute(text("DELETE FROM finance.bank_line_allocations WHERE id = :id"), {"id": alloc_id})
    await db.execute(text("UPDATE finance.bank_statement_lines SET tagged_by = :u, tagged_at = NOW() WHERE id = :id"),
                     {"u": user_id, "id": line_id})
    return await sync(db, org_id=org_id, user_id=user_id, line_ids=[line_id])


async def list_allocations(db: AsyncSession, *, org_id: str, line_id: UUID) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT a.*, p.name AS project_name
            FROM finance.bank_line_allocations a
            LEFT JOIN projects.projects p ON p.id = a.project_id
            WHERE a.line_id = :id AND a.organization_id = :org_id
            ORDER BY a.created_at
        """),
        {"id": line_id, "org_id": org_id},
    )
    return [dict(r) for r in rows.mappings()]


# ---------------------------------------------------------------------------
# Project workspace (everything the project panel shows, in one call)
# ---------------------------------------------------------------------------

async def project_workspace(db: AsyncSession, *, org_id: str, project_id: UUID) -> Optional[dict]:
    q = lambda sql, **p: db.execute(text(sql), {"org_id": org_id, "project_id": project_id, **p})
    project = (await q("""
        SELECT p.id, p.name, p.project_code, p.client_name, p.status, p.project_type, p.contract_value,
               p.start_date, p.planned_completion_date, p.is_historical, p.department_id, d.name AS department_name
        FROM projects.projects p LEFT JOIN finance.departments d ON d.id = p.department_id
        WHERE p.id = :project_id AND p.organization_id = :org_id AND p.is_deleted = false
    """)).mappings().first()
    if not project:
        return None

    money_in, money_out, cash_uses = [], [], []
    for line in await _load_lines(db, org_id, None):
        base = {
            "line_id": str(line.id), "transaction_date": line.row["transaction_date"], "reference": line.row["reference"],
            "bank_description": line.row["description"], "counterparty_name": line.row["counterparty_name"],
            "line_amount": abs(line.amount), "line_category": line.row["category"],
            "split": bool(line.allocations),
        }
        if line.is_cash_withdrawal:
            for use in line.cash_uses():
                if use.project_id == project_id:
                    cash_uses.append({**base, "allocation_id": str(use.allocation_id) if use.allocation_id else None,
                                      "amount": use.amount, "category": use.category, "description": use.description,
                                      "allocation_date": next((a["allocation_date"] for a in line.allocations
                                                               if a["id"] == use.allocation_id), line.row["transaction_date"])})
            continue
        for part in line.parts():
            if part.project_id != project_id:
                continue
            item = {**base, "allocation_id": str(part.allocation_id) if part.allocation_id else None,
                    "amount": part.amount, "category": part.category,
                    "description": part.description if part.allocation_id else None}
            (money_in if line.amount > 0 else money_out).append(item)

    claims = [dict(r) for r in (await q("""
        SELECT id, claim_number, claim_period_start, claim_period_end, status, this_claim_amount, certified_amount,
               net_claim_amount, retention_amount, vat_amount, notes, created_at
        FROM finance.progress_claims
        WHERE organization_id = :org_id AND project_id = :project_id AND is_deleted = false
        ORDER BY claim_period_end DESC, created_at DESC
    """)).mappings()]
    budget = (await q("""
        SELECT id, total_amount, status, created_at FROM finance.project_budgets
        WHERE organization_id = :org_id AND project_id = :project_id AND is_deleted = false
        ORDER BY (status = 'approved') DESC, created_at DESC LIMIT 1
    """)).mappings().first()
    costs_by_category = [dict(r) for r in (await q("""
        SELECT cost_category, count(*) AS entries, sum(amount) AS amount,
               sum(amount) FILTER (WHERE source_type IN ('bank_statement_line', 'bank_line_allocation')) AS from_bank
        FROM finance.cost_transactions WHERE organization_id = :org_id AND project_id = :project_id
        GROUP BY cost_category ORDER BY sum(amount) DESC
    """)).mappings()]
    ledger = [dict(r) for r in (await q("""
        SELECT a.account_code, a.account_name, a.account_category,
               sum(jl.debit_amount) AS debit, sum(jl.credit_amount) AS credit,
               sum(jl.debit_amount - jl.credit_amount) AS balance
        FROM finance.journal_lines jl
        JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
        JOIN finance.chart_of_accounts a ON a.id = jl.account_id
        WHERE jl.organization_id = :org_id AND jl.project_id = :project_id
        GROUP BY a.account_code, a.account_name, a.account_category ORDER BY a.account_code
    """)).mappings()]
    petty_cash = [dict(r) for r in (await q("""
        SELECT id, account_name, current_balance, float_amount, is_active FROM finance.cash_accounts
        WHERE organization_id = :org_id AND project_id = :project_id AND is_petty_cash = true AND is_deleted = false
    """)).mappings()]

    total = lambda rows: sum((Decimal(str(r["amount"])) for r in rows), Decimal("0"))
    collected = sum((Decimal(str(c["net_claim_amount"] or 0)) for c in claims if c["status"] == "paid"), Decimal("0"))
    certified = sum((Decimal(str(c["certified_amount"] or 0)) for c in claims if c["status"] in ("certified", "paid")), Decimal("0"))
    actual_cost = sum((Decimal(str(c["amount"] or 0)) for c in costs_by_category), Decimal("0"))
    contract_value = Decimal(str(project["contract_value"] or 0))
    return {
        "project": dict(project),
        "summary": {
            "contract_value": contract_value,
            "budget": budget["total_amount"] if budget else None,
            "budget_status": budget["status"] if budget else None,
            "certified": certified,
            "collected": collected,
            "outstanding_on_contract": contract_value - certified if contract_value else None,
            "actual_cost": actual_cost,
            "margin_to_date": collected - actual_cost,
            "bank_in": total(money_in),
            "bank_out": total(money_out),
            "cash_used": total(cash_uses),
        },
        "money_in": money_in,
        "money_out": money_out,
        "cash_uses": cash_uses,
        "claims": claims,
        "costs_by_category": costs_by_category,
        "ledger": ledger,
        "petty_cash": petty_cash,
    }


# ---------------------------------------------------------------------------
# Completeness audit
# ---------------------------------------------------------------------------

async def audit(db: AsyncSession, *, org_id: str) -> dict:
    """Proves the bank statement is fully carried into the books, and lists
    what still needs attention. Every check is a number that should be 0 /
    equal, so the frontend can show pass/fail."""
    q = lambda sql, **p: db.execute(text(sql), {"org_id": org_id, **p})
    imports = [dict(r) for r in (await q("""
        SELECT i.id, i.file_name, i.total_lines, i.statement_period_start, i.statement_period_end,
               (SELECT count(*) FROM finance.bank_statement_lines l WHERE l.import_id = i.id) AS lines_stored,
               (SELECT COALESCE(sum(amount), 0) FROM finance.bank_statement_lines l WHERE l.import_id = i.id) AS net_movement,
               i.column_mapping->>'closing_balance' AS closing_balance_per_bank,
               COALESCE(i.column_mapping->>'opening_balance', '0') AS opening_balance
        FROM finance.bank_statement_imports i WHERE i.organization_id = :org_id
    """)).mappings()]
    lines = (await q("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE category IS NULL AND project_id IS NULL) AS unclassified,
               count(*) FILTER (WHERE gl_journal_id IS NULL) AS missing_journal,
               COALESCE(sum(-amount) FILTER (WHERE amount < 0 AND category IS NULL AND project_id IS NULL), 0) AS unclassified_out,
               COALESCE(sum(amount) FILTER (WHERE amount > 0 AND category IS NULL AND project_id IS NULL), 0) AS unclassified_in
        FROM finance.bank_statement_lines WHERE organization_id = :org_id
    """)).mappings().one()
    gl = {r["account_code"]: r for r in (await q("""
        SELECT a.account_code, a.account_name, COALESCE(sum(jl.debit_amount - jl.credit_amount), 0) AS balance
        FROM finance.chart_of_accounts a
        JOIN finance.journal_lines jl ON jl.account_id = a.id
        JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
        WHERE a.organization_id = :org_id
          AND (je.source_type IN ('bank_statement_line', 'bank_line_allocation')
               OR je.reverses_journal_id IN (SELECT id FROM finance.journal_entries
                                             WHERE source_type IN ('bank_statement_line', 'bank_line_allocation')))
        GROUP BY a.account_code, a.account_name
    """)).mappings()}
    net = sum((Decimal(str(i["net_movement"])) for i in imports), Decimal("0"))
    stale = (await q("""
        SELECT count(*) FROM finance.journal_entries je
        JOIN finance.bank_statement_lines l ON l.gl_journal_id = je.id
        WHERE l.organization_id = :org_id AND (je.status <> 'posted' OR je.reversed_by_journal_id IS NOT NULL)
    """)).scalar()
    hq_balance = (await q("""
        SELECT COALESCE(current_balance, 0) FROM finance.cash_accounts
        WHERE organization_id = :org_id AND account_code = :code AND is_deleted = false
    """, code=HQ_PETTY_CASH_CODE)).scalar() or 0
    # Cash handed from HQ to a site float stays in GL 1010 (both are petty cash)
    handed_to_sites = (await q("""
        SELECT COALESCE(sum(ct.amount), 0) FROM finance.cashbook_transactions ct
        JOIN finance.cash_accounts ca ON ca.id = ct.cash_account_id AND ca.account_code <> :code
        WHERE ct.organization_id = :org_id AND ct.source_type = 'bank_line_allocation'
          AND ct.transaction_type = 'transfer_in' AND ct.is_deleted = false
    """, code=HQ_PETTY_CASH_CODE)).scalar() or 0
    project_parts = (await q("""
        SELECT
          (SELECT count(*) FROM finance.progress_claims WHERE organization_id = :org_id AND claim_number LIKE 'BANK-%' AND NOT is_deleted) AS bank_claims,
          (SELECT COALESCE(sum(net_claim_amount), 0) FROM finance.progress_claims WHERE organization_id = :org_id AND claim_number LIKE 'BANK-%' AND NOT is_deleted) AS bank_claims_total,
          (SELECT count(*) FROM finance.cost_transactions WHERE organization_id = :org_id AND source_type IN ('bank_statement_line', 'bank_line_allocation')) AS bank_costs,
          (SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions WHERE organization_id = :org_id AND source_type IN ('bank_statement_line', 'bank_line_allocation')) AS bank_costs_total
    """)).mappings().one()

    def bal(code: str) -> Decimal:
        return Decimal(str(gl[code]["balance"])) if code in gl else Decimal("0")

    checks = [
        {"check": "Every line on each statement was stored",
         "ok": all(i["lines_stored"] == i["total_lines"] for i in imports),
         "detail": ", ".join(f"{i['lines_stored']}/{i['total_lines']}" for i in imports)},
        {"check": "Stored lines add up to the bank's closing balance",
         "ok": all(i["closing_balance_per_bank"] is None
                   or Decimal(i["opening_balance"]) + Decimal(str(i["net_movement"])) == Decimal(i["closing_balance_per_bank"])
                   for i in imports),
         "detail": ", ".join(f"{Decimal(i['opening_balance']) + Decimal(str(i['net_movement']))} vs {i['closing_balance_per_bank']}"
                             for i in imports)},
        {"check": "Every line has a posted, current ledger journal",
         "ok": lines["missing_journal"] == 0 and stale == 0,
         "detail": f"{lines['missing_journal']} missing, {stale} out of date"},
        {"check": "Ledger Cash and Bank from the statement equals the statement",
         "ok": bal(BANK) == net, "detail": f"GL {bal(BANK)} vs statement {net}"},
        {"check": "HQ Petty Cash in the ledger equals HQ Petty Cash plus cash handed to site floats",
         "ok": bal(HQ_PETTY) == Decimal(str(hq_balance)) + Decimal(str(handed_to_sites)),
         "detail": f"GL {bal(HQ_PETTY)} vs HQ {hq_balance} + sites {handed_to_sites}"},
    ]
    return {
        "checks": checks,
        "all_ok": all(c["ok"] for c in checks),
        "imports": imports,
        "to_do": {
            "unclassified_lines": lines["unclassified"],
            "unclassified_money_in": lines["unclassified_in"],
            "unclassified_money_out": lines["unclassified_out"],
            "suspense_balance": bal(SUSPENSE),
            "hq_petty_cash_not_yet_accounted_for": hq_balance,
            "unclassified_project_costs": bal(UNCLASSIFIED_PROJECT_COST),
        },
        "books": dict(project_parts),
        "ledger_by_account": [
            {"account_code": c, "account_name": gl[c]["account_name"], "balance": gl[c]["balance"]} for c in sorted(gl)
        ],
    }
