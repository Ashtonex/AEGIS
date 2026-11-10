"""End-to-end check of the HQ office reserve (migration 291) against an
ISOLATED database: the migration (twice), nothing happens while the reserve
is off, contributions follow client receipts recorded on a project and
arriving on the bank statement, a project override (0 = exempt), voiding a
receipt, a rate change applying from the current month on, a closed period
blocking a change, company budget actuals netting to zero, and the reserve
balance (contributed less office vouchers).

Needs a local database holding the production schema with migration 288
applied (see verify_office_expenses.py). Seeds its own synthetic
organisation. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55435/office_test
    python scripts/verify_hq_reserve.py
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

from app.services.finance import bank_books, company_budget, hq_reserve, project_entries  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
USER = str(uuid.uuid4())
A, B = uuid.uuid4(), uuid.uuid4()
OCT, NOV = date(2026, 10, 1), date(2026, 11, 1)
MIGRATION = (ROOT / "migrations" / "291_hq_office_reserve.sql").read_text(encoding="utf-8")

ACCOUNTS = [
    ("1000", "Cash and Bank", "asset", "debit"), ("1010", "HQ Cash", "asset", "debit"),
    ("1060", "Inter-account", "asset", "debit"), ("1070", "Recorded, awaiting bank", "asset", "debit"),
    ("1100", "Receivable", "asset", "debit"), ("1900", "Suspense", "asset", "debit"),
    ("4100", "Certified revenue", "revenue", "credit"), ("4900", "Other income", "other_income", "credit"),
    ("5000", "Materials", "direct_project_cost", "debit"), ("5950", "Unclassified", "direct_project_cost", "debit"),
    ("6000", "HQ salaries", "operating_expense", "debit"),
    ("6600", "Office administration", "operating_expense", "debit"), ("7900", "Other expense", "other_expense", "debit"),
]


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


async def q(db, sql: str, **params):
    return await db.execute(text(sql), {"org": ORG, **params})


async def gl(db, code: str, project=None) -> Decimal:
    value = (await q(db, """
        SELECT COALESCE(sum(jl.debit_amount - jl.credit_amount), 0)
        FROM finance.journal_lines jl
        JOIN finance.journal_entries je ON je.id = jl.journal_entry_id AND je.status = 'posted'
        JOIN finance.chart_of_accounts a ON a.id = jl.account_id
        WHERE je.organization_id = :org AND a.account_code = :code
          AND (CAST(:p AS uuid) IS NULL OR jl.project_id = CAST(:p AS uuid))
    """, code=code, p=project)).scalar()
    return Decimal(str(value))


async def row(db, project, month):
    return (await q(db, """SELECT receipts, rate_pct, amount, gl_journal_id, blocked_reason
                           FROM finance.hq_reserve_contributions
                           WHERE organization_id = :org AND project_id = :p AND month = :m""", p=project, m=month)).mappings().first()


async def project_cost(db, project) -> Decimal:
    value = (await q(db, """SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions
                            WHERE organization_id = :org AND project_id = :p AND source_type = 'hq_reserve_contribution'
                              AND cost_category = 'overhead'""", p=project)).scalar()
    return Decimal(str(value))


async def receipt(db, project, amount, on, via="cash"):
    entry = await project_entries.create(db, org_id=ORG, user_id=USER, values={
        "project_id": project, "direction": "in", "paid_via": via, "entry_date": on, "amount": amount,
        "category": "client_receipt", "description": "Client payment"})
    await db.commit()
    return entry


async def save(db, active=True, rate="5", starts_on=OCT, overrides=(), today=None):
    await hq_reserve.save_settings(db, org_id=ORG, user_id=USER, is_active=active, default_rate_pct=Decimal(rate),
                                   starts_on=starts_on, project_rates=[{"project_id": p, "rate_pct": Decimal(r)}
                                                                       for p, r in overrides], today=today)
    await db.commit()


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await q(db, "INSERT INTO core.organizations (id, name) VALUES (:org, 'HQ reserve test org')")
        await q(db, "INSERT INTO core.users (id, organization_id, email, full_name) VALUES (:u, :org, :email, 'Reserve Tester')",
                u=USER, email=f"reserve.test.{USER[:8]}@example.invalid")
        for code, name, category, normal in ACCOUNTS:
            await q(db, """INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance)
                           VALUES (:org, :c, :n, :cat, :nb)""", c=code, n=name, cat=category, nb=normal)
        for n, start, end in ((10, OCT, date(2026, 10, 31)), (11, NOV, date(2026, 11, 30))):
            await q(db, """INSERT INTO finance.accounting_periods (organization_id, period_number, period_code, fiscal_year, period_start, period_end)
                           VALUES (:org, :n, :code, 2026, :s, :e)""", n=n, code=f"2026-{n}", s=start, e=end)
        await q(db, "INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :org, 'Alpha Bridge')", p=A)
        await q(db, "INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :org, 'Beta Clinic')", p=B)
        bank = (await q(db, """INSERT INTO finance.cash_accounts (organization_id, account_code, account_name, account_type)
                               VALUES (:org, 'BANKABC', 'BancABC USD', 'bank') RETURNING id""")).scalar()
        await db.commit()

        # --- migration 291 -------------------------------------------------------
        raw = await (await db.connection()).get_raw_connection()   # as migrations/run_aegis_migrations.py runs it
        await raw.driver_connection.execute(MIGRATION)
        await raw.driver_connection.execute(MIGRATION)
        await db.commit()
        codes = (await q(db, """SELECT account_code, count(*) FROM finance.chart_of_accounts
                                WHERE organization_id = :org AND account_code IN ('5970', '6990') GROUP BY 1""")).all()
        check("migration adds 5970 and 6990 once, even when run twice", sorted(codes) == [("5970", 1), ("6990", 1)], codes)

        # --- off by default ----------------------------------------------------------
        await receipt(db, A, 1000, date(2026, 11, 4))
        check("nothing contributed while the reserve is off", await gl(db, "5970") == 0 and await row(db, A, NOV) is None)

        # --- switch on: 5% default, Beta exempt -----------------------------------------
        await save(db, rate="5", overrides=[(B, "0")])
        r = await row(db, A, NOV)
        check("switching on works out Alpha's November: 5% of 1000 = 50",
              r and r["amount"] == Decimal("50") and r["receipts"] == Decimal("1000") and r["gl_journal_id"], dict(r or {}))
        check("Dr 5970 on Alpha", await gl(db, "5970", A) == Decimal("50"), await gl(db, "5970", A))
        check("Cr 6990 HQ recovery", await gl(db, "6990") == Decimal("-50"), await gl(db, "6990"))
        check("project cost row (overhead) on Alpha", await project_cost(db, A) == Decimal("50"), await project_cost(db, A))

        # --- another receipt follows on its own ------------------------------------------
        second = await receipt(db, A, 200, date(2026, 11, 9))
        r = await row(db, A, NOV)
        check("a new receipt re-works the month: 5% of 1200 = 60", r["amount"] == Decimal("60"), r["amount"])
        check("old journal reversed, GL shows 60 once", await gl(db, "5970", A) == Decimal("60"), await gl(db, "5970", A))
        check("project cost follows (60)", await project_cost(db, A) == Decimal("60"), await project_cost(db, A))

        await receipt(db, B, 500, date(2026, 11, 6))
        b_row = await row(db, B, NOV)
        check("exempt project (0%) contributes nothing", b_row and b_row["amount"] == 0 and b_row["gl_journal_id"] is None
              and await gl(db, "5970", B) == 0, dict(b_row or {}))

        # --- a receipt arriving on the bank statement -----------------------------------
        imp = (await q(db, """INSERT INTO finance.bank_statement_imports (organization_id, cash_account_id, file_name)
                              VALUES (:org, :b, 'oct.pdf') RETURNING id""", b=bank)).scalar()
        line = (await q(db, """INSERT INTO finance.bank_statement_lines
                                   (organization_id, cash_account_id, import_id, line_number, transaction_date, amount,
                                    description, project_id, category)
                               VALUES (:org, :b, :i, 1, :on, 400, 'RTGS ALPHA CLIENT', :p, 'client_receipt') RETURNING id""",
                            b=bank, i=imp, on=date(2026, 10, 20), p=A)).scalar()
        await db.commit()
        await bank_books.sync(db, org_id=ORG, user_id=USER, line_ids=[line])
        await db.commit()
        r = await row(db, A, OCT)
        check("bank-statement receipt counted: Alpha October 5% of 400 = 20", r and r["amount"] == Decimal("20"), dict(r or {}))
        check("not counted twice (Alpha 5970 = 80)", await gl(db, "5970", A) == Decimal("80"), await gl(db, "5970", A))

        # --- voiding a receipt ---------------------------------------------------------
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=second["id"])
        await db.commit()
        r = await row(db, A, NOV)
        check("voiding the 200 receipt brings November back to 50", r["amount"] == Decimal("50"), r["amount"])

        # --- idempotent ----------------------------------------------------------------
        counts = await hq_reserve.sync(db, org_id=ORG, user_id=USER, today=date(2026, 11, 10))
        await db.commit()
        check("a second sync changes nothing", counts["posted"] == 0 and counts["reversed"] == 0, counts)

        # --- rate change applies from the current month on -------------------------------
        await save(db, rate="10", overrides=[(B, "0")], today=date(2026, 11, 10))
        oct_row, nov_row = await row(db, A, OCT), await row(db, A, NOV)
        check("current month (November) moves to 10% = 100", nov_row["amount"] == Decimal("100") and nov_row["rate_pct"] == Decimal("10"),
              dict(nov_row))
        check("earlier month (October) keeps 5% = 20", oct_row["amount"] == Decimal("20") and oct_row["rate_pct"] == Decimal("5"),
              dict(oct_row))

        # --- a 0% month keeps its rate too ------------------------------------------------
        b_row = await row(db, B, NOV)
        check("exempt month is remembered at 0% (no journal)", b_row and b_row["rate_pct"] == 0 and b_row["amount"] == 0
              and b_row["gl_journal_id"] is None, dict(b_row or {}))
        await save(db, rate="10", overrides=[], today=date(2026, 12, 5))
        b_row = await row(db, B, NOV)
        check("dropping the exemption in December does not reach back into November",
              b_row["amount"] == 0 and b_row["rate_pct"] == 0 and await gl(db, "5970", B) == 0, dict(b_row))
        await save(db, rate="10", overrides=[(B, "0")], today=date(2026, 11, 10))

        # --- reserve balance -----------------------------------------------------------
        await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "paid_via": "cash", "entry_date": date(2026, 11, 8), "amount": 30,
            "category": "office_admin", "description": "Printer paper"})
        await db.commit()
        ov = await hq_reserve.overview(db, org_id=ORG)
        check("reserve: contributed 120, spent 30, available 90",
              (ov["totals"]["contributed"], ov["totals"]["spent"], ov["totals"]["available"])
              == (Decimal("120"), Decimal("30"), Decimal("90")), ov["totals"])
        check("by project lists Alpha only", [p["project_name"] for p in ov["by_project"]] == ["Alpha Bridge"],
              [p["project_name"] for p in ov["by_project"]])

        # --- company budget nets to zero -------------------------------------------------
        actuals = await company_budget._get_department_actuals_by_month(db, ORG, None, 2026)
        cost = sum(m["cost"] for m in actuals)
        check("company actual cost = the office voucher only (contributions net to zero)", cost == 30.0, actuals)

        # --- HQ salaries: from the ledger unless a posted payroll run covers the month ----
        await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "paid_via": "cash", "entry_date": date(2026, 11, 7), "amount": 400,
            "category": "salaries_wages", "description": "Office assistant, October salary"})
        await db.commit()
        actuals = await company_budget._get_department_actuals_by_month(db, ORG, None, 2026)
        check("a salary voucher with no payroll run counts (30 + 400)", sum(m["cost"] for m in actuals) == 430.0, actuals)
        emp = (await q(db, "INSERT INTO hr.employees (organization_id, employee_name) VALUES (:org, 'Office Assistant') RETURNING id")).scalar()
        run = (await q(db, """INSERT INTO finance.payroll_runs (organization_id, run_number, period_start, period_end, payment_date, status)
                              VALUES (:org, 'PR-TEST-11', '2026-11-01', '2026-11-30', '2026-11-07', 'posted') RETURNING id""")).scalar()
        await q(db, "INSERT INTO finance.payroll_items (organization_id, payroll_run_id, employee_id, net_pay) VALUES (:org, :r, :e, 400)",
                r=run, e=emp)
        await db.commit()
        actuals = await company_budget._get_department_actuals_by_month(db, ORG, None, 2026)
        check("...and once a posted payroll run covers November, salaries are not counted twice (30 + 400)",
              sum(m["cost"] for m in actuals) == 430.0, actuals)

        # --- closed period blocks a change ------------------------------------------------
        await q(db, "UPDATE finance.accounting_periods SET status = 'closed' WHERE organization_id = :org AND period_number = 10")
        await db.commit()
        await save(db, rate="10", starts_on=NOV, overrides=[(B, "0")], today=date(2026, 11, 10))
        oct_row = await row(db, A, OCT)
        check("closed October is left alone and flagged", oct_row["amount"] == Decimal("20") and oct_row["blocked_reason"],
              dict(oct_row))
        check("overview counts the blocked month", (await hq_reserve.overview(db, org_id=ORG))["totals"]["blocked"] == 1)
        await q(db, "UPDATE finance.accounting_periods SET status = 'open' WHERE organization_id = :org AND period_number = 10")
        await db.commit()
        await hq_reserve.sync(db, org_id=ORG, user_id=USER, today=date(2026, 11, 10))
        await db.commit()
        oct_row = await row(db, A, OCT)
        check("reopened: October drops out (before the new start date)",
              oct_row["amount"] == 0 and oct_row["gl_journal_id"] is None and oct_row["blocked_reason"] is None, dict(oct_row))
        check("GL now holds November only (100)", await gl(db, "5970", A) == Decimal("100"), await gl(db, "5970", A))

        # --- switching off leaves what was posted ----------------------------------------
        await save(db, active=False, rate="10", starts_on=NOV, overrides=[(B, "0")])
        await receipt(db, A, 1000, date(2026, 11, 12))
        check("while off, new receipts add nothing", (await row(db, A, NOV))["amount"] == Decimal("100"))

    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: " + "; ".join(FAILURES))
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
