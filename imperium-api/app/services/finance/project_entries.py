"""
Money recorded directly on a project (migration 246).

Finance records a receipt or a cost on the project itself; it goes into the
books straight away and is paired with its bank statement line when the
statement is imported.

What an entry puts in the books (all rebuilt from scratch whenever the entry
changes, and torn down when it is voided):
  money in   -> a paid progress claim (PRJ-...), or marks an existing
                certified/invoiced claim paid
  money out  -> a finance.cost_transactions row (source 'project_money_entry')
  cash entry -> a receipt/payment in HQ Petty Cash
  GL         -> one posted journal:
                  in, new claim      Dr 1070 (or 1010)  Cr revenue
                  in, pays a claim   Dr 1070 (or 1010)  Cr 1100 receivable
                  out                Dr cost account    Cr 1070 (or 1010)

Pairing with the bank (bank entries only):
  A matched statement line carries project_entry_id; bank_books then posts
  it as Bank against 1070 and creates no claim or cost of its own, so the
  entry's books stand and 1070 clears. An entry with exactly one plausible
  line (and that line exactly one plausible entry) is matched automatically;
  anything less certain becomes a suggestion a person confirms.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import bank_books
from app.services.finance.bank_books import (
    EXCLUDED_FROM_PROJECT_BOOKS, HQ_PETTY, RECEIVABLE, cost_category, money_in_account, money_out_account,
)
from app.services.finance.general_ledger import GeneralLedgerError

AWAITING_BANK = "1070"
AUTO_MATCH_DAYS = 10        # an entry and its line this close (and unique) pair on their own
SUGGEST_DAYS = 45           # anything with the same amount this close is offered to a person
SOURCE = "project_money_entry"

IN_CATEGORIES = {"client_receipt", "refund", "other"}
OUT_EXCLUDED = {"cash_withdrawal", "site_petty_cash", "internal_transfer", "reversal", "client_receipt",
                "capital_injection", bank_books.HISTORICAL_CASH_USE}
PAYABLE_CLAIM_STATUSES = ("certified", "invoiced", "submitted")


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0))


# ---------------------------------------------------------------------------
# Books for one entry
# ---------------------------------------------------------------------------

async def _get(db: AsyncSession, org_id: str, entry_id: UUID) -> dict:
    row = (await db.execute(
        text("SELECT * FROM finance.project_money_entries WHERE id = :id AND organization_id = :org_id"),
        {"id": entry_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        raise GeneralLedgerError("Recorded entry not found.", status_code=404)
    return dict(row)


async def _tear_down(db: AsyncSession, org_id: str, user_id: str, entry: dict, reason: str) -> None:
    if entry["gl_journal_id"]:
        await bank_books._reverse_journal(db, org_id=org_id, user_id=user_id, journal_id=entry["gl_journal_id"],
                                          reason=reason, periods={})
    if entry["books_claim_id"]:
        await db.execute(text("UPDATE finance.progress_claims SET is_deleted = true, updated_at = NOW() WHERE id = :id"),
                         {"id": entry["books_claim_id"]})
    if entry["pays_claim_id"] and entry["pays_claim_prior_status"]:
        await db.execute(
            text("UPDATE finance.progress_claims SET status = :s, updated_at = NOW() WHERE id = :id AND status = 'paid'"),
            {"id": entry["pays_claim_id"], "s": entry["pays_claim_prior_status"]},
        )
    await db.execute(text("DELETE FROM finance.cost_transactions WHERE source_type = :st AND source_id = :id"),
                     {"st": SOURCE, "id": entry["id"]})
    await db.execute(
        text("UPDATE finance.cashbook_transactions SET is_deleted = true WHERE source_type = :st AND source_id = :id AND is_deleted = false"),
        {"st": SOURCE, "id": entry["id"]},
    )
    await db.execute(
        text("""
            UPDATE finance.project_money_entries
            SET gl_journal_id = NULL, gl_signature = NULL, books_claim_id = NULL, petty_cashbook_id = NULL,
                pays_claim_prior_status = NULL, updated_at = NOW()
            WHERE id = :id
        """),
        {"id": entry["id"]},
    )


async def _build(db: AsyncSession, org_id: str, user_id: str, entry: dict) -> None:
    accounts = await bank_books._account_ids(db, org_id)
    project_id, amount, on = entry["project_id"], _d(entry["amount"]), entry["entry_date"]
    holding = HQ_PETTY if entry["paid_via"] == "cash" else AWAITING_BANK
    who = entry["counterparty_name"]
    detail = (f"{'Received' if entry['direction'] == 'in' else 'Paid'} {on}"
              f"{' ' + entry['reference'] if entry['reference'] else ''}: "
              f"{who + ' - ' if who else ''}{entry['description'] or ''}").strip(" :-")
    updates: dict[str, Any] = {}

    if entry["direction"] == "in":
        if entry["pays_claim_id"]:
            claim = (await db.execute(
                text("""
                    SELECT status FROM finance.progress_claims
                    WHERE id = :id AND organization_id = :org_id AND project_id = :p AND is_deleted = false
                """),
                {"id": entry["pays_claim_id"], "org_id": org_id, "p": project_id},
            )).mappings().first()
            if not claim:
                raise GeneralLedgerError("The claim this receipt pays was not found on this project.", status_code=404)
            if claim["status"] != "paid":
                updates["pays_claim_prior_status"] = claim["status"]
                await db.execute(text("UPDATE finance.progress_claims SET status = 'paid', updated_at = NOW() WHERE id = :id"),
                                 {"id": entry["pays_claim_id"]})
            credit = RECEIVABLE
        else:
            credit = money_in_account(entry["category"], True)
            if (entry["category"] or "") not in EXCLUDED_FROM_PROJECT_BOOKS:
                updates["books_claim_id"] = (await db.execute(
                    text("""
                        INSERT INTO finance.progress_claims (
                            organization_id, claim_number, project_id, claim_period_start, claim_period_end,
                            contract_value, this_claim_amount, retention_pct, retention_amount, net_claim_amount,
                            status, submitted_by, submitted_at, certified_amount, certified_by, certified_at,
                            notes, created_by, evidence_quality
                        ) VALUES (
                            :org_id, :number, :project_id, :on, :on,
                            :amount, :amount, 0, 0, :amount,
                            'paid', :user_id, :at, :amount, :user_id, :at,
                            :notes, :user_id, 'B'
                        ) RETURNING id
                    """),
                    {"org_id": org_id, "number": f"PRJ-{uuid4().hex[:8].upper()}", "project_id": project_id, "on": on,
                     "at": datetime.combine(on, datetime.min.time()), "amount": amount, "user_id": user_id,
                     "notes": f"Recorded on the project: {detail}. No VAT accrued."},
                )).scalar()
        gl = [{"code": holding, "debit_amount": amount, "description": detail},
              {"code": credit, "credit_amount": amount, "project_id": project_id, "description": detail}]
    else:
        await db.execute(
            text("""
                INSERT INTO finance.cost_transactions (
                    organization_id, project_id, source_type, source_id, cost_category, description,
                    quantity, unit_cost, amount, transaction_date, status, posted_by, evidence_quality
                ) VALUES (:org_id, :project_id, :st, :id, :cc, :description, 1, :amount, :amount, :on, 'posted', :user_id, 'B')
            """),
            {"org_id": org_id, "project_id": project_id, "st": SOURCE, "id": entry["id"],
             "cc": cost_category(entry["category"]), "description": detail[:500], "amount": amount, "on": on,
             "user_id": user_id},
        )
        gl = [{"code": money_out_account(entry["category"], True), "debit_amount": amount, "project_id": project_id,
               "description": detail},
              {"code": holding, "credit_amount": amount, "description": detail}]

    if entry["paid_via"] == "cash":
        hq = await bank_books.ensure_hq_petty_cash(db, org_id, user_id)
        updates["petty_cashbook_id"] = await bank_books._cashbook_row(
            db, org_id=org_id, user_id=user_id, cash_account_id=hq,
            tx_type="receipt" if entry["direction"] == "in" else "payment",
            direction="inflow" if entry["direction"] == "in" else "outflow",
            amount=amount, on=on, description=detail, reference=entry["reference"], project_id=project_id,
            source_type=SOURCE, source_id=entry["id"],
        )

    lines = bank_books._resolve(gl, accounts)
    updates["gl_journal_id"] = await bank_books._post_journal(
        db, org_id=org_id, user_id=user_id, entry_date=on, description=detail or "Recorded on project",
        lines=lines, source_type=SOURCE, source_id=entry["id"], periods={},
    )
    updates["gl_signature"] = bank_books._signature(on, lines)
    await db.execute(
        text(f"UPDATE finance.project_money_entries SET {', '.join(f'{k} = :{k}' for k in updates)}, updated_at = NOW() WHERE id = :id"),
        {"id": entry["id"], **updates},
    )


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

async def _validate(db: AsyncSession, org_id: str, values: dict) -> None:
    project = (await db.execute(
        text("SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": values["project_id"], "org_id": org_id},
    )).first()
    if not project:
        raise GeneralLedgerError("Project not found.", status_code=404)
    category = values.get("category")
    if values["direction"] == "in":
        if category and category not in IN_CATEGORIES:
            raise GeneralLedgerError("Money in can be a client receipt, a refund or other income.", status_code=422)
        if values.get("pays_claim_id"):
            claim = (await db.execute(
                text("""
                    SELECT status FROM finance.progress_claims
                    WHERE id = :id AND organization_id = :org_id AND project_id = :p AND is_deleted = false
                """),
                {"id": values["pays_claim_id"], "org_id": org_id, "p": values["project_id"]},
            )).mappings().first()
            if not claim:
                raise GeneralLedgerError("That claim is not on this project.", status_code=404)
    else:
        if values.get("pays_claim_id"):
            raise GeneralLedgerError("Only money in can pay a claim.", status_code=422)
        if category in OUT_EXCLUDED:
            raise GeneralLedgerError("That category can't be recorded as a project cost.", status_code=422)


ENTRY_FIELDS = ("project_id", "direction", "paid_via", "entry_date", "amount", "category", "counterparty_name",
                "reference", "description", "pays_claim_id")


async def create(db: AsyncSession, *, org_id: str, user_id: str, values: dict) -> dict:
    await _validate(db, org_id, values)
    if values.get("pays_claim_id"):
        payable = {str(c["id"]) for c in await payable_claims(db, org_id=org_id, project_id=values["project_id"])}
        if str(values["pays_claim_id"]) not in payable:
            raise GeneralLedgerError("That claim is already paid or has a receipt recorded against it.", status_code=409)
    entry_id = (await db.execute(
        text(f"""
            INSERT INTO finance.project_money_entries (organization_id, {', '.join(ENTRY_FIELDS)}, match_status, created_by)
            VALUES (:org_id, {', '.join(':' + f for f in ENTRY_FIELDS)}, :status, :user_id)
            RETURNING id
        """),
        {"org_id": org_id, "user_id": user_id, "status": "not_bank" if values["paid_via"] == "cash" else "awaiting",
         **{f: values.get(f) for f in ENTRY_FIELDS}},
    )).scalar()
    await _build(db, org_id, user_id, await _get(db, org_id, entry_id))
    if values["paid_via"] == "bank":
        await match(db, org_id=org_id, user_id=user_id, entry_ids=[entry_id])
    return await get_entry(db, org_id=org_id, entry_id=entry_id)


async def update(db: AsyncSession, *, org_id: str, user_id: str, entry_id: UUID, changes: dict) -> dict:
    entry = await _get(db, org_id, entry_id)
    if entry["is_void"]:
        raise GeneralLedgerError("This entry has been removed.", status_code=409)
    values = {**{f: entry[f] for f in ENTRY_FIELDS}, **changes}
    await _validate(db, org_id, values)
    amount_or_way_changed = (_d(values["amount"]) != _d(entry["amount"]) or values["direction"] != entry["direction"]
                             or values["paid_via"] != entry["paid_via"])
    if entry["matched_line_id"] and amount_or_way_changed:
        await unmatch(db, org_id=org_id, user_id=user_id, entry_id=entry_id)
        entry = await _get(db, org_id, entry_id)
    await _tear_down(db, org_id, user_id, entry, "recorded entry changed")
    status = "not_bank" if values["paid_via"] == "cash" else "matched" if entry["matched_line_id"] else "awaiting"
    await db.execute(
        text(f"""
            UPDATE finance.project_money_entries
            SET {', '.join(f'{f} = :{f}' for f in ENTRY_FIELDS)}, match_status = :status{"" if status == "matched" else ", suggested_line_ids = '{}'"},
                updated_at = NOW()
            WHERE id = :id
        """),
        {"id": entry_id, "status": status, **{f: values.get(f) for f in ENTRY_FIELDS}},
    )
    await _build(db, org_id, user_id, await _get(db, org_id, entry_id))
    entry = await _get(db, org_id, entry_id)
    if entry["matched_line_id"]:
        # tags follow the entry; the line's own journal only depends on the link
        await _tag_line_from_entry(db, user_id, entry, entry["matched_line_id"])
    elif entry["paid_via"] == "bank":
        await match(db, org_id=org_id, user_id=user_id, entry_ids=[entry_id])
    return await get_entry(db, org_id=org_id, entry_id=entry_id)


async def void(db: AsyncSession, *, org_id: str, user_id: str, entry_id: UUID) -> dict:
    """Remove a recorded entry. If it was matched, the bank line keeps the
    project and category and carries the books itself from now on."""
    entry = await _get(db, org_id, entry_id)
    if entry["is_void"]:
        return {"id": str(entry_id), "voided": True}
    line_id = entry["matched_line_id"]
    await _tear_down(db, org_id, user_id, entry, "recorded entry removed")
    await db.execute(
        text("""
            UPDATE finance.project_money_entries
            SET is_void = true, voided_at = NOW(), voided_by = :u, matched_line_id = NULL, suggested_line_ids = '{}',
                updated_at = NOW()
            WHERE id = :id
        """),
        {"id": entry_id, "u": user_id},
    )
    if line_id:
        await db.execute(text("UPDATE finance.bank_statement_lines SET project_entry_id = NULL WHERE id = :id"), {"id": line_id})
        await bank_books.sync(db, org_id=org_id, user_id=user_id, line_ids=[line_id])
    return {"id": str(entry_id), "voided": True, "bank_line_kept": bool(line_id)}


# ---------------------------------------------------------------------------
# Pairing with bank statement lines
# ---------------------------------------------------------------------------

_CANDIDATE_SQL = """
    SELECT e.id AS entry_id, l.id AS line_id, abs(l.transaction_date - e.entry_date) AS days_apart,
           (l.project_id = e.project_id) AS same_project,
           (e.reference IS NOT NULL AND length(e.reference) >= 3
              AND (l.reference ILIKE '%' || e.reference || '%' OR l.description ILIKE '%' || e.reference || '%')) AS ref_hit,
           (e.counterparty_name IS NOT NULL AND length(e.counterparty_name) >= 3
              AND (l.counterparty_name ILIKE '%' || e.counterparty_name || '%'
                   OR l.description ILIKE '%' || e.counterparty_name || '%')) AS name_hit
    FROM finance.project_money_entries e
    JOIN finance.bank_statement_lines l
      ON l.organization_id = e.organization_id
     AND abs(l.amount) = e.amount
     AND (CASE WHEN e.direction = 'in' THEN l.amount > 0 ELSE l.amount < 0 END)
     AND abs(l.transaction_date - e.entry_date) <= :suggest_days
     AND l.project_entry_id IS NULL
     AND COALESCE(l.category, '') <> 'cash_withdrawal'
     AND (l.project_id IS NULL OR l.project_id = e.project_id)
     AND NOT EXISTS (SELECT 1 FROM finance.bank_line_allocations a WHERE a.line_id = l.id)
    WHERE e.organization_id = :org_id AND NOT e.is_void AND e.paid_via = 'bank'
      AND e.match_status IN ('awaiting', 'suggested')
"""


def _score(c: dict) -> tuple:
    return (bool(c["ref_hit"]), bool(c["same_project"]), bool(c["name_hit"]), -int(c["days_apart"]))


async def match(db: AsyncSession, *, org_id: str, user_id: str, entry_ids: Optional[list[UUID]] = None,
                line_ids: Optional[list[UUID]] = None) -> dict:
    """Pair unmatched bank entries with statement lines. Scope with entry_ids
    (a new/changed entry against every line) or line_ids (new lines against
    every waiting entry). Returns counts."""
    sql, params = _CANDIDATE_SQL, {"org_id": org_id, "suggest_days": SUGGEST_DAYS}
    if entry_ids is not None:
        sql += " AND e.id = ANY(:entry_ids)"
        params["entry_ids"] = list(entry_ids)
    if line_ids is not None:
        sql += " AND l.id = ANY(:line_ids)"
        params["line_ids"] = list(line_ids)
    candidates = [dict(r) for r in (await db.execute(text(sql), params)).mappings()]

    by_entry: dict[UUID, list[dict]] = {}
    by_line: dict[UUID, list[dict]] = {}
    for c in candidates:
        by_entry.setdefault(c["entry_id"], []).append(c)
        by_line.setdefault(c["line_id"], []).append(c)

    counts = {"matched": 0, "suggested": 0}
    used: set[UUID] = set()
    for entry_id, options in by_entry.items():
        options.sort(key=_score, reverse=True)
        best = options[0]
        close = [o for o in options if o["days_apart"] <= AUTO_MATCH_DAYS]
        unique = (len(close) == 1 and best is close[0]) or \
                 (len(options) > 1 and best["ref_hit"] and not options[1]["ref_hit"])
        line_unique = len([o for o in by_line[best["line_id"]] if o["days_apart"] <= AUTO_MATCH_DAYS or o["ref_hit"]]) == 1
        if unique and line_unique and best["line_id"] not in used and (best["days_apart"] <= AUTO_MATCH_DAYS or best["ref_hit"]):
            used.add(best["line_id"])
            await _link(db, org_id, user_id, entry_id, best["line_id"], confirmed_by=None)
            counts["matched"] += 1
        else:
            await db.execute(
                text("""
                    UPDATE finance.project_money_entries
                    SET match_status = 'suggested', updated_at = NOW(),
                        suggested_line_ids = (SELECT array_agg(DISTINCT x) FROM unnest(suggested_line_ids || CAST(:ids AS uuid[])) x)
                    WHERE id = :id
                """),
                {"id": entry_id, "ids": [o["line_id"] for o in options]},
            )
            counts["suggested"] += 1
    return counts


async def _tag_line_from_entry(db: AsyncSession, user_id: str, entry: dict, line_id: UUID) -> None:
    category = entry["category"] or ("client_receipt" if entry["direction"] == "in" else None)
    await db.execute(
        text("""
            UPDATE finance.bank_statement_lines
            SET project_entry_id = :e, project_id = :p, category = COALESCE(:c, category),
                counterparty_name = COALESCE(counterparty_name, :who), tagged_by = :u, tagged_at = NOW()
            WHERE id = :id
        """),
        {"id": line_id, "e": entry["id"], "p": entry["project_id"], "c": category, "who": entry["counterparty_name"],
         "u": user_id},
    )


async def _link(db: AsyncSession, org_id: str, user_id: str, entry_id: UUID, line_id: UUID,
                confirmed_by: Optional[str]) -> None:
    entry = await _get(db, org_id, entry_id)
    await _tag_line_from_entry(db, user_id, entry, line_id)
    await db.execute(
        text("""
            UPDATE finance.project_money_entries
            SET match_status = 'matched', matched_line_id = :l, suggested_line_ids = '{}', matched_at = NOW(),
                matched_by = :u, updated_at = NOW()
            WHERE id = :id
        """),
        {"id": entry_id, "l": line_id, "u": confirmed_by},
    )
    # The line now settles 1070 instead of carrying its own claim/cost.
    await bank_books.sync(db, org_id=org_id, user_id=user_id, line_ids=[line_id])


async def confirm(db: AsyncSession, *, org_id: str, user_id: str, entry_id: UUID, line_id: UUID) -> dict:
    entry = await _get(db, org_id, entry_id)
    if entry["is_void"] or entry["paid_via"] != "bank":
        raise GeneralLedgerError("Only a bank entry can be matched to a statement line.", status_code=409)
    if entry["matched_line_id"]:
        raise GeneralLedgerError("This entry is already matched - unmatch it first.", status_code=409)
    line = (await db.execute(
        text("""
            SELECT l.amount, l.project_entry_id, l.project_id, l.category,
                   EXISTS (SELECT 1 FROM finance.bank_line_allocations a WHERE a.line_id = l.id) AS split
            FROM finance.bank_statement_lines l WHERE l.id = :id AND l.organization_id = :org_id
        """),
        {"id": line_id, "org_id": org_id},
    )).mappings().first()
    if not line:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    if line["project_entry_id"]:
        raise GeneralLedgerError("That bank line is already matched to another recorded entry.", status_code=409)
    if line["split"]:
        raise GeneralLedgerError("That bank line is split across several uses - remove the split first.", status_code=409)
    if line["category"] == "cash_withdrawal":
        raise GeneralLedgerError("A cash withdrawal can't settle a recorded entry - record the entry as cash instead.",
                                 status_code=422)
    signed = _d(line["amount"])
    if (signed > 0) != (entry["direction"] == "in"):
        raise GeneralLedgerError("That bank line goes the other way.", status_code=422)
    if abs(signed) != _d(entry["amount"]):
        raise GeneralLedgerError(
            f"The bank line is {abs(signed)} but the entry is {_d(entry['amount'])}. "
            "Change the entry's amount to the bank amount first.", status_code=422)
    await _link(db, org_id, user_id, entry_id, line_id, confirmed_by=user_id)
    return await get_entry(db, org_id=org_id, entry_id=entry_id)


async def unmatch(db: AsyncSession, *, org_id: str, user_id: str, entry_id: UUID) -> dict:
    """The line was not this entry after all: the line goes back to having no
    project (so it isn't counted twice) and the entry waits for the bank again."""
    entry = await _get(db, org_id, entry_id)
    line_id = entry["matched_line_id"]
    await db.execute(
        text("""
            UPDATE finance.project_money_entries
            SET match_status = 'awaiting', matched_line_id = NULL, matched_at = NULL, matched_by = NULL,
                suggested_line_ids = '{}', updated_at = NOW()
            WHERE id = :id
        """),
        {"id": entry_id},
    )
    if line_id:
        await db.execute(
            text("""
                UPDATE finance.bank_statement_lines
                SET project_entry_id = NULL,
                    project_id = CASE WHEN project_id = :p THEN NULL ELSE project_id END,
                    tagged_by = :u, tagged_at = NOW()
                WHERE id = :id
            """),
            {"id": line_id, "p": entry["project_id"], "u": user_id},
        )
        await bank_books.sync(db, org_id=org_id, user_id=user_id, line_ids=[line_id])
    return await get_entry(db, org_id=org_id, entry_id=entry_id)


async def dismiss_suggestion(db: AsyncSession, *, org_id: str, entry_id: UUID, line_id: UUID) -> dict:
    await db.execute(
        text("""
            UPDATE finance.project_money_entries
            SET suggested_line_ids = array_remove(suggested_line_ids, CAST(:l AS uuid)),
                match_status = CASE WHEN cardinality(array_remove(suggested_line_ids, CAST(:l AS uuid))) = 0
                                    THEN 'awaiting' ELSE match_status END,
                updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND match_status = 'suggested'
        """),
        {"id": entry_id, "org_id": org_id, "l": line_id},
    )
    return await get_entry(db, org_id=org_id, entry_id=entry_id)


async def candidates(db: AsyncSession, *, org_id: str, entry_id: UUID, q: Optional[str] = None) -> list[dict]:
    """Lines that could be this entry: same direction, within the wider
    window. With q, any unmatched line in that direction matching the search
    (for when the bank amount differs, e.g. charges deducted)."""
    entry = await _get(db, org_id, entry_id)
    params: dict[str, Any] = {"org_id": org_id, "amount": entry["amount"], "on": entry["entry_date"],
                              "days": SUGGEST_DAYS, "p": entry["project_id"]}
    where = """
        l.organization_id = :org_id AND l.project_entry_id IS NULL AND COALESCE(l.category, '') <> 'cash_withdrawal'
        AND NOT EXISTS (SELECT 1 FROM finance.bank_line_allocations a WHERE a.line_id = l.id)
        AND (l.project_id IS NULL OR l.project_id = :p)
    """
    where += " AND l.amount > 0" if entry["direction"] == "in" else " AND l.amount < 0"
    if q and q.strip():
        where += " AND (l.description ILIKE :q OR l.reference ILIKE :q OR l.counterparty_name ILIKE :q OR CAST(abs(l.amount) AS text) LIKE :q)"
        params["q"] = f"%{q.strip()}%"
    else:
        where += " AND abs(l.amount) = :amount AND abs(l.transaction_date - CAST(:on AS date)) <= :days"
    rows = await db.execute(
        text(f"""
            SELECT l.id, l.transaction_date, l.description, l.reference, l.counterparty_name, l.amount, l.category,
                   l.project_id, p.name AS project_name, abs(l.transaction_date - CAST(:on AS date)) AS days_apart,
                   (abs(l.amount) = :amount) AS same_amount
            FROM finance.bank_statement_lines l
            LEFT JOIN projects.projects p ON p.id = l.project_id
            WHERE {where}
            ORDER BY (abs(l.amount) = :amount) DESC, abs(l.transaction_date - CAST(:on AS date)), l.transaction_date DESC
            LIMIT 30
        """),
        params,
    )
    return [dict(r) for r in rows.mappings()]


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

_LIST_SQL = """
    SELECT e.*, pc.claim_number AS pays_claim_number,
           l.transaction_date AS bank_date, l.reference AS bank_reference, l.description AS bank_description,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                          'id', s.id, 'transaction_date', s.transaction_date, 'reference', s.reference,
                          'description', left(s.description, 200), 'amount', s.amount,
                          'counterparty_name', s.counterparty_name) ORDER BY s.transaction_date)
               FROM finance.bank_statement_lines s
               WHERE s.id = ANY(e.suggested_line_ids) AND s.project_entry_id IS NULL
           ), '[]'::jsonb) AS suggestions
    FROM finance.project_money_entries e
    LEFT JOIN finance.progress_claims pc ON pc.id = e.pays_claim_id
    LEFT JOIN finance.bank_statement_lines l ON l.id = e.matched_line_id
"""


async def get_entry(db: AsyncSession, *, org_id: str, entry_id: UUID) -> dict:
    row = (await db.execute(text(_LIST_SQL + " WHERE e.id = :id AND e.organization_id = :org_id"),
                            {"id": entry_id, "org_id": org_id})).mappings().first()
    if not row:
        raise GeneralLedgerError("Recorded entry not found.", status_code=404)
    return dict(row)


async def list_for_project(db: AsyncSession, *, org_id: str, project_id: UUID) -> list[dict]:
    rows = await db.execute(
        text(_LIST_SQL + """
            WHERE e.organization_id = :org_id AND e.project_id = :p AND NOT e.is_void
            ORDER BY e.entry_date DESC, e.created_at DESC
        """),
        {"org_id": org_id, "p": project_id},
    )
    return [dict(r) for r in rows.mappings()]


async def payable_claims(db: AsyncSession, *, org_id: str, project_id: UUID) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT c.id, c.claim_number, c.status, c.certified_amount, c.net_claim_amount, c.this_claim_amount,
                   c.claim_period_end
            FROM finance.progress_claims c
            WHERE c.organization_id = :org_id AND c.project_id = :p AND NOT c.is_deleted
              AND c.status = ANY(:statuses)
              AND NOT EXISTS (SELECT 1 FROM finance.project_money_entries e WHERE e.pays_claim_id = c.id AND NOT e.is_void)
            ORDER BY c.claim_period_end DESC
        """),
        {"org_id": org_id, "p": project_id, "statuses": list(PAYABLE_CLAIM_STATUSES)},
    )
    return [dict(r) for r in rows.mappings()]


def summary(entries: list[dict]) -> dict:
    out = {"recorded_in": Decimal("0"), "recorded_out": Decimal("0"), "awaiting_bank": 0,
           "awaiting_bank_amount": Decimal("0"), "needs_decision": 0}
    for e in entries:
        out["recorded_in" if e["direction"] == "in" else "recorded_out"] += _d(e["amount"])
        if e["paid_via"] == "bank" and e["match_status"] in ("awaiting", "suggested"):
            out["awaiting_bank"] += 1
            out["awaiting_bank_amount"] += _d(e["amount"])
        if e["match_status"] == "suggested" and e["suggestions"]:
            out["needs_decision"] += 1
    return out
