"""Payroll phase 2: bank payment files and monthly PAYE / NSSA return schedules.

ZIMRA (TaRMS), NSSA and every bank publish their own upload templates and
change them, so nothing here hard-codes a format. A *layout* is a list of
columns picked from the field catalogue below (plus constant columns), with
the header text, separator and date format the template wants. Three
built-in layouts give a sensible start; orgs save their own.

Amounts per currency follow exactly the split the posting used
(payroll_service.split_amount), so a schedule's totals match the statutory
liabilities and the cashbook to the cent.

The pure part (field catalogue, per-currency figures, rendering) is
unit-tested; the DB part reads posted / approved runs only.
"""
from __future__ import annotations

import csv
import hashlib
import io
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Mapping, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance.payroll_engine import money
from app.services.finance.payroll_service import PayrollServiceError, split_amount

ZERO = Decimal("0")
KINDS = ("bank", "paye", "nssa")
DELIMITERS = {",": ",", ";": ";", "|": "|", "tab": "\t"}
DATE_FORMATS = {
    "YYYY-MM-DD": "%Y-%m-%d",
    "DD/MM/YYYY": "%d/%m/%Y",
    "DD-MM-YYYY": "%d-%m-%Y",
    "MM/DD/YYYY": "%m/%d/%Y",
    "YYYYMMDD": "%Y%m%d",
    "DDMMYYYY": "%d%m%Y",
}
# Accounts added or changed this recently are flagged on the bank file.
RECENT_CHANGE_DAYS = 30


# ---------------------------------------------------------------------------
# Field catalogue
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class FieldDef:
    key: str
    label: str
    type: str  # text | money | date


def _fields(*defs: tuple[str, str, str]) -> dict[str, FieldDef]:
    return {key: FieldDef(key, label, ftype) for key, label, ftype in defs}


_PERSON = (
    ("employee_number", "Employee number", "text"),
    ("employee_name", "Full name", "text"),
    ("surname", "Surname", "text"),
    ("first_names", "First names", "text"),
    ("national_id", "National ID", "text"),
    ("date_of_birth", "Date of birth", "date"),
    ("start_date", "Start date", "date"),
    ("end_date", "End date", "date"),
)

FIELDS: dict[str, dict[str, FieldDef]] = {
    "bank": _fields(
        *_PERSON[:5],
        ("bank_name", "Bank", "text"),
        ("branch_code", "Branch code", "text"),
        ("branch_name", "Branch name", "text"),
        ("account_number", "Account number", "text"),
        ("account_name", "Account name", "text"),
        ("amount", "Amount", "money"),
        ("currency", "Currency", "text"),
        ("payment_date", "Payment date", "date"),
        ("reference", "Reference (run number)", "text"),
        ("narrative", "Narrative", "text"),
    ),
    "paye": _fields(
        *_PERSON,
        ("tax_number", "Tax number (TIN)", "text"),
        ("currency", "Currency", "text"),
        ("gross_earnings", "Gross earnings", "money"),
        ("bonus", "Bonus", "money"),
        ("bonus_exempt", "Tax-free bonus", "money"),
        ("pre_tax_deductions", "Pre-tax deductions (pension etc.)", "money"),
        ("nssa_employee", "NSSA (employee)", "money"),
        ("taxable_income", "Taxable income", "money"),
        ("paye_before_credits", "PAYE before credits", "money"),
        ("tax_credits", "Tax credits", "money"),
        ("paye", "PAYE", "money"),
        ("aids_levy", "AIDS levy", "money"),
        ("total_tax", "PAYE + AIDS levy", "money"),
        ("net_pay", "Net pay", "money"),
        ("period_end", "Month end", "date"),
    ),
    "nssa": _fields(
        *_PERSON,
        ("nssa_number", "NSSA number (SSN)", "text"),
        ("currency", "Currency", "text"),
        ("basic_salary", "Basic salary", "money"),
        ("insurable_earnings", "Insurable earnings (before ceiling)", "money"),
        ("insurable_capped", "Insurable earnings (capped at ceiling)", "money"),
        ("nssa_employee", "Employee contribution", "money"),
        ("nssa_employer", "Employer contribution", "money"),
        ("nssa_total", "Total contribution", "money"),
        ("period_end", "Month end", "date"),
    ),
}

# Column whose sum is the file's total (logged, and checked on bank files).
TOTAL_FIELD = {"bank": "amount", "paye": "total_tax", "nssa": "nssa_total"}


def _cols(*pairs: tuple[str, str]) -> list[dict[str, str]]:
    return [{"field": f, "header": h} for f, h in pairs]


BUILTIN_LAYOUTS: dict[str, dict[str, Any]] = {
    "bank": {
        "id": "builtin:bank", "kind": "bank", "name": "Standard bank file (CSV)", "is_builtin": True,
        "description": "Generic layout. Match it to your bank's bulk-payment template before the first upload.",
        "delimiter": ",", "include_header": True, "date_format": "DD/MM/YYYY",
        "columns": _cols(("employee_number", "Employee No"), ("account_name", "Beneficiary"), ("bank_name", "Bank"),
                         ("branch_code", "Branch Code"), ("account_number", "Account Number"), ("amount", "Amount"),
                         ("currency", "Currency"), ("reference", "Reference"), ("payment_date", "Payment Date")),
    },
    "paye": {
        "id": "builtin:paye", "kind": "paye", "name": "PAYE schedule (per employee)", "is_builtin": True,
        "description": "Per-employee PAYE for the month. Arrange the columns to match the TaRMS return template.",
        "delimiter": ",", "include_header": True, "date_format": "DD/MM/YYYY",
        "columns": _cols(("employee_number", "Employee No"), ("surname", "Surname"), ("first_names", "First Names"),
                         ("national_id", "National ID"), ("tax_number", "TIN"), ("gross_earnings", "Gross Earnings"),
                         ("bonus_exempt", "Exempt Bonus"), ("pre_tax_deductions", "Allowable Deductions"),
                         ("nssa_employee", "NSSA"), ("taxable_income", "Taxable Income"),
                         ("paye_before_credits", "Tax Charged"), ("tax_credits", "Credits"), ("paye", "PAYE"),
                         ("aids_levy", "AIDS Levy"), ("total_tax", "Total Tax")),
    },
    "nssa": {
        "id": "builtin:nssa", "kind": "nssa", "name": "NSSA P4 schedule (per employee)", "is_builtin": True,
        "description": "Per-employee NSSA contributions for the month. Match the P4 template on the NSSA portal.",
        "delimiter": ",", "include_header": True, "date_format": "DD/MM/YYYY",
        "columns": _cols(("nssa_number", "SSN"), ("national_id", "National ID"), ("surname", "Surname"),
                         ("first_names", "First Names"), ("date_of_birth", "Date of Birth"),
                         ("start_date", "Start Date"), ("end_date", "End Date"), ("employee_number", "Works No"),
                         ("basic_salary", "Basic Salary"), ("insurable_capped", "Insurable Earnings"),
                         ("nssa_employee", "Employee Contribution"), ("nssa_employer", "Employer Contribution"),
                         ("nssa_total", "Total Contribution")),
    },
}


def validate_layout(kind: str, columns: Any, delimiter: str, date_format: str) -> list[dict[str, str]]:
    """Normalised column list, or PayrollServiceError(422)."""
    if kind not in KINDS:
        raise PayrollServiceError(422, f"Unknown export kind '{kind}'.")
    if delimiter not in DELIMITERS:
        raise PayrollServiceError(422, "Separator must be one of , ; | or tab.")
    if date_format not in DATE_FORMATS:
        raise PayrollServiceError(422, f"Date format must be one of {', '.join(DATE_FORMATS)}.")
    if not isinstance(columns, list) or not columns:
        raise PayrollServiceError(422, "A layout needs at least one column.")
    if len(columns) > 60:
        raise PayrollServiceError(422, "A layout can have at most 60 columns.")
    out: list[dict[str, str]] = []
    for i, col in enumerate(columns, 1):
        if not isinstance(col, Mapping):
            raise PayrollServiceError(422, f"Column {i} is not valid.")
        field_key = str(col.get("field") or "").strip()
        header = str(col.get("header") or "").strip()[:80]
        if field_key == "constant":
            value = str(col.get("value") or "").strip()[:80]
            out.append({"field": "constant", "value": value, "header": header})
            continue
        if field_key not in FIELDS[kind]:
            raise PayrollServiceError(422, f"Column {i}: '{field_key}' is not a {kind} field.")
        out.append({"field": field_key, "header": header or FIELDS[kind][field_key].label})
    if not any(c["field"] == TOTAL_FIELD[kind] for c in out) and kind == "bank":
        raise PayrollServiceError(422, "A bank file layout must include the Amount column.")
    return out


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def split_name(full_name: Optional[str]) -> tuple[str, str]:
    """(surname, first names). Names are held as one field; the last word is
    taken as the surname."""
    parts = (full_name or "").split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[-1], " ".join(parts[:-1])


def mask_account(number: Optional[str]) -> Optional[str]:
    if not number:
        return number
    tail = number.strip()[-4:]
    return f"••••{tail}"


_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def format_value(value: Any, ftype: str, date_format: str) -> str:
    if value is None or value == "":
        return ""
    if ftype == "money":
        return f"{money(Decimal(str(value))):.2f}"
    if ftype == "date":
        if isinstance(value, datetime):
            value = value.date()
        if isinstance(value, date):
            return value.strftime(DATE_FORMATS[date_format])
        return str(value)
    out = str(value).replace("\r", " ").replace("\n", " ").strip()
    # A name typed as "=HYPERLINK(...)" must not run as a formula when the
    # file is opened in a spreadsheet.
    if out.startswith(_FORMULA_START):
        out = "'" + out
    return out


def render_csv(layout: Mapping[str, Any], kind: str, rows: list[Mapping[str, Any]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=DELIMITERS[layout["delimiter"]], lineterminator="\r\n",
                        quoting=csv.QUOTE_MINIMAL)
    columns = layout["columns"]
    if layout.get("include_header", True):
        writer.writerow([c.get("header") or "" for c in columns])
    for row in rows:
        out = []
        for c in columns:
            if c["field"] == "constant":
                out.append(c.get("value") or "")
            else:
                fdef = FIELDS[kind][c["field"]]
                out.append(format_value(row.get(c["field"]), fdef.type, layout["date_format"]))
        writer.writerow(out)
    return buffer.getvalue()


def sha256(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Per-currency figures for one payroll item
# ---------------------------------------------------------------------------

_SPLIT = {
    # report key: (whole-salary column, second-currency column)
    "gross_earnings": ("total_earnings", "gross_secondary"),
    "paye": ("paye_amount", "paye_secondary"),
    "aids_levy": ("aids_levy_amount", "aids_levy_secondary"),
    "nssa_employee": ("nssa_employee_amount", "nssa_employee_secondary"),
    "nssa_employer": ("nssa_employer_amount", "nssa_employer_secondary"),
    "net_pay": ("net_pay", "net_pay_secondary"),
}
_PROPORTIONAL = {
    # report key: (whole-salary column, key in a calc_trace portion)
    "taxable_income": ("taxable_gross", "taxable_income"),
    "pre_tax_deductions": ("pre_tax_deductions", "pre_tax_deductions"),
    "bonus": ("bonus_amount", None),
    "bonus_exempt": ("bonus_exempt_amount", "bonus_exempt"),
    "paye_before_credits": ("paye_before_credits", "paye_before_credits"),
    "tax_credits": ("tax_credits_amount", "tax_credits"),
    "insurable_earnings": ("nssa_insurable", "nssa_insurable"),
    "basic_salary": ("basic_amount", None),
}


def _dec(value: Any) -> Decimal:
    return Decimal(str(value)) if value is not None else ZERO


def currency_figures(item: Mapping[str, Any], currency: str) -> Optional[dict[str, Decimal]]:
    """The part of one payroll item paid / owed in `currency`, or None if the
    item has nothing in that currency.

    Amounts that were split on posting (gross, PAYE, AIDS levy, NSSA, net)
    use the same split, so they reconcile to the liabilities and cashbook.
    Figures that are not stored per currency (taxable income, credits...)
    come from the engine's per-currency portion when each currency was taxed
    on its own tables, otherwise pro rata to gross."""
    base_currency = (item.get("base_currency") or "USD").upper()
    secondary = (item.get("secondary_currency") or "").upper() or None
    fx = _dec(item.get("exchange_rate")) or None
    currency = currency.upper()
    if currency == base_currency:
        pick = 0
    elif secondary and currency == secondary and fx:
        pick = 1
    else:
        return None

    out: dict[str, Decimal] = {}
    for key, (total_col, sec_col) in _SPLIT.items():
        base_part, sec_part = split_amount(_dec(item.get(total_col)), _dec(item.get(sec_col)), fx)
        out[key] = (base_part, sec_part)[pick]

    whole_gross = _dec(item.get("total_earnings"))
    factor = (out["gross_earnings"] / whole_gross) if whole_gross else ZERO
    portion = None
    trace = item.get("calc_trace") or {}
    if isinstance(trace, Mapping) and trace.get("method") == "separate_tables":
        portion = next((p for p in trace.get("portions") or [] if (p.get("currency") or "").upper() == currency), None)
    for key, (col, portion_key) in _PROPORTIONAL.items():
        if portion is not None and portion_key and portion.get(portion_key) is not None:
            out[key] = money(_dec(portion[portion_key]))
        else:
            out[key] = money(_dec(item.get(col)) * factor)

    if pick == 1 and out["gross_earnings"] == 0 and out["net_pay"] == 0:
        return None
    if pick == 0 and out["gross_earnings"] == 0 and out["net_pay"] == 0 and secondary:
        return None
    return out


def add_figures(target: dict[str, Decimal], figures: Mapping[str, Decimal]) -> None:
    for key, value in figures.items():
        target[key] = target.get(key, ZERO) + value


def nssa_ceiling(table: Any) -> Optional[Decimal]:
    """Monthly insurable-earnings ceiling from an NSSA rate table: the upper
    bound of the last band that charges a rate. None if uncapped."""
    if table is None:
        return None
    charged = [b for b in table.bands if b.rate_pct and b.upper_bound is not None]
    if not charged:
        return None
    ceiling = max(b.upper_bound for b in charged)
    if getattr(table, "period_basis", "monthly") == "annual":
        ceiling = ceiling / 12
    return money(ceiling)


# ---------------------------------------------------------------------------
# Layouts (DB)
# ---------------------------------------------------------------------------

def _layout_row(row: Mapping[str, Any]) -> dict[str, Any]:
    out = dict(row)
    out["id"] = str(out["id"])
    out["is_builtin"] = False
    return out


async def list_layouts(db: AsyncSession, org_id: str, kind: Optional[str] = None) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"org_id": org_id}
    where = "organization_id = :org_id AND is_active = true"
    if kind:
        where += " AND kind = :kind"
        params["kind"] = kind
    rows = (await db.execute(
        text(f"""
            SELECT id, kind, name, description, delimiter, include_header, date_format, columns, updated_at
            FROM finance.payroll_export_layouts WHERE {where} ORDER BY kind, name
        """),
        params,
    )).mappings().all()
    builtins = [dict(v) for k, v in BUILTIN_LAYOUTS.items() if not kind or k == kind]
    return builtins + [_layout_row(r) for r in rows]


async def get_layout(db: AsyncSession, org_id: str, kind: str, layout_id: Optional[str]) -> dict[str, Any]:
    if not layout_id or layout_id == f"builtin:{kind}":
        return dict(BUILTIN_LAYOUTS[kind])
    if layout_id.startswith("builtin:"):
        raise PayrollServiceError(422, f"Layout '{layout_id}' is not a {kind} layout.")
    try:
        layout_id = str(UUID(layout_id))
    except ValueError as exc:
        raise PayrollServiceError(404, "Export layout not found.") from exc
    row = (await db.execute(
        text("""
            SELECT id, kind, name, description, delimiter, include_header, date_format, columns
            FROM finance.payroll_export_layouts
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_active = true
        """),
        {"id": layout_id, "org_id": org_id},
    )).mappings().first()
    if not row:
        raise PayrollServiceError(404, "Export layout not found.")
    if row["kind"] != kind:
        raise PayrollServiceError(422, f"'{row['name']}' is a {row['kind']} layout, not {kind}.")
    return _layout_row(row)


# ---------------------------------------------------------------------------
# Payment accounts (DB)
# ---------------------------------------------------------------------------

async def list_payment_accounts(
    db: AsyncSession, org_id: str, employee_id: Optional[str] = None, include_ended: bool = False
) -> list[dict[str, Any]]:
    params: dict[str, Any] = {"org_id": org_id}
    where = "a.organization_id = :org_id"
    if employee_id:
        where += " AND a.employee_id = CAST(:employee_id AS uuid)"
        params["employee_id"] = employee_id
    if not include_ended:
        where += " AND a.is_active = true"
    rows = (await db.execute(
        text(f"""
            SELECT a.id, a.employee_id, e.employee_name, e.employee_number, a.currency, a.method,
                   a.bank_name, a.branch_code, a.branch_name, a.account_number, a.account_name,
                   a.mobile_number, a.effective_from, a.is_active, a.created_at, a.ended_at, a.end_reason,
                   cu.full_name AS created_by_name
            FROM finance.employee_payment_accounts a
            JOIN hr.employees e ON e.id = a.employee_id
            LEFT JOIN core.users cu ON cu.id = a.created_by
            WHERE {where}
            ORDER BY e.employee_name, a.currency, a.created_at DESC
        """),
        params,
    )).mappings().all()
    out = []
    for r in rows:
        d = dict(r)
        # Full numbers only ever leave the server inside a bank file.
        d["account_number"] = mask_account(d["account_number"])
        d["mobile_number"] = mask_account(d["mobile_number"])
        out.append(d)
    return out


async def add_payment_account(
    db: AsyncSession, *, org_id: str, user_id: Optional[str], employee_id: str, values: Mapping[str, Any]
) -> tuple[str, bool]:
    """Starts a new payment account for (employee, currency), ending the
    current one in the same transaction. Never edits in place.
    Returns (new id, whether an earlier account was ended)."""
    exists = (await db.execute(
        text("SELECT 1 FROM hr.employees WHERE id = CAST(:id AS uuid) AND organization_id = :org_id"),
        {"id": employee_id, "org_id": org_id},
    )).first()
    if not exists:
        raise PayrollServiceError(404, "Employee not found.")
    currency = str(values["currency"]).upper()
    ended = await db.execute(
        text("""
            UPDATE finance.employee_payment_accounts
            SET is_active = false, ended_at = NOW(), ended_by = :user_id,
                end_reason = 'Replaced by a new account', updated_at = NOW()
            WHERE organization_id = :org_id AND employee_id = CAST(:employee_id AS uuid)
              AND currency = :currency AND is_active = true
        """),
        {"org_id": org_id, "employee_id": employee_id, "currency": currency, "user_id": user_id},
    )
    new_id = (await db.execute(
        text("""
            INSERT INTO finance.employee_payment_accounts (
                organization_id, employee_id, currency, method, bank_name, branch_code, branch_name,
                account_number, account_name, mobile_number, effective_from, created_by
            ) VALUES (
                :org_id, CAST(:employee_id AS uuid), :currency, :method, :bank_name, :branch_code, :branch_name,
                :account_number, :account_name, :mobile_number, COALESCE(:effective_from, CURRENT_DATE), :user_id
            ) RETURNING id
        """),
        {
            "org_id": org_id, "employee_id": employee_id, "currency": currency, "user_id": user_id,
            "method": values["method"],
            "bank_name": values.get("bank_name"), "branch_code": values.get("branch_code"),
            "branch_name": values.get("branch_name"), "account_number": values.get("account_number"),
            "account_name": values.get("account_name"), "mobile_number": values.get("mobile_number"),
            "effective_from": values.get("effective_from"),
        },
    )).scalar_one()
    return str(new_id), bool(ended.rowcount)


async def end_payment_account(db: AsyncSession, *, org_id: str, user_id: Optional[str], account_id: str, reason: str) -> None:
    result = await db.execute(
        text("""
            UPDATE finance.employee_payment_accounts
            SET is_active = false, ended_at = NOW(), ended_by = :user_id, end_reason = :reason, updated_at = NOW()
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_active = true
        """),
        {"id": account_id, "org_id": org_id, "user_id": user_id, "reason": reason},
    )
    if not result.rowcount:
        raise PayrollServiceError(404, "Active payment account not found.")


# ---------------------------------------------------------------------------
# Bank file
# ---------------------------------------------------------------------------

_ITEM_COLUMNS = """
    pi.id, pi.employee_id, pi.total_earnings, pi.gross_secondary, pi.taxable_gross, pi.pre_tax_deductions,
    pi.bonus_amount, pi.bonus_exempt_amount, pi.paye_before_credits, pi.tax_credits_amount, pi.nssa_insurable,
    pi.paye_amount, pi.paye_secondary, pi.aids_levy_amount, pi.aids_levy_secondary,
    pi.nssa_employee_amount, pi.nssa_employee_secondary, pi.nssa_employer_amount, pi.nssa_employer_secondary,
    pi.net_pay, pi.net_pay_secondary, pi.exchange_rate, pi.secondary_currency, pi.calc_trace,
    pr.base_currency, pr.payment_date, pr.run_number, pr.id AS run_id,
    COALESCE((SELECT SUM(l.amount) FROM finance.payroll_item_lines l
              WHERE l.payroll_item_id = pi.id AND l.code = 'BASIC'), 0) AS basic_amount,
    e.employee_name, e.employee_number, e.national_id, e.date_of_birth, e.start_date, e.end_date,
    pp.tax_number, pp.nssa_number
"""


def _person(row: Mapping[str, Any]) -> dict[str, Any]:
    surname, first = split_name(row.get("employee_name"))
    return {
        "employee_id": str(row["employee_id"]),
        "employee_number": row.get("employee_number"),
        "employee_name": row.get("employee_name"),
        "surname": surname,
        "first_names": first,
        "national_id": row.get("national_id"),
        "date_of_birth": row.get("date_of_birth"),
        "start_date": row.get("start_date"),
        "end_date": row.get("end_date"),
    }


async def lock_run_for_export(db: AsyncSession, org_id: str, run_id: str) -> None:
    """Row-locks the run until the transaction ends, so bank files for one
    run are produced one after another and each sees the export logged by
    the one before."""
    locked = (await db.execute(
        text("""
            SELECT id FROM finance.payroll_runs
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_deleted = false
            FOR UPDATE
        """),
        {"id": run_id, "org_id": org_id},
    )).first()
    if not locked:
        raise PayrollServiceError(404, "Payroll run not found.")


async def _run_header(db: AsyncSession, org_id: str, run_id: str) -> Mapping[str, Any]:
    run = (await db.execute(
        text("""
            SELECT id, run_number, status, period_start, period_end, payment_date, base_currency, secondary_currency
            FROM finance.payroll_runs
            WHERE id = CAST(:id AS uuid) AND organization_id = :org_id AND is_deleted = false
        """),
        {"id": run_id, "org_id": org_id},
    )).mappings().first()
    if not run:
        raise PayrollServiceError(404, "Payroll run not found.")
    return run


async def bank_file_preview(db: AsyncSession, org_id: str, run_id: str, currency: str) -> dict[str, Any]:
    """Rows for a bank file plus everything that stops or should give pause:
    employees with no account in this currency (blocking), people paid in
    cash or by mobile money (listed, not in the file), accounts changed in the
    last 30 days, and earlier exports of the same run and currency."""
    from app.services.finance.payroll_service import cash_postings

    run = await _run_header(db, org_id, run_id)
    if run["status"] not in ("approved", "posted"):
        raise PayrollServiceError(409, f"Run {run['run_number']} is '{run['status']}': approve it before producing a bank file.")
    currency = currency.upper()
    base_currency = (run["base_currency"] or "USD").upper()
    if currency not in {base_currency, (run["secondary_currency"] or "").upper()}:
        raise PayrollServiceError(422, f"Run {run['run_number']} pays nothing in {currency}.")

    items = (await db.execute(
        text(f"""
            SELECT {_ITEM_COLUMNS},
                   a.id AS account_id, a.method, a.bank_name, a.branch_code, a.branch_name, a.account_number,
                   a.account_name, a.mobile_number, a.created_at AS account_created_at
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
            JOIN hr.employees e ON e.id = pi.employee_id
            LEFT JOIN finance.employee_pay_profiles pp
              ON pp.employee_id = pi.employee_id AND pp.organization_id = pi.organization_id
            LEFT JOIN finance.employee_payment_accounts a
              ON a.employee_id = pi.employee_id AND a.organization_id = pi.organization_id
             AND a.currency = :currency AND a.is_active = true
            WHERE pi.payroll_run_id = CAST(:run_id AS uuid) AND pi.organization_id = :org_id
            ORDER BY e.employee_name
        """),
        {"run_id": run_id, "org_id": org_id, "currency": currency},
    )).mappings().all()

    narrative = f"Salary {run['period_end']:%b %Y}"
    rows: list[dict[str, Any]] = []
    cash: list[dict[str, Any]] = []
    mobile: list[dict[str, Any]] = []
    missing: list[str] = []
    recent: list[dict[str, Any]] = []
    cutoff = datetime.now(tz=None).date() - timedelta(days=RECENT_CHANGE_DAYS)
    for it in items:
        figures = currency_figures(it, currency)
        amount = figures["net_pay"] if figures else ZERO
        if amount <= 0:
            continue
        person = _person(it)
        if not it["account_id"]:
            missing.append(it["employee_name"])
            continue
        entry = {**person, "amount": amount, "currency": currency, "method": it["method"]}
        if it["method"] == "cash":
            cash.append(entry)
            continue
        if it["method"] == "mobile_money":
            mobile.append({**entry, "mobile_number": mask_account(it["mobile_number"])})
            continue
        created = it["account_created_at"]
        if created is not None and created.date() >= cutoff:
            recent.append({"employee_name": it["employee_name"], "changed_on": created.date().isoformat(),
                           "account_number": mask_account(it["account_number"])})
        rows.append({
            **entry,
            "bank_name": it["bank_name"], "branch_code": it["branch_code"], "branch_name": it["branch_name"],
            "account_number": it["account_number"], "account_name": it["account_name"] or it["employee_name"],
            "payment_date": run["payment_date"], "reference": run["run_number"], "narrative": narrative,
        })

    base_cash, secondary_cash = await cash_postings(db, org_id, run_id)
    expected = base_cash if currency == base_currency else secondary_cash
    bank_total = money(sum((r["amount"] for r in rows), ZERO))
    cash_total = money(sum((r["amount"] for r in cash), ZERO))
    mobile_total = money(sum((r["amount"] for r in mobile), ZERO))
    missing_total = expected - bank_total - cash_total - mobile_total

    problems = []
    if missing:
        problems.append(f"No {currency} payment account for: {', '.join(missing)}. Add one before producing the file.")
    if not missing and money(missing_total) != 0:
        problems.append(f"File totals {bank_total + cash_total + mobile_total} {currency} but the run pays {expected} {currency}.")

    previous = (await db.execute(
        text("""
            SELECT x.generated_at, x.file_name, x.total_amount, u.full_name AS generated_by_name
            FROM finance.payroll_exports x LEFT JOIN core.users u ON u.id = x.generated_by
            WHERE x.organization_id = :org_id AND x.kind = 'bank'
              AND x.payroll_run_id = CAST(:run_id AS uuid) AND x.currency = :currency
            ORDER BY x.generated_at DESC
        """),
        {"org_id": org_id, "run_id": run_id, "currency": currency},
    )).mappings().all()

    return {
        "run": {k: (str(v) if k == "id" else v) for k, v in dict(run).items()},
        "currency": currency,
        "rows": rows,
        "cash": cash,
        "mobile_money": mobile,
        "totals": {"bank": bank_total, "cash": cash_total, "mobile_money": mobile_total, "run": expected},
        "problems": problems,
        "recent_changes": recent,
        "previous_exports": [dict(p) for p in previous],
    }


def preview_for_client(preview: dict[str, Any]) -> dict[str, Any]:
    """The preview as shown on screen: account numbers masked."""
    out = dict(preview)
    out["rows"] = [{**r, "account_number": mask_account(r.get("account_number"))} for r in preview["rows"]]
    return out


# ---------------------------------------------------------------------------
# Monthly PAYE / NSSA schedules
# ---------------------------------------------------------------------------

async def returns_preview(db: AsyncSession, org_id: str, kind: str, month: date, currency: str) -> dict[str, Any]:
    """Per-employee schedule for one month and currency, from posted runs
    whose payment date falls in the month (tax is due when pay is paid),
    with the totals checked against the statutory liabilities."""
    from app.services.finance.payroll_service import load_tables
    from app.services.finance.tax_rates import NoRateTableError

    if kind not in ("paye", "nssa"):
        raise PayrollServiceError(422, "Returns are 'paye' or 'nssa'.")
    currency = currency.upper()
    month_end = (month.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    items = (await db.execute(
        text(f"""
            SELECT {_ITEM_COLUMNS}
            FROM finance.payroll_items pi
            JOIN finance.payroll_runs pr ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
            JOIN hr.employees e ON e.id = pi.employee_id
            LEFT JOIN finance.employee_pay_profiles pp
              ON pp.employee_id = pi.employee_id AND pp.organization_id = pi.organization_id
            WHERE pi.organization_id = :org_id AND pr.status = 'posted' AND pr.is_deleted = false
              AND pr.payment_date BETWEEN :month_start AND :month_end
            ORDER BY e.employee_name, pr.payment_date
        """),
        {"org_id": org_id, "month_start": month, "month_end": month_end},
    )).mappings().all()

    by_employee: dict[str, dict[str, Any]] = {}
    runs: set[str] = set()
    for it in items:
        figures = currency_figures(it, currency)
        if figures is None:
            continue
        runs.add(it["run_number"])
        key = str(it["employee_id"])
        entry = by_employee.setdefault(key, {
            **_person(it), "tax_number": it.get("tax_number"), "nssa_number": it.get("nssa_number"),
            "currency": currency, "period_end": month_end, "_sums": {},
        })
        add_figures(entry["_sums"], figures)

    ceiling = None
    if kind == "nssa":
        try:
            tables = await load_tables(db, org_id, currency, month_end)
            ceiling = nssa_ceiling(tables.nssa_employee)
        except NoRateTableError:
            ceiling = None

    rows = []
    for entry in by_employee.values():
        sums = {k: money(v) for k, v in entry.pop("_sums").items()}
        row = {**entry, **sums}
        row["total_tax"] = money(sums["paye"] + sums["aids_levy"])
        row["nssa_total"] = money(sums["nssa_employee"] + sums["nssa_employer"])
        row["insurable_capped"] = min(sums["insurable_earnings"], ceiling) if ceiling is not None else sums["insurable_earnings"]
        if kind == "paye" and not (row["paye"] or row["aids_levy"] or row["gross_earnings"]):
            continue
        if kind == "nssa" and not (row["nssa_employee"] or row["nssa_employer"]):
            continue
        rows.append(row)

    id_field, id_label = ("tax_number", "tax number") if kind == "paye" else ("nssa_number", "NSSA number")
    warnings = []
    no_id = [r["employee_name"] for r in rows if not (r.get(id_field) or "").strip()]
    if no_id:
        warnings.append(f"No {id_label} for: {', '.join(no_id)}. Add it on the pay profile.")
    no_nid = [r["employee_name"] for r in rows if not (r.get("national_id") or "").strip()]
    if no_nid:
        warnings.append(f"No national ID for: {', '.join(no_nid)}. Add it on the employee record.")
    unposted = (await db.execute(
        text("""
            SELECT run_number, status FROM finance.payroll_runs
            WHERE organization_id = :org_id AND is_deleted = false AND status IN ('draft', 'approved')
              AND payment_date BETWEEN :month_start AND :month_end
            ORDER BY run_number
        """),
        {"org_id": org_id, "month_start": month, "month_end": month_end},
    )).mappings().all()
    if unposted:
        warnings.append("Not included (not posted yet): " + ", ".join(f"{r['run_number']} ({r['status']})" for r in unposted) + ".")

    liability_types = ("paye", "aids_levy") if kind == "paye" else ("nssa_employee", "nssa_employer")
    liabilities = (await db.execute(
        text("""
            SELECT liability_type, gross_accrued, settled_amount, outstanding_amount, status, due_date,
                   filing_reference, filed_at
            FROM finance.statutory_liabilities
            WHERE organization_id = :org_id AND is_deleted = false AND currency = :currency
              AND period_start = :month_start AND liability_type = ANY(CAST(:types AS text[]))
        """),
        {"org_id": org_id, "currency": currency, "month_start": month, "types": list(liability_types)},
    )).mappings().all()
    by_type = {r["liability_type"]: dict(r) for r in liabilities}
    schedule_key = {"paye": "paye", "aids_levy": "aids_levy", "nssa_employee": "nssa_employee", "nssa_employer": "nssa_employer"}
    reconciliation = []
    for lt in liability_types:
        schedule_total = money(sum((r[schedule_key[lt]] for r in rows), ZERO))
        liability = by_type.get(lt)
        accrued = money(_dec(liability["gross_accrued"])) if liability else ZERO
        reconciliation.append({
            "liability_type": lt,
            "schedule_total": schedule_total,
            "liability_accrued": accrued,
            "difference": money(schedule_total - accrued),
            "status": liability["status"] if liability else None,
            "due_date": liability["due_date"] if liability else None,
            "filing_reference": liability["filing_reference"] if liability else None,
            "outstanding": money(_dec(liability["outstanding_amount"])) if liability else ZERO,
        })
        if schedule_total != accrued:
            warnings.append(
                f"{lt.replace('_', ' ').upper()} schedule {schedule_total} {currency} differs from the accrued "
                f"liability {accrued} {currency}. Recompute statutory accruals or check for non-payroll entries."
            )

    total_field = TOTAL_FIELD[kind]
    return {
        "kind": kind,
        "month": month.isoformat()[:7],
        "currency": currency,
        "runs": sorted(runs),
        "rows": rows,
        "total": money(sum((r[total_field] for r in rows), ZERO)),
        "nssa_ceiling": ceiling,
        "warnings": warnings,
        "reconciliation": reconciliation,
    }


# ---------------------------------------------------------------------------
# Producing a file
# ---------------------------------------------------------------------------

async def log_export(
    db: AsyncSession, *, org_id: str, user_id: Optional[str], kind: str, layout: Mapping[str, Any],
    currency: str, file_name: str, rows: int, total: Decimal, content: str,
    run_id: Optional[str] = None, month: Optional[date] = None, warnings: Optional[list] = None,
) -> str:
    import json

    layout_id = layout["id"] if not str(layout["id"]).startswith("builtin:") else None
    export_id = (await db.execute(
        text("""
            INSERT INTO finance.payroll_exports (
                organization_id, kind, layout_id, layout_name, payroll_run_id, period_month, currency,
                file_name, row_count, total_amount, content_sha256, warnings, generated_by
            ) VALUES (
                :org_id, :kind, CAST(:layout_id AS uuid), :layout_name, CAST(:run_id AS uuid), :month, :currency,
                :file_name, :rows, :total, :sha, CAST(:warnings AS jsonb), :user_id
            ) RETURNING id
        """),
        {
            "org_id": org_id, "kind": kind, "layout_id": layout_id, "layout_name": layout["name"],
            "run_id": run_id, "month": month, "currency": currency, "file_name": file_name, "rows": rows,
            "total": total, "sha": sha256(content), "warnings": json.dumps(warnings or []), "user_id": user_id,
        },
    )).scalar_one()
    return str(export_id)


async def list_exports(db: AsyncSession, org_id: str, limit: int = 50) -> list[dict[str, Any]]:
    rows = (await db.execute(
        text("""
            SELECT x.id, x.kind, x.layout_name, x.currency, x.file_name, x.row_count, x.total_amount,
                   x.period_month, x.generated_at, x.content_sha256, pr.run_number, u.full_name AS generated_by_name
            FROM finance.payroll_exports x
            LEFT JOIN finance.payroll_runs pr ON pr.id = x.payroll_run_id
            LEFT JOIN core.users u ON u.id = x.generated_by
            WHERE x.organization_id = :org_id
            ORDER BY x.generated_at DESC
            LIMIT :limit
        """),
        {"org_id": org_id, "limit": limit},
    )).mappings().all()
    return [{**dict(r), "id": str(r["id"])} for r in rows]
