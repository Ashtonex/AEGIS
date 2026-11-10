"""End-to-end check of office expense vouchers (migration 288) against an
ISOLATED database: cash and bank vouchers, their ledger postings and
department, approval (and its reset when the amount changes), bank-statement
pairing, the bank-books audit, receipts linked through core.document_links,
voiding, and company-budget actuals read from the ledger.

Needs a local database holding the production schema (pg_dump --schema-only of
core, finance, projects and their neighbours) with migration 288 applied.
Seeds its own synthetic organisation. Refuses to run unless DATABASE_URL is
local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55435/office_test
    python scripts/verify_office_expenses.py
"""

import asyncio
import os
import sys
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from sqlalchemy import text  # noqa: E402

from app.services.finance import bank_books, company_budget, project_entries  # noqa: E402
from app.services.finance.general_ledger import GeneralLedgerError  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
USER = str(uuid.uuid4())
DEPT = uuid.uuid4()
ON = date(2026, 11, 3)

ACCOUNTS = [
    ("1000", "Cash and Bank", "asset", "debit"), ("1010", "HQ Cash", "asset", "debit"),
    ("1060", "Inter-account", "asset", "debit"), ("1070", "Recorded, awaiting bank", "asset", "debit"),
    ("1100", "Receivable", "asset", "debit"), ("1500", "Advances", "asset", "debit"),
    ("1900", "Suspense", "asset", "debit"), ("3100", "Retained earnings", "equity", "credit"),
    ("3200", "Directors", "equity", "credit"), ("3300", "Shareholders", "equity", "credit"),
    ("4100", "Certified revenue", "revenue", "credit"), ("4900", "Other income", "other_income", "credit"),
    ("5000", "Materials", "direct_project_cost", "debit"), ("5950", "Unclassified", "direct_project_cost", "debit"),
    ("5960", "Historical cash", "direct_project_cost", "debit"),
    ("6000", "HQ salaries", "operating_expense", "debit"), ("6100", "Rent", "operating_expense", "debit"),
    ("6200", "Utilities", "operating_expense", "debit"), ("6300", "Professional fees", "operating_expense", "debit"),
    ("6400", "Insurance", "operating_expense", "debit"), ("6500", "Travel", "operating_expense", "debit"),
    ("6600", "Office administration", "operating_expense", "debit"), ("6700", "Marketing", "operating_expense", "debit"),
    ("6800", "Finance costs", "operating_expense", "debit"), ("6900", "Taxes", "operating_expense", "debit"),
    ("7800", "Donations", "other_expense", "debit"), ("7900", "Other expense", "other_expense", "debit"),
]


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


async def q(db, sql: str, **params):
    return await db.execute(text(sql), {"org": ORG, **params})


async def gl(db, code: str) -> Decimal:
    value = (await q(db, """
        SELECT COALESCE(sum(jl.debit_amount - jl.credit_amount), 0)
        FROM finance.journal_lines jl
        JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
        JOIN finance.chart_of_accounts a ON a.id = jl.account_id
        WHERE je.organization_id = :org AND a.account_code = :code
    """, code=code)).scalar()
    return Decimal(str(value))


async def seed(db) -> uuid.UUID:
    await q(db, "INSERT INTO core.organizations (id, name) VALUES (:org, 'Office expense test org')")
    await q(db, "INSERT INTO core.users (id, organization_id, email, full_name) VALUES (:u, :org, 'office.test@example.invalid', 'Office Tester')",
            u=USER)
    for code, name, category, normal in ACCOUNTS:
        await q(db, """INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance)
                       VALUES (:org, :c, :n, :cat, :nb)""", c=code, n=name, cat=category, nb=normal)
    await q(db, """INSERT INTO finance.accounting_periods (organization_id, period_number, period_code, fiscal_year, period_start, period_end)
                   VALUES (:org, 11, '2026-11', 2026, '2026-11-01', '2026-11-30')""")
    await q(db, "INSERT INTO finance.departments (id, organization_id, code, name) VALUES (:d, :org, 'ccs', 'Corporate Control Services')",
            d=DEPT)
    bank = (await q(db, """INSERT INTO finance.cash_accounts (organization_id, account_code, account_name, account_type)
                           VALUES (:org, 'BANKABC', 'BancABC USD', 'bank') RETURNING id""")).scalar()
    return bank


async def main() -> None:
    async with AsyncSessionLocal() as db:
        bank = await seed(db)
        await db.commit()

        # --- validation ------------------------------------------------------
        for label, values in [
            ("money in with no project is refused", {"direction": "in", "category": "refund"}),
            ("no category is refused", {"category": None}),
            ("a project-cost category is refused", {"category": "supplier_payment"}),
        ]:
            try:
                await project_entries.create(db, org_id=ORG, user_id=USER, values={
                    "project_id": None, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 10,
                    **values})
                check(label, False, "accepted")
            except GeneralLedgerError:
                check(label, True)
            await db.rollback()

        # --- cash voucher ------------------------------------------------------
        cash = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 45,
            "category": "utilities", "counterparty_name": "Econet", "reference": "R-778",
            "description": "Office airtime", "spent_by": "Gladmore", "department_id": DEPT})
        await db.commit()
        check("cash voucher saved with no project", cash["project_id"] is None and cash["match_status"] == "not_bank")
        check("cash voucher debits Utilities 6200", await gl(db, "6200") == Decimal("45"), await gl(db, "6200"))
        check("cash voucher credits HQ Cash 1010", await gl(db, "1010") == Decimal("-45"), await gl(db, "1010"))
        dept_on_line = (await q(db, """
            SELECT jl.department_id FROM finance.journal_lines jl JOIN finance.chart_of_accounts a ON a.id = jl.account_id
            WHERE jl.journal_entry_id = :j AND a.account_code = '6200'""", j=cash["gl_journal_id"])).scalar()
        check("department carried onto the expense GL line", dept_on_line == DEPT, dept_on_line)
        costs = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = :id", id=cash["id"])).scalar()
        check("no project cost row for an office voucher", costs == 0, costs)
        hq_out = (await q(db, """SELECT count(*) FROM finance.cashbook_transactions
                                 WHERE source_id = :id AND direction = 'outflow' AND NOT is_deleted""", id=cash["id"])).scalar()
        check("HQ Cash payment row written", hq_out == 1, hq_out)

        # --- approval, and reset when the amount changes ----------------------
        approved = await project_entries.approve(db, org_id=ORG, user_id=USER, entry_id=cash["id"])
        await db.commit()
        check("approve records the approver", str(approved["approved_by"]) == USER and approved["approved_by_name"] == "Office Tester",
              approved["approved_by_name"])
        renamed = await project_entries.update(db, org_id=ORG, user_id=USER, entry_id=cash["id"], changes={"description": "Airtime, Oct"})
        await db.commit()
        check("editing the description keeps the approval", str(renamed["approved_by"]) == USER)
        changed = await project_entries.update(db, org_id=ORG, user_id=USER, entry_id=cash["id"], changes={"amount": 50})
        await db.commit()
        check("changing the amount clears the approval", changed["approved_by"] is None)
        check("GL follows the new amount (old journal reversed)", await gl(db, "6200") == Decimal("50"), await gl(db, "6200"))

        # --- receipts through core.document_links ------------------------------
        doc = (await q(db, "INSERT INTO core.documents (organization_id, title, created_by) VALUES (:org, 'Till slip', :u) RETURNING id",
                       u=USER)).scalar()
        found = (await q(db, "SELECT 1 FROM finance.project_money_entries WHERE id = :id AND organization_id = :org AND is_deleted = false",
                         id=cash["id"])).first()
        check("documents router entity check finds the voucher", found is not None)
        await q(db, """INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
                       VALUES (:org, :d, 'money_entry', :e, 'evidence', :u)""", d=doc, e=cash["id"], u=USER)
        await db.commit()

        # --- bank voucher paired with its statement line ------------------------
        bank_v = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "paid_via": "bank", "entry_date": ON, "amount": 120,
            "category": "office_admin", "counterparty_name": "Axis Solutions", "description": "Printer toner"})
        await db.commit()
        check("bank voucher waits for the statement", bank_v["match_status"] == "awaiting", bank_v["match_status"])
        check("bank voucher sits in 1070 until matched", await gl(db, "1070") == Decimal("-120"), await gl(db, "1070"))
        imp = (await q(db, """INSERT INTO finance.bank_statement_imports (organization_id, cash_account_id, file_name)
                              VALUES (:org, :b, 'nov.pdf') RETURNING id""", b=bank)).scalar()
        line = (await q(db, """INSERT INTO finance.bank_statement_lines
                                   (organization_id, cash_account_id, import_id, line_number, transaction_date, amount, description)
                               VALUES (:org, :b, :i, 1, :on, -120, 'POS PURCHASE AXIS SOLUTIONS MUTARE') RETURNING id""",
                            b=bank, i=imp, on=date(2026, 11, 5))).scalar()
        await db.commit()
        counts = await project_entries.match(db, org_id=ORG, user_id=USER, line_ids=[line])
        await bank_books.sync(db, org_id=ORG, user_id=USER, line_ids=[line])
        await db.commit()
        check("statement line auto-matched to the voucher", counts["matched"] == 1, counts)
        matched = await project_entries.get_entry(db, org_id=ORG, entry_id=bank_v["id"])
        check("voucher shows matched", matched["match_status"] == "matched" and matched["matched_line_id"] == line)
        tagged = (await q(db, "SELECT category, project_id, project_entry_id FROM finance.bank_statement_lines WHERE id = :l", l=line)).mappings().one()
        check("bank line takes the voucher's category, no project",
              tagged["category"] == "office_admin" and tagged["project_id"] is None and tagged["project_entry_id"] == bank_v["id"], dict(tagged))
        check("1070 clears once matched", await gl(db, "1070") == Decimal("0"), await gl(db, "1070"))
        check("expense counted once (6600 = 120)", await gl(db, "6600") == Decimal("120"), await gl(db, "6600"))
        check("bank 1000 down by the payment", await gl(db, "1000") == Decimal("-120"), await gl(db, "1000"))

        audit = await bank_books.audit(db, org_id=ORG)
        for c in audit["checks"]:
            if "1070" in c["check"] or "Petty Cash" in c["check"] or "ledger journal" in c["check"]:
                check(f"audit: {c['check']}", c["ok"], c["detail"])

        # --- listing and summary -------------------------------------------------
        entries = await project_entries.list_office(db, org_id=ORG, date_from=date(2026, 11, 1))
        summary = await project_entries.office_summary(db, org_id=ORG, entries=entries)
        check("list shows both vouchers", len(entries) == 2, len(entries))
        cash_row = next(e for e in entries if e["id"] == cash["id"])
        check("receipt counted on the voucher", cash_row["receipt_count"] == 1, cash_row["receipt_count"])
        check("department name listed", cash_row["department_name"] == "Corporate Control Services")
        check("summary totals", summary["total"] == Decimal("170") and summary["cash"] == Decimal("50")
              and summary["bank"] == Decimal("120"), {k: summary[k] for k in ("total", "cash", "bank")})
        check("summary flags the missing receipt and approvals",
              summary["without_receipt"] == 1 and summary["without_approval"] == 2,
              (summary["without_receipt"], summary["without_approval"]))
        check("HQ Cash per the books reported", summary["cash_not_yet_vouchered"] == Decimal("-50"),
              summary["cash_not_yet_vouchered"])

        # --- company budget actuals from the ledger --------------------------------
        company = await company_budget._get_department_actuals_by_month(db, ORG, None, 2026)
        check("company actuals include both office costs", company == [{"month": date(2026, 11, 1), "revenue": 0.0, "cost": 170.0}],
              company)
        dept = await company_budget._get_department_actuals_by_month(db, ORG, DEPT, 2026)
        check("department actuals include only its own voucher", dept == [{"month": date(2026, 11, 1), "revenue": 0.0, "cost": 50.0}],
              dept)

        # --- voiding ------------------------------------------------------------------
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=cash["id"])
        await db.commit()
        check("void reverses the expense", await gl(db, "6200") == Decimal("0"), await gl(db, "6200"))
        check("void returns the cash to HQ Cash", await gl(db, "1010") == Decimal("0"), await gl(db, "1010"))
        gone = (await q(db, "SELECT 1 FROM finance.project_money_entries WHERE id = :id AND is_deleted = false", id=cash["id"])).first()
        check("voided voucher no longer accepts receipts", gone is None)
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=bank_v["id"])
        await db.commit()
        line_after = (await q(db, "SELECT category, project_entry_id FROM finance.bank_statement_lines WHERE id = :l", l=line)).mappings().one()
        check("voiding a matched voucher leaves the bank line carrying its own tag",
              line_after["project_entry_id"] is None and line_after["category"] == "office_admin", dict(line_after))
        check("...which still books the cost once (6600 = 120)", await gl(db, "6600") == Decimal("120"), await gl(db, "6600"))
        check("...and 1070 stays clear", await gl(db, "1070") == Decimal("0"), await gl(db, "1070"))

    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: " + "; ".join(FAILURES))
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
