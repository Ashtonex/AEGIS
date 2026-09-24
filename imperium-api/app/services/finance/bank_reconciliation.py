"""
Bank Reconciliation - matches an uploaded bank statement (CSV) against
finance.cashbook_transactions ("our books" side).

Per the master spec ("AI may suggest matches. Human approval is required
for ambiguous matches"): only an exact same-account/same-amount match within
a 1-day window is auto-marked `matched` by run_matching. Every other
candidate becomes `suggested` (or `duplicate`/`difference`) and needs an
explicit human confirm_match/reject_match decision - nothing here writes to
finance.cashbook_transactions.reconciliation_status without either that
tight auto-match rule or a human action.

Known, flagged simplification: the raw uploaded file is parsed immediately
and not retained in core.documents/Storage (bank_statement_imports.document_id
stays NULL) - no existing code path in this app does a server-side Storage
upload to copy, and building one is out of scope for proving the matching
engine itself. Only the parsed rows persist.
"""

import csv
import io
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Optional
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.general_ledger import GeneralLedgerError

EXACT_MATCH_WINDOW_DAYS = 1
SUGGESTED_MATCH_WINDOW_DAYS = 7
DUPLICATE_DATE_WINDOW_DAYS = 2


def parse_csv_rows(csv_content: str, column_mapping: dict[str, str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Returns (parsed_rows, row_errors). Never raises on a bad row - a
    malformed line is collected as an error, not a fatal exception, so one
    bad row never kills the whole import."""
    date_col = column_mapping.get("date")
    description_col = column_mapping.get("description")
    reference_col = column_mapping.get("reference")
    amount_col = column_mapping.get("amount")
    debit_col = column_mapping.get("debit")
    credit_col = column_mapping.get("credit")

    if not date_col or not (amount_col or (debit_col and credit_col)):
        raise GeneralLedgerError(
            "column_mapping must include 'date' and either 'amount' or both 'debit' and 'credit'.",
            status_code=422,
        )

    reader = csv.DictReader(io.StringIO(csv_content))
    rows: list[dict[str, Any]] = []
    errors: list[dict[str, Any]] = []

    for line_number, raw_row in enumerate(reader, start=1):
        try:
            raw_date = (raw_row.get(date_col) or "").strip()
            transaction_date = _parse_date(raw_date)

            if amount_col:
                amount = Decimal((raw_row.get(amount_col) or "0").replace(",", "").strip() or "0")
            else:
                debit = Decimal((raw_row.get(debit_col) or "0").replace(",", "").strip() or "0")
                credit = Decimal((raw_row.get(credit_col) or "0").replace(",", "").strip() or "0")
                amount = credit - debit

            if amount == 0:
                raise ValueError("amount is zero")

            rows.append({
                "line_number": line_number,
                "transaction_date": transaction_date,
                "description": (raw_row.get(description_col) or "").strip() if description_col else None,
                "reference": (raw_row.get(reference_col) or "").strip() if reference_col else None,
                "amount": amount,
            })
        except (ValueError, InvalidOperation, KeyError) as exc:
            errors.append({"line_number": line_number, "row": raw_row, "error": str(exc)})

    return rows, errors


def _parse_date(raw: str) -> date:
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"unrecognized date format: '{raw}'")


async def create_import(
    db: AsyncSession, *, org_id: str, user_id: str, cash_account_id: UUID,
    filename: str, csv_content: str, column_mapping: dict[str, str],
) -> dict:
    account = await db.execute(
        text("SELECT id FROM finance.cash_accounts WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": cash_account_id, "org_id": org_id},
    )
    if not account.first():
        raise GeneralLedgerError("Cash account not found.", status_code=404)

    rows, row_errors = parse_csv_rows(csv_content, column_mapping)
    if not rows:
        raise GeneralLedgerError("No valid rows could be parsed from this file.", status_code=422)

    dates = [r["transaction_date"] for r in rows]
    import_id = (
        await db.execute(
            text("""
                INSERT INTO finance.bank_statement_imports (
                    organization_id, cash_account_id, file_name, column_mapping,
                    statement_period_start, statement_period_end, status, total_lines, uploaded_by
                ) VALUES (
                    :org_id, :cash_account_id, :file_name, CAST(:column_mapping AS jsonb),
                    :period_start, :period_end, 'parsed', :total_lines, :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id, "cash_account_id": cash_account_id, "file_name": filename,
                "column_mapping": _to_json(column_mapping),
                "period_start": min(dates), "period_end": max(dates),
                "total_lines": len(rows), "user_id": user_id,
            },
        )
    ).scalar()

    for row in rows:
        await db.execute(
            text("""
                INSERT INTO finance.bank_statement_lines (
                    organization_id, import_id, cash_account_id, line_number,
                    transaction_date, description, reference, amount
                ) VALUES (
                    :org_id, :import_id, :cash_account_id, :line_number,
                    :transaction_date, :description, :reference, :amount
                )
            """),
            {
                "org_id": org_id, "import_id": import_id, "cash_account_id": cash_account_id,
                "line_number": row["line_number"], "transaction_date": row["transaction_date"],
                "description": row["description"], "reference": row["reference"], "amount": row["amount"],
            },
        )

    return {
        "import_id": str(import_id),
        "total_lines": len(rows),
        "row_errors": row_errors,
    }


def _to_json(value: dict) -> str:
    import json
    return json.dumps(value)


async def _next_transaction_number(db: AsyncSession, org_id: str, prefix: str) -> str:
    row = await db.execute(
        text("""
            INSERT INTO core.sequences (organization_id, sequence_name, last_value)
            VALUES (:org_id, 'cashbook_transaction', 1)
            ON CONFLICT (organization_id, sequence_name)
            DO UPDATE SET last_value = core.sequences.last_value + 1, updated_at = NOW()
            RETURNING last_value
        """),
        {"org_id": org_id},
    )
    return f"{prefix}-{int(row.scalar()):06d}"


async def _reconcile_cashbook_row(db: AsyncSession, *, cashbook_transaction_id: UUID, user_id: Optional[str]) -> None:
    await db.execute(
        text("""
            UPDATE finance.cashbook_transactions
            SET reconciliation_status = 'reconciled', reconciled_at = NOW(), reconciled_by = :user_id
            WHERE id = :id
        """),
        {"id": cashbook_transaction_id, "user_id": user_id},
    )


async def run_matching(db: AsyncSession, *, org_id: str, user_id: str, import_id: UUID) -> dict:
    import_row = await db.execute(
        text("SELECT id, cash_account_id FROM finance.bank_statement_imports WHERE id = :id AND organization_id = :org_id"),
        {"id": import_id, "org_id": org_id},
    )
    imp = import_row.mappings().first()
    if not imp:
        raise GeneralLedgerError("Bank statement import not found.", status_code=404)

    # Set-based on purpose: the original per-line loop issued 3-5 queries per
    # line, which for a multi-year statement (2,000+ lines) over the pooler
    # ran long enough for the connection to be dropped mid-transaction.
    params = {"import_id": import_id, "org_id": org_id, "cash_account_id": imp["cash_account_id"]}
    counts = {"matched": 0, "suggested": 0, "unmatched": 0, "duplicate": 0}

    # 1. Duplicates first: another line in this import with the same
    # date/amount/description/reference. The bank reference is part of the
    # key because statements legitimately repeat identical same-day lines
    # (e.g. two $5.00 transfer fees) that differ only by their reference.
    duplicates = await db.execute(
        text("""
            WITH keyed AS (
                SELECT id, COUNT(*) OVER (
                    PARTITION BY transaction_date, amount, COALESCE(description, ''), COALESCE(reference, '')
                ) AS copies
                FROM finance.bank_statement_lines
                WHERE import_id = :import_id AND organization_id = :org_id
            )
            UPDATE finance.bank_statement_lines bsl
            SET match_status = 'duplicate', matched_cashbook_transaction_id = NULL, match_confidence = NULL
            FROM keyed
            WHERE bsl.id = keyed.id AND keyed.copies > 1 AND bsl.match_status = 'unmatched'
            RETURNING bsl.id
        """),
        params,
    )
    counts["duplicate"] = len(duplicates.all())

    # 2. Exact auto-match: exactly one unreconciled cashbook row with the same
    # amount, a direction-consistent type and within the tight window. A
    # cashbook row claimed by several such lines goes to the earliest line only.
    exact = await db.execute(
        text("""
            WITH candidates AS (
                SELECT bsl.id AS line_id, bsl.line_number, ct.id AS cashbook_id,
                       COUNT(*) OVER (PARTITION BY bsl.id) AS candidate_count
                FROM finance.bank_statement_lines bsl
                JOIN finance.cashbook_transactions ct
                  ON ct.organization_id = bsl.organization_id AND ct.cash_account_id = :cash_account_id
                 AND ct.is_deleted = false AND ct.reconciliation_status = 'unreconciled'
                 AND ct.amount = ABS(bsl.amount)
                 AND ABS(ct.transaction_date - bsl.transaction_date) <= :window
                 AND (CASE WHEN bsl.amount > 0 THEN ct.transaction_type IN ('receipt', 'transfer_in')
                           ELSE ct.transaction_type IN ('payment', 'transfer_out', 'bank_charge') END)
                WHERE bsl.import_id = :import_id AND bsl.organization_id = :org_id AND bsl.match_status = 'unmatched'
            )
            SELECT DISTINCT ON (cashbook_id) line_id, cashbook_id
            FROM candidates
            WHERE candidate_count = 1
            ORDER BY cashbook_id, line_number
        """),
        {**params, "window": EXACT_MATCH_WINDOW_DAYS},
    )
    for match in exact.mappings().all():
        await _set_line_status(db, match["line_id"], "matched", matched_cashbook_transaction_id=match["cashbook_id"], confidence=100)
        await _reconcile_cashbook_row(db, cashbook_transaction_id=match["cashbook_id"], user_id=user_id)
        counts["matched"] += 1

    # 3. Everything still unmatched with any same-amount unreconciled cashbook
    # row inside the wider window becomes a suggestion for a human to confirm.
    suggested = await db.execute(
        text("""
            WITH suggestion AS (
                SELECT DISTINCT ON (bsl.id) bsl.id AS line_id, ct.id AS cashbook_id
                FROM finance.bank_statement_lines bsl
                JOIN finance.cashbook_transactions ct
                  ON ct.organization_id = bsl.organization_id AND ct.cash_account_id = :cash_account_id
                 AND ct.is_deleted = false AND ct.reconciliation_status = 'unreconciled'
                 AND ct.amount = ABS(bsl.amount)
                 AND ABS(ct.transaction_date - bsl.transaction_date) <= :window
                WHERE bsl.import_id = :import_id AND bsl.organization_id = :org_id AND bsl.match_status = 'unmatched'
                ORDER BY bsl.id, ABS(ct.transaction_date - bsl.transaction_date)
            )
            UPDATE finance.bank_statement_lines bsl
            SET match_status = 'suggested', matched_cashbook_transaction_id = suggestion.cashbook_id, match_confidence = 60
            FROM suggestion
            WHERE bsl.id = suggestion.line_id
            RETURNING bsl.id
        """),
        {**params, "window": SUGGESTED_MATCH_WINDOW_DAYS},
    )
    counts["suggested"] = len(suggested.all())

    counts["unmatched"] = (
        await db.execute(
            text("""
                SELECT COUNT(*) FROM finance.bank_statement_lines
                WHERE import_id = :import_id AND organization_id = :org_id AND match_status = 'unmatched'
            """),
            params,
        )
    ).scalar()

    await db.execute(
        text("""
            UPDATE finance.bank_statement_imports
            SET status = 'reviewing', matched_count = matched_count + :matched,
                suggested_count = suggested_count + :suggested, unmatched_count = :unmatched,
                duplicate_count = duplicate_count + :duplicate, updated_at = NOW()
            WHERE id = :id
        """),
        {"id": import_id, **counts},
    )
    return counts


async def _set_line_status(
    db: AsyncSession, line_id: UUID, status: str, *,
    matched_cashbook_transaction_id: Optional[UUID] = None, confidence: Optional[float] = None,
) -> None:
    await db.execute(
        text("""
            UPDATE finance.bank_statement_lines
            SET match_status = :status, matched_cashbook_transaction_id = :matched_id, match_confidence = :confidence
            WHERE id = :id
        """),
        {"id": line_id, "status": status, "matched_id": matched_cashbook_transaction_id, "confidence": confidence},
    )


async def confirm_match(db: AsyncSession, *, org_id: str, user_id: str, line_id: UUID, cashbook_transaction_id: UUID) -> dict:
    line = await db.execute(
        text("SELECT * FROM finance.bank_statement_lines WHERE id = :id AND organization_id = :org_id"),
        {"id": line_id, "org_id": org_id},
    )
    line_row = line.mappings().first()
    if not line_row:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    if line_row["match_status"] not in ("suggested", "unmatched", "difference"):
        raise GeneralLedgerError(f"Line is already '{line_row['match_status']}'.", status_code=409)

    cashbook = await db.execute(
        text("""
            SELECT id FROM finance.cashbook_transactions
            WHERE id = :id AND organization_id = :org_id AND reconciliation_status = 'unreconciled'
        """),
        {"id": cashbook_transaction_id, "org_id": org_id},
    )
    if not cashbook.first():
        raise GeneralLedgerError("Cashbook transaction not found or already reconciled.", status_code=404)

    await _set_line_status(db, line_id, "matched", matched_cashbook_transaction_id=cashbook_transaction_id, confidence=100)
    await _reconcile_cashbook_row(db, cashbook_transaction_id=cashbook_transaction_id, user_id=user_id)
    return {"line_id": str(line_id), "cashbook_transaction_id": str(cashbook_transaction_id), "status": "matched"}


async def reject_match(db: AsyncSession, *, org_id: str, line_id: UUID) -> dict:
    line = await db.execute(
        text("SELECT match_status FROM finance.bank_statement_lines WHERE id = :id AND organization_id = :org_id"),
        {"id": line_id, "org_id": org_id},
    )
    row = line.first()
    if not row:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    if row.match_status not in ("suggested", "duplicate"):
        raise GeneralLedgerError(f"Only a suggested or duplicate line can be rejected (currently '{row.match_status}').", status_code=409)

    await _set_line_status(db, line_id, "unmatched")
    return {"line_id": str(line_id), "status": "unmatched"}


async def reopen_match(db: AsyncSession, *, org_id: str, user_id: str, line_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reopen a confirmed match.")

    line = await db.execute(
        text("SELECT match_status, matched_cashbook_transaction_id FROM finance.bank_statement_lines WHERE id = :id AND organization_id = :org_id"),
        {"id": line_id, "org_id": org_id},
    )
    row = line.mappings().first()
    if not row:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    if row["match_status"] != "matched":
        raise GeneralLedgerError("Only a matched line can be reopened.", status_code=409)

    await db.execute(
        text("""
            UPDATE finance.bank_statement_lines
            SET match_status = 'unmatched', matched_cashbook_transaction_id = NULL, match_confidence = NULL,
                reviewed_by = :user_id, reviewed_at = NOW()
            WHERE id = :id
        """),
        {"id": line_id, "user_id": user_id},
    )
    if row["matched_cashbook_transaction_id"]:
        await db.execute(
            text("""
                UPDATE finance.cashbook_transactions
                SET reconciliation_status = 'unreconciled', reconciled_at = NULL, reconciled_by = NULL
                WHERE id = :id
            """),
            {"id": row["matched_cashbook_transaction_id"]},
        )
    return {"line_id": str(line_id), "status": "unmatched", "reopen_reason": reason}


async def create_cashbook_entry_from_line(
    db: AsyncSession, *, org_id: str, user_id: str, line_id: UUID,
    transaction_type: str, project_id: Optional[UUID] = None, description: Optional[str] = None,
) -> dict:
    line = await db.execute(
        text("""
            SELECT bsl.*, bsi.cash_account_id
            FROM finance.bank_statement_lines bsl
            JOIN finance.bank_statement_imports bsi ON bsi.id = bsl.import_id
            WHERE bsl.id = :id AND bsl.organization_id = :org_id
        """),
        {"id": line_id, "org_id": org_id},
    )
    line_row = line.mappings().first()
    if not line_row:
        raise GeneralLedgerError("Bank statement line not found.", status_code=404)
    if line_row["match_status"] not in ("unmatched", "suggested"):
        raise GeneralLedgerError(f"Line is already '{line_row['match_status']}'.", status_code=409)

    amount = abs(Decimal(str(line_row["amount"])))
    direction = "inflow" if line_row["amount"] > 0 else "outflow"
    tx_number = await _next_transaction_number(db, org_id, "BR")

    tx_id = (
        await db.execute(
            text("""
                INSERT INTO finance.cashbook_transactions (
                    organization_id, cash_account_id, transaction_number, transaction_date,
                    transaction_type, direction, amount, currency, description,
                    project_id, source_type, source_id, reconciliation_status, reconciled_at, reconciled_by, posted_by
                ) VALUES (
                    :org_id, :cash_account_id, :tx_number, :transaction_date,
                    :transaction_type, :direction, :amount, 'USD', :description,
                    :project_id, 'bank_statement_line', :line_id, 'reconciled', NOW(), :user_id, :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id, "cash_account_id": line_row["cash_account_id"], "tx_number": tx_number,
                "transaction_date": line_row["transaction_date"], "transaction_type": transaction_type,
                "direction": direction, "amount": amount,
                "description": description or line_row["description"] or "Created from bank statement line",
                "project_id": project_id, "line_id": line_id, "user_id": user_id,
            },
        )
    ).scalar()

    await _set_line_status(db, line_id, "matched", matched_cashbook_transaction_id=tx_id, confidence=100)
    return {"line_id": str(line_id), "cashbook_transaction_id": str(tx_id), "status": "matched"}


async def get_import_summary(db: AsyncSession, *, org_id: str, import_id: UUID) -> Optional[dict]:
    row = await db.execute(
        text("""
            SELECT bsi.*, ca.account_code, ca.account_name
            FROM finance.bank_statement_imports bsi
            JOIN finance.cash_accounts ca ON ca.id = bsi.cash_account_id
            WHERE bsi.id = :id AND bsi.organization_id = :org_id
        """),
        {"id": import_id, "org_id": org_id},
    )
    result = row.mappings().first()
    return dict(result) if result else None


async def list_imports(db: AsyncSession, *, org_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT bsi.*, ca.account_code, ca.account_name
            FROM finance.bank_statement_imports bsi
            JOIN finance.cash_accounts ca ON ca.id = bsi.cash_account_id
            WHERE bsi.organization_id = :org_id
            ORDER BY bsi.uploaded_at DESC
        """),
        {"org_id": org_id},
    )
    return [dict(r._mapping) for r in rows]


async def list_lines(db: AsyncSession, *, org_id: str, import_id: UUID, match_status: Optional[str] = None) -> list[dict]:
    filters = ["bsl.import_id = :import_id", "bsl.organization_id = :org_id"]
    params: dict = {"import_id": import_id, "org_id": org_id}
    if match_status:
        filters.append("bsl.match_status = :match_status")
        params["match_status"] = match_status
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT bsl.*, ct.transaction_number AS matched_transaction_number,
                   ct.description AS matched_description, ct.transaction_date AS matched_transaction_date
            FROM finance.bank_statement_lines bsl
            LEFT JOIN finance.cashbook_transactions ct ON ct.id = bsl.matched_cashbook_transaction_id
            WHERE {where}
            ORDER BY bsl.line_number
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# Line tagging (migration 226): allocating statement lines to projects,
# counterparties and categories. Tagging never creates cashbook entries and
# never moves a cash account balance - it only annotates the bank's record.
# ---------------------------------------------------------------------------

TAGGABLE_FIELDS = ("project_id", "counterparty_name", "category", "notes")


def _line_filter_sql(org_id: str, filters: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    clauses = ["bsl.organization_id = :org_id"]
    params: dict[str, Any] = {"org_id": org_id}
    if filters.get("cash_account_id"):
        clauses.append("bsl.cash_account_id = :cash_account_id")
        params["cash_account_id"] = filters["cash_account_id"]
    if filters.get("import_id"):
        clauses.append("bsl.import_id = :import_id")
        params["import_id"] = filters["import_id"]
    if filters.get("date_from"):
        clauses.append("bsl.transaction_date >= :date_from")
        params["date_from"] = filters["date_from"]
    if filters.get("date_to"):
        clauses.append("bsl.transaction_date <= :date_to")
        params["date_to"] = filters["date_to"]
    direction = filters.get("direction")
    if direction == "in":
        clauses.append("bsl.amount > 0")
    elif direction == "out":
        clauses.append("bsl.amount < 0")
    tag_status = filters.get("tag_status")
    if tag_status == "untagged":
        clauses.append("bsl.project_id IS NULL AND bsl.counterparty_name IS NULL AND bsl.category IS NULL")
    elif tag_status == "tagged":
        clauses.append("(bsl.project_id IS NOT NULL OR bsl.counterparty_name IS NOT NULL OR bsl.category IS NOT NULL)")
    elif tag_status == "no_project":
        clauses.append("bsl.project_id IS NULL")
    if filters.get("project_id"):
        clauses.append("bsl.project_id = :project_id")
        params["project_id"] = filters["project_id"]
    if filters.get("category"):
        clauses.append("bsl.category = :category")
        params["category"] = filters["category"]
    if filters.get("match_status"):
        clauses.append("bsl.match_status = :match_status")
        params["match_status"] = filters["match_status"]
    search = (filters.get("q") or "").strip()
    if search:
        text_match = (
            "(bsl.description ILIKE :q OR bsl.reference ILIKE :q "
            "OR bsl.counterparty_name ILIKE :q OR bsl.notes ILIKE :q)"
        )
        try:
            params["q_amount"] = Decimal(search.replace(",", ""))
            clauses.append(f"({text_match} OR ABS(bsl.amount) = ABS(:q_amount))")
        except InvalidOperation:
            clauses.append(text_match)
        params["q"] = f"%{search}%"
    return " AND ".join(clauses), params


async def search_lines(
    db: AsyncSession, *, org_id: str, filters: dict[str, Any], limit: int, offset: int,
) -> tuple[list[dict], dict]:
    where, params = _line_filter_sql(org_id, filters)
    totals_row = await db.execute(
        text(f"""
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0) AS money_in,
                   COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0) AS money_out
            FROM finance.bank_statement_lines bsl
            WHERE {where}
        """),
        params,
    )
    totals = dict(totals_row.mappings().one())
    rows = await db.execute(
        text(f"""
            SELECT bsl.id, bsl.import_id, bsl.cash_account_id, bsl.line_number, bsl.transaction_date,
                   bsl.description, bsl.reference, bsl.amount, bsl.match_status,
                   bsl.matched_cashbook_transaction_id, bsl.project_id, bsl.counterparty_name,
                   bsl.category, bsl.notes, bsl.tagged_at,
                   p.name AS project_name, p.project_code,
                   ct.transaction_number AS matched_transaction_number
            FROM finance.bank_statement_lines bsl
            LEFT JOIN projects.projects p ON p.id = bsl.project_id
            LEFT JOIN finance.cashbook_transactions ct ON ct.id = bsl.matched_cashbook_transaction_id
            WHERE {where}
            ORDER BY bsl.transaction_date DESC, bsl.line_number DESC
            LIMIT :limit OFFSET :offset
        """),
        {**params, "limit": limit, "offset": offset},
    )
    return [dict(r._mapping) for r in rows], totals


async def tag_lines(
    db: AsyncSession, *, org_id: str, user_id: str, updates: dict[str, Any],
    line_ids: Optional[list[UUID]] = None, filters: Optional[dict[str, Any]] = None,
) -> dict:
    """Apply `updates` (a subset of TAGGABLE_FIELDS; a None value clears that
    field) to either an explicit set of lines or every line matching `filters`."""
    fields = {k: v for k, v in updates.items() if k in TAGGABLE_FIELDS}
    if not fields:
        raise GeneralLedgerError("Nothing to tag - provide a project, counterparty, category or notes.")
    if not line_ids and filters is None:
        raise GeneralLedgerError("Select at least one statement line.")

    if fields.get("project_id"):
        project = await db.execute(
            text("SELECT 1 FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": fields["project_id"], "org_id": org_id},
        )
        if not project.first():
            raise GeneralLedgerError("Project not found.", status_code=404)

    set_sql = ", ".join(f"{name} = :set_{name}" for name in fields)
    params: dict[str, Any] = {f"set_{name}": value for name, value in fields.items()}
    params["user_id"] = user_id

    if line_ids:
        where = "organization_id = :org_id AND id = ANY(:line_ids)"
        where_params: dict[str, Any] = {"org_id": org_id, "line_ids": list(line_ids)}
    else:
        filter_where, where_params = _line_filter_sql(org_id, filters or {})
        where = f"id IN (SELECT bsl.id FROM finance.bank_statement_lines bsl WHERE {filter_where})"

    result = await db.execute(
        text(f"""
            UPDATE finance.bank_statement_lines
            SET {set_sql}, tagged_by = :user_id, tagged_at = NOW()
            WHERE {where}
        """),
        {**params, **where_params},
    )
    return {"updated": result.rowcount}


async def allocation_summary(db: AsyncSession, *, org_id: str, cash_account_id: Optional[UUID] = None) -> dict:
    params: dict[str, Any] = {"org_id": org_id}
    account_clause = ""
    if cash_account_id:
        account_clause = "AND bsl.cash_account_id = :cash_account_id"
        params["cash_account_id"] = cash_account_id

    by_project = await db.execute(
        text(f"""
            SELECT bsl.project_id, p.name AS project_name, p.project_code,
                   COUNT(*) AS line_count,
                   COALESCE(SUM(bsl.amount) FILTER (WHERE bsl.amount > 0), 0) AS money_in,
                   COALESCE(-SUM(bsl.amount) FILTER (WHERE bsl.amount < 0), 0) AS money_out,
                   COALESCE(SUM(bsl.amount), 0) AS net
            FROM finance.bank_statement_lines bsl
            LEFT JOIN projects.projects p ON p.id = bsl.project_id
            WHERE bsl.organization_id = :org_id {account_clause}
            GROUP BY bsl.project_id, p.name, p.project_code
            ORDER BY (bsl.project_id IS NULL), money_out DESC
        """),
        params,
    )
    by_category = await db.execute(
        text(f"""
            SELECT bsl.category, COUNT(*) AS line_count,
                   COALESCE(SUM(bsl.amount) FILTER (WHERE bsl.amount > 0), 0) AS money_in,
                   COALESCE(-SUM(bsl.amount) FILTER (WHERE bsl.amount < 0), 0) AS money_out
            FROM finance.bank_statement_lines bsl
            WHERE bsl.organization_id = :org_id {account_clause}
            GROUP BY bsl.category
            ORDER BY (bsl.category IS NULL), line_count DESC
        """),
        params,
    )
    progress = await db.execute(
        text(f"""
            SELECT COUNT(*) AS total_lines,
                   COUNT(*) FILTER (WHERE bsl.project_id IS NOT NULL OR bsl.counterparty_name IS NOT NULL
                                    OR bsl.category IS NOT NULL) AS tagged_lines,
                   COUNT(*) FILTER (WHERE bsl.project_id IS NOT NULL) AS project_lines
            FROM finance.bank_statement_lines bsl
            WHERE bsl.organization_id = :org_id {account_clause}
        """),
        params,
    )
    return {
        "progress": dict(progress.mappings().one()),
        "by_project": [dict(r._mapping) for r in by_project],
        "by_category": [dict(r._mapping) for r in by_category],
    }


# ---------------------------------------------------------------------------
# Project books (migration 227): project-tagged lines flow into the records the
# Finance dashboard reads - money in as a paid historical progress claim
# (Certified Revenue / Cash Collected), money out as a cost_transactions row
# (Actual Cost). The tags are the source of truth: sync_project_books creates,
# moves and retires those records to match, and is safe to re-run.
#
# Deliberately NOT done: no cashbook entry (the statement import already is the
# cash record, so the reconciled account balance must not move), no VAT accrual
# (a bank receipt is not an invoice) and no GL journal proposal.
# ---------------------------------------------------------------------------

BOOKS_EXCLUDED_CATEGORIES = ("reversal", "internal_transfer")

# Line category -> cost_transactions.cost_category
_COST_CATEGORY_SQL = """
    CASE bsl.category
        WHEN 'supplier_payment' THEN 'materials'
        WHEN 'subcontractor' THEN 'subcontract'
        WHEN 'equipment_hire' THEN 'equipment'
        WHEN 'fuel_transport' THEN 'equipment'
        WHEN 'salaries_wages' THEN 'labour'
        WHEN 'tax_statutory' THEN 'overhead'
        WHEN 'bank_charges' THEN 'overhead'
        ELSE 'other'
    END
"""


async def sync_project_books(db: AsyncSession, *, org_id: str, user_id: str) -> dict:
    counts = {"claims_created": 0, "claims_retired": 0, "costs_created": 0, "costs_removed": 0}
    params = {"org_id": org_id, "excluded": list(BOOKS_EXCLUDED_CATEGORIES)}

    # --- money in -> paid historical claims -------------------------------
    # A receipt already in the books through the live flow (its matched
    # cashbook entry is a claim receipt, e.g. a confirmed project deposit) is
    # skipped, or it would be counted twice.
    revenue_rows = await db.execute(
        text("""
            SELECT bsl.id, bsl.project_id, bsl.amount, bsl.transaction_date, bsl.reference,
                   bsl.counterparty_name, bsl.books_claim_id,
                   pc.project_id AS claim_project_id, pc.this_claim_amount AS claim_amount,
                   COALESCE(pc.is_deleted, true) AS claim_gone,
                   (bsl.project_id IS NOT NULL AND bsl.amount > 0
                    AND COALESCE(bsl.category, '') <> ALL(:excluded)
                    AND NOT EXISTS (
                        SELECT 1 FROM finance.cashbook_transactions ct
                        WHERE ct.id = bsl.matched_cashbook_transaction_id
                          AND (ct.source_type = 'progress_claim' OR EXISTS (
                              SELECT 1 FROM finance.receipt_allocations ra WHERE ra.cashbook_transaction_id = ct.id))
                    )) AS wanted
            FROM finance.bank_statement_lines bsl
            LEFT JOIN finance.progress_claims pc ON pc.id = bsl.books_claim_id
            WHERE bsl.organization_id = :org_id
              AND (bsl.books_claim_id IS NOT NULL OR (bsl.project_id IS NOT NULL AND bsl.amount > 0))
        """),
        params,
    )
    for row in revenue_rows.mappings().all():
        has_claim = row["books_claim_id"] is not None and not row["claim_gone"]
        claim_current = (
            has_claim and row["wanted"]
            and row["claim_project_id"] == row["project_id"]
            and Decimal(str(row["claim_amount"])) == Decimal(str(row["amount"]))
        )
        if claim_current:
            continue
        if row["books_claim_id"] is not None:
            if has_claim:
                await db.execute(
                    text("UPDATE finance.progress_claims SET is_deleted = true, updated_at = NOW() WHERE id = :id"),
                    {"id": row["books_claim_id"]},
                )
                counts["claims_retired"] += 1
            await db.execute(
                text("UPDATE finance.bank_statement_lines SET books_claim_id = NULL WHERE id = :id"),
                {"id": row["id"]},
            )
        if not row["wanted"]:
            continue
        paid_at = datetime.combine(row["transaction_date"], datetime.min.time())
        claim_id = (
            await db.execute(
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
                    "org_id": org_id, "claim_number": f"BANK-{uuid4().hex[:8].upper()}",
                    "project_id": row["project_id"], "paid_on": row["transaction_date"], "paid_at": paid_at,
                    "amount": row["amount"], "user_id": user_id,
                    "notes": (
                        f"Bank statement receipt {row['transaction_date']} ref {row['reference'] or '-'}"
                        f"{' from ' + row['counterparty_name'] if row['counterparty_name'] else ''}."
                        " Posted from Bank Statement Review; no VAT accrued."
                    ),
                },
            )
        ).scalar()
        await db.execute(
            text("UPDATE finance.bank_statement_lines SET books_claim_id = :claim_id WHERE id = :id"),
            {"claim_id": claim_id, "id": row["id"]},
        )
        counts["claims_created"] += 1

    # --- money out -> project cost rows ------------------------------------
    wanted_costs = f"""
        SELECT bsl.id, bsl.project_id, -bsl.amount AS amount, bsl.transaction_date,
               {_COST_CATEGORY_SQL} AS cost_category,
               left(regexp_replace(COALESCE(bsl.description, ''), '\\s+', ' ', 'g'), 500) AS description
        FROM finance.bank_statement_lines bsl
        WHERE bsl.organization_id = :org_id AND bsl.project_id IS NOT NULL AND bsl.amount < 0
          AND COALESCE(bsl.category, '') <> ALL(:excluded)
    """
    removed = await db.execute(
        text(f"""
            WITH wanted AS ({wanted_costs})
            DELETE FROM finance.cost_transactions ct
            WHERE ct.organization_id = :org_id AND ct.source_type = 'bank_statement_line'
              AND NOT EXISTS (
                  SELECT 1 FROM wanted w
                  WHERE w.id = ct.source_id AND w.project_id = ct.project_id
                    AND w.amount = ct.amount AND w.cost_category = ct.cost_category
              )
            RETURNING ct.id
        """),
        params,
    )
    counts["costs_removed"] = len(removed.all())
    created = await db.execute(
        text(f"""
            WITH wanted AS ({wanted_costs})
            INSERT INTO finance.cost_transactions (
                organization_id, project_id, source_type, source_id, cost_category, description,
                quantity, unit_cost, amount, transaction_date, status, posted_by, evidence_quality
            )
            SELECT :org_id, w.project_id, 'bank_statement_line', w.id, w.cost_category, w.description,
                   1, w.amount, w.amount, w.transaction_date, 'posted', :user_id, 'B'
            FROM wanted w
            WHERE NOT EXISTS (
                SELECT 1 FROM finance.cost_transactions ct
                WHERE ct.source_type = 'bank_statement_line' AND ct.source_id = w.id
            )
            RETURNING id
        """),
        {**params, "user_id": user_id},
    )
    counts["costs_created"] = len(created.all())
    return counts


async def list_counterparties(db: AsyncSession, *, org_id: str) -> list[str]:
    rows = await db.execute(
        text("""
            SELECT DISTINCT counterparty_name FROM finance.bank_statement_lines
            WHERE organization_id = :org_id AND counterparty_name IS NOT NULL
            ORDER BY counterparty_name
        """),
        {"org_id": org_id},
    )
    return [r.counterparty_name for r in rows]
