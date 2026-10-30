"""End-to-end verification of the quotation workspace (migration 279) through
the real FastAPI app - router permission dependencies included - against an
ISOLATED database. Covers: existing-record compatibility, server-authoritative
totals and effective-dated VAT, four-eyes / SOP / permission rejections,
frozen revisions and their diff, client vs internal documents, award from an
issued revision, duplicate-safe handoff, optimistic concurrency, and a
1,000-line estimate.

Refuses to run unless DATABASE_URL points at localhost. Push/email are
stubbed (block_outbound).

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55432/aegis_test
    .venv/Scripts/python.exe scripts/verify_quotation_workspace.py
"""

import asyncio
import io
import json
import os
import secrets
import sys
import time
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

if (urlsplit(os.environ.get("DATABASE_URL", "")).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

JWT_SECRET = secrets.token_urlsafe(48)
JWT_ISSUER = "aegis-local-quotation-workspace-test"
os.environ["JWT_SECRET_KEY"] = JWT_SECRET
os.environ["JWT_ISSUER"] = JWT_ISSUER
os.environ.setdefault("ENVIRONMENT", "development")
os.environ.setdefault("BACKGROUND_JOBS_ENABLED", "false")
os.environ["RATE_LIMIT_ENABLED"] = "false"

import httpx  # noqa: E402
import jwt  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import FAILURES, block_outbound, check  # noqa: E402
from app.services.finance.project_forecast import execution_budget_total  # noqa: E402
from app.services.quotations import workspace as qws  # noqa: E402
from app.services.quotations.calculator import QuotationCalculator, build_calc_input_from_metadata  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from main import app  # noqa: E402

TAG = uuid.uuid4().hex[:6]


async def scalar(db, sql, **p):
    return (await db.execute(text(sql), p)).scalar()


async def make_user(db, org_id, name, role):
    uid = str(uuid.uuid4())
    email = f"{name.lower().replace(' ', '.')}.{TAG}@example.test"
    await db.execute(text("""INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted)
                             VALUES (:id, :org, :email, :name, true, false)"""),
                     {"id": uid, "org": org_id, "email": email, "name": name})
    await db.execute(text("INSERT INTO auth.users (id, email) VALUES (:id, :email) ON CONFLICT DO NOTHING"), {"id": uid, "email": email})
    role_id = await scalar(db, "SELECT id FROM core.roles WHERE organization_id = :org AND name = :name", org=org_id, name=role)
    assert role_id, f"role {role} missing in replica"
    await db.execute(text("INSERT INTO core.user_roles (user_id, role_id, organization_id) VALUES (:u, :r, :org)"),
                     {"u": uid, "r": role_id, "org": org_id})
    now = int(time.time())
    token = jwt.encode({
        "sub": uid, "aud": "authenticated", "iss": JWT_ISSUER, "iat": now, "exp": now + 3600, "role": "authenticated",
        "email": email, "app_metadata": {"org_id": org_id}, "user_metadata": {},
    }, JWT_SECRET, algorithm="HS256")
    return {"id": uid, "name": name, "headers": {"Authorization": f"Bearer {token}"}}


def items(n=3, *, ids=False):
    rows = [
        {"section": "Bill 1", "item_no": "1.1", "description": "Excavate foundation trenches", "qty": 120, "unit": "m3", "rate": 12.35,
         "buildup": [{"type": "labour", "name": "General hand", "unit": "hr", "qty": 1.5, "rate": 3.5},
                     {"type": "equipment", "name": "Excavator", "unit": "hr", "qty": 0.2, "rate": 35.5}]},
        {"section": "Bill 1", "item_no": "1.2", "description": "Concrete 25MPa in foundations", "qty": 33.3, "unit": "m3", "rate": 187.17,
         "buildup": [{"type": "material", "name": "Cement", "unit": "bag", "qty": 7, "rate": 11.5},
                     {"type": "material", "name": "River sand", "unit": "m3", "qty": 0.5, "rate": 25},
                     {"type": "material", "name": "Aggregate 19mm", "unit": "m3", "qty": 0.7, "rate": 30},
                     {"type": "labour", "name": "Concrete gang", "unit": "hr", "qty": 3, "rate": 4.04},
                     {"type": "equipment", "name": "Mixer", "unit": "hr", "qty": 0.5, "rate": 15}]},
        {"section": "Bill 2", "item_no": "2.1", "description": "230mm common brickwork", "qty": 412, "unit": "m2", "rate": 41.07,
         "buildup": [{"type": "material", "name": "Common bricks", "unit": "no", "qty": 100, "rate": 0.18},
                     {"type": "material", "name": "Cement", "unit": "bag", "qty": 0.6, "rate": 11.5},
                     {"type": "labour", "name": "Bricklayer", "unit": "hr", "qty": 2.5, "rate": 6.666}]},
    ][:n]
    return rows


def meta(item_rows, **kw):
    base = {
        "project_title": f"Workspace verification {TAG}", "reference_number": f"SNC-QT-VER-{TAG}",
        "quote_date": date.today().isoformat(), "valid_until_days": 30, "currency": "USD",
        "preliminaries": 2500, "overhead_pct": 5, "contingency_pct": 5, "profit_pct": 12, "apply_vat": True,
        "discount": 0, "provisional_sums": 0, "terms": "50% deposit, balance on completion.",
        "exclusions": ["Rock excavation"], "assumptions": ["Normal soil conditions"], "items": item_rows,
    }
    base.update(kw)
    return base


async def main() -> None:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    client = httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1:8000")
    Q = "/api/v1/quotations"

    async with AsyncSessionLocal() as db:
        org_id = str(await scalar(db, "SELECT id FROM core.organizations ORDER BY created_at LIMIT 1"))
        estimator = await make_user(db, org_id, f"Estimator {TAG}", "Estimations & Quotations Associate")
        reviewer = await make_user(db, org_id, f"Reviewer {TAG}", "Finance Manager")
        qs_author = await make_user(db, org_id, f"QS {TAG}", "Quantity Surveyor")
        sales = await make_user(db, org_id, f"Sales {TAG}", "Sales Executive")
        # Checklists left by an earlier run of this script would block every award.
        await db.execute(text("""UPDATE compliance.sop_templates SET is_active = false
                                 WHERE organization_id = :org AND name LIKE 'Pre-award checklist %'"""), {"org": org_id})
        await db.commit()

    # ------------------------------------------------------------------ A
    print("\nA. Existing (legacy-shaped) quotation stays intact")
    legacy_meta = meta([{k: v for k, v in i.items()} for i in items()])
    legacy_calc = QuotationCalculator.calculate(build_calc_input_from_metadata("legacy", legacy_meta))
    async with AsyncSessionLocal() as db:
        legacy_id = str(await scalar(db, """
            INSERT INTO finance.quotations (organization_id, created_by, client_name, quote_amount, metadata, status)
            VALUES (:org, :u, 'Legacy Client', :amt, CAST(:m AS jsonb), 'sent') RETURNING id
        """, org=org_id, u=estimator["id"], amt=legacy_calc.grand_total, m=json.dumps(legacy_meta, default=str)))
        await db.commit()
    r = await client.get(f"{Q}/{legacy_id}", headers=estimator["headers"])
    check(r.status_code == 200 and Decimal(str(r.json()["data"]["quote_amount"])) == legacy_calc.grand_total, "legacy GET returns its stored amount")
    r = await client.get(f"{Q}/{legacy_id}/workspace", headers=estimator["headers"])
    ws = r.json()["data"]
    check(r.status_code == 200, "workspace opens a legacy record")
    check(Decimal(ws["breakdown"]["grand_total"]) == legacy_calc.grand_total, "workspace total == legacy calculator total (15.5% legacy VAT kept)")
    check(any(f["code"] == "tax_rate_unconfigured" for f in ws["flags"]), "legacy default VAT is flagged, not silent")
    check(ws["quotation"]["status"] == "sent", "status untouched by opening")

    # ------------------------------------------------------------------ B / C
    print("\nB/C. Create + save: server-authoritative totals, effective-dated VAT, line ids")
    async with AsyncSessionLocal() as db:
        await db.execute(text("""UPDATE finance.tax_rate_tables SET is_active = false
                                 WHERE organization_id = :org AND tax_type = 'vat_output' AND currency = 'USD'"""), {"org": org_id})
        table_id = await scalar(db, """
            INSERT INTO finance.tax_rate_tables (organization_id, tax_type, currency, period_basis, effective_from, name, is_active)
            VALUES (:org, 'vat_output', 'USD', 'monthly', DATE '2020-01-01' + CAST(:offset AS integer), 'VAT test 15%', true) RETURNING id
        """, org=org_id, offset=int(TAG, 16) % 1500)
        await db.execute(text("""INSERT INTO finance.tax_rate_bands (organization_id, rate_table_id, band_order, rate_pct)
                                 VALUES (:org, :t, 1, 15)"""), {"org": org_id, "t": table_id})
        await db.commit()
    r = await client.post(f"{Q}/", headers=estimator["headers"], json={
        "client_name": f"Workspace Client {TAG}", "quote_amount": 1.0, "status": "draft",
        "metadata": {**meta(items()), "boq_approval": {"status": "approved"}},
    })
    check(r.status_code == 200, f"estimator creates quotation ({r.status_code})")
    qid = r.json()["data"]["id"]
    r = await client.get(f"{Q}/{qid}/workspace", headers=estimator["headers"])
    ws = r.json()["data"]
    q = ws["quotation"]
    stored = q["metadata"]
    expected = QuotationCalculator.calculate(build_calc_input_from_metadata(qid, stored))
    check(Decimal(str(q["quote_amount"])) == expected.grand_total and expected.grand_total != Decimal("1.0"),
          f"browser quote_amount ignored; stored {q['quote_amount']} == server calc {expected.grand_total}")
    check(stored.get("vat_rate") == "0.15" and str(stored.get("vat_rate_source", "")).startswith("rate_table:"),
          f"VAT resolved from effective-dated rate table ({stored.get('vat_rate')}, {stored.get('vat_rate_source')})")
    check(all(i.get("line_id") for i in stored["items"]), "every line has a stable line_id")
    check((stored.get("boq_approval") or {}).get("status") != "approved", "forged boq_approval on create was stripped")
    taxable = expected.taxable_amount
    check(expected.tax_amount == (taxable * Decimal("0.15")).quantize(Decimal("0.01")), "tax = 15% of taxable (discount before tax)")
    b = ws["breakdown"]
    cost, selling, profit = Decimal(b["cost_total"]), Decimal(b["selling_ex_tax"]), Decimal(b["profit_realised"])
    check(abs(Decimal(str(b["markup_pct"])) - (profit / cost * 100)) < Decimal("0.01") and
          abs(Decimal(str(b["margin_pct"])) - (profit / selling * 100)) < Decimal("0.01"),
          f"markup {b['markup_pct']}% (profit/cost) vs margin {b['margin_pct']}% (profit/selling)")
    row_version = q["row_version"]
    line_ids = [i["line_id"] for i in stored["items"]]

    # Save round-trip keeps ids, reload reconciles
    edited = json.loads(json.dumps(stored))
    edited["items"].append({"section": "Bill 2", "item_no": "2.2", "description": "Plaster to walls", "qty": 800, "unit": "m2", "rate": 9.45})
    r = await client.put(f"{Q}/{qid}", headers=estimator["headers"], json={"metadata": edited, "expected_row_version": row_version})
    check(r.status_code == 200, f"save with current version ({r.status_code})")
    saved = r.json()["data"]
    check([i["line_id"] for i in saved["items"]][:3] == line_ids and saved["items"][3].get("line_id"), "ids preserved, new line gets one")
    row_version = saved["row_version"]
    r = await client.get(f"{Q}/{qid}", headers=estimator["headers"])
    reloaded = r.json()["data"]
    recalc = QuotationCalculator.calculate(build_calc_input_from_metadata(qid, reloaded["metadata"]))
    check(Decimal(str(reloaded["quote_amount"])) == recalc.grand_total == Decimal(str(saved["quote_amount"])), "reload reconciles to calculator")

    # ------------------------------------------------------------------ D
    print("\nD. Governance - server rejections")
    r = await client.put(f"{Q}/{qid}", headers=sales["headers"], json={"client_name": "hijack"})
    check(r.status_code == 403, f"user without quotations.update cannot edit ({r.status_code})")
    r = await client.put(f"{Q}/{qid}", headers=estimator["headers"], json={"status": "won"})
    check(r.status_code == 409, f"status=won via save rejected ({r.status_code})")
    r = await client.post(f"{Q}/", headers=estimator["headers"], json={"client_name": "x", "status": "won"})
    check(r.status_code == 409, f"create already-won rejected ({r.status_code})")
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"], json={"kind": "issued"})
    check(r.status_code == 409 and "independent approval" in r.text, f"issue blocked without independent BOQ approval ({r.status_code})")
    r = await client.post(f"{Q}/{qid}/decision", headers=estimator["headers"], json={"status": "won"})
    check(r.status_code == 403, f"estimator without quotations.decide cannot award ({r.status_code})")
    # QS author self-approval
    r = await client.post(f"{Q}/", headers=qs_author["headers"], json={"client_name": "Self cert", "metadata": meta(items(1))})
    own_id = r.json()["data"]["id"]
    r = await client.post(f"{Q}/{own_id}/boq-approval", headers=qs_author["headers"], json={"decision": "approved"})
    check(r.status_code == 403, f"author cannot approve own BOQ ({r.status_code})")
    r = await client.post(f"{Q}/{own_id}/decision", headers=qs_author["headers"], json={"status": "won"})
    check(r.status_code == 403, f"author cannot mark own quotation won ({r.status_code})")
    r = await client.post(f"{Q}/", headers=reviewer["headers"], json={"client_name": "Convert self cert", "metadata": meta(items(1))})
    fm_own = r.json()["data"]["id"]
    r = await client.post(f"{Q}/{fm_own}/convert-to-project", headers=reviewer["headers"], json={})
    check(r.status_code == 403, f"author cannot convert-to-project (marks won) on own quotation ({r.status_code})")
    async with AsyncSessionLocal() as db:
        check(await scalar(db, "SELECT status FROM finance.quotations WHERE id = :id", id=fm_own) != "won", "rejected convert left status unchanged")

    # independent approval then issue
    r = await client.post(f"{Q}/{qid}/boq-approval", headers=reviewer["headers"], json={"decision": "approved", "notes": "Checked"})
    check(r.status_code == 200, f"independent reviewer approves BOQ ({r.status_code})")

    # ------------------------------------------------------------------ E
    print("\nE. Revisions - freeze, diff, immutability")
    r = await client.get(f"{Q}/{qid}/workspace", headers=estimator["headers"])
    row_version = r.json()["data"]["quotation"]["row_version"]
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"],
                          json={"kind": "issued", "change_reason": "First issue", "expected_row_version": row_version})
    check(r.status_code == 201, f"issue Rev 1 ({r.status_code} {r.text[:160]})")
    rev1 = r.json()["data"]
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"], json={"kind": "issued"})
    check(r.status_code == 201 and r.json()["data"].get("already_issued") and r.json()["data"]["id"] == rev1["id"], "re-issue of identical figures returns Rev 1")
    async with AsyncSessionLocal() as db:
        check(await scalar(db, "SELECT count(*) FROM finance.quotation_revisions WHERE quotation_id = :q", q=qid) == 1, "still exactly one revision")
        check(await scalar(db, "SELECT status FROM finance.quotations WHERE id = :q", q=qid) == "sent", "issue moved draft -> sent")
    r = await client.get(f"{Q}/{qid}/revisions/{rev1['id']}", headers=estimator["headers"])
    rev1_full = r.json()["data"]

    r = await client.get(f"{Q}/{qid}", headers=estimator["headers"])
    current = r.json()["data"]
    draft = json.loads(json.dumps(current["metadata"]))
    draft["items"][0]["qty"] = 131.5
    draft["items"][0]["rate"] = 13.1
    draft["items"][1]["description"] = "Concrete 30MPa in foundations"
    removed = draft["items"].pop(2)
    draft["items"].append({"section": "Bill 3", "item_no": "3.1", "description": "Roof sheeting", "qty": 210, "unit": "m2", "rate": 18.6,
                           "buildup": [{"type": "material", "name": "IBR sheet 0.5mm", "unit": "m2", "qty": 1.1, "rate": 11}]})
    r = await client.put(f"{Q}/{qid}", headers=estimator["headers"], json={"metadata": draft, "expected_row_version": current["row_version"]})
    check(r.status_code == 200, f"post-issue edit saves to the working draft ({r.status_code})")
    r = await client.get(f"{Q}/{qid}/revisions/compare", headers=estimator["headers"], params={"base": rev1["id"], "target": "working"})
    cmp = r.json()["data"]
    v = sum(Decimal(x) for x in cmp["variance"].values())
    check(r.status_code == 200 and v == Decimal(cmp["direct_cost_delta"]) and Decimal(cmp["rounding"]) == 0,
          f"variance (qty/rate/interaction/added/removed) {v} reconciles to direct-cost delta {cmp['direct_cost_delta']}")
    check(cmp["counts"]["added"] == 1 and cmp["counts"]["removed"] == 1 and cmp["counts"]["changed"] == 2, f"diff counts {cmp['counts']}")
    check(any(line["line_id"] == removed["line_id"] and line["change"] == "removed" for line in cmp["lines"]), "removed line matched by stable id")
    r = await client.get(f"{Q}/{qid}/revisions/{rev1['id']}", headers=estimator["headers"])
    check(r.json()["data"]["grand_total"] == rev1_full["grand_total"] and r.json()["data"]["snapshot"]["items"] == rev1_full["snapshot"]["items"],
          "Rev 1 snapshot unchanged after draft edits")
    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("UPDATE finance.quotation_revisions SET grand_total = 1 WHERE id = :id"), {"id": rev1["id"]})
            await db.commit()
            check(False, "direct SQL update of a revision was blocked")
        except Exception as exc:  # noqa: BLE001
            await db.rollback()
            check("immutable" in str(exc), "direct SQL update of a revision is rejected by trigger")
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"], json={"kind": "issued", "change_reason": "Client query"})
    check(r.status_code == 409, f"Rev 2 blocked until changed lines are re-approved ({r.status_code})")
    await client.post(f"{Q}/{qid}/boq-approval", headers=reviewer["headers"], json={"decision": "approved"})
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"], json={"kind": "issued", "change_reason": "Client query"})
    check(r.status_code == 201 and r.json()["data"]["revision_number"] == 2, "Rev 2 issued after re-approval")
    rev2 = r.json()["data"]
    check(rev2["parent_revision_id"] == rev1["id"], "Rev 2 parent is Rev 1")

    # ------------------------------------------------------------------ F
    print("\nF. Client vs internal documents")
    from pypdf import PdfReader

    for rev in (rev1, rev2):
        r = await client.get(f"{Q}/{qid}/revisions/{rev['id']}/documents/client-pdf", headers=estimator["headers"])
        check(r.status_code == 200 and r.content.startswith(b"%PDF"), f"client PDF Rev {rev['revision_number']} renders")
        pdf_text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)
        check(f"{Decimal(rev['grand_total']):,.2f}" in pdf_text, f"client PDF Rev {rev['revision_number']} total == frozen {rev['grand_total']}")
        leaked = [w for w in ("187.17", "12.35", "Cement", "Overhead", "Contingency", "Profit", "Markup", "margin") if w in pdf_text]
        check(not leaked, f"client PDF Rev {rev['revision_number']} excludes cost rates/build-ups/markups {leaked}")
    r = await client.get(f"{Q}/{qid}/revisions/{rev1['id']}/documents/internal-xlsx", headers=estimator["headers"])
    check(r.status_code == 200 and r.content.startswith(b"PK"), "internal estimate workbook renders")

    # ------------------------------------------------------------------ G
    print("\nG. Award from issued revision + duplicate-safe handoff")
    async with AsyncSessionLocal() as db:
        sop_id = await scalar(db, """INSERT INTO compliance.sop_templates (organization_id, name, applies_to, blocks_quotation_win, is_active)
                                     VALUES (:org, :n, 'quotation', true, true) RETURNING id""", org=org_id, n=f"Pre-award checklist {TAG}")
        project_id = await scalar(db, """INSERT INTO projects.projects (organization_id, name, project_code, quotation_id)
                                         VALUES (:org, :n, :c, :q) RETURNING id""", org=org_id, n=f"Workspace project {TAG}", c=f"PRJ-{TAG}", q=qid)
        await db.execute(text("UPDATE finance.quotations SET project_id = :p WHERE id = :q"), {"p": project_id, "q": qid})
        await db.commit()
    r = await client.post(f"{Q}/{qid}/decision", headers=reviewer["headers"], json={"status": "won", "revision_id": rev1["id"]})
    check(r.status_code == 409 and "SOP" in r.text, f"award blocked by incomplete SOP checkpoint ({r.status_code})")
    async with AsyncSessionLocal() as db:
        await db.execute(text("""INSERT INTO compliance.sop_instances (organization_id, template_id, subject_type, subject_id, status)
                                 VALUES (:org, :t, 'quotation', :q, 'complete')"""), {"org": org_id, "t": sop_id, "q": qid})
        await db.commit()
    key = f"award-{TAG}"
    r = await client.post(f"{Q}/{qid}/decision", headers={**reviewer["headers"], "Idempotency-Key": key}, json={"status": "won", "revision_id": rev1["id"]})
    check(r.status_code == 200, f"independent reviewer awards Rev 1 ({r.status_code} {r.text[:200]})")
    award = r.json()["data"]
    check(award.get("awarded_revision_id") == rev1["id"] and award.get("budget_basis") == "issued revision 1", f"budget basis {award.get('budget_basis')}")
    rev1_calc = QuotationCalculator.calculate(build_calc_input_from_metadata(qid, rev1_full["snapshot"]))
    async with AsyncSessionLocal() as db:
        budgets = (await db.execute(text("""SELECT total_amount FROM finance.project_budgets
                                            WHERE project_id = :p AND status = 'approved' AND is_deleted = false"""), {"p": project_id})).all()
    check(len(budgets) == 1 and Decimal(str(budgets[0].total_amount)) == Decimal(str(execution_budget_total(rev1_calc))).quantize(Decimal("0.01")),
          f"one approved budget seeded from Rev 1 ({budgets[0].total_amount if budgets else None} vs {execution_budget_total(rev1_calc)})")
    r2 = await client.post(f"{Q}/{qid}/decision", headers={**reviewer["headers"], "Idempotency-Key": key}, json={"status": "won", "revision_id": rev1["id"]})
    r3 = await client.post(f"{Q}/{qid}/decision", headers=reviewer["headers"], json={"status": "won", "revision_id": rev1["id"]})
    check(r2.status_code == 200 and r3.status_code == 200 and r3.json()["data"].get("already_decided"), "repeat award (same key / new key) changes nothing")
    async with AsyncSessionLocal() as db:
        check(await scalar(db, "SELECT count(*) FROM finance.project_budgets WHERE project_id = :p AND is_deleted = false", p=project_id) == 1, "no duplicate budget")

    original = qws.build_materials_schedule
    calls = {"n": 0}

    def flaky(snapshot):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("simulated failure mid-handoff")
        return original(snapshot)

    qws.build_materials_schedule = flaky
    try:
        r = await client.post(f"{Q}/{qid}/handoff/materials-schedule", headers=reviewer["headers"])
        check(r.status_code == 500, f"simulated failure surfaces as an error ({r.status_code})")
        async with AsyncSessionLocal() as db:
            check(await scalar(db, "SELECT count(*) FROM finance.quotation_handoff_packages WHERE quotation_id = :q", q=qid) == 0, "failed attempt left nothing behind")
        r = await client.post(f"{Q}/{qid}/handoff/materials-schedule", headers=reviewer["headers"])
        check(r.status_code == 201 and r.json()["data"]["created"], "retry creates the schedule")
        r = await client.post(f"{Q}/{qid}/handoff/materials-schedule", headers=reviewer["headers"])
        check(r.status_code == 201 and not r.json()["data"]["created"], "repeat returns the existing schedule")
        results = await asyncio.gather(*[client.post(f"{Q}/{qid}/handoff/materials-schedule", headers=reviewer["headers"]) for _ in range(4)])
        check(all(x.status_code == 201 for x in results), "concurrent repeats all succeed")
    finally:
        qws.build_materials_schedule = original
    async with AsyncSessionLocal() as db:
        check(await scalar(db, "SELECT count(*) FROM finance.quotation_handoff_packages WHERE quotation_id = :q", q=qid) == 1, "exactly one materials schedule")
        lines = json.loads(json.dumps(await scalar(db, "SELECT lines FROM finance.quotation_handoff_packages WHERE quotation_id = :q", q=qid)))
        if isinstance(lines, str):
            lines = json.loads(lines)
        cement = [line for line in lines if line["material"] == "Cement"]
        check(len(cement) == 1 and Decimal(cement[0]["quantity"]) == Decimal("33.3") * 7 + Decimal("412") * Decimal("0.6"),
              f"cement aggregated across lines from Rev 1 ({cement[0]['quantity'] if cement else None})")
        check(not any(line["material"] == "IBR sheet 0.5mm" for line in lines), "Rev 2-only material not in Rev 1 schedule")
        check(await scalar(db, "SELECT count(*) FROM procurement.purchase_orders WHERE project_id = :p", p=project_id) == 0, "no purchase order created")
    r = await client.get(f"{Q}/{qid}/handoff", headers=reviewer["headers"])
    h = r.json()["data"]
    check(r.status_code == 200 and h["budget"] and h["boq_lines"] == len(rev1_full["snapshot"]["items"]) and len(h["packages"]) == 1, f"handoff status reads real records (boq lines {h['boq_lines']})")
    r = await client.post(f"{Q}/{qid}/revisions", headers=estimator["headers"], json={"kind": "issued"})
    check(r.status_code == 409, "no new revision after award")
    r = await client.put(f"{Q}/{qid}", headers=estimator["headers"], json={"client_name": "edit after award"})
    check(r.status_code == 409, f"won quotation cannot be edited ({r.status_code})")

    # ------------------------------------------------------------------ H
    print("\nH. Concurrent editing")
    r = await client.post(f"{Q}/", headers=estimator["headers"], json={"client_name": f"Concurrency {TAG}", "metadata": meta(items(2))})
    cid = r.json()["data"]["id"]
    a = (await client.get(f"{Q}/{cid}", headers=estimator["headers"])).json()["data"]
    b_ = (await client.get(f"{Q}/{cid}", headers=reviewer["headers"])).json()["data"]
    ma = json.loads(json.dumps(a["metadata"]))
    ma["items"][0]["qty"] = 999
    ra = await client.put(f"{Q}/{cid}", headers=estimator["headers"], json={"metadata": ma, "expected_row_version": a["row_version"]})
    mb = json.loads(json.dumps(b_["metadata"]))
    mb["items"][1]["rate"] = 1
    rb = await client.put(f"{Q}/{cid}", headers=reviewer["headers"], json={"metadata": mb, "expected_row_version": b_["row_version"]})
    check(ra.status_code == 200, "first save wins")
    check(rb.status_code == 409 and rb.json().get("code") == "STALE_VERSION", f"second (stale) save gets 409 STALE_VERSION ({rb.status_code})")
    final = (await client.get(f"{Q}/{cid}", headers=estimator["headers"])).json()["data"]["metadata"]["items"]
    check(Decimal(str(final[0]["qty"])) == 999 and Decimal(str(final[1]["rate"])) != 1, "first edit kept, stale edit not applied")
    racers = []
    for n in range(5):
        m = json.loads(json.dumps(ma))
        m["items"][0]["qty"] = 1000 + n
        racers.append(client.put(f"{Q}/{cid}", headers=estimator["headers"], json={"metadata": m, "expected_row_version": ra.json()["data"]["row_version"]}))
    outcomes = [x.status_code for x in await asyncio.gather(*racers)]
    check(outcomes.count(200) == 1 and outcomes.count(409) == 4, f"5 simultaneous saves on one version: exactly one wins {outcomes}")
    r = await client.put(f"{Q}/{cid}", headers=estimator["headers"], json={"client_name": f"Legacy caller {TAG}"})
    check(r.status_code == 200, "caller without a version keeps last-write-wins (legacy builder)")

    # ------------------------------------------------------------------ I
    print("\nI. 1,000-line estimate")
    big = [{"section": f"Bill {i // 100 + 1}", "item_no": f"{i // 100 + 1}.{i % 100 + 1}", "description": f"Measured item {i}",
            "qty": (i % 37) + 1.25, "unit": "m2", "rate": round(5 + (i % 53) * 1.37, 2),
            "buildup": [{"type": "material", "name": f"Material {i % 20}", "unit": "m2", "qty": 1.05, "rate": round(4 + (i % 53) * 1.2, 2)}]}
           for i in range(1000)]
    t0 = time.perf_counter()
    r = await client.post(f"{Q}/", headers=estimator["headers"], json={"client_name": f"Big {TAG}", "metadata": meta(big)})
    t_create = time.perf_counter() - t0
    bid = r.json()["data"]["id"]
    t0 = time.perf_counter()
    r = await client.get(f"{Q}/{bid}/workspace", headers=estimator["headers"])
    t_ws = time.perf_counter() - t0
    big_saved = r.json()["data"]["quotation"]
    t0 = time.perf_counter()
    r = await client.put(f"{Q}/{bid}", headers=estimator["headers"], json={"metadata": big_saved["metadata"], "expected_row_version": big_saved["row_version"]})
    t_save = time.perf_counter() - t0
    big_calc = QuotationCalculator.calculate(build_calc_input_from_metadata(bid, r.json()["data"] and big_saved["metadata"]))
    check(r.status_code == 200 and Decimal(str(r.json()["data"]["quote_amount"])) == big_calc.grand_total, "1,000-line save reconciles")
    print(f"  TIMING create {t_create * 1000:.0f} ms, workspace read {t_ws * 1000:.0f} ms, save {t_save * 1000:.0f} ms (local PG, in-process)")

    await client.aclose()


if __name__ == "__main__":
    with block_outbound():
        asyncio.run(main())
    print(f"\n{'ALL CHECKS PASSED' if not FAILURES else f'{len(FAILURES)} FAILURE(S)'}")
    for f in FAILURES:
        print("  -", f)
    sys.exit(1 if FAILURES else 0)
