"""
Monthly BancABC PDF statements -> finance.bank_statement_lines.

The PDF is the bank's "Internet Banking" statement. pdfplumber gives every
word with its position, and the columns are fixed, so a line is read by
where its words sit, not by splitting text:

    Trn Date | [R] Value Date | Transaction Ref | Description | Dr | Cr | Balance
     x < 30     x 90-150        x 150-240          240-395     ..440 ..505  > 530

An "R" before the value date marks a bank reversal: the amount sits in the
same column as the original, so its sign is flipped (money comes back).

Nothing is trusted until it ties out: every line's printed balance must equal
the previous balance plus its amount, the totals must equal the bank's closing
balance, and the debit/credit counts must equal the bank's "CLOSING TOTALS".

Statements overlap (one run on the 9th, the next covering the whole month).
Each stored line keeps the bank's running balance, so (date, amount, balance)
identifies a line exactly; an upload skips what AEGIS already has and refuses
to leave a gap - the first new line must start from the last stored balance.
"""

import asyncio
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import GeneralLedgerError

DATE = re.compile(r"^\d{2}-[A-Z]{3}-\d{4}$")
NUM = re.compile(r"^-?[\d,]+\.\d{2}-?$")
ZERO = Decimal("0")


def _num(raw: str) -> Decimal:
    negative = raw.startswith("-") or raw.endswith("-")
    value = Decimal(raw.strip("-").replace(",", ""))
    return -value if negative else value


def _date(raw: str) -> date:
    return datetime.strptime(raw.title(), "%d-%b-%Y").date()


@dataclass
class StatementLine:
    transaction_date: date
    reference: str
    description: str
    debit: Optional[Decimal]
    credit: Optional[Decimal]
    balance: Optional[Decimal]
    reversal: bool
    page: int

    @property
    def amount(self) -> Decimal:
        movement = (self.credit or ZERO) - (self.debit or ZERO)
        return -movement if self.reversal else movement


@dataclass
class ParsedStatement:
    account_number: Optional[str] = None
    currency: Optional[str] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    opening_balance: Optional[Decimal] = None
    closing_balance: Optional[Decimal] = None
    debit_count: Optional[int] = None
    credit_count: Optional[int] = None
    lines: list[StatementLine] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


# ---------------------------------------------------------------------------
# Parsing (pure - no database)
# ---------------------------------------------------------------------------

def _place(line: dict, word: dict, first_row: bool) -> None:
    x0, x1, t = word["x0"], word["x1"], word["text"]
    if first_row and x0 < 100 and t == "R":
        line["reversal"] = True
    elif first_row and 90 <= x0 < 150 and DATE.match(t):
        pass                                   # value date - the transaction date is kept
    elif first_row and 150 <= x0 < 240:
        line["reference"] += t
    elif 240 <= x0 and x1 < 395:
        line["description"].append(t)
    elif NUM.match(t) and 395 <= x1 <= 440 and line["debit"] is None:
        line["debit"] = _num(t)
    elif NUM.match(t) and 460 <= x1 <= 505 and line["credit"] is None:
        line["credit"] = _num(t)
    elif NUM.match(t) and x1 > 530 and line["balance"] is None:
        line["balance"] = _num(t)
    # anything else left of the description (wrapped reference text) is ignored


def _read_header(statement: ParsedStatement, page_text: str) -> None:
    if m := re.search(r"Account No:\s*(\d+)", page_text):
        statement.account_number = m.group(1)
    if m := re.search(r"Currency:\s*([^\n]+)", page_text):
        statement.currency = m.group(1).strip()
    if m := re.search(r"Period:\s*(\d{2}-[A-Z]{3}-\d{4})\s+To\s+(\d{2}-[A-Z]{3}-\d{4})", page_text):
        statement.period_start, statement.period_end = _date(m.group(1)), _date(m.group(2))


def parse(pdf_bytes: bytes) -> ParsedStatement:
    import pdfplumber

    statement = ParsedStatement()
    raw: list[dict] = []
    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as exc:  # pdfplumber raises several unrelated types for a bad file
        raise GeneralLedgerError(f"This file could not be read as a PDF ({exc.__class__.__name__}).", status_code=422)

    with pdf:
        if not pdf.pages:
            raise GeneralLedgerError("The PDF has no pages.", status_code=422)
        first_text = pdf.pages[0].extract_text() or ""
        if "BancABC" not in first_text or "Trn Date" not in first_text:
            raise GeneralLedgerError(
                "This doesn't look like a BancABC internet banking statement. Only BancABC PDF "
                "statements can be read for now - use CSV for other banks.", status_code=422)
        _read_header(statement, first_text)

        current: Optional[dict] = None
        for page_number, page in enumerate(pdf.pages, start=1):
            rows: dict[int, list[dict]] = {}
            for word in page.extract_words():
                rows.setdefault(round(word["top"]), []).append(word)
            tops = sorted(rows)
            words = {top: sorted(rows[top], key=lambda w: w["x0"]) for top in tops}
            # Transactions start under the column header; pages that carry only
            # the bank's letterhead start after its EMAIL line.
            header = next((t for t in tops if [w["text"] for w in words[t]][:2] == ["Trn", "Date"]), None)
            if header is None:
                header = next((t for t in tops if words[t][0]["text"] == "EMAIL:"), 10 ** 9)
            for top in tops:
                if top <= header:
                    continue
                ws = words[top]
                texts = [w["text"] for w in ws]
                if texts[:2] == ["CLOSING", "TOTALS"]:
                    numbers = [t for t in texts[2:] if re.match(r"^-?[\d,.]+-?$", t)]
                    if len(numbers) >= 3:
                        statement.debit_count = int(numbers[0].replace(",", ""))
                        statement.credit_count = int(numbers[1].replace(",", ""))
                        statement.closing_balance = _num(numbers[2])
                    current = None
                    continue
                if texts[:2] == ["Opening", "Balance"]:
                    if statement.opening_balance is None and len(texts) > 2 and NUM.match(texts[-1]):
                        statement.opening_balance = _num(texts[-1])
                    continue
                if ws[0]["x0"] < 30 and DATE.match(texts[0]):
                    current = {"date": texts[0], "reversal": False, "reference": "", "description": [],
                               "debit": None, "credit": None, "balance": None, "page": page_number}
                    raw.append(current)
                    for w in ws[1:]:
                        _place(current, w, True)
                elif current is not None:
                    for w in ws:
                        _place(current, w, False)

    for r in raw:
        description = " ".join(" ".join(r["description"]).split())
        if r["reversal"]:
            description = "[REVERSAL] " + description
        statement.lines.append(StatementLine(
            transaction_date=_date(r["date"]), reference=r["reference"][:160], description=description,
            debit=r["debit"], credit=r["credit"], balance=r["balance"], reversal=r["reversal"], page=r["page"]))
    _validate(statement)
    return statement


def _validate(s: ParsedStatement) -> None:
    if not s.lines:
        s.problems.append("No transactions were found in the statement.")
        return
    if s.opening_balance is None:
        s.problems.append("The statement's opening balance could not be found.")
    if s.closing_balance is None:
        s.problems.append("The statement's CLOSING TOTALS line could not be found - is the PDF complete?")
    running = s.opening_balance if s.opening_balance is not None else ZERO
    broken = []
    for line in s.lines:
        if line.debit is None and line.credit is None:
            broken.append(f"page {line.page}, {line.transaction_date:%d %b %Y} {line.reference}: no amount")
        elif line.balance is None or running + line.amount != line.balance:
            broken.append(f"page {line.page}, {line.transaction_date:%d %b %Y} {line.reference}: "
                          f"expected balance {running + line.amount}, statement shows {line.balance}")
        if line.balance is not None:
            running = line.balance
    if broken:
        s.problems.append(f"{len(broken)} line(s) don't follow the running balance - first: {broken[0]}")
    if s.closing_balance is not None and s.opening_balance is not None:
        total = s.opening_balance + sum((l.amount for l in s.lines), ZERO)
        if total != s.closing_balance:
            s.problems.append(f"Opening {s.opening_balance} plus the lines gives {total}, "
                              f"but the bank's closing balance is {s.closing_balance}.")
    debits = sum(1 for l in s.lines if l.debit is not None)
    credits = sum(1 for l in s.lines if l.credit is not None)
    if s.debit_count is not None and (debits, credits) != (s.debit_count, s.credit_count):
        s.problems.append(f"Read {debits} debits / {credits} credits, the bank counts "
                          f"{s.debit_count} / {s.credit_count}.")


# ---------------------------------------------------------------------------
# Overlap with what is already stored (pure)
# ---------------------------------------------------------------------------

def line_key(transaction_date: date, amount: Decimal, balance: Optional[Decimal]) -> tuple:
    return (transaction_date, Decimal(amount).quantize(Decimal("0.01")),
            None if balance is None else Decimal(balance).quantize(Decimal("0.01")))


def plan(statement: ParsedStatement, stored_keys: list[tuple], last_stored: Optional[dict]) -> dict:
    """Split the statement into lines AEGIS already has and lines to add.

    stored_keys: line_key() of every stored line on this account on/after the
    statement's first date. last_stored: {"transaction_date", "bank_balance"}
    of the account's latest stored line, or None for an empty account.
    """
    remaining: dict[tuple, int] = {}
    for key in stored_keys:
        remaining[key] = remaining.get(key, 0) + 1
    duplicate_idx, new_idx = [], []
    for i, line in enumerate(statement.lines):
        key = line_key(line.transaction_date, line.amount, line.balance)
        if remaining.get(key):
            remaining[key] -= 1
            duplicate_idx.append(i)
        else:
            new_idx.append(i)

    problems: list[str] = []
    if new_idx:
        first = statement.lines[new_idx[0]]
        opening = first.balance - first.amount if first.balance is not None else None
        if duplicate_idx and max(duplicate_idx) > new_idx[0]:
            problems.append("Some lines in the middle of this statement are missing from AEGIS while "
                            "later ones are already stored - the stored history doesn't match this "
                            "statement. Nothing was imported.")
        elif last_stored is not None:
            if last_stored.get("bank_balance") is None:
                problems.append("The lines already stored for this account have no bank balances "
                                "(they came from a CSV), so the overlap can't be checked.")
            elif opening != Decimal(last_stored["bank_balance"]):
                problems.append(
                    f"Gap: AEGIS ends at {Decimal(last_stored['bank_balance']):,.2f} on "
                    f"{last_stored['transaction_date']:%d %b %Y}, but the first new line on this statement "
                    f"starts from {opening:,.2f} on {first.transaction_date:%d %b %Y}. Upload the statement "
                    f"that covers the days in between first.")
    else:
        opening = None
    new_lines = [statement.lines[i] for i in new_idx]
    return {
        "new": new_lines,
        "duplicates": len(duplicate_idx),
        "opening_balance": opening,
        "net": sum((l.amount for l in new_lines), ZERO),
        "problems": problems,
    }


# ---------------------------------------------------------------------------
# Database side
# ---------------------------------------------------------------------------

async def _prepare(db: AsyncSession, *, org_id: str, cash_account_id: UUID, pdf_bytes: bytes) -> tuple:
    account = (await db.execute(text("""
        SELECT id, account_name, account_number, currency FROM finance.cash_accounts
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
    """), {"id": cash_account_id, "org_id": org_id})).mappings().first()
    if not account:
        raise GeneralLedgerError("Cash account not found.", status_code=404)

    # pdfplumber is CPU-bound (a multi-year statement is ~200 pages) - keep it off the event loop
    statement = await asyncio.to_thread(parse, pdf_bytes)
    problems = list(statement.problems)
    stored_number = re.sub(r"\D", "", account["account_number"] or "")
    if statement.account_number and stored_number and statement.account_number != stored_number:
        problems.append(f"This statement is for account {statement.account_number}, but "
                        f"{account['account_name']} is account {account['account_number']}.")

    first_date = min((l.transaction_date for l in statement.lines), default=None)
    stored = [] if first_date is None else (await db.execute(text("""
        SELECT transaction_date, amount, bank_balance FROM finance.bank_statement_lines
        WHERE organization_id = :org_id AND cash_account_id = :acc AND transaction_date >= :first
    """), {"org_id": org_id, "acc": cash_account_id, "first": first_date})).all()
    last = (await db.execute(text("""
        SELECT l.transaction_date, l.bank_balance FROM finance.bank_statement_lines l
        JOIN finance.bank_statement_imports i ON i.id = l.import_id
        WHERE l.organization_id = :org_id AND l.cash_account_id = :acc
        ORDER BY l.transaction_date DESC, i.uploaded_at DESC, l.line_number DESC LIMIT 1
    """), {"org_id": org_id, "acc": cash_account_id})).mappings().first()
    result = plan(statement, [line_key(r.transaction_date, r.amount, r.bank_balance) for r in stored],
                  dict(last) if last else None)
    problems += result["problems"]
    return account, statement, result, problems


def _summary(account, statement: ParsedStatement, result: dict, problems: list[str], file_hash: str) -> dict:
    new = result["new"]
    return {
        "cash_account": {"id": str(account["id"]), "name": account["account_name"],
                         "account_number": account["account_number"]},
        "statement": {
            "account_number": statement.account_number, "currency": statement.currency,
            "period_start": statement.period_start, "period_end": statement.period_end,
            "first_line": statement.lines[0].transaction_date if statement.lines else None,
            "last_line": statement.lines[-1].transaction_date if statement.lines else None,
            "opening_balance": statement.opening_balance, "closing_balance": statement.closing_balance,
            "lines": len(statement.lines), "debit_count": statement.debit_count, "credit_count": statement.credit_count,
        },
        "already_in_aegis": result["duplicates"],
        "new_lines": len(new),
        "new_money_in": sum((l.amount for l in new if l.amount > 0), ZERO),
        "new_money_out": -sum((l.amount for l in new if l.amount < 0), ZERO),
        "new_first_date": new[0].transaction_date if new else None,
        "new_last_date": new[-1].transaction_date if new else None,
        "sample": [{"date": l.transaction_date, "reference": l.reference, "description": l.description,
                    "amount": l.amount, "balance": l.balance} for l in new[:15]],
        "problems": problems,
        "can_import": not problems and bool(new),
        "file_sha256": file_hash,
    }


async def preview(db: AsyncSession, *, org_id: str, cash_account_id: UUID, pdf_bytes: bytes) -> dict:
    account, statement, result, problems = await _prepare(
        db, org_id=org_id, cash_account_id=cash_account_id, pdf_bytes=pdf_bytes)
    return _summary(account, statement, result, problems, hashlib.sha256(pdf_bytes).hexdigest())


async def create_import(db: AsyncSession, *, org_id: str, user_id: str, cash_account_id: UUID,
                        filename: str, pdf_bytes: bytes) -> dict:
    """Stores only the lines AEGIS doesn't already have. Refuses (422) when the
    statement doesn't tie out, belongs to another account, leaves a gap, or
    has nothing new - so a bad upload can never half-load."""
    # One upload at a time per account, so two people can't add the same month twice
    await db.execute(text("SELECT pg_advisory_xact_lock(hashtext('bank-pdf-import:' || :acc))"),
                     {"acc": str(cash_account_id)})
    account, statement, result, problems = await _prepare(
        db, org_id=org_id, cash_account_id=cash_account_id, pdf_bytes=pdf_bytes)
    file_hash = hashlib.sha256(pdf_bytes).hexdigest()
    if problems:
        raise GeneralLedgerError("The statement was not imported: " + " ".join(problems), status_code=422)
    new = result["new"]
    if not new:
        raise GeneralLedgerError("Every line on this statement is already in AEGIS - nothing to import.",
                                 status_code=409)

    mapping = {
        "source": "pdf", "bank": "BancABC", "parser": "pdfplumber column positions",
        "sign": "amount = money in (+) / money out (-); reversals flipped",
        "opening_balance": str(result["opening_balance"]),
        "closing_balance": str(statement.closing_balance),
        "statement_opening_balance": str(statement.opening_balance),
        "statement_lines": len(statement.lines), "skipped_already_stored": result["duplicates"],
        "debit_count": statement.debit_count, "credit_count": statement.credit_count,
        "account_number": statement.account_number, "file_sha256": file_hash,
    }
    import_id = (await db.execute(text("""
        INSERT INTO finance.bank_statement_imports (
            organization_id, cash_account_id, file_name, column_mapping, statement_period_start,
            statement_period_end, status, total_lines, unmatched_count, uploaded_by
        ) VALUES (:org_id, :acc, :file_name, CAST(:mapping AS jsonb), :start, :end, 'parsed', :n, :n, :user_id)
        RETURNING id
    """), {"org_id": org_id, "acc": cash_account_id, "file_name": filename[:255], "mapping": json.dumps(mapping),
           "start": new[0].transaction_date, "end": new[-1].transaction_date, "n": len(new),
           "user_id": user_id})).scalar()
    await db.execute(text("""
        INSERT INTO finance.bank_statement_lines (
            organization_id, import_id, cash_account_id, line_number, transaction_date,
            description, reference, amount, bank_balance)
        SELECT :org_id, :import_id, :acc, r.line_number, r.transaction_date, r.description, r.reference,
               r.amount, r.bank_balance
        FROM jsonb_to_recordset(CAST(:rows AS jsonb)) AS r(
            line_number int, transaction_date date, description text, reference text,
            amount numeric, bank_balance numeric)
    """), {"org_id": org_id, "import_id": import_id, "acc": cash_account_id, "rows": json.dumps([
        {"line_number": n, "transaction_date": l.transaction_date.isoformat(), "description": l.description,
         "reference": l.reference, "amount": str(l.amount), "bank_balance": str(l.balance)}
        for n, l in enumerate(new, start=1)])})

    summary = _summary(account, statement, result, problems, file_hash)
    summary.pop("sample")
    return {"import_id": str(import_id), "total_lines": len(new), **summary}
