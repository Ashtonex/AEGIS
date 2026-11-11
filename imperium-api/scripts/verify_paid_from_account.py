"""End-to-end check of "paid from / received into" on recorded money
(migration 294) against an ISOLATED database: an entry names any Banking &
Cash account; cash accounts get a cashbook row in THAT account (its balance
moves) and post to GL 1010; bank accounts wait in 1070 and only match their
own statement. Also: moving an entry between accounts, refusals (closed,
non-USD, another project's float), entries that name no account (old
behaviour), money in, voiding, the bank-books audit and the migration backfill.

Needs a local database holding the production schema with migration 294
applied. Seeds its own synthetic organisation. Refuses to run unless
DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55436/paidfrom_test
    python scripts/verify_paid_from_account.py
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
sys.path.insert(0, str(ROOT / "scripts"))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from sqlalchemy import text  # noqa: E402

from app.services.finance import bank_books, project_entries  # noqa: E402
from app.services.finance.general_ledger import GeneralLedgerError  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
USER = str(uuid.uuid4())
PROJECT = uuid.uuid4()
OTHER_PROJECT = uuid.uuid4()
ON = date(2026, 11, 3)
MIGRATION = (ROOT / "migrations" / "294_money_entry_paid_from_account.sql").read_text(encoding="utf-8")
SITE_OVERHEADS_MIGRATION = (ROOT / "migrations" / "295_project_site_overhead_accounts.sql").read_text(encoding="utf-8")

ACCOUNTS = [
    ("1000", "Cash and Bank", "asset", "debit"), ("1010", "HQ Cash", "asset", "debit"),
    ("1060", "Inter-account", "asset", "debit"), ("1070", "Recorded, awaiting bank", "asset", "debit"),
    ("1100", "Receivable", "asset", "debit"), ("1500", "Advances", "asset", "debit"),
    ("1900", "Suspense", "asset", "debit"), ("3100", "Retained earnings", "equity", "credit"),
    ("3200", "Directors", "equity", "credit"), ("3300", "Shareholders", "equity", "credit"),
    ("4100", "Certified revenue", "revenue", "credit"), ("4900", "Other income", "other_income", "credit"),
    ("5000", "Materials", "direct_project_cost", "debit"), ("5200", "Subcontract", "direct_project_cost", "debit"),
    ("6100", "Rent", "operating_expense", "debit"), ("6900", "Taxes", "operating_expense", "debit"),
    ("5950", "Unclassified", "direct_project_cost", "debit"), ("5960", "Historical cash", "direct_project_cost", "debit"),
    ("6600", "Office administration", "operating_expense", "debit"), ("7900", "Other expense", "other_expense", "debit"),
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


async def balance(db, account_id) -> Decimal:
    return Decimal(str((await q(db, "SELECT current_balance FROM finance.cash_accounts WHERE id = :id", id=account_id)).scalar()))


async def account(db, code: str, name: str, kind: str, opening: str = "0", currency: str = "USD",
                  active: bool = True, project=None):
    return (await q(db, """
        INSERT INTO finance.cash_accounts (organization_id, account_code, account_name, account_type, currency,
                                           opening_balance, current_balance, is_active, project_id, is_petty_cash)
        VALUES (:org, :c, :n, :t, :cur, :o, :o, :a, CAST(:p AS uuid), CAST(:p AS uuid) IS NOT NULL) RETURNING id
    """, c=code, n=name, t=kind, cur=currency, o=Decimal(opening), a=active, p=project)).scalar()


async def line(db, bank, imp, n: int, amount: str, on: date, desc: str):
    return (await q(db, """
        INSERT INTO finance.bank_statement_lines (organization_id, cash_account_id, import_id, line_number,
                                                  transaction_date, amount, description)
        VALUES (:org, :b, :i, :n, :on, :a, :d) RETURNING id
    """, b=bank, i=imp, n=n, on=on, a=Decimal(amount), d=desc)).scalar()


async def refused(db, label: str, values: dict) -> None:
    try:
        await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 10,
            "category": "supplier_payment", **values})
        check(label, False, "accepted")
    except GeneralLedgerError as exc:
        check(label, True)
        print(f"     -> {exc}")
    await db.rollback()


async def main() -> None:
    async with AsyncSessionLocal() as db:
        await q(db, "INSERT INTO core.organizations (id, name) VALUES (:org, 'Paid-from test org')")
        await q(db, "INSERT INTO core.users (id, organization_id, email, full_name) VALUES (:u, :org, :email, 'Paid-from Tester')",
                u=USER, email=f"paidfrom.test.{USER[:8]}@example.invalid")
        for code, name, category, normal in ACCOUNTS:
            await q(db, """INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance)
                           VALUES (:org, :c, :n, :cat, :nb)""", c=code, n=name, cat=category, nb=normal)
        await q(db, """INSERT INTO finance.accounting_periods (organization_id, period_number, period_code, fiscal_year, period_start, period_end)
                       VALUES (:org, 11, '2026-11', 2026, '2026-11-01', '2026-11-30')""")
        await q(db, "INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :org, 'Paid-from project')", p=PROJECT)
        await q(db, "INSERT INTO projects.projects (id, organization_id, name) VALUES (:p, :org, 'Other project')", p=OTHER_PROJECT)
        abc = await account(db, "OPS1", "BancABC", "bank")
        stanbic = await account(db, "OPS2", "Stanbic", "bank")
        eht = await account(db, "CASH-02", "EHT-Petty Cash", "cash", opening="200")
        empa = await account(db, "EMPA", "Employee Advance", "cash", opening="100")
        await q(db, "UPDATE finance.cash_accounts SET ledger_account_code = '1500' WHERE id = :id", id=empa)
        closed = await account(db, "CASH-09", "Old tin", "cash", active=False)
        zwg = await account(db, "ZWG1", "ZiG cash", "cash", currency="ZWG")
        float_other = await account(db, "PC-OTHER", "Other project float", "cash", project=OTHER_PROJECT)
        hq = await bank_books.ensure_hq_petty_cash(db, ORG, USER)
        imp_abc = (await q(db, "INSERT INTO finance.bank_statement_imports (organization_id, cash_account_id, file_name) VALUES (:org, :b, 'abc.pdf') RETURNING id", b=abc)).scalar()
        imp_stb = (await q(db, "INSERT INTO finance.bank_statement_imports (organization_id, cash_account_id, file_name) VALUES (:org, :b, 'stb.pdf') RETURNING id", b=stanbic)).scalar()
        await db.commit()
        raw = await (await db.connection()).get_raw_connection()   # as migrations/run_aegis_migrations.py runs it
        await raw.driver_connection.execute(SITE_OVERHEADS_MIGRATION)
        await raw.driver_connection.execute(SITE_OVERHEADS_MIGRATION)
        await db.commit()
        n = (await q(db, "SELECT count(*) FROM finance.chart_of_accounts WHERE organization_id = :org AND account_code BETWEEN '5510' AND '5570'")).scalar()
        check("migration 295 adds the 7 site-overhead accounts once, even run twice", n == 7, n)

        # --- refusals ------------------------------------------------------------
        await refused(db, "a closed account is refused", {"cash_account_id": closed})
        await refused(db, "a non-USD account is refused", {"cash_account_id": zwg})
        await refused(db, "another project's petty cash float is refused", {"cash_account_id": float_other})
        await refused(db, "an unknown account is refused", {"cash_account_id": uuid.uuid4()})

        # --- cost paid from a named cash account ----------------------------------
        cost = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "bank", "cash_account_id": eht, "entry_date": ON,
            "amount": 50, "category": "supplier_payment", "counterparty_name": "Halsteds", "description": "Cement"})
        await db.commit()
        check("cash account overrides paid_via (bank sent, cash account chosen)", cost["paid_via"] == "cash", cost["paid_via"])
        check("entry is not waiting for a bank statement", cost["match_status"] == "not_bank", cost["match_status"])
        check("entry lists the account name", cost["cash_account_name"] == "EHT-Petty Cash", cost["cash_account_name"])
        check("EHT-Petty Cash balance 200 -> 150", await balance(db, eht) == Decimal("150"), await balance(db, eht))
        check("HQ Cash untouched", await balance(db, hq) == Decimal("0"), await balance(db, hq))
        check("GL: Dr materials 5000 50", await gl(db, "5000") == Decimal("50"), await gl(db, "5000"))
        check("GL: Cr cash on hand 1010 50", await gl(db, "1010") == Decimal("-50"), await gl(db, "1010"))
        check("GL: nothing in 1070", await gl(db, "1070") == Decimal("0"), await gl(db, "1070"))
        costs = (await q(db, "SELECT count(*), sum(amount) FROM finance.cost_transactions WHERE source_id = :id", id=cost["id"])).one()
        check("one project cost row of 50", costs[0] == 1 and Decimal(str(costs[1])) == Decimal("50"), tuple(costs))

        # --- move it to another cash account ---------------------------------------
        moved = await project_entries.update(db, org_id=ORG, user_id=USER, entry_id=cost["id"], changes={"cash_account_id": empa})
        await db.commit()
        check("moved entry names Employee Advance", moved["cash_account_name"] == "Employee Advance", moved["cash_account_name"])
        check("EHT-Petty Cash restored to 200", await balance(db, eht) == Decimal("200"), await balance(db, eht))
        check("Employee Advance 100 -> 50", await balance(db, empa) == Decimal("50"), await balance(db, empa))
        check("Employee Advance sits in 1500: Cr 1500 50, 1010 back to 0",
              await gl(db, "1500") == Decimal("-50") and await gl(db, "1010") == 0, (await gl(db, "1500"), await gl(db, "1010")))
        check("GL still Dr 5000 50 once", await gl(db, "5000") == Decimal("50"), await gl(db, "5000"))
        rows = (await q(db, "SELECT count(*) FROM finance.cashbook_transactions WHERE source_id = :id AND NOT is_deleted", id=cost["id"])).scalar()
        check("exactly one live cashbook row", rows == 1, rows)

        # --- move it to a bank account ---------------------------------------------
        to_bank = await project_entries.update(db, org_id=ORG, user_id=USER, entry_id=cost["id"], changes={"cash_account_id": stanbic})
        await db.commit()
        check("now a bank entry waiting for the Stanbic statement",
              to_bank["paid_via"] == "bank" and to_bank["match_status"] == "awaiting", (to_bank["paid_via"], to_bank["match_status"]))
        check("Employee Advance restored to 100", await balance(db, empa) == Decimal("100"), await balance(db, empa))
        check("GL: 1500 and 1010 back to 0, 1070 -50",
              await gl(db, "1500") == 0 and await gl(db, "1010") == 0 and await gl(db, "1070") == Decimal("-50"),
              (await gl(db, "1500"), await gl(db, "1010"), await gl(db, "1070")))

        # --- only its own bank's statement matches -----------------------------------
        wrong = await line(db, abc, imp_abc, 1, "-50", date(2026, 11, 4), "RTGS HALSTEDS")
        await db.commit()
        counts = await project_entries.match(db, org_id=ORG, user_id=USER, line_ids=[wrong])
        await db.commit()
        check("a BancABC line does not match a Stanbic entry", counts == {"matched": 0, "suggested": 0}, counts)
        cands = await project_entries.candidates(db, org_id=ORG, entry_id=cost["id"])
        check("BancABC line not offered as a candidate", all(c["id"] != wrong for c in cands), [c["id"] for c in cands])
        try:
            await project_entries.confirm(db, org_id=ORG, user_id=USER, entry_id=cost["id"], line_id=wrong)
            check("confirming a line on another bank is refused", False, "accepted")
        except GeneralLedgerError as exc:
            check("confirming a line on another bank is refused", True)
            print(f"     -> {exc}")
        await db.rollback()
        right = await line(db, stanbic, imp_stb, 1, "-50", date(2026, 11, 5), "RTGS HALSTEDS CEMENT")
        await db.commit()
        counts = await project_entries.match(db, org_id=ORG, user_id=USER, line_ids=[right])
        await bank_books.sync(db, org_id=ORG, user_id=USER, line_ids=[right, wrong])
        await db.commit()
        check("the Stanbic line auto-matches", counts["matched"] == 1, counts)
        check("1070 clears once matched", await gl(db, "1070") == Decimal("0"), await gl(db, "1070"))
        check("cost counted once (5000 = 50)", await gl(db, "5000") == Decimal("50"), await gl(db, "5000"))

        # --- money in received into a cash account -------------------------------------
        receipt = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "in", "cash_account_id": eht, "entry_date": ON, "amount": 75,
            "category": "client_receipt", "counterparty_name": "Client"})
        await db.commit()
        check("receipt goes into EHT-Petty Cash (200 -> 275)", await balance(db, eht) == Decimal("275"), await balance(db, eht))
        check("GL: Cr revenue 4100 75", await gl(db, "4100") == Decimal("-75"), await gl(db, "4100"))
        check("GL: Dr 1010 75", await gl(db, "1010") == Decimal("75"), await gl(db, "1010"))

        # --- entries that name no account (old clients) ------------------------------------
        legacy_cash = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "cash", "entry_date": ON, "amount": 5,
            "category": "other"})
        legacy_bank = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "paid_via": "bank", "entry_date": ON, "amount": 7,
            "category": "other"})
        await db.commit()
        check("no account + cash -> HQ Cash", str(legacy_cash["cash_account_id"]) == str(hq) and await balance(db, hq) == Decimal("-5"),
              (legacy_cash["cash_account_id"], await balance(db, hq)))
        check("no account + bank with two banks -> any bank", legacy_bank["cash_account_id"] is None, legacy_bank["cash_account_id"])

        # --- owner drawings and loans are not a project cost ---------------------------------
        cost_before = Decimal(str((await q(db, "SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions WHERE organization_id = :org AND project_id = :p", p=PROJECT)).scalar()))
        drawings = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "cash_account_id": eht, "entry_date": ON, "amount": 30,
            "category": "owner_drawings", "description": "Director took cash on site"})
        loan = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "cash_account_id": eht, "entry_date": ON, "amount": 20,
            "category": "loan_advance", "description": "Advance to foreman"})
        await db.commit()
        rows = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = ANY(:ids)", ids=[drawings["id"], loan["id"]])).scalar()
        check("recorded drawings / loan create no project cost row", rows == 0, rows)
        cost_after = Decimal(str((await q(db, "SELECT COALESCE(sum(amount), 0) FROM finance.cost_transactions WHERE organization_id = :org AND project_id = :p", p=PROJECT)).scalar()))
        check("project actual cost unchanged by drawings / loan", cost_after == cost_before, (cost_before, cost_after))
        check("drawings post Dr Directors 3200", await gl(db, "3200") == Decimal("30"), await gl(db, "3200"))
        check("loan posts Dr Advances 1500", await gl(db, "1500") == Decimal("20"), await gl(db, "1500"))
        check("cash still leaves EHT-Petty Cash (275 -> 225)", await balance(db, eht) == Decimal("225"), await balance(db, eht))
        tagged = await line(db, stanbic, imp_stb, 2, "-40", date(2026, 11, 6), "TRANSFER TO DIRECTOR")
        await q(db, "UPDATE finance.bank_statement_lines SET project_id = :p, category = 'owner_drawings' WHERE id = :l", p=PROJECT, l=tagged)
        await db.commit()
        await bank_books.sync(db, org_id=ORG, user_id=USER, line_ids=[tagged])
        await db.commit()
        rows = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = :l", l=tagged)).scalar()
        check("bank line tagged project + owner drawings creates no project cost", rows == 0, rows)
        check("...but still posts Dr 3200 (30 + 40)", await gl(db, "3200") == Decimal("70"), await gl(db, "3200"))
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=drawings["id"])
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=loan["id"])
        await db.commit()

        # --- site overheads on a project are direct cost (migration 295) -----------------------
        site_rent = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "cash_account_id": eht, "entry_date": ON, "amount": 15,
            "category": "rent", "description": "Site container rent"})
        office_rent = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": None, "direction": "out", "cash_account_id": eht, "entry_date": ON, "amount": 25,
            "category": "rent", "description": "Head office rent"})
        await db.commit()
        check("project rent posts Dr 5510 Site Rent", await gl(db, "5510") == Decimal("15"), await gl(db, "5510"))
        check("office rent still posts Dr 6100 Rent", await gl(db, "6100") == Decimal("25"), await gl(db, "6100"))
        rent_cost = (await q(db, "SELECT count(*) FROM finance.cost_transactions WHERE source_id = :id", id=site_rent["id"])).scalar()
        check("project rent still counts as project cost", rent_cost == 1, rent_cost)

        # items posted under the old rules (before this change) are moved by the repost script
        real_from = bank_books.SITE_OVERHEADS_DIRECT_FROM
        bank_books.SITE_OVERHEADS_DIRECT_FROM = date(2099, 1, 1)
        old_entry = await project_entries.create(db, org_id=ORG, user_id=USER, values={
            "project_id": PROJECT, "direction": "out", "cash_account_id": eht, "entry_date": ON, "amount": 11,
            "category": "other", "description": "Old-rule sundry"})
        old_line = await line(db, stanbic, imp_stb, 3, "-13", date(2026, 11, 7), "LEVY PAYMENT")
        await q(db, "UPDATE finance.bank_statement_lines SET project_id = :p, category = 'tax_statutory' WHERE id = :l", p=PROJECT, l=old_line)
        await db.commit()
        await bank_books.sync(db, org_id=ORG, user_id=USER, line_ids=[old_line])
        await db.commit()
        bank_books.SITE_OVERHEADS_DIRECT_FROM = real_from
        check("old-rule items sit in 7900 / 6900", await gl(db, "7900") == Decimal("11") and await gl(db, "6900") == Decimal("13"),
              (await gl(db, "7900"), await gl(db, "6900")))
        unclassified_before = await gl(db, "5950")
        sys.argv += ["--org", ORG, "--actor", USER]
        import repost_project_site_overheads as repost   # noqa: E402
        from _rollback_harness import FAILURES as REPOST_FAILURES   # noqa: E402
        await repost.steps(db)
        await db.commit()
        check("repost script's own checks pass", not REPOST_FAILURES, REPOST_FAILURES)
        check("repost moves 'other' (11) to 5950 and the levy (13) to 5570",
              await gl(db, "7900") == 0 and await gl(db, "6900") == 0
              and await gl(db, "5950") == unclassified_before + Decimal("11") and await gl(db, "5570") == Decimal("13"),
              (await gl(db, "7900"), await gl(db, "6900"), await gl(db, "5950"), await gl(db, "5570")))
        for e in (site_rent, office_rent, old_entry):
            await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=e["id"])
        await db.commit()

        # --- void ------------------------------------------------------------------------
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=receipt["id"])
        await project_entries.void(db, org_id=ORG, user_id=USER, entry_id=legacy_cash["id"])
        await db.commit()
        check("void restores EHT-Petty Cash to 200", await balance(db, eht) == Decimal("200"), await balance(db, eht))
        check("void restores HQ Cash to 0", await balance(db, hq) == Decimal("0"), await balance(db, hq))
        check("GL 1010 back to 0", await gl(db, "1010") == Decimal("0"), await gl(db, "1010"))

        audit = await bank_books.audit(db, org_id=ORG)
        for c in audit["checks"]:
            if "1070" in c["check"] or "ledger journal" in c["check"] or "Petty Cash" in c["check"]:
                check(f"audit: {c['check']}", c["ok"], c["detail"])

        # --- migration backfill --------------------------------------------------------------
        await q(db, "UPDATE finance.project_money_entries SET cash_account_id = NULL WHERE organization_id = :org")
        await db.commit()
        raw = await (await db.connection()).get_raw_connection()   # as migrations/run_aegis_migrations.py runs it
        await raw.driver_connection.execute(MIGRATION)
        await db.commit()
        back = {r["id"]: r["cash_account_id"] for r in (await q(db, "SELECT id, cash_account_id FROM finance.project_money_entries WHERE organization_id = :org")).mappings()}
        check("backfill: matched bank entry -> its line's bank (Stanbic)", back[cost["id"]] == stanbic, back[cost["id"]])
        check("backfill: voided cash entry -> its cashbook account", back[receipt["id"]] == eht, back[receipt["id"]])
        check("backfill: unmatched bank entry with two banks stays open", back[legacy_bank["id"]] is None, back[legacy_bank["id"]])

    print()
    print("ALL PASSED" if not FAILURES else f"{len(FAILURES)} FAILED: " + "; ".join(FAILURES))
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
