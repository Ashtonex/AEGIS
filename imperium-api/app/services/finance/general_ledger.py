"""
General Ledger posting service.

The single place that writes to finance.journal_entries / finance.journal_lines
and manages finance.accounting_periods / finance.chart_of_accounts, so every
future caller (this router today; procurement/payroll/project-cost auto-
posting in later phases) posts through one consistent mechanism instead of
divergent hand-rolled INSERTs.

Phase 1 invariants (also enforced at the DB layer by triggers defined in
migration 182 - this service validates early for a fast, friendly error, but
the trigger is the real backstop given this codebase has no ORM):
  - A journal only posts when its lines balance (sum(debit) == sum(credit) > 0)
    and its accounting period is open or soft_closed.
  - A posted journal is immutable. Corrections are always a new reversal or
    correcting journal, never an edit to a posted row.
  - Closing a period is refused while draft journals remain open in it.
"""

from datetime import date
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class GeneralLedgerError(Exception):
    """Raised for validation failures the router should surface as 4xx."""

    def __init__(self, message: str, *, status_code: int = 422, detail: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail if detail is not None else message


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

async def list_chart_of_accounts(
    db: AsyncSession, *, org_id: str, category: Optional[str] = None, active_only: bool = False
) -> list[dict]:
    filters = ["organization_id = :org_id", "is_deleted = false"]
    params: dict = {"org_id": org_id}
    if category:
        filters.append("account_category = :category")
        params["category"] = category
    if active_only:
        filters.append("is_active = true")
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT * FROM finance.chart_of_accounts
            WHERE {where}
            ORDER BY account_code
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def get_chart_of_account(db: AsyncSession, *, org_id: str, account_id: UUID) -> Optional[dict]:
    row = await db.execute(
        text("""
            SELECT * FROM finance.chart_of_accounts
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
        {"id": account_id, "org_id": org_id},
    )
    r = row.mappings().first()
    return dict(r) if r else None


async def create_chart_of_account(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    account_code: str,
    account_name: str,
    account_category: str,
    normal_balance: str,
    parent_account_id: Optional[UUID] = None,
    is_control_account: bool = False,
    currency_code: str = "USD",
    description: Optional[str] = None,
) -> dict:
    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.chart_of_accounts (
                    organization_id, account_code, account_name, account_category,
                    normal_balance, parent_account_id, is_control_account, currency_code,
                    description, created_by, updated_by
                ) VALUES (
                    :org_id, :account_code, :account_name, :account_category,
                    :normal_balance, :parent_account_id, :is_control_account, :currency_code,
                    :description, :user_id, :user_id
                ) RETURNING *
            """),
            {
                "org_id": org_id,
                "account_code": account_code,
                "account_name": account_name,
                "account_category": account_category,
                "normal_balance": normal_balance,
                "parent_account_id": parent_account_id,
                "is_control_account": is_control_account,
                "currency_code": currency_code,
                "description": description,
                "user_id": user_id,
            },
        )
        row = result.mappings().first()
    except Exception as exc:
        raise GeneralLedgerError(
            f"Account code '{account_code}' already exists or is invalid.", status_code=409
        ) from exc
    return dict(row)


async def update_chart_of_account(
    db: AsyncSession, *, org_id: str, user_id: str, account_id: UUID, values: dict
) -> dict:
    if not values:
        existing = await get_chart_of_account(db, org_id=org_id, account_id=account_id)
        if not existing:
            raise GeneralLedgerError("Account not found.", status_code=404)
        return existing

    if "account_category" in values or "normal_balance" in values:
        posted = await db.execute(
            text("""
                SELECT 1 FROM finance.journal_lines jl
                JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
                WHERE jl.account_id = :account_id AND je.status = 'posted'
                LIMIT 1
            """),
            {"account_id": account_id},
        )
        if posted.first():
            raise GeneralLedgerError(
                "Cannot change the category or normal balance of an account with posted journal lines.",
                status_code=409,
            )

    set_clause = ", ".join(f"{k} = :{k}" for k in values)
    result = await db.execute(
        text(f"""
            UPDATE finance.chart_of_accounts
            SET {set_clause}, updated_by = :user_id, updated_at = NOW()
            WHERE id = :account_id AND organization_id = :org_id AND is_deleted = false
            RETURNING *
        """),
        {**values, "account_id": account_id, "org_id": org_id, "user_id": user_id},
    )
    row = result.mappings().first()
    if not row:
        raise GeneralLedgerError("Account not found.", status_code=404)
    return dict(row)


async def get_account_ledger(
    db: AsyncSession, *, org_id: str, account_id: UUID, date_from: Optional[date] = None, date_to: Optional[date] = None
) -> list[dict]:
    filters = ["jl.organization_id = :org_id", "jl.account_id = :account_id", "je.status = 'posted'"]
    params: dict = {"org_id": org_id, "account_id": account_id}
    if date_from:
        filters.append("je.entry_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("je.entry_date <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"""
            SELECT
                jl.id, jl.line_number, jl.debit_amount, jl.credit_amount, jl.description,
                jl.project_id, jl.department_id, jl.cost_code_id,
                je.id AS journal_entry_id, je.journal_number, je.entry_date, je.description AS journal_description,
                je.source_type, je.source_id,
                SUM(jl.debit_amount - jl.credit_amount) OVER (ORDER BY je.entry_date, je.journal_number, jl.line_number) AS running_balance
            FROM finance.journal_lines jl
            JOIN finance.journal_entries je ON je.id = jl.journal_entry_id
            WHERE {where}
            ORDER BY je.entry_date, je.journal_number, jl.line_number
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def get_trial_balance(
    db: AsyncSession, *, org_id: str, as_of_date: Optional[date] = None, period_id: Optional[UUID] = None
) -> list[dict]:
    je_filters = ["je.status = 'posted'"]
    params: dict = {"org_id": org_id}
    if period_id:
        je_filters.append("je.period_id = :period_id")
        params["period_id"] = period_id
    elif as_of_date:
        je_filters.append("je.entry_date <= :as_of_date")
        params["as_of_date"] = as_of_date
    je_on = " AND ".join(je_filters)
    rows = await db.execute(
        text(f"""
            SELECT
                a.id AS account_id, a.account_code, a.account_name, a.account_category, a.normal_balance,
                COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS total_debit,
                COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS total_credit,
                COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0)
                    - COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) AS net_balance
            FROM finance.chart_of_accounts a
            LEFT JOIN finance.journal_lines jl ON jl.account_id = a.id AND jl.organization_id = :org_id
            LEFT JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND {je_on}
            WHERE a.organization_id = :org_id AND a.is_deleted = false
            GROUP BY a.id, a.account_code, a.account_name, a.account_category, a.normal_balance
            HAVING COALESCE(SUM(jl.debit_amount) FILTER (WHERE je.id IS NOT NULL), 0) <> 0
                OR COALESCE(SUM(jl.credit_amount) FILTER (WHERE je.id IS NOT NULL), 0) <> 0
            ORDER BY a.account_code
        """),
        params,
    )
    return [dict(r._mapping) for r in rows]


# ---------------------------------------------------------------------------
# Accounting Periods
# ---------------------------------------------------------------------------

async def list_accounting_periods(db: AsyncSession, *, org_id: str, status_filter: Optional[str] = None) -> list[dict]:
    filters = ["organization_id = :org_id"]
    params: dict = {"org_id": org_id}
    if status_filter:
        filters.append("status = :status")
        params["status"] = status_filter
    where = " AND ".join(filters)
    rows = await db.execute(
        text(f"SELECT * FROM finance.accounting_periods WHERE {where} ORDER BY period_start"),
        params,
    )
    return [dict(r._mapping) for r in rows]


async def create_accounting_period(
    db: AsyncSession, *, org_id: str, user_id: str, period_start: date, period_end: date
) -> dict:
    period_code = period_start.strftime("%Y-%m")
    try:
        result = await db.execute(
            text("""
                INSERT INTO finance.accounting_periods (
                    organization_id, period_code, fiscal_year, period_number,
                    period_start, period_end, created_by
                ) VALUES (
                    :org_id, :period_code, :fiscal_year, :period_number,
                    :period_start, :period_end, :user_id
                ) RETURNING *
            """),
            {
                "org_id": org_id,
                "period_code": period_code,
                "fiscal_year": period_start.year,
                "period_number": period_start.month,
                "period_start": period_start,
                "period_end": period_end,
                "user_id": user_id,
            },
        )
        row = result.mappings().first()
    except Exception as exc:
        raise GeneralLedgerError(f"Period '{period_code}' already exists or is invalid.", status_code=409) from exc
    return dict(row)


async def _get_period(db: AsyncSession, *, org_id: str, period_id: UUID) -> dict:
    row = await db.execute(
        text("SELECT * FROM finance.accounting_periods WHERE id = :id AND organization_id = :org_id"),
        {"id": period_id, "org_id": org_id},
    )
    r = row.mappings().first()
    if not r:
        raise GeneralLedgerError("Accounting period not found.", status_code=404)
    return dict(r)


async def soft_close_period(db: AsyncSession, *, org_id: str, user_id: str, period_id: UUID) -> dict:
    period = await _get_period(db, org_id=org_id, period_id=period_id)
    if period["status"] != "open":
        raise GeneralLedgerError(f"Period is {period['status']}, not open - cannot soft-close.")
    result = await db.execute(
        text("""
            UPDATE finance.accounting_periods
            SET status = 'soft_closed', soft_closed_at = NOW(), soft_closed_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": period_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def close_period(db: AsyncSession, *, org_id: str, user_id: str, period_id: UUID) -> dict:
    period = await _get_period(db, org_id=org_id, period_id=period_id)
    if period["status"] not in ("open", "soft_closed"):
        raise GeneralLedgerError(f"Period is {period['status']} - cannot close.")

    drafts = await db.execute(
        text("""
            SELECT id, journal_number FROM finance.journal_entries
            WHERE period_id = :period_id AND status = 'draft'
            ORDER BY journal_number
        """),
        {"period_id": period_id},
    )
    draft_rows = [dict(r._mapping) for r in drafts]
    if draft_rows:
        raise GeneralLedgerError(
            "Cannot close period while draft journal entries remain. Post or delete them first.",
            detail={"draft_journals": draft_rows},
        )

    result = await db.execute(
        text("""
            UPDATE finance.accounting_periods
            SET status = 'closed', closed_at = NOW(), closed_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": period_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def reopen_period(db: AsyncSession, *, org_id: str, user_id: str, period_id: UUID, reason: str) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reopen an accounting period.")
    period = await _get_period(db, org_id=org_id, period_id=period_id)
    if period["status"] not in ("closed", "audited", "locked"):
        raise GeneralLedgerError(f"Period is {period['status']} - nothing to reopen.")
    result = await db.execute(
        text("""
            UPDATE finance.accounting_periods
            SET status = 'open', reopened_at = NOW(), reopened_by = :user_id,
                reopen_reason = :reason, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": period_id, "user_id": user_id, "reason": reason},
    )
    return dict(result.mappings().first())


async def lock_period(db: AsyncSession, *, org_id: str, user_id: str, period_id: UUID) -> dict:
    period = await _get_period(db, org_id=org_id, period_id=period_id)
    if period["status"] not in ("closed", "audited"):
        raise GeneralLedgerError(f"Period is {period['status']} - must be closed or audited before locking.")
    result = await db.execute(
        text("""
            UPDATE finance.accounting_periods
            SET status = 'locked', locked_at = NOW(), locked_by = :user_id, updated_at = NOW()
            WHERE id = :id RETURNING *
        """),
        {"id": period_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


# ---------------------------------------------------------------------------
# Journal Entries
# ---------------------------------------------------------------------------

def _validate_lines(lines: list[dict]) -> tuple[float, float]:
    if len(lines) < 2:
        raise GeneralLedgerError("A journal entry needs at least two lines.")
    total_debit = 0.0
    total_credit = 0.0
    for i, line in enumerate(lines, start=1):
        debit = float(line.get("debit_amount") or 0)
        credit = float(line.get("credit_amount") or 0)
        if debit > 0 and credit > 0:
            raise GeneralLedgerError(f"Line {i}: a line cannot have both a debit and a credit amount.")
        if debit <= 0 and credit <= 0:
            raise GeneralLedgerError(f"Line {i}: must have a positive debit or credit amount.")
        total_debit += debit
        total_credit += credit
    if round(total_debit, 2) != round(total_credit, 2):
        raise GeneralLedgerError(
            f"Journal does not balance: total debit {total_debit:.2f} vs total credit {total_credit:.2f}."
        )
    return total_debit, total_credit


async def _assert_period_open_for_posting(db: AsyncSession, *, org_id: str, period_id: UUID) -> None:
    period = await _get_period(db, org_id=org_id, period_id=period_id)
    if period["status"] not in ("open", "soft_closed"):
        raise GeneralLedgerError(f"Cannot post into a {period['status']} accounting period.")


async def create_journal(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    period_id: UUID,
    entry_date: date,
    description: str,
    lines: list[dict],
    journal_type: str = "standard",
    source_type: Optional[str] = None,
    source_id: Optional[UUID] = None,
    reverses_journal_id: Optional[UUID] = None,
) -> dict:
    _validate_lines(lines)
    await _assert_period_open_for_posting(db, org_id=org_id, period_id=period_id)

    seq_val = (await db.execute(text("SELECT NEXTVAL('finance.journal_entry_seq')"))).scalar()
    journal_number = f"JE-{entry_date.strftime('%Y%m')}-{seq_val:06d}"

    result = await db.execute(
        text("""
            INSERT INTO finance.journal_entries (
                organization_id, journal_number, journal_type, period_id, entry_date,
                description, source_type, source_id, reverses_journal_id, created_by, updated_by
            ) VALUES (
                :org_id, :journal_number, :journal_type, :period_id, :entry_date,
                :description, :source_type, :source_id, :reverses_journal_id, :user_id, :user_id
            ) RETURNING *
        """),
        {
            "org_id": org_id,
            "journal_number": journal_number,
            "journal_type": journal_type,
            "period_id": period_id,
            "entry_date": entry_date,
            "description": description,
            "source_type": source_type,
            "source_id": source_id,
            "reverses_journal_id": reverses_journal_id,
            "user_id": user_id,
        },
    )
    journal = dict(result.mappings().first())

    await _insert_lines(db, org_id=org_id, journal_entry_id=journal["id"], lines=lines)
    return await get_journal(db, org_id=org_id, journal_id=journal["id"])


async def _insert_lines(db: AsyncSession, *, org_id: str, journal_entry_id: UUID, lines: list[dict]) -> None:
    for i, line in enumerate(lines, start=1):
        await db.execute(
            text("""
                INSERT INTO finance.journal_lines (
                    journal_entry_id, organization_id, line_number, account_id,
                    debit_amount, credit_amount, description, department_id, project_id,
                    cost_code_id, supplier_id, client_id, employee_id, currency_code
                ) VALUES (
                    :journal_entry_id, :org_id, :line_number, :account_id,
                    :debit_amount, :credit_amount, :description, :department_id, :project_id,
                    :cost_code_id, :supplier_id, :client_id, :employee_id, :currency_code
                )
            """),
            {
                "journal_entry_id": journal_entry_id,
                "org_id": org_id,
                "line_number": i,
                "account_id": line["account_id"],
                "debit_amount": line.get("debit_amount") or 0,
                "credit_amount": line.get("credit_amount") or 0,
                "description": line.get("description"),
                "department_id": line.get("department_id"),
                "project_id": line.get("project_id"),
                "cost_code_id": line.get("cost_code_id"),
                "supplier_id": line.get("supplier_id"),
                "client_id": line.get("client_id"),
                "employee_id": line.get("employee_id"),
                "currency_code": line.get("currency_code") or "USD",
            },
        )


async def get_journal(db: AsyncSession, *, org_id: str, journal_id: UUID) -> Optional[dict]:
    header = await db.execute(
        text("""
            SELECT je.*, ap.period_code, ap.status AS period_status
            FROM finance.journal_entries je
            JOIN finance.accounting_periods ap ON ap.id = je.period_id
            WHERE je.id = :id AND je.organization_id = :org_id
        """),
        {"id": journal_id, "org_id": org_id},
    )
    row = header.mappings().first()
    if not row:
        return None
    lines = await db.execute(
        text("""
            SELECT jl.*, a.account_code, a.account_name
            FROM finance.journal_lines jl
            JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            WHERE jl.journal_entry_id = :id
            ORDER BY jl.line_number
        """),
        {"id": journal_id},
    )
    result = dict(row)
    result["lines"] = [dict(r._mapping) for r in lines]
    return result


async def list_journals(
    db: AsyncSession,
    *,
    org_id: str,
    period_id: Optional[UUID] = None,
    status_filter: Optional[str] = None,
    source_type: Optional[str] = None,
    source_id: Optional[UUID] = None,
    project_id: Optional[UUID] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    filters = ["je.organization_id = :org_id"]
    params: dict = {"org_id": org_id, "limit": limit, "offset": offset}
    if period_id:
        filters.append("je.period_id = :period_id")
        params["period_id"] = period_id
    if status_filter:
        filters.append("je.status = :status")
        params["status"] = status_filter
    if source_type:
        filters.append("je.source_type = :source_type")
        params["source_type"] = source_type
    if source_id:
        filters.append("je.source_id = :source_id")
        params["source_id"] = source_id
    if project_id:
        filters.append("EXISTS (SELECT 1 FROM finance.journal_lines jl WHERE jl.journal_entry_id = je.id AND jl.project_id = :project_id)")
        params["project_id"] = project_id
    if date_from:
        filters.append("je.entry_date >= :date_from")
        params["date_from"] = date_from
    if date_to:
        filters.append("je.entry_date <= :date_to")
        params["date_to"] = date_to
    where = " AND ".join(filters)
    count_params = {k: v for k, v in params.items() if k not in ("limit", "offset")}

    total = (await db.execute(text(f"SELECT COUNT(*) FROM finance.journal_entries je WHERE {where}"), count_params)).scalar() or 0
    rows = await db.execute(
        text(f"""
            SELECT je.*, ap.period_code
            FROM finance.journal_entries je
            JOIN finance.accounting_periods ap ON ap.id = je.period_id
            WHERE {where}
            ORDER BY je.entry_date DESC, je.journal_number DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    return [dict(r._mapping) for r in rows], total


async def update_journal(db: AsyncSession, *, org_id: str, journal_id: UUID, values: dict, lines: Optional[list[dict]] = None) -> dict:
    existing = await get_journal(db, org_id=org_id, journal_id=journal_id)
    if not existing:
        raise GeneralLedgerError("Journal entry not found.", status_code=404)
    if existing["status"] != "draft":
        raise GeneralLedgerError("Only draft journal entries can be edited.", status_code=409)

    if values:
        set_clause = ", ".join(f"{k} = :{k}" for k in values)
        await db.execute(
            text(f"""
                UPDATE finance.journal_entries
                SET {set_clause}, updated_at = NOW()
                WHERE id = :id AND organization_id = :org_id
            """),
            {**values, "id": journal_id, "org_id": org_id},
        )

    if lines is not None:
        _validate_lines(lines)
        await db.execute(text("DELETE FROM finance.journal_lines WHERE journal_entry_id = :id"), {"id": journal_id})
        await _insert_lines(db, org_id=org_id, journal_entry_id=journal_id, lines=lines)

    return await get_journal(db, org_id=org_id, journal_id=journal_id)


async def delete_journal(db: AsyncSession, *, org_id: str, journal_id: UUID) -> None:
    existing = await get_journal(db, org_id=org_id, journal_id=journal_id)
    if not existing:
        raise GeneralLedgerError("Journal entry not found.", status_code=404)
    if existing["status"] != "draft":
        raise GeneralLedgerError("Only draft journal entries can be deleted. Reverse a posted journal instead.", status_code=409)
    await db.execute(text("DELETE FROM finance.journal_entries WHERE id = :id AND organization_id = :org_id"), {"id": journal_id, "org_id": org_id})


async def post_journal(db: AsyncSession, *, org_id: str, user_id: str, journal_id: UUID) -> dict:
    locked = await db.execute(
        text("SELECT * FROM finance.journal_entries WHERE id = :id AND organization_id = :org_id FOR UPDATE"),
        {"id": journal_id, "org_id": org_id},
    )
    journal = locked.mappings().first()
    if not journal:
        raise GeneralLedgerError("Journal entry not found.", status_code=404)
    if journal["status"] != "draft":
        raise GeneralLedgerError("Only draft journal entries can be posted.", status_code=409)
    if journal["total_debit"] != journal["total_credit"] or journal["total_debit"] <= 0:
        raise GeneralLedgerError(
            f"Journal does not balance: debit {journal['total_debit']} vs credit {journal['total_credit']}."
        )
    await _assert_period_open_for_posting(db, org_id=org_id, period_id=journal["period_id"])

    result = await db.execute(
        text("""
            UPDATE finance.journal_entries
            SET status = 'posted', posted_at = NOW(), posted_by = :user_id, updated_by = :user_id, updated_at = NOW()
            WHERE id = :id
            RETURNING *
        """),
        {"id": journal_id, "user_id": user_id},
    )
    return dict(result.mappings().first())


async def reverse_journal(
    db: AsyncSession, *, org_id: str, user_id: str, journal_id: UUID, reversal_date: date, reason: str
) -> dict:
    if not reason or not reason.strip():
        raise GeneralLedgerError("A reason is required to reverse a journal entry.")

    original = await get_journal(db, org_id=org_id, journal_id=journal_id)
    if not original:
        raise GeneralLedgerError("Journal entry not found.", status_code=404)
    if original["status"] != "posted":
        raise GeneralLedgerError("Only posted journal entries can be reversed.", status_code=409)
    if original.get("reversed_by_journal_id"):
        raise GeneralLedgerError("Journal entry has already been reversed.", status_code=409)

    period_row = await db.execute(
        text("SELECT id FROM finance.accounting_periods WHERE organization_id = :org_id AND :d BETWEEN period_start AND period_end"),
        {"org_id": org_id, "d": reversal_date},
    )
    period = period_row.mappings().first()
    if not period:
        raise GeneralLedgerError("No accounting period covers the reversal date. Create one first.", status_code=422)

    reversal_lines = [
        {
            "account_id": line["account_id"],
            "debit_amount": line["credit_amount"],
            "credit_amount": line["debit_amount"],
            "description": line.get("description"),
            "department_id": line.get("department_id"),
            "project_id": line.get("project_id"),
            "cost_code_id": line.get("cost_code_id"),
            "supplier_id": line.get("supplier_id"),
            "client_id": line.get("client_id"),
            "employee_id": line.get("employee_id"),
            "currency_code": line.get("currency_code"),
        }
        for line in original["lines"]
    ]

    reversal = await create_journal(
        db,
        org_id=org_id,
        user_id=user_id,
        period_id=period["id"],
        entry_date=reversal_date,
        description=f"Reversal of {original['journal_number']}: {reason}",
        lines=reversal_lines,
        journal_type="reversal",
        source_type="journal_reversal",
        source_id=journal_id,
        reverses_journal_id=journal_id,
    )
    reversal = await post_journal(db, org_id=org_id, user_id=user_id, journal_id=reversal["id"])

    # The only field a posted header may still change is reversed_by_journal_id
    # (see finance.enforce_journal_entry_rules in migration 182) - this is that
    # sanctioned write, linking the original to the reversal that supersedes it.
    await db.execute(
        text("UPDATE finance.journal_entries SET reversed_by_journal_id = :reversal_id WHERE id = :id"),
        {"reversal_id": reversal["id"], "id": journal_id},
    )
    return await get_journal(db, org_id=org_id, journal_id=reversal["id"])
