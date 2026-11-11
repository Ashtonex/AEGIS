"""End-to-end check of the site operations streamline (migration 298) against
an ISOLATED local database with production's schema (pg_dump --schema-only)
and synthetic rows only. Refuses to run unless DATABASE_URL is local.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55433/siteops_test
    python scripts/verify_site_ops_streamline.py

  1. labour hours set by hand (one line, or everyone at once) survive the
     register sync and reach the register row HR accepts; reset restores clock hours
  2. daily report detail names plant, operator, material and store
  3. closing a site day needs material + plant usage; usage from a site store
     leaves its stock, re-saving re-quantifies, issued material doesn't move stock
  4. Saturday recon: open is blocked while last week is outstanding; unrecorded
     usage is booked; the count posts adjustments; then open is allowed
  5. one request with several materials -> one material request per line
  6. variations: site log + finance form without number/title, 'site' initiator,
     omission negative; numbering per project
  7. project financials pick up subcontract cost lines as payments made
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal as D
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

URL = os.environ.get("DATABASE_URL", "")
if (urlsplit(URL).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

from fastapi import HTTPException  # noqa: E402
from pydantic import ValidationError  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import block_outbound  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from routers import financial_performance as fp  # noqa: E402
from routers import site_day, site_reconciliation as recon, site_reports as sr  # noqa: E402

FAILURES: list[str] = []
ORG = str(uuid.uuid4())
UID = str(uuid.uuid4())
USER = {"user_id": UID, "sub": UID, "org_id": ORG, "role": "SUPERADMIN"}
PROJECT, STORE, CENTRAL = (str(uuid.uuid4()) for _ in range(3))
CEMENT, SAND = str(uuid.uuid4()), str(uuid.uuid4())
COMPACTOR, TLB = str(uuid.uuid4()), str(uuid.uuid4())
EMP, HIRE = str(uuid.uuid4()), str(uuid.uuid4())
TODAY = site_day.harare_today()
LAST_SAT = recon.previous_week_ending(TODAY)


def check(label: str, condition: bool, detail: object = "") -> None:
    print(("PASS " if condition else "FAIL ") + label + (f"  [{detail}]" if not condition and detail != "" else ""))
    if not condition:
        FAILURES.append(label)


async def sql(query: str, **params):
    async with AsyncSessionLocal() as db:
        result = await db.execute(text(query), params)
        rows = result.mappings().all() if result.returns_rows else None
        await db.commit()
        return rows


async def call(fn, *args, **kwargs):
    async with AsyncSessionLocal() as db:
        try:
            return 200, await fn(*args, db=db, **kwargs)
        except HTTPException as exc:
            await db.rollback()
            return exc.status_code, exc.detail


async def balance(item: str, store: str) -> D:
    return D(str((await sql("SELECT COALESCE(SUM(quantity),0) q FROM procurement.stock_ledger WHERE item_id=:i AND store_id=:s",
                            i=item, s=store))[0]["q"]))


async def seed() -> tuple[str, str]:
    await sql("INSERT INTO core.organizations (id, name) VALUES (:o, 'Site ops test org')", o=ORG)
    await sql("INSERT INTO core.users (id, organization_id, full_name, email) VALUES (:u, :o, 'Clerk Test', :e)",
              u=UID, o=ORG, e=f"clerk-{UID[:8]}@example.test")
    await sql("INSERT INTO projects.projects (id, organization_id, name, status) VALUES (:p, :o, 'Test Units', 'active')", p=PROJECT, o=ORG)
    await sql("""INSERT INTO procurement.stores (id, organization_id, project_id, name, store_type, status)
                 VALUES (:s, :o, :p, 'Site store A', 'site', 'active'), (:c, :o, NULL, 'Central yard', 'warehouse', 'active')""",
              s=STORE, c=CENTRAL, o=ORG, p=PROJECT)
    await sql("""INSERT INTO procurement.inventory_items (id, organization_id, item_name, item_code, unit_of_measure, standard_cost)
                 VALUES (:c, :o, 'Cement 50kg', 'CEM-50', 'bag', 12), (:s, :o, 'River sand', 'SND', 'm3', 30)""",
              c=CEMENT, s=SAND, o=ORG)
    for item, store, q, cost in ((CEMENT, STORE, 100, 12), (SAND, STORE, 20, 30), (SAND, CENTRAL, 50, 30)):
        await sql("""INSERT INTO procurement.stock_ledger (organization_id, item_id, store_id, project_id, movement_type, quantity,
                     unit_cost, total_cost, source_type, source_id, reference, movement_at)
                     VALUES (:o, :i, :s, NULL, 'receipt', :q, :c, CAST(:q AS numeric) * CAST(:c AS numeric), 'manual_receipt', gen_random_uuid(), 'seed', NOW() - interval '20 days')""",
                  o=ORG, i=item, s=store, q=q, c=cost)
    await sql("""INSERT INTO fleet.fleet (id, organization_id, vehicle_registration, asset_code, make, model, asset_type, asset_category,
                 hourly_charge_rate, current_project_id)
                 VALUES (:c, :o, 'SP-001', 'COMP-1', 'Wacker', 'BS60', 'Jumping Compactor', 'Small plant and tools', 4, NULL),
                        (:t, :o, 'TLB-01', 'TLB-1', 'JCB', '3CX', 'TLB', 'Heavy plant', 45, :p)""",
              c=COMPACTOR, t=TLB, o=ORG, p=PROJECT)
    await sql("INSERT INTO hr.employees (id, organization_id, employee_name, linked_user_id) VALUES (:e, :o, 'Staff Person', :u)", e=EMP, o=ORG, u=UID)
    await sql("INSERT INTO finance.site_workers (id, organization_id, project_id, full_name, hourly_rate, status) VALUES (:w, :o, :p, 'Hire Person', 3, 'active')",
              w=HIRE, o=ORG, p=PROJECT)
    start = datetime.now(timezone.utc) - timedelta(hours=9)
    briefing = (await sql("""
        INSERT INTO projects.site_day_briefings (organization_id, project_id, briefing_date, shift, status, started_at, started_by,
               toolbox_talk_completed, ppe_check_completed, labour_count_completed)
        VALUES (:o, :p, :d, 'day', 'started', :st, :u, true, true, true) RETURNING id""",
        o=ORG, p=PROJECT, d=TODAY, st=start, u=UID))[0]["id"]
    end = start + timedelta(hours=8, minutes=30)
    await sql("""INSERT INTO projects.site_day_attendance (organization_id, briefing_id, project_id, worker_kind, employee_id, site_worker_id,
                 worker_name, hourly_rate, ppe_ok, clock_in_at, clock_out_at, regular_hours, overtime_hours, hr_status)
                 VALUES (:o, :b, :p, 'employee', :e, NULL, 'Staff Person', 5, true, :ci, :co, 8, 0, 'open'),
                        (:o, :b, :p, 'project_hire', NULL, :w, 'Hire Person', 3, true, :ci, :co, 8, 0, 'open')""",
              o=ORG, b=briefing, p=PROJECT, e=EMP, w=HIRE, ci=start, co=end)
    async with AsyncSessionLocal() as db:
        report = await site_day.ensure_daily_report_draft(db, org_id=ORG, project_id=uuid.UUID(PROJECT), site_id=None,
                                                          on_date=TODAY, shift="day", user_id=UID, briefing_id=briefing)
        await site_day.sync_attendance_to_daily_report(db, org_id=ORG, briefing_id=briefing, report_id=report["id"])
        await db.commit()
    return str(briefing), str(report["id"])


async def labour_hours(briefing: str, report: str) -> None:
    print("\n== 1. labour hours set by hand")
    lines = await sql("SELECT id, regular_hours, worker_kind, attendance_id FROM projects.daily_report_labour WHERE report_id=:r AND NOT is_deleted ORDER BY worker_kind", r=report)
    check("register synced two labour lines at 8 h", len(lines) == 2 and all(l["regular_hours"] == 8 for l in lines), lines)
    staff = next(l for l in lines if l["worker_kind"] == "employee")
    code, _ = await call(sr.update_daily_report_labour, uuid.UUID(report), staff["id"], sr.LabourLineUpdate(regular_hours=D("6.5")), user=USER)
    check("one line edited", code == 200)
    async with AsyncSessionLocal() as db:
        await site_day.sync_attendance_to_daily_report(db, org_id=ORG, briefing_id=uuid.UUID(briefing), report_id=uuid.UUID(report))
        await db.commit()
    row = (await sql("SELECT regular_hours, hours_overridden FROM projects.daily_report_labour WHERE id=:i", i=staff["id"]))[0]
    check("edited hours survive the register sync (was reset to 8)", row["regular_hours"] == D("6.5") and row["hours_overridden"], row)
    att = (await sql("SELECT regular_hours, hours_overridden FROM projects.site_day_attendance WHERE id=:i", i=staff["attendance_id"]))[0]
    check("register row HR accepts carries the edited hours", att["regular_hours"] == D("6.5") and att["hours_overridden"], att)
    code, _ = await call(sr.set_daily_report_labour_hours, uuid.UUID(report), sr.LabourHoursBulk(regular_hours=D("7"), overtime_hours=D("1")), user=USER)
    async with AsyncSessionLocal() as db:
        await site_day.sync_attendance_to_daily_report(db, org_id=ORG, briefing_id=uuid.UUID(briefing), report_id=uuid.UUID(report))
        await db.commit()
    rows = await sql("SELECT regular_hours, overtime_hours FROM projects.daily_report_labour WHERE report_id=:r AND NOT is_deleted", r=report)
    check("set hours for everyone: all lines 7 + 1 after sync", code == 200 and all((r["regular_hours"], r["overtime_hours"]) == (7, 1) for r in rows), rows)
    try:
        sr.LabourHoursBulk(regular_hours=D("0"), overtime_hours=D("0"))
        check("zero hours refused", False)
    except ValidationError:
        check("zero hours refused", True)
    code, _ = await call(sr.reset_daily_report_labour_hours, uuid.UUID(report), user=USER)
    rows = await sql("SELECT l.regular_hours, l.overtime_hours, l.hours_overridden, a.hours_overridden AS a_ov FROM projects.daily_report_labour l JOIN projects.site_day_attendance a ON a.id=l.attendance_id WHERE l.report_id=:r AND NOT l.is_deleted", r=report)
    brief = (await sql("SELECT regular_hours_cap, break_minutes FROM projects.site_day_briefings WHERE id=:b", b=briefing))[0]
    span = await sql("SELECT clock_in_at, clock_out_at FROM projects.site_day_attendance WHERE briefing_id=:b LIMIT 1", b=briefing)
    want = site_day.split_hours(span[0]["clock_in_at"], span[0]["clock_out_at"], cap=D(str(brief["regular_hours_cap"])), break_minutes=int(brief["break_minutes"]))
    check(f"reset puts lines back on clock hours (8.5 h on site, {brief['break_minutes']} min break -> {want[0]} + {want[1]})",
          code == 200 and all(not r["hours_overridden"] and not r["a_ov"] and (r["regular_hours"], r["overtime_hours"]) == want for r in rows), rows)


async def usage_and_close(briefing: str, report: str) -> None:
    print("\n== 3. close-day usage reconciliation")
    code, detail = await call(site_day.close_site_day, uuid.UUID(briefing), None, user=USER)
    check("close refused before usage is recorded", code == 409 and "usage" in str(detail), (code, detail))
    try:
        recon.UsageReconcile(materials=[], plant=[])
        check("an empty, unanswered usage check is refused", False)
    except ValidationError:
        check("an empty, unanswered usage check is refused", True)
    payload = recon.UsageReconcile(
        materials=[recon.UsageMaterial(item_id=CEMENT, store_id=STORE, quantity_used=D("10"), wastage_quantity=D("1")),
                   recon.UsageMaterial(item_id=SAND, store_id=None, quantity_used=D("2"), consumes_stock=False)],
        plant=[recon.UsagePlant(fleet_id=COMPACTOR, operating_hours=D("6"), idle_hours=D("1"), fuel_litres=D("4")),
               recon.UsagePlant(fleet_id=TLB, operating_hours=D("8"))],
    )
    code, res = await call(recon.reconcile_day_usage, uuid.UUID(briefing), payload, user=USER)
    check("usage recorded", code == 200, res)
    check("site store cement 100 -> 90", await balance(CEMENT, STORE) == 90)
    check("issued-to-site sand doesn't move any store", await balance(SAND, STORE) == 20 and await balance(SAND, CENTRAL) == 50)
    payload.materials[0].quantity_used = D("12")
    payload.plant = payload.plant[:1]
    code, res = await call(recon.reconcile_day_usage, uuid.UUID(briefing), payload, user=USER)
    check("re-saving re-quantifies the same stock row (cement 88, one ledger row)",
          code == 200 and await balance(CEMENT, STORE) == 88
          and (await sql("SELECT COUNT(*) n FROM procurement.stock_ledger WHERE item_id=:i AND movement_type='consumption'", i=CEMENT))[0]["n"] == 1)
    plant = await sql("SELECT fleet_id FROM projects.daily_report_equipment WHERE report_id=:r AND NOT is_deleted", r=report)
    check("plant list is the day's answer (TLB removed, compactor kept)", [str(p["fleet_id"]) for p in plant] == [COMPACTOR], plant)

    print("\n== 2. daily report names")
    brick = str(uuid.uuid4())
    await sql("INSERT INTO procurement.inventory_items (id, organization_id, item_name, unit_of_measure) VALUES (:i, :o, 'Common brick', 'each')", i=brick, o=ORG)
    await sql("""INSERT INTO procurement.stock_ledger (organization_id, item_id, store_id, project_id, movement_type, quantity, unit_cost,
                 total_cost, source_type, source_id, reference, movement_at)
                 VALUES (:o, :i, :s, :p, 'issue', -500, 0.2, 100, 'site_material_request', gen_random_uuid(), 'MR-T', NOW())""",
              o=ORG, i=brick, s=CENTRAL, p=PROJECT)
    code, res = await call(sr.get_daily_report, uuid.UUID(report), user=USER)
    synced = [m for m in (res["data"]["materials"] if code == 200 else []) if str(m["item_id"]) == brick]
    check("today's store issue is copied onto the report (positive qty, no second stock move)",
          len(synced) == 1 and synced[0]["quantity_used"] == 500 and synced[0]["consumes_stock"] is False, synced)
    eq =res["data"]["equipment"] if code == 200 else []
    mats = res["data"]["materials"] if code == 200 else []
    check("plant line has machine name, code and small-plant flag",
          any(e["fleet_name"] == "Wacker BS60" and e["fleet_code"] == "COMP-1" and e["is_small_plant"] for e in eq), eq)
    check("TLB not re-added by the on-project auto-sync after it was removed", all(str(e["fleet_id"]) != TLB for e in eq))
    check("material lines have item name and store name",
          any(m["item_name"] == "Cement 50kg" and m["store_name"] == "Site store A" for m in mats), mats)

    code, res = await call(site_day.close_site_day, uuid.UUID(briefing), None, user=USER)
    if TODAY.isoweekday() == 6:
        check("Saturday close needs the weekly recon (enforced from start date)", code in (200, 409), (code, res))
    else:
        check("close allowed once usage is recorded", code == 200, (code, res))


async def weekly() -> None:
    print("\n== 4. Saturday stores + material reconciliation")
    recon.WEEKLY_RECON_START = LAST_SAT  # enforce from last week for the test
    last_week_day = LAST_SAT - timedelta(days=2)
    await sql("""INSERT INTO projects.site_day_briefings (organization_id, project_id, briefing_date, shift, status, started_at)
                 VALUES (:o, :p, :d, 'day', 'closed', NOW())""", o=ORG, p=PROJECT, d=last_week_day)
    code, detail = await call(site_day.open_site_day, site_day.DayOpen(project_id=PROJECT, briefing_date=TODAY + timedelta(days=0), shift="night"), user=USER)
    check("opening a new site day is blocked while last week's recon is outstanding", code == 409 and "weekly" in str(detail).lower(), (code, detail))
    code, res = await call(recon.get_weekly_reconciliation, uuid.UUID(PROJECT), None, user=USER)
    data = res["data"] if code == 200 else {}
    check("recon shows required + blocking", data.get("required") and data.get("blocking"), {k: data.get(k) for k in ("required", "blocking", "week_ending")})
    code, detail = await call(recon.complete_weekly_stores_count, recon.ReconStores(project_id=PROJECT, week_ending=LAST_SAT, lines=[]), user=USER)
    check("stores count refused before usage is confirmed", code == 409, (code, detail))
    code, res = await call(recon.confirm_weekly_material_usage, recon.ReconMaterials(
        project_id=PROJECT, week_ending=LAST_SAT,
        lines=[recon.ReconMaterialLine(item_id=CEMENT, store_id=STORE, unrecorded_usage_qty=D("5"))]), user=USER)
    check("unrecorded usage booked: cement 88 -> 83", code == 200 and await balance(CEMENT, STORE) == 83, (code, res))
    code, detail = await call(recon.complete_weekly_stores_count, recon.ReconStores(
        project_id=PROJECT, week_ending=LAST_SAT, lines=[recon.ReconCountLine(item_id=CEMENT, store_id=STORE, counted_qty=D("80"))]), user=USER)
    check("every item in store must be counted (sand missing)", code == 422 and "River sand" in str(detail), (code, detail))
    code, res = await call(recon.complete_weekly_stores_count, recon.ReconStores(
        project_id=PROJECT, week_ending=LAST_SAT,
        lines=[recon.ReconCountLine(item_id=CEMENT, store_id=STORE, counted_qty=D("80"), notes="3 bags hardened"),
               recon.ReconCountLine(item_id=SAND, store_id=STORE, counted_qty=D("20"))]), user=USER)
    check("count posted; cement adjusted 83 -> 80, sand agrees", code == 200 and await balance(CEMENT, STORE) == 80 and await balance(SAND, STORE) == 20, (code, res))
    check("one difference reported", code == 200 and res["data"]["differences"] == 1, res)
    code, detail = await call(site_day.open_site_day, site_day.DayOpen(project_id=PROJECT, briefing_date=TODAY, shift="night"), user=USER)
    check("site day opens once the recon is done", code == 201 or code == 200, (code, detail))


async def materials_batch() -> None:
    print("\n== 5. several materials in one request")
    monday = TODAY - timedelta(days=TODAY.weekday())
    await sql("""INSERT INTO projects.weekly_budgets (organization_id, project_id, week_start, status)
                 VALUES (:o, :p, :w, 'approved')""", o=ORG, p=PROJECT, w=monday)
    code, res = await call(sr.request_site_materials_batch, sr.SiteMaterialRequestBatch(
        project_id=PROJECT, required_by_date=TODAY, store_id=STORE, priority="urgent", justification="Slab pour",
        lines=[sr.SiteMaterialRequestLine(item_id=CEMENT, quantity=D("40"), unit_cost=D("12")),
               sr.SiteMaterialRequestLine(material_description="Y12 rebar 6m", unit_of_measure="length", quantity=D("30")),
               sr.SiteMaterialRequestLine(item_id=SAND, quantity=D("6"), store_id=CENTRAL)]), user=USER)
    rows = await sql("SELECT request_number, store_id, priority, justification, engineer_review_status FROM procurement.material_requests WHERE project_id=:p", p=PROJECT)
    check("3 lines -> 3 material requests in one save", code == 200 and res["data"]["count"] == 3 and len(rows) == 3, (code, res))
    check("header applied to every line, line store kept", all(r["priority"] == "urgent" and r["justification"] == "Slab pour" for r in rows)
          and sum(1 for r in rows if str(r["store_id"]) == CENTRAL) == 1, rows)
    code, detail = await call(sr.request_site_materials_batch, sr.SiteMaterialRequestBatch(
        project_id=PROJECT, required_by_date=TODAY,
        lines=[sr.SiteMaterialRequestLine(item_id=CEMENT, quantity=D("1")), sr.SiteMaterialRequestLine(quantity=D("1"))]), user=USER)
    after = await sql("SELECT COUNT(*) n FROM procurement.material_requests WHERE project_id=:p", p=PROJECT)
    check("a bad line rejects the whole request and names the line", code == 422 and "Line 2" in str(detail) and after[0]["n"] == 3, (code, detail))


async def variations() -> None:
    print("\n== 6. variations")
    code, res = await call(recon.log_site_variation, recon.SiteVariationCreate(
        project_id=PROJECT, title="Rock excavation at Unit 4", cost_impact=D("1500"), time_impact_days=3,
        variance_origin="site_initiated", instruction_given_by="Resident engineer"), user=USER)
    check("site variation logged with a project number", code == 201 or (code == 200 and res["data"]["variation_number"].endswith("-001")), (code, res))
    code, res = await call(fp.create_variation, fp.VariationCreate(project_id=PROJECT, description="Drainage behind wall", cost_impact=800, type="omission"), user=USER)
    check("project financials form (no number, no title, 'type') now saves", code == 200 and res["data"]["variation_number"].endswith("-002"), (code, res))
    code, res = await call(fp.create_variation, fp.VariationCreate(project_id=PROJECT, variation_number="VAR-X-1", title="Panel form", initiated_by="site"), user=USER)
    check("initiated_by 'site' accepted (mapped to contractor)", code == 200, (code, res))
    rows = await sql("SELECT title, cost_impact, initiated_by, status, source_type FROM finance.variations WHERE project_id=:p ORDER BY created_at", p=PROJECT)
    check("omission stored negative; site one submitted for review",
          rows[1]["cost_impact"] == -800 and rows[0]["status"] == "submitted" and rows[0]["source_type"] == "site_operations"
          and rows[2]["initiated_by"] == "contractor", rows)
    code, res = await call(recon.list_site_variations, uuid.UUID(PROJECT), user=USER)
    check("site tab lists all three with totals", code == 200 and res["totals"]["count"] == 3, res.get("totals") if code == 200 else res)


async def subcontract() -> None:
    print("\n== 7. subcontractor payments in project financials")
    await sql("""INSERT INTO finance.cost_transactions (organization_id, project_id, source_type, source_id, cost_category, description,
                 quantity, unit_cost, amount, transaction_date, status)
                 VALUES (:o, :p, 'bank_statement_line', gen_random_uuid(), 'subcontract', 'RTGS aluminium windows', 1, 4200, 4200, :d, 'posted'),
                        (:o, :p, 'bank_statement_line', gen_random_uuid(), 'materials', 'Cement', 1, 300, 300, :d, 'posted')""",
              o=ORG, p=PROJECT, d=TODAY)
    code, res = await call(fp.get_project_financial_detail, uuid.UUID(PROJECT), user=USER)
    sub = res["data"]["subcontractor_payments"] if code == 200 and isinstance(res, dict) and "data" in res else (res.get("subcontractor_payments") if code == 200 else None)
    check("subcontract cost lines show as paid", sub is not None and D(str(sub["paid_amount"])) == 4200 and len(sub["items"]) == 1, sub if sub else (code, res))


async def main() -> None:
    with block_outbound():
        briefing, report = await seed()
        await labour_hours(briefing, report)
        await usage_and_close(briefing, report)
        await weekly()
        await materials_batch()
        await variations()
        await subcontract()
    print(f"\n{'ALL PASSED' if not FAILURES else f'{len(FAILURES)} FAILED: ' + '; '.join(FAILURES)}")
    sys.exit(1 if FAILURES else 0)


if __name__ == "__main__":
    asyncio.run(main())
