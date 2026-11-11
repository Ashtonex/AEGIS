"""End-to-end check of payroll phase 2 (migration 297) against an ISOLATED
database: legacy bank details carried over, payment accounts with history,
bank files per currency (blocking and warning rules, masking, repeat guard,
custom layouts), monthly PAYE and NSSA schedules reconciled to the statutory
liabilities, and the export log.

Rate tables seeded here are FIXTURES with round numbers, not ZIMRA/NSSA rates.
Needs the same local schema-only database as verify_payroll_engine_phase1.py.
Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55433/payroll_test
    set PSQL=<path to psql.exe>
    python scripts/verify_payroll_phase2.py
"""

import asyncio
import csv
import io
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
from pydantic import ValidationError  # noqa: E402
from sqlalchemy import text  # noqa: E402

from core.database import AsyncSessionLocal  # noqa: E402
from routers import financial_performance, payroll_exports, payroll_runs  # noqa: E402

FAILURES: list[str] = []
MIGRATIONS = [ROOT / "migrations" / "296_payroll_engine_phase1.sql", ROOT / "migrations" / "297_payroll_returns_bank_files.sql"]
ORG = str(uuid.uuid4())
USER_ID = str(uuid.uuid4())
USER = {"sub": USER_ID, "org_id": ORG, "role": "SUPERADMIN"}
ALICE, BOB, CARA, DAN = (str(uuid.uuid4()) for _ in range(4))
USD_ACC, ZWG_ACC = str(uuid.uuid4()), str(uuid.uuid4())
MONTH = "2026-03"


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
    async with AsyncSessionLocal() as db:
        try:
            return 200, await fn(db=db, **kwargs)
        except HTTPException as exc:
            return exc.status_code, exc.detail


async def table(tax_type, currency, bands):
    tid = str(uuid.uuid4())
    await sql("""INSERT INTO finance.tax_rate_tables (id, organization_id, tax_type, currency, period_basis, effective_from, name)
                 VALUES (:id, :org, :t, :c, 'monthly', '2026-01-01', 'TEST FIXTURE')""", id=tid, org=ORG, t=tax_type, c=currency)
    for i, (lo, hi, rate, fixed) in enumerate(bands, 1):
        await sql("""INSERT INTO finance.tax_rate_bands (organization_id, rate_table_id, band_order, lower_bound, upper_bound, rate_pct, fixed_deduction)
                     VALUES (:org, :t, :o, :lo, :hi, :r, :f)""", org=ORG, t=tid, o=i, lo=lo, hi=hi, r=rate, f=fixed)


async def seed() -> None:
    await sql("INSERT INTO core.organizations (id, name) VALUES (:id, 'Payroll Phase 2 Org')", id=ORG)
    await sql("""INSERT INTO core.users (id, email, full_name, organization_id)
                 VALUES (:id, :email, 'Payroll Tester', :org)""", id=USER_ID, org=ORG,
              email=f"payroll.p2+{ORG[:8]}@example.test")
    for eid, name, nid in ((ALICE, "Alice Split Moyo", "63-111111A63"), (BOB, "Bob Banda", "63-222222B63"),
                           (CARA, "=Cara Cash", None), (DAN, "Dan Late", "63-444444D63")):
        await sql("""INSERT INTO hr.employees (id, organization_id, employee_name, employment_status, national_id,
                                                employee_number, date_of_birth, start_date)
                     VALUES (:id, :org, :name, 'active', :nid, :num, '1990-05-01', '2025-01-01')""",
                  id=eid, org=ORG, name=name, nid=nid, num="E-" + eid[:4])
    await sql("""INSERT INTO finance.cash_accounts (id, organization_id, account_code, account_name, account_type, currency)
                 VALUES (:u, :org, 'BANK-USD', 'Bank USD', 'bank', 'USD'), (:z, :org, 'BANK-ZWG', 'Bank ZWG', 'bank', 'ZWG')""",
              u=USD_ACC, z=ZWG_ACC, org=ORG)
    # Bob's profile carries legacy bank details (pre-297 style) to be carried over.
    await sql("""INSERT INTO finance.employee_pay_profiles
                   (organization_id, employee_id, pay_type, base_rate, overtime_rate, currency, secondary_currency,
                    secondary_share_pct, tax_number, nssa_number, bank_name, bank_account_number)
                 VALUES (:org, :a, 'monthly_salary', 1000, 0, 'USD', 'ZWG', 40, 'TIN-A', 'SSN-A', NULL, NULL),
                        (:org, :b, 'monthly_salary', 900, 0, 'USD', NULL, 0, 'TIN-B', 'SSN-B', 'CBZ', '0099887766'),
                        (:org, :c, 'monthly_salary', 300, 0, 'USD', NULL, 0, NULL, NULL, NULL, NULL),
                        (:org, :d, 'monthly_salary', 500, 0, 'USD', NULL, 0, NULL, NULL, NULL, NULL)""",
              org=ORG, a=ALICE, b=BOB, c=CARA, d=DAN)
    await table("paye", "USD", [(0, 100, 0, 0), (100, 300, 20, 20), (300, 1000, 25, 35), (1000, None, 30, 85)])
    await table("nssa_employee", "USD", [(0, 700, 4.5, 0)])
    await table("nssa_employer", "USD", [(0, 700, 4.5, 0)])
    await table("aids_levy", "USD", [(0, None, 3, 0)])


def account(employee, currency, method="bank", **kw):
    return payroll_exports.PaymentAccountCreate(employee_id=employee, currency=currency, method=method, **kw)


async def main() -> None:
    await seed()
    for path in MIGRATIONS:
        psql_file(path, f"{path.name} applies")
    psql_file(MIGRATIONS[1], "297 re-applies cleanly (idempotent)")

    legacy = await sql("""SELECT currency, method, bank_name, account_number, is_active FROM finance.employee_payment_accounts
                          WHERE employee_id = :b""", b=BOB)
    check("legacy profile bank details carried over once",
          len(legacy) == 1 and legacy[0]["account_number"] == "0099887766" and legacy[0]["currency"] == "USD", legacy)

    status, body = await call(financial_performance.get_payroll_profiles, user=USER)
    bob_profile = next((p for p in body["data"] if str(p["employee_id"]) == BOB), {}) if status == 200 else {}
    check("pay profile list masks the legacy account number", bob_profile.get("bank_account_number") == "••••7766", bob_profile)

    try:
        account(ALICE, "USD", bank_name="FBC", account_number="1", effective_from=date(2099, 1, 1))
        check("future-dated payment account is refused", False)
    except ValidationError:
        check("future-dated payment account is refused", True)
    try:
        account(ALICE, "USD", bank_name="FBC")
        check("bank account without a number is refused", False)
    except ValidationError:
        check("bank account without a number is refused", True)

    for emp, cur, kw in ((ALICE, "USD", {"bank_name": "Stanbic", "branch_code": "3101", "account_number": "0012345678"}),
                         (ALICE, "ZWG", {"bank_name": "Stanbic", "account_number": "9140000111"}),
                         (BOB, "USD", {"bank_name": "CBZ", "account_number": "0099887799", "account_name": "B Banda"})):
        status, body = await call(payroll_exports.create_payment_account, user=USER, payload=account(emp, cur, **kw))
        check(f"payment account {cur} saved", status == 200, body)
    status, body = await call(payroll_exports.create_payment_account, user=USER, payload=account(CARA, "USD", "cash"))
    check("cash payment saved", status == 200, body)
    bob_rows = await sql("""SELECT account_number, is_active, end_reason FROM finance.employee_payment_accounts
                            WHERE employee_id = :b ORDER BY created_at""", b=BOB)
    check("Bob's change ended the old account and kept it",
          [(r["account_number"], r["is_active"]) for r in bob_rows] == [("0099887766", False), ("0099887799", True)], bob_rows)
    status, body = await call(payroll_exports.get_payment_accounts, user=USER, employee_id=None, include_ended=True)
    check("account list is masked", status == 200 and all("••••" in (r["account_number"] or "••••") for r in body["data"]), body)

    # --- A March run: Alice split, Bob, Cara (cash), Dan (no account yet) -----------
    status, body = await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=payroll_runs.PayrollRunCreate(
        period_start=date(2026, 3, 1), period_end=date(2026, 3, 31), payment_date=date(2026, 3, 25),
        cash_account_id=USD_ACC, secondary_currency="ZWG", exchange_rate=D(25), secondary_cash_account_id=ZWG_ACC,
        items=[payroll_runs.PayrollItemInput(employee_id=e) for e in (ALICE, BOB, CARA, DAN)]))
    check("March run created", status == 200, body)
    run = body["data"]["id"] if status == 200 else None
    run_uuid = uuid.UUID(run) if run else uuid.uuid4()

    status, body = await call(payroll_exports.preview_bank_file, user=USER, run_id=run_uuid, currency="USD")
    check("draft run has no bank file", status == 409, (status, body))
    status, body = await call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=run,
                              payload=payroll_runs.PayrollRunDecision(action="approve"))
    check("run approved", status == 200, body)

    status, body = await call(payroll_exports.preview_bank_file, user=USER, run_id=run_uuid, currency="USD")
    preview = body["data"] if status == 200 else {}
    check("missing account blocks the file", status == 200 and any("Dan Late" in p for p in preview.get("problems", [])), body)
    status, body = await call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
                              payload=payroll_exports.BankFileRequest(currency="USD", confirm_recent_changes=True))
    check("producing a blocked file is refused", status == 409 and "Dan Late" in str(body), (status, body))

    status, body = await call(payroll_exports.create_payment_account, user=USER,
                              payload=account(DAN, "USD", "mobile_money", mobile_number="0771234567"))
    check("mobile money saved", status == 200, body)
    status, body = await call(payroll_exports.preview_bank_file, user=USER, run_id=run_uuid, currency="USD")
    preview = body["data"] if status == 200 else {}
    totals = preview.get("totals", {})
    check("bank + cash + mobile money = run's USD pay",
          not preview.get("problems") and totals.get("bank", 0) + totals.get("cash", 0) + totals.get("mobile_money", 0) == totals.get("run"),
          totals)
    check("bank rows: Alice and Bob only", sorted(r["employee_name"] for r in preview.get("rows", [])) == ["Alice Split Moyo", "Bob Banda"],
          preview.get("rows"))
    check("cash and mobile money listed apart", [r["employee_name"] for r in preview.get("cash", [])] == ["=Cara Cash"]
          and [r["employee_name"] for r in preview.get("mobile_money", [])] == ["Dan Late"], preview)
    check("preview masks account numbers", all(r["account_number"].startswith("••••") for r in preview.get("rows", [])), preview.get("rows"))
    check("recent account changes flagged", len(preview.get("recent_changes", [])) == 2, preview.get("recent_changes"))

    status, body = await call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
                              payload=payroll_exports.BankFileRequest(currency="USD"))
    check("recent changes must be confirmed", status == 409 and "changed in the last" in str(body), (status, body))
    status, body = await call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
                              payload=payroll_exports.BankFileRequest(currency="USD", confirm_recent_changes=True))
    check("USD bank file produced", status == 200, body)
    content = body["data"]["content"] if status == 200 else ""
    rows = list(csv.reader(io.StringIO(content)))
    check("bank file: header + 2 rows with full account numbers",
          len(rows) == 3 and rows[0][0] == "Employee No" and {"0012345678", "0099887799"} <= {r[4] for r in rows[1:]}, rows)
    check("bank file total equals bank rows", status == 200 and D(str(body["data"]["total"])) == totals.get("bank"), body)

    status, body = await call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
                              payload=payroll_exports.BankFileRequest(currency="USD", confirm_recent_changes=True))
    check("second USD file needs confirmation", status == 409 and "already produced" in str(body), (status, body))

    # Two simultaneous first requests for the ZWG file: only one may pass.
    results = await asyncio.gather(*(
        call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
             payload=payroll_exports.BankFileRequest(currency="ZWG", confirm_recent_changes=True))
        for _ in range(2)))
    check("concurrent ZWG files: one produced, the other refused as a repeat",
          sorted(s for s, _ in results) == [200, 409] and any("already produced" in str(b) for _, b in results), results)
    status, body = next(((s, b) for s, b in results if s == 200), results[0])
    zwg_cash = (await sql("SELECT net_pay_secondary FROM finance.payroll_items WHERE payroll_run_id = :r AND employee_id = :a",
                          r=run, a=ALICE))[0]["net_pay_secondary"] if run else None
    check("ZWG bank file: Alice's ZWG net only",
          status == 200 and body["data"]["rows"] == 1 and D(str(body["data"]["total"])) == zwg_cash, (status, body, zwg_cash))

    # --- Custom layout -----------------------------------------------------------
    status, body = await call(payroll_exports.create_export_layout, user=USER, payload=payroll_exports.LayoutCreate(
        kind="bank", name="Stanbic bulk", delimiter=";", include_header=False, date_format="YYYYMMDD",
        columns=[payroll_exports.LayoutColumn(field="constant", value="SAL"),
                 payroll_exports.LayoutColumn(field="account_number"),
                 payroll_exports.LayoutColumn(field="amount"),
                 payroll_exports.LayoutColumn(field="payment_date")]))
    check("custom bank layout saved", status == 200, body)
    layout_id = body["data"]["id"] if status == 200 else None
    status, body = await call(payroll_exports.create_export_layout, user=USER, payload=payroll_exports.LayoutCreate(
        kind="bank", name="No amount", columns=[payroll_exports.LayoutColumn(field="account_number")]))
    check("bank layout without Amount refused", status == 422, (status, body))
    status, body = await call(payroll_exports.produce_bank_file, user=USER, run_id=run_uuid,
                              payload=payroll_exports.BankFileRequest(currency="USD", layout_id=layout_id,
                                                                      confirm_repeat=True, confirm_recent_changes=True))
    first = (body["data"]["content"].splitlines() or [""])[0] if status == 200 else ""
    check("custom layout used: no header, ; separator, constant, YYYYMMDD",
          status == 200 and first.startswith("SAL;") and first.endswith(";20260325"), (status, first))
    status, body = await call(payroll_exports.update_export_layout, user=USER, layout_id="builtin:bank",
                              payload=payroll_exports.LayoutBase(name="x"))
    check("built-in layout can't be changed", status == 409, (status, body))
    status, body = await call(payroll_exports.update_export_layout, user=USER, layout_id=layout_id,
                              payload=payroll_exports.LayoutBase(include_header=True))
    check("custom layout updated", status == 200, body)
    status, body = await call(payroll_exports.get_export_layouts, user=USER, kind="bank")
    check("layout list: built-in + custom", status == 200 and [r["name"] for r in body["data"]] == ["Standard bank file (CSV)", "Stanbic bulk"], body)

    # --- Post, then the month's returns ---------------------------------------------
    status, body = await call(payroll_runs.decide_payroll_run, user=USER, _={}, run_id=run,
                              payload=payroll_runs.PayrollRunDecision(action="post"))
    check("run posted", status == 200, body)
    await call(payroll_runs.create_payroll_run, user=USER, _={}, payload=payroll_runs.PayrollRunCreate(
        # Late February pay, paid in March: same tax month, no overlap with run 1.
        period_start=date(2026, 2, 1), period_end=date(2026, 2, 28), payment_date=date(2026, 3, 30),
        cash_account_id=USD_ACC, items=[payroll_runs.PayrollItemInput(employee_id=DAN)]))

    status, body = await call(payroll_exports.preview_return, user=USER, kind="paye", month=MONTH, currency="USD")
    paye = body["data"] if status == 200 else {}
    check("PAYE schedule: 4 employees", len(paye.get("rows", [])) == 4, paye.get("rows"))
    recon = {r["liability_type"]: r for r in paye.get("reconciliation", [])}
    check("PAYE schedule reconciles to the liability", recon.get("paye", {}).get("difference") == D("0")
          and recon["paye"]["liability_accrued"] > 0, recon)
    check("AIDS levy schedule reconciles", recon.get("aids_levy", {}).get("difference") == D("0"), recon)
    warnings = " ".join(paye.get("warnings", []))
    check("warns: missing tax numbers, missing national ID, unposted run",
          "No tax number for:" in warnings and "=Cara Cash" in warnings and "Dan Late" in warnings
          and "No national ID for: =Cara Cash." in warnings
          and "Not included (not posted yet)" in warnings, paye.get("warnings"))
    alice = next((r for r in paye.get("rows", []) if r["employee_name"] == "Alice Split Moyo"), {})
    check("Alice USD row is the USD share only", alice and alice["paye"] < D("223.55") and alice["tax_number"] == "TIN-A", alice)

    status, body = await call(payroll_exports.preview_return, user=USER, kind="paye", month=MONTH, currency="ZWG")
    zpaye = body["data"] if status == 200 else {}
    zrecon = {r["liability_type"]: r for r in zpaye.get("reconciliation", [])}
    check("ZWG PAYE schedule: Alice only, reconciles",
          [r["employee_name"] for r in zpaye.get("rows", [])] == ["Alice Split Moyo"] and zrecon.get("paye", {}).get("difference") == D("0"),
          (zpaye.get("rows"), zrecon))

    status, body = await call(payroll_exports.preview_return, user=USER, kind="nssa", month=MONTH, currency="USD")
    nssa = body["data"] if status == 200 else {}
    nrecon = {r["liability_type"]: r for r in nssa.get("reconciliation", [])}
    check("NSSA schedule reconciles (employee and employer)",
          nrecon.get("nssa_employee", {}).get("difference") == D("0") and nrecon.get("nssa_employer", {}).get("difference") == D("0"), nrecon)
    check("NSSA ceiling read from the rate table", nssa.get("nssa_ceiling") == D("700.00"), nssa.get("nssa_ceiling"))
    check("insurable earnings capped at the ceiling", all(r["insurable_capped"] <= D("700") for r in nssa.get("rows", [])), nssa.get("rows"))

    status, body = await call(payroll_exports.export_return, user=USER, kind="paye",
                              payload=payroll_exports.ReturnRequest(month=MONTH, currency="USD"))
    content = body["data"]["content"] if status == 200 else ""
    out = list(csv.reader(io.StringIO(content)))
    check("PAYE file: built-in header and 4 rows", status == 200 and out[0][:3] == ["Employee No", "Surname", "First Names"] and len(out) == 5,
          (status, out[:2]))
    cara = next((r for r in out if "Cara" in ",".join(r)), [])
    check("formula in a name is neutralised in the file", any(c.startswith("'=") for c in cara), cara)
    status, body = await call(payroll_exports.export_return, user=USER, kind="nssa",
                              payload=payroll_exports.ReturnRequest(month="2026-01", currency="USD"))
    check("empty month refused", status == 409, (status, body))

    status, body = await call(payroll_exports.get_exports, user=USER, limit=50)
    kinds = sorted(r["kind"] for r in body["data"]) if status == 200 else []
    check("export log: 3 bank files + 1 PAYE schedule", kinds == ["bank", "bank", "bank", "paye"], kinds)
    logged = (await sql("SELECT content_sha256 FROM finance.payroll_exports WHERE organization_id = :org AND kind = 'paye'", org=ORG))
    check("log keeps the file's checksum, not its content", len(logged) == 1 and len(logged[0]["content_sha256"]) == 64, logged)

    print()
    print(f"{len(FAILURES)} failure(s)" if FAILURES else "ALL CHECKS PASSED")
    sys.exit(1 if FAILURES else 0)


asyncio.run(main())
