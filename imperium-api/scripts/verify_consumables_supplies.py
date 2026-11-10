"""End-to-end check of the Consumables & supplies cost type (migration 289)
against an ISOLATED database: the migration adds account 5910 to every chart
(and is safe to run twice), a project entry paid in cash debits 5910 on the
project and counts as site overhead, a bank-paid one waits in 1070, an office
voucher with the same category lands on 6600, and voiding reverses it.

Needs a local database holding the production schema with migrations 288 and
289's prerequisites (see verify_office_expenses.py). Seeds its own synthetic
organisation. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55435/office_test
    python scripts/verify_consumables_supplies.py
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

from app.services.finance import project_entries  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
USER = str(uuid.uuid4())
PROJECT = uuid.uuid4()
ON = date(2026, 11, 10)
MIGRATION = (ROOT / "migrations" / "289_consumables_supplies_account.sql").read_text(encoding="utf-8")

ACCOUNTS = [
    ("1000", "Cash and Bank", "asset", "debit"), ("1010", "HQ Cash", "asset", "debit"),
    ("1070", "Recorded, awaiting bank", "asset", "debit"), ("1900", "Suspense", "asset", "debit"),
    ("5000", "Materials", "direct_project_cost", "debit"), ("5950", "Unclassified", "direct_project_cost", "debit"),
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


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await q(db, "INSERT INTO core.organizations (id, name) VALUES (:org, 'Consumables test org')")
        await q(db, "INSERT INTO core.users (id, organization_id, email, full_name) VALUES (:u, :org, :email, 'Consumables Tester')",
                u=USER, email=f"consumables.test.{USER[:8]}@example.invalid")
        for code, name, category, normal in ACCOUNTS:
            await q(db, """INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance)
                           VALUES (:org, :c, :n, :cat, :nb)""", c=code, n=name, cat=category, nb=normal)
        await q(db, """INSERT INTO finance.accounting_periods (organization_id, period_number, period_code, fiscal_year, period_start, period_end)
                       VALUES (:org, 11, '2026-11', 2026, '2026-11-01', '2026-11-30')""")
        await q(db, "INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :org, 'Consumables test project')", p=PROJECT)
        await db.commit()

        # --- migration 289 -----------------------------------------------------
        raw = await (await db.connection()).get_raw_connection()   # as migrations/run_aegis_migrations.py runs it
        await raw.driver_connection.execute(MIGRATION)
        await raw.driver_connection.execute(MIGRATION)
        await db.commit()
        rows = (await q(db, """SELECT account_name, account_category, normal_balance FROM finance.chart_of_accounts
                               WHERE organization_id = :org AND account_code = '5910'""")).mappings().all()
        check("migration adds 5910 once, even when run twice", len(rows) == 1, len(rows))
        check("5910 is a direct project cost", rows and rows[0]["account_category"] == "direct_project_cost"
              and rows[0]["normal_balance"] == "debit", rows)

        # --- project entry, paid in cash -----------------------------------------
        cash = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 38.5,
            "category": "consumables_supplies", "counterparty_name": "OK Mart",
            "description": "Lunch and drinking water for the crew"})
        await db.commit()
        check("cash consumables entry debits 5910 on the project", await gl(db, "5910", PROJECT) == Decimal("38.50"),
              await gl(db, "5910", PROJECT))
        check("...and credits HQ Cash 1010", await gl(db, "1010") == Decimal("-38.50"), await gl(db, "1010"))
        check("...never Other expense or Unclassified", await gl(db, "7900") == 0 and await gl(db, "5950") == 0)
        cost = (await q(db, "SELECT cost_category, amount FROM finance.cost_transactions WHERE source_id = :id",
                        id=cash["id"])).mappings().all()
        check("project cost row counts as site overhead", [(c["cost_category"], c["amount"]) for c in cost]
              == [("overhead", Decimal("38.50"))], cost)

        # --- project entry, paid by bank -----------------------------------------
        bank = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "bank", "entry_date": ON, "amount": 61,
            "category": "consumables_supplies", "description": "Cleaning materials and gas"})
        await db.commit()
        check("bank consumables entry waits in 1070", bank["match_status"] == "awaiting" and await gl(db, "1070") == Decimal("-61"),
              (bank["match_status"], await gl(db, "1070")))
        check("5910 now carries both", await gl(db, "5910", PROJECT) == Decimal("99.50"), await gl(db, "5910", PROJECT))

        # --- office voucher with the same category -------------------------------
        office = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 20,
            "category": "consumables_supplies", "description": "Tea, sugar and milk for HQ"})
        await db.commit()
        check("office consumables voucher lands on 6600", await gl(db, "6600") == Decimal("20"), await gl(db, "6600"))
        office_costs = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = :id", id=office["id"])).scalar()
        check("...with no project cost row", office_costs == 0, office_costs)

        # --- void ------------------------------------------------------------------
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=cash["id"])
        await db.commit()
        check("void reverses the cash entry", await gl(db, "5910", PROJECT) == Decimal("61"), await gl(db, "5910", PROJECT))
        gone = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = :id", id=cash["id"])).scalar()
        check("...and removes its project cost", gone == 0, gone)

    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: " + "; ".join(FAILURES))
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
