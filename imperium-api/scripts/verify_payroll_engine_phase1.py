"""End-to-end check of the payroll engine (migration 287) against an ISOLATED
database: migration + starter codes, run creation with pay codes, loans,
bonus exemption and USD/ZiG split pay, the double-payment guard, approve and
post (two-currency cashbook, per-currency statutory liabilities, loan
balances), year-to-date view, month close/reopen, the separate-tables method,
the statutory recompute and the retired endpoints.

Rate tables seeded here are FIXTURES with round numbers, not ZIMRA/NSSA rates.

Needs a local database with production's schema-only definitions of core,
finance, hr and projects (pg_dump --schema-only), migration 287 NOT applied.
Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55433/payroll_test
    set PSQL=<path to psql.exe>
    python scripts/verify_payroll_engine_phase1.py
"""

import asyncio
import os
import subprocess
import sys
import uuid
from datetime import date
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from routers import finance_statutory, financial_performance, payroll_config, payroll_runs  # noqa: E402

FAILURES: list[str] = []
MIGRATION = ROOT / "migrations" / "287_payroll_engine_phase1.sql"
ORG = str(uuid.uuid4())
USER_ID = str(uuid.uuid4())
USER = {"sub": USER_ID, "org_id": ORG, "role": "SUPERADMIN"}
E1, E2, E3 = (str(uuid.uuid4()) for _ in range(3))
USD_ACC, ZWG_ACC = str(uuid.uuid4()), str(uuid.uuid4())


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


def psql_file(path: Path, label: str) -> None:
    u = urlsplit(URL)
    result = subprocess.run(
        [os.environ["PSQL"], "-h", u.hostname, "-p", str(u.port), "-U", u.username or "postgres",
         "-d", u.path.lstrip("/"), "-v", "ON_ERROR_STOP=1", "-q", "-f", str(path)],
        capture_output=True, text=True,
    )
    check(label, result.returncode == 0, result.stderr.strip()[-600:])


async def sql(query: str, **params):
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(query), params)
        rows = result.mappings().all() if result.returns_rows else None
        await db.commit()
        return rows


async def call(fn, **kwargs):
    """Calls a router function the way FastAPI would; returns (status, body)."""
    async with AsyncSessionLocal() as db:
        try:
            body = await fn(db=db, **kwargs)
            return 200, body
        except HTTPException as exc:
            return exc.status_code, exc.detail


async def seed_base() -> None:
    await sql("INSERT INTO core.organizations (id, name) VALUES (:id, 'Payroll Test Org')", id=ORG)
    await sql("""INSERT INTO core.users (id, email, full_name, organization_id)
                 VALUES (:id, :email, 'Payroll Tester', :org)""", id=USER_ID, org=ORG,
              email=f"payroll.tester+{ORG[:8]}@example.test")


async def seed_rest() -> None:
    for eid, name in ((E1, "Alice Split"), (E2, "Bob Hourly"), (E3, "Cara Loan")):
        await sql("""INSERT INTO hr.employees (id, organization_id, employee_name, employment_status)
                     VALUES (:id, :org, :name, 'active')""", id=eid, org=ORG, name=name)
    await sql("""INSERT INTO finance.cash_accounts (id, organization_id, account_code, account_name, account_type, currency)
                 VALUES (:u, :org, 'BANK-USD', 'Bank USD', 'bank', 'USD'), (:z, :org, 'BANK-ZWG', 'Bank ZWG', 'bank', 'ZWG')""",
              u=USD_ACC, z=ZWG_ACC, org=ORG)
    await sql("""INSERT INTO finance.employee_pay_profiles
                   (organization_id, employee_id, pay_type, base_rate, overtime_rate, currency, secondary_currency, secondary_share_pct)
                 VALUES (:org, :e1, 'monthly_salary', 1000, 0, 'USD', 'ZWG', 40),
                        (:org, :e2, 'hourly', 5, 0, 'USD', NULL, 0),
                        (:org, :e3, 'monthly_salary', 300, 0, 'USD', NULL, 0)""", org=ORG, e1=E1, e2=E2, e3=E3)

    async def table(tax_type, currency, basis, bands):
        tid = str(uuid.uuid4())
        await sql("""INSERT INTO finance.tax_rate_tables (id, organization_id, tax_type, currency, period_basis, effective_from, name)
                     VALUES (:id, :org, :t, :c, :b, '2026-01-01', 'TEST FIXTURE')""", id=tid, org=ORG, t=tax_type, c=currency, b=basis)
        for i, (lo, hi, rate, fixed) in enumerate(bands, 1):
            await sql("""INSERT INTO finance.tax_rate_bands (organization_id, rate_table_id, band_order, lower_bound, upper_bound, rate_pct, fixed_deduction)
                         VALUES (:org, :t, :o, :lo, :hi, :r, :f)""", org=ORG, t=tid, o=i, lo=lo, hi=hi, r=rate, f=fixed)

    await table("paye", "USD", "monthly", [(0, 100, 0, 0), (100, 300, 20, 20), (300, 1000, 25, 35), (1000, None, 30, 85)])
    await table("nssa_employee", "USD", "monthly", [(0, 700, 4.5, 0)])
    await table("nssa_employer", "USD", "monthly", [(0, 700, 4.5, 0)])
    await table("aids_levy", "USD", "monthly", [(0, None, 3, 0)])
    await table("bonus_exemption", "USD", "annual", [(0, 700, 0, 0)])
    await table("paye", "ZWG", "monthly", [(0, None, 10, 0)])
    await table("nssa_employee", "ZWG", "monthly", [(0, None, 4.5, 0)])

    codes = {r["code"]: str(r["id"]) for r in await sql("SELECT id, code FROM finance.pay_elements WHERE organization_id = :org", org=ORG)}
    for emp, code, amount, balance in ((E1, "HOUSING", 200, None), (E1, "PENSION", 40, None), (E1, "MEDAID", 60, None),
                                       (E3, "LOAN", 100, 150)):
        status, body = await call(payroll_config.create_employee_pay_element, user=USER, payload=payroll_config.EmployeePayElementCreate(
            employee_id=emp, pay_element_id=codes[code], amount=D(amount), loan_balance=D(balance) if balance else None,
            effective_from=date(2026, 1, 1)))
        check(f"assign {code}", status == 200, body)


def run_payload(month: int, items, **extra):
    return payroll_runs.PayrollRunCreate(
        period_start=date(2026, month, 1), period_end=date(2026, month, 28), payment_date=date(2026, month, 25),
        cash_account_id=USD_ACC, items=items, **extra)


async def main() -> None:
    await seed_base()
    psql_file(MIGRATION, "migration 287 applies cleanly")
    psql_file(MIGRATION, "migration 287 re-applies cleanly (idempotent)")
    seeded = await sql("SELECT code, is_system FROM finance.pay_elements WHERE organization_id = :org ORDER BY code", org=ORG)
    check("starter codes seeded for existing org", len(seeded) == 13, [r["code"] for r in seeded])
    check("settings row seeded", bool(await sql("SELECT 1 FROM finance.payroll_settings WHERE organization_id = :org", org=ORG)))

    await seed_rest()

    # --- Run 1: January, split pay, bonus, loan -----------------------------------
    jan_items = [
        payroll_runs.PayrollItemInput(employee_id=E1),
        payroll_runs.PayrollItemInput(employee_id=E2, regular_hours=D(160), overtime_hours=D(10),
                                      one_offs=[payroll_runs.PayrollOneOffInput(code="BONUS", amount=D(400))]),
        payroll_runs.PayrollItemInput(employee_id=E3),
    ]
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(1, jan_items))
    check("split run without exchange rate is refused", status == 422 and "exchange rate" in str(body), (status, body))

    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(
        1, jan_items, secondary_currency="ZWG", exchange_rate=D("26.5"), secondary_cash_account_id=ZWG_ACC))
    check("January run created", status == 200, body)
    run1 = body["data"]["id"] if status == 200 else None
    check("no warnings with every table configured", status == 200 and body["data"]["warnings"] == [], body)

    items = {r["employee_id"]: r for r in await sql(
        "SELECT * FROM finance.payroll_items WHERE payroll_run_id = :r", r=run1)} if run1 else {}
    a = items.get(uuid.UUID(E1))
    # Alice: basic 1000 + housing 200; insurable 1200 capped 700 -> NSSA 31.50;
    # taxable 1200 - 40 pension - 31.50 = 1128.50 -> x30% - 85 = 253.55;
    # credit 30 (50% of medical aid) -> PAYE 223.55; AIDS 6.71;
    # net 1200 - 223.55 - 6.71 - 31.50 - 100 = 838.24; ZWG share 40% x 26.5.
    check("Alice taxable income", a and a["taxable_gross"] == D("1128.50"), a and a["taxable_gross"])
    check("Alice PAYE after medical-aid credit", a and a["paye_amount"] == D("223.55") and a["tax_credits_amount"] == D("30.00"),
          a and (a["paye_amount"], a["tax_credits_amount"]))
    check("Alice AIDS levy", a and a["aids_levy_amount"] == D("6.71"), a and a["aids_levy_amount"])
    check("Alice net pay", a and a["net_pay"] == D("838.24"), a and a["net_pay"])
    check("Alice ZWG net", a and a["net_pay_secondary"] == D("8885.34"), a and a["net_pay_secondary"])
    for emp, row in items.items():
        check(f"GL invariant net = gross - tax - NSSA - other ({emp})",
              row["net_pay"] == row["gross_pay"] - row["tax_deduction"] - row["statutory_deduction"] - row["other_deduction"])
    b = items.get(uuid.UUID(E2))
    check("Bob bonus fully exempt (within 700 allowance)", b and b["bonus_exempt_amount"] == D("400.00"), b and b["bonus_exempt_amount"])
    check("Bob earnings = 800 basic + 75 OT + 400 bonus", b and b["total_earnings"] == D("1275.00"), b and b["total_earnings"])
    lines = await sql("""SELECT pi.employee_id, l.code, l.line_kind, l.amount FROM finance.payroll_item_lines l
                         JOIN finance.payroll_items pi ON pi.id = l.payroll_item_id WHERE l.payroll_run_id = :r""", r=run1)
    alice_codes = sorted(r["code"] for r in lines if str(r["employee_id"]) == E1)
    check("Alice payslip lines", alice_codes == sorted(["BASIC", "HOUSING", "PENSION", "MEDAID", "PAYE", "AIDS", "NSSA", "NSSA_ER"]), alice_codes)
    cara_loan = [r["amount"] for r in lines if str(r["employee_id"]) == E3 and r["code"] == "LOAN"]
    check("Cara loan instalment 100", cara_loan == [D("100.00")], cara_loan)

    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(
        1, [payroll_runs.PayrollItemInput(employee_id=E2, regular_hours=D(8))]))
    check("double payment in overlapping period is refused", status == 409 and "Bob Hourly" in str(body), (status, body))

    status, body = await call(payroll_config.close_payroll_period, user=USER, month="2026-01")
    check("cannot close month with a draft run", status == 409, (status, body))

    for action in ("approve", "post"):
        status, body = await call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=run1,
                                  payload=payroll_runs.PayrollRunDecision(action=action))
        check(f"January run {action}", status == 200, body)

    cash = {r["currency"]: r["amount"] for r in await sql(
        "SELECT currency, amount FROM finance.cashbook_transactions WHERE organization_id = :org", org=ORG)}
    run_row = (await sql("SELECT net_pay, secondary_net_pay FROM finance.payroll_runs WHERE id = :r", r=run1))[0]
    check("cashbook ZWG payment = run ZWG net", cash.get("ZWG") == run_row["secondary_net_pay"], (cash, run_row))
    check("cashbook USD + ZWG/26.5 = run net (to the cent)",
          abs(cash.get("USD", D(0)) + cash.get("ZWG", D(0)) / D("26.5") - run_row["net_pay"]) <= D("0.01"), (cash, run_row))

    liab = {(r["liability_type"], r["currency"]): r["total"] for r in await sql(
        """SELECT l.liability_type, l.currency, SUM(ll.computed_amount) AS total
           FROM finance.statutory_liabilities l JOIN finance.statutory_liability_lines ll ON ll.liability_id = l.id
           WHERE l.organization_id = :org GROUP BY 1, 2""", org=ORG)}
    check("PAYE owed in USD and ZWG", ("paye", "USD") in liab and ("paye", "ZWG") in liab, liab)
    check("AIDS levy now accrued", ("aids_levy", "USD") in liab, liab)
    check("ZWG PAYE = Alice's ZWG share", liab.get(("paye", "ZWG")) == a["paye_secondary"], (liab.get(("paye", "ZWG")), a and a["paye_secondary"]))

    loan = (await sql("""SELECT epe.loan_balance, epe.is_active FROM finance.employee_pay_elements epe
                         JOIN finance.pay_elements pe ON pe.id = epe.pay_element_id WHERE pe.code = 'LOAN' AND epe.organization_id = :org""", org=ORG))[0]
    check("loan balance reduced to 50", loan["loan_balance"] == D("50.00") and loan["is_active"], dict(loan))

    status, body = await call(finance_statutory.recompute_statutory, user=USER, payload=finance_statutory.RecomputePayload(
        period_start=date(2026, 1, 1), period_end=date(2026, 1, 31)))
    liab_after = {(r["liability_type"], r["currency"]): r["total"] for r in await sql(
        """SELECT l.liability_type, l.currency, SUM(ll.computed_amount) AS total
           FROM finance.statutory_liabilities l JOIN finance.statutory_liability_lines ll ON ll.liability_id = l.id
           WHERE l.organization_id = :org GROUP BY 1, 2""", org=ORG)}
    check("statutory recompute is idempotent and currency-aware", status == 200 and liab_after == liab, (status, liab_after))

    status, body = await call(payroll_config.payroll_ytd, user=USER, year=2026, employee_id=None)
    ytd = {str(r["employee_id"]): r for r in body["data"]} if status == 200 else {}
    check("YTD has 3 employees", len(ytd) == 3, ytd.keys())
    check("YTD PAYE matches January item", ytd.get(E1, {}).get("paye_amount") == a["paye_amount"])

    # --- Month lock --------------------------------------------------------------
    status, body = await call(payroll_config.close_payroll_period, user=USER, month="2026-01")
    check("January closed", status == 200, body)
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=payroll_runs.PayrollRunCreate(
        period_start=date(2026, 1, 29), period_end=date(2026, 1, 31), payment_date=date(2026, 1, 31),
        cash_account_id=USD_ACC, items=[payroll_runs.PayrollItemInput(employee_id=E2, regular_hours=D(8))]))
    check("run dated in a closed month is refused", status == 409 and "closed" in str(body), (status, body))
    status, body = await call(payroll_config.reopen_payroll_period, user=USER, month="2026-01",
                              payload=payroll_config.ReopenPayload(reason="Testing reopen"))
    check("January reopened with a reason", status == 200, body)

    # --- Run 2: February, loan clears, bonus exemption runs out --------------------
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(2, [
        payroll_runs.PayrollItemInput(employee_id=E2, regular_hours=D(160),
                                      one_offs=[payroll_runs.PayrollOneOffInput(code="BONUS", amount=D(500))]),
        payroll_runs.PayrollItemInput(employee_id=E3),
    ]))
    check("February run created", status == 200, body)
    run2 = body["data"]["id"] if status == 200 else None
    feb = {r["employee_id"]: r for r in await sql("SELECT * FROM finance.payroll_items WHERE payroll_run_id = :r", r=run2)}
    check("Bob bonus exemption limited to the 300 left this year",
          feb[uuid.UUID(E2)]["bonus_exempt_amount"] == D("300.00"), feb[uuid.UUID(E2)]["bonus_exempt_amount"])
    feb_loan = await sql("""SELECT l.amount FROM finance.payroll_item_lines l WHERE l.payroll_run_id = :r AND l.code = 'LOAN'""", r=run2)
    check("Cara loan capped at remaining 50", [r["amount"] for r in feb_loan] == [D("50.00")], feb_loan)

    status, body = await call(payroll_config.close_payroll_period, user=USER, month="2026-02")
    check("cannot close February with draft run", status == 409, (status, body))
    for action in ("approve", "post"):
        status, body = await call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=run2,
                                  payload=payroll_runs.PayrollRunDecision(action=action))
        check(f"February run {action}", status == 200, body)
    loan = (await sql("""SELECT epe.loan_balance, epe.is_active FROM finance.employee_pay_elements epe
                         JOIN finance.pay_elements pe ON pe.id = epe.pay_element_id WHERE pe.code = 'LOAN' AND epe.organization_id = :org""", org=ORG))[0]
    check("loan cleared and ended", loan["loan_balance"] == D("0.00") and not loan["is_active"], dict(loan))

    # --- Negative net refused ------------------------------------------------------
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(3, [
        payroll_runs.PayrollItemInput(employee_id=E3, other_deduction=D(5000))]))
    check("deductions above pay are refused", status == 422 and "exceed" in str(body), (status, body))

    # --- Separate-tables method ------------------------------------------------------
    status, body = await call(payroll_config.put_payroll_settings, user=USER,
                              payload=payroll_config.PayrollSettingsUpdate(split_tax_method="separate_tables"))
    check("switch to separate_tables", status == 200 and body["data"]["split_tax_method"] == "separate_tables", body)
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(
        3, [payroll_runs.PayrollItemInput(employee_id=E1)], secondary_currency="ZWG", exchange_rate=D(25),
        secondary_cash_account_id=ZWG_ACC))
    check("March split run (separate tables) created", status == 200, body)
    mar = (await sql("SELECT * FROM finance.payroll_items WHERE payroll_run_id = :r", r=body["data"]["id"]))[0] if status == 200 else None
    # ZWG portion: 1200 x 40% x 25 = 12,000 gross; NSSA 4.5% insurable 12,000 = 540;
    # pre-tax 40 x 0.4 x 25 = 400; taxable 12,000 - 400 - 540 = 11,060; PAYE 10% = 1,106;
    # credit 30 x 0.4 x 25 = 300 -> 806.
    check("ZWG PAYE from ZWG table", mar and mar["paye_secondary"] == D("806.00"), mar and mar["paye_secondary"])
    check("trace records the method", mar and mar["calc_trace"]["method"] == "separate_tables", mar and mar["calc_trace"].get("method"))
    status, body = await call(payroll_config.put_payroll_settings, user=USER,
                              payload=payroll_config.PayrollSettingsUpdate(base_currency="ZWG"))
    check("base currency change blocked while a run is open", status == 409, (status, body))

    # --- Pay code rules ----------------------------------------------------------------
    status, body = await call(payroll_config.create_pay_element, user=USER, payload=payroll_config.PayElementCreate(
        code="BADCR", name="Bad", element_type="earning", tax_credit_pct=D(50)))
    check("tax-credit % on an earning is refused", status == 422, (status, body))
    basic_id = (await sql("SELECT id FROM finance.pay_elements WHERE organization_id = :org AND code = 'BASIC'", org=ORG))[0]["id"]
    status, body = await call(payroll_config.update_pay_element, user=USER, element_id=basic_id,
                              payload=payroll_config.PayElementBase(is_taxable=False))
    check("system code tax flags are locked", status == 409, (status, body))

    try:
        payroll_config.PayElementCreate(code="PENS_ER", name="Pension (employer)", element_type="employer_contribution")
        check("employer-cost pay codes cannot be created", False)
    except ValueError:
        check("employer-cost pay codes cannot be created", True)

    # --- Two runs posting against the same loan at once ---------------------------------
    E4 = str(uuid.uuid4())
    await sql("""INSERT INTO hr.employees (id, organization_id, employee_name, employment_status)
                 VALUES (:id, :org, 'Dan Race', 'active')""", id=E4, org=ORG)
    await sql("""INSERT INTO finance.employee_pay_profiles (organization_id, employee_id, pay_type, base_rate, overtime_rate, currency)
                 VALUES (:org, :e, 'monthly_salary', 300, 0, 'USD')""", org=ORG, e=E4)
    loan_code = (await sql("SELECT id FROM finance.pay_elements WHERE organization_id = :org AND code = 'LOAN'", org=ORG))[0]["id"]
    status, body = await call(payroll_config.create_employee_pay_element, user=USER, payload=payroll_config.EmployeePayElementCreate(
        employee_id=E4, pay_element_id=loan_code, amount=D(100), loan_balance=D(100), effective_from=date(2026, 1, 1)))
    check("assign race loan", status == 200, body)
    race_runs = []
    for month in (4, 5):
        status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=run_payload(
            month, [payroll_runs.PayrollItemInput(employee_id=E4)]))
        race_runs.append(body["data"]["id"] if status == 200 else None)
        if status == 200:
            await call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=race_runs[-1],
                       payload=payroll_runs.PayrollRunDecision(action="approve"))
    check("two drafts each take the full 100 instalment", all(race_runs), race_runs)
    if all(race_runs):
        results = await asyncio.gather(*(
            call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=r, payload=payroll_runs.PayrollRunDecision(action="post"))
            for r in race_runs))
        statuses = sorted(s for s, _ in results)
        check("concurrent posts: one posts, the other is refused", statuses == [200, 409], results)
        bal = (await sql("SELECT loan_balance FROM finance.employee_pay_elements WHERE employee_id = :e", e=E4))[0]["loan_balance"]
        check("race loan recovered once, not twice", bal == D("0.00"), bal)

    # --- Retired endpoints ---------------------------------------------------------------
    status, body = await call(financial_performance.decide_payroll_run, user=USER, run_id=run1,
                              payload=financial_performance.PayrollDecisionPayload(status="approved"))
    check("retired financial-performance payroll endpoint returns 410", status == 410, (status, body))

    print()
    print(f"{len(FAILURES)} failure(s)" if FAILURES else "ALL CHECKS PASSED")
    sys.exit(1 if FAILURES else 0)


asyncio.run(main())
