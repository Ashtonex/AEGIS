"""End-to-end verification of tender automation (migration 276): scheduled
sourcing -> auto-import -> document/schedule collection -> initial review
gate -> QS handover (round robin) -> correction loop -> QS preparation, and
the new-tender emails, against an ISOLATED database.

Nothing leaves the machine: the e-GP portal is a fixture server
(httpx.MockTransport), storage uploads, email sending, push and calendar
sync are stubbed. Refuses to run unless DATABASE_URL points at localhost.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55432/aegis_test
    .venv/Scripts/python.exe scripts/verify_tender_intake_workflow.py
"""

import asyncio
import os
import sys
import uuid

from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

if (urlsplit(os.environ.get("DATABASE_URL", "")).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

import httpx  # noqa: E402
from fastapi import BackgroundTasks, HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import FAILURES, block_outbound, check  # noqa: E402
from app.services.tenders import notify, pipeline, workflow  # noqa: E402
from app.services.tenders.egp import collect, portal  # noqa: E402
from app.services.tenders.egp import discovery as disc  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from core.email import EmailResult  # noqa: E402
from routers import crm as crm_router  # noqa: E402
from routers import crm_tasks  # noqa: E402
from routers import tender_bids  # noqa: E402
from routers import tender_workflow as tw  # noqa: E402
from tests.egp_fixtures import CULVERT_NYANGA, ROAD_MUTARE, STATIONERY, bulletin_page, notice_page  # noqa: E402

PDF = b"%PDF-1.4\n% test bidding document\n"


def doc_list_html(nid: str) -> str:
    return f"""<div class="popup"><table class="table table-bordered table-striped"><tr><td colspan="3"><b>Tender Id: </b>{nid}</td></tr>
    <tr><th>Sr.No.</th><th>Document Name</th><th>Date</th></tr>
    <tr><td>1</td><td><a href="https://egp.praz.org.zw/privateUploads/downloads/?id={nid}1&amp;tn=TenderDoc&amp;h=abc&amp;fh=x" class="no_encryption" target="_blank">{nid}_bidding_document.pdf</a></td><td>20-Oct-2026 09:29 AM</td></tr>
    <tr><td>2</td><td><a href="https://egp.praz.org.zw/privateUploads/downloads/?id={nid}2&amp;tn=TenderDoc&amp;h=def&amp;fh=y" class="no_encryption" target="_blank">{nid}_drawings.pdf</a></td><td>20-Oct-2026 09:30 AM</td></tr>
    </table></div>"""


def schedule_html(start: str) -> str:
    return f"""<div><a>&times;</a><h4>Schedule of activity</h4>
    <p>Pre-Bid Meeting :</p><p>OFFLINE</p><p>Pre-Bid Venue:</p><p>Civic Centre boardroom</p>
    <p>Pre-Bid Meeting Start Date and Time :</p><p>{start}</p>
    <p>Request for clarification :</p><p>10-Nov-2026 04:00 PM</p>
    <p>Bid submission deadline date and time :</p><p>20-Nov-2026 10:00 AM</p></div>"""


class FakePortal:
    def __init__(self, notices):
        self.notices = {n.notice_id: n for n in notices}
        self.requests: list[str] = []
        self.popup_headers: list[str] = []
        self.broken_downloads: set[str] = set()

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        if "/Indexes/index" in url:
            return httpx.Response(200, text=bulletin_page(list(self.notices.values())))
        if "/Indexes/viewLiveTenderDetails/" in url:
            n = self.notices[url.rsplit("/", 1)[-1]]
            html = notice_page(n).replace(
                "<label>Bid Form Fee: </label>",
                "<label>Bid Security Amount(Domestic): </label></br> 500&nbsp; </br></br>"
                "<label>Establishment Amount(Domestic): </label></br> 150&nbsp; </br></br><label>Bid Form Fee: </label>")
            return httpx.Response(200, text=html)
        if "/Tenders/tender_doc_view/" in url or "/Tenders/tender_shedule/" in url:
            self.popup_headers.append(request.headers.get("x-requested-with", ""))
            if request.headers.get("x-requested-with") != "XMLHttpRequest":
                return httpx.Response(200, text="<html>Your session has been expired, please login</html>")
            nid = url.rstrip("/").split("/")[-1]
            if "tender_doc_view" in url:
                return httpx.Response(200, text=doc_list_html(nid))
            return httpx.Response(200, text=schedule_html("30-Dec-2026 10:00 AM"))
        if "/privateUploads/downloads/" in url:
            key = request.url.params.get("id")
            if key in self.broken_downloads or key.endswith("2"):
                return httpx.Response(200, text="<html>error page</html>")  # not a PDF -> rejected
            return httpx.Response(200, content=PDF, headers={"content-disposition": f'attachment; filename="{key}_doc.pdf"'})
        return httpx.Response(404)

    def factory(self):
        async def no_sleep(_):
            return None
        return lambda: portal.PortalClient(min_interval=0, backoff_base=0, transport=httpx.MockTransport(self.handler), sleeper=no_sleep)


SENT: list[tuple[str, str]] = []
FAIL_ONCE: set[str] = set()


async def fake_send(to, subject, html, text_body=None):
    if to in FAIL_ONCE:
        FAIL_ONCE.discard(to)
        return EmailResult(False, True, "HTTP 503 (simulated)")
    SENT.append((to, subject))
    return EmailResult(True)


STORED: list[str] = []


async def fake_store(content, file_name, mime):
    STORED.append(file_name)
    return f"documents/test-{uuid.uuid4().hex[:8]}.pdf"


CALENDAR: list[str] = []


async def fake_calendar(db, **kwargs):
    CALENDAR.append(str(kwargs.get("item_id")))


async def scalar(db, sql, **p):
    return (await db.execute(text(sql), p)).scalar()


async def rows(db, sql, **p):
    return [dict(r) for r in (await db.execute(text(sql), p)).mappings().all()]


async def make_user(db, org_id, name, role, *, email=None, teams=None, personal=None):
    uid = str(uuid.uuid4())
    email = email or f"{name.lower().replace(' ', '.')}.{uid[:6]}@example.test"
    await db.execute(text("""INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted, teams_account)
                             VALUES (:id, :org, :email, :name, true, false, :teams)"""),
                     {"id": uid, "org": org_id, "email": email, "name": name, "teams": teams})
    role_id = await scalar(db, "SELECT id FROM core.roles WHERE organization_id = :org AND name = :name", org=org_id, name=role)
    await db.execute(text("INSERT INTO core.user_roles (user_id, role_id, organization_id) VALUES (:u, :r, :org)"),
                     {"u": uid, "r": role_id, "org": org_id})
    if personal:
        await db.execute(text("""INSERT INTO hr.employees (organization_id, employee_name, linked_user_id, personal_email)
                                 VALUES (:org, :name, :u, :p)"""), {"org": org_id, "name": name, "u": uid, "p": personal})
    return {"user_id": uid, "sub": uid, "org_id": org_id, "name": name, "email": email}


async def expect_http(coro, status: int, label: str):
    try:
        await coro
    except HTTPException as exc:
        check(exc.status_code == status, f"{label} -> HTTP {exc.status_code}")
        return exc
    check(False, f"{label} -> expected HTTP {status}, it succeeded")
    return None


def expect_sync(fn, status: int, label: str) -> None:
    try:
        fn()
    except HTTPException as exc:
        check(exc.status_code == status, f"{label} -> HTTP {exc.status_code}")
        return
    check(False, f"{label} -> expected HTTP {status}, it succeeded")


async def main() -> None:
    fake = FakePortal([ROAD_MUTARE, CULVERT_NYANGA, STATIONERY])
    disc._client_factory = lambda source: fake.factory()
    collect._client_factory = lambda source: fake.factory()
    collect._store = fake_store
    notify.send_email_exact = fake_send
    tender_bids._sync_tender_calendar = fake_calendar

    async with AsyncSessionLocal() as db:
        org_id = str(await scalar(db, "SELECT id FROM core.organizations ORDER BY created_at LIMIT 1"))
        tag = uuid.uuid4().hex[:5]
        rev_a = await make_user(db, org_id, f"Reviewer A {tag}", "CRM Associate")
        rev_b = await make_user(db, org_id, f"Reviewer B {tag}", "Document Controller")
        qs_x = await make_user(db, org_id, f"QS X {tag}", "Quantity Surveyor")
        qs_y = await make_user(db, org_id, f"QS Y {tag}", "Quantity Surveyor")
        gloria = await make_user(db, org_id, f"Gloria {tag}", "Executive (Admin)",
                                 teams=f"gloria{tag}_gmail.com#EXT#@Tenant.onmicrosoft.com")
        cosmas = await make_user(db, org_id, f"Cosmas {tag}", "Executive (Admin)", personal=f"cosmas{tag}@gmail.com")
        admin_login = "ashton@admin.com"
        admin_id = await scalar(db, "SELECT id FROM core.users WHERE lower(email) = :e", e=admin_login)
        admin = ({"user_id": str(admin_id), "sub": str(admin_id), "org_id": org_id} if admin_id
                 else await make_user(db, org_id, "Aegis Administrare", "Executive (Admin)", email=admin_login))
        nobody = await make_user(db, org_id, f"No Private {tag}", "Executive (Admin)")
        outsider = await make_user(db, org_id, f"Outsider {tag}", "Site Engineer")
        await workflow.get_settings(db, org_id)
        await db.execute(text("""
            UPDATE crm.tender_automation_settings SET
              review_user_ids = CAST(:r AS jsonb), qs_user_ids = CAST(:q AS jsonb), qs_assignment_rule = 'round_robin',
              notify_user_ids = CAST(:n AS jsonb), notify_enabled = true, auto_import_enabled = true,
              auto_import_bands = '["strong","possible"]', collect_documents = true, workflow_enabled = true,
              review_cursor = 0, qs_cursor = 0
            WHERE organization_id = :org"""),
            {"org": org_id, "r": workflow._j([rev_a["user_id"], rev_b["user_id"]]), "q": workflow._j([qs_x["user_id"], qs_y["user_id"]]),
             "n": workflow._j([{"user_id": gloria["user_id"], "company": True, "private": True},
                               {"user_id": cosmas["user_id"], "company": True, "private": True},
                               {"user_id": admin["user_id"], "company": True, "private": False},
                               {"user_id": nobody["user_id"], "company": False, "private": True}])})
        # Clear any earlier test runs of these fixture notices.
        await db.execute(text("""UPDATE crm.tenders SET is_deleted = true WHERE organization_id = :org AND source_key = 'praz_egp'
                                 AND source_notice_id = ANY(:ids)"""), {"org": org_id, "ids": list(fake.notices)})
        await db.execute(text("DELETE FROM crm.tender_candidates WHERE organization_id = :org AND source_notice_id = ANY(:ids)"),
                         {"org": org_id, "ids": list(fake.notices)})
        await db.execute(text("UPDATE crm.tender_discovery_runs SET status = 'cancelled' WHERE organization_id = :org AND status IN ('queued','running')"),
                         {"org": org_id})
        await db.commit()

        # 1. Sourcing: a run imports the matching notices, collects, emails.
        profile = await disc.ensure_default_profile(db, org_id, None)
        run = await disc.create_run(db, org_id=org_id, user_id=None, profile=profile, filters={}, page_limit=None)
        await db.commit()
        result = await pipeline.run_discovery_and_import(org_id, str(run["id"]))
        tenders = await rows(db, """SELECT * FROM crm.tenders WHERE organization_id = :org AND source_key = 'praz_egp'
                                    AND source_notice_id = ANY(:ids) AND is_deleted = false ORDER BY created_at""",
                             org=org_id, ids=list(fake.notices))
        check(result["run_status"] in ("completed", "partial") and len(tenders) >= 1,
              f"1. scraper retrieved and imported tenders ({result}, {len(tenders)} tenders)")
        check(all(h == "XMLHttpRequest" for h in fake.popup_headers) and fake.popup_headers,
              "1. document list / schedule requested as the notice page's popups")
        check(not any("login" in u.lower() for u in fake.requests), "1. no login page was ever requested")
        t1 = tenders[0]
        check(t1["review_workflow_status"] == workflow.PENDING_REVIEW, f"4. new tender is Pending Tender Review ({t1['review_workflow_status']})")
        check(float(t1["bond_amount"] or 0) == 500 and t1["bid_security_source"] == "egp_notice", "1. bid security amount read from the notice")
        check(t1["site_visit_at"] is not None and t1["site_visit_status"] == "unknown" and t1["site_visit_source"] == "egp_schedule",
              "1. pre-bid meeting from the schedule, attendance NOT presented as confirmed")
        check(t1["clarification_deadline"] is not None, "1. clarification deadline from the schedule")

        # 3. Documents
        docs = await workflow.linked_documents(db, org_id, str(t1["id"]))
        official = await rows(db, "SELECT * FROM crm.tender_candidate_documents WHERE tender_id = :t ORDER BY official_document_key", t=t1["id"])
        check(len(docs) == 1 and docs[0]["file_name"], f"3. downloaded document stored and linked to the tender ({len(docs)})")
        check(any(d["download_status"] == "rejected" and d["download_error"] for d in official),
              "9. a bad download is recorded as failed with the reason (flagged for manual follow-up)")
        status_json = t1["source_material_status"] or {}
        check(status_json.get("documents", {}).get("failed") == 1, "9. collection summary shows the failed document")

        # 4. Review tasks for both reviewers, primary alternates
        tasks = await rows(db, """SELECT assigned_to_user_id, title, priority FROM crm.tasks WHERE entity_id = :t AND generation_rule = :r
                                  AND is_deleted = false""", t=t1["id"], r=workflow.GATE_RULE)
        assignees = {str(t["assigned_to_user_id"]) for t in tasks}
        check(assignees == {rev_a["user_id"], rev_b["user_id"]} and len(tasks) == 2, "4. review tasks generated for both initial reviewers")
        if len(tenders) > 1:
            check(str(tenders[1]["review_primary_user_id"]) != str(t1["review_primary_user_id"]), "4. primary reviewer alternates (shared queue)")

        # 8. Emails: company + private for Gloria and Cosmas, admin redirect, unresolved flagged
        deliveries = await rows(db, "SELECT * FROM crm.tender_notification_deliveries WHERE tender_id = :t", t=t1["id"])
        by_email = {d["recipient_email"]: d for d in deliveries if d["recipient_email"]}
        check(gloria["email"].lower() in by_email and f"gloria{tag}@gmail.com" in by_email, "8. Gloria: company and Teams private address")
        check(cosmas["email"].lower() in by_email and f"cosmas{tag}@gmail.com" in by_email, "8. Cosmas: company and HR private address")
        check("admin@sixnineconstruction.com" in by_email, "8. admin login delivered through EMAIL_REDIRECTS")
        check(any(d["status"] == "unresolved" for d in deliveries), "8. missing private address flagged, not guessed")
        sent_t1 = [s for s in SENT if t1["tender_name"][:40] in s[1]]
        check(len(sent_t1) == 5 and all(d["status"] == "sent" for d in deliveries if d["recipient_email"]),
              f"8. one email per resolved address ({len(sent_t1)} sent)")

        # 2. Re-run: nothing duplicated
        before = {
            "tenders": await scalar(db, "SELECT count(*) FROM crm.tenders WHERE organization_id = :o AND source_notice_id = ANY(:i) AND is_deleted = false", o=org_id, i=list(fake.notices)),
            "tasks": await scalar(db, "SELECT count(*) FROM crm.tasks WHERE generation_rule = :r AND is_deleted = false", r=workflow.GATE_RULE),
            "deliveries": await scalar(db, "SELECT count(*) FROM crm.tender_notification_deliveries"),
            "documents": await scalar(db, "SELECT count(*) FROM core.documents WHERE tender_id = :t", t=t1["id"]),
            "sent": len(SENT),
        }
        run2 = await disc.create_run(db, org_id=org_id, user_id=None, profile=profile, filters={}, page_limit=None)
        await db.commit()
        await pipeline.run_discovery_and_import(org_id, str(run2["id"]))
        await pipeline.after_commit(org_id, [str(t1["id"])], post_import_hooks=False)
        after = {
            "tenders": await scalar(db, "SELECT count(*) FROM crm.tenders WHERE organization_id = :o AND source_notice_id = ANY(:i) AND is_deleted = false", o=org_id, i=list(fake.notices)),
            "tasks": await scalar(db, "SELECT count(*) FROM crm.tasks WHERE generation_rule = :r AND is_deleted = false", r=workflow.GATE_RULE),
            "deliveries": await scalar(db, "SELECT count(*) FROM crm.tender_notification_deliveries"),
            "documents": await scalar(db, "SELECT count(*) FROM core.documents WHERE tender_id = :t", t=t1["id"]),
            "sent": len(SENT),
        }
        check(before == after, f"2. repeated scraping/collection creates no duplicate tenders, tasks, documents or emails ({before} vs {after})")

        tid = str(t1["id"])
        primary = rev_a if str(t1["review_primary_user_id"]) == rev_a["user_id"] else rev_b

        # 5. Incomplete review cannot go to QS
        exc = await expect_http(workflow.submit_review(db, primary, tid, confirm=True, note=None, is_admin=False), 422,
                                "5. submitting an incomplete review")
        await db.rollback()
        check(bool(exc and exc.detail.get("problems")), "5. the refusal lists what is missing")
        task_id = await scalar(db, "SELECT id FROM crm.tasks WHERE entity_id = :t AND generation_rule = :r LIMIT 1", t=tid, r=workflow.GATE_RULE)
        await expect_http(crm_tasks.update_task(task_id, crm_tasks.TaskUpdate(status="completed", evidence_ref="x"), BackgroundTasks(),
                                                user=primary, db=db), 409, "5. completing a review task from the Tasks page")
        await db.rollback()
        expect_sync(lambda: workflow.ensure_stage_allowed(workflow.PENDING_REVIEW, "Bid Prep"), 409,
                    "5. moving a tender in review to Bid Prep")
        expect_sync(lambda: workflow.reject_managed_columns(["review_workflow_status"]), 400,
                    "5. setting the workflow status through the generic tender API")
        await expect_http(workflow.update_item(db, outsider, tid, "source_verified", status="done", not_applicable_reason=None,
                                               notes=None, is_admin=False), 403, "permissions: a non-reviewer cannot tick the checklist")
        await db.rollback()
        await expect_http(workflow.update_item(db, primary, tid, "documents_obtained", status="not_applicable",
                                               not_applicable_reason="", notes=None, is_admin=False), 422, "N/A without a reason")
        await db.rollback()

        for key, _, _ in workflow.REVIEW_ITEMS:
            await workflow.update_item(db, primary, tid, key, status="done", not_applicable_reason=None, notes="checked", is_admin=False)
        await db.commit()
        exc = await expect_http(workflow.submit_review(db, primary, tid, confirm=True, note=None, is_admin=False), 422,
                                "5. checklist ticked but site visit / bid bond facts not recorded")
        await db.rollback()
        check(any("site visit" in p.lower() for p in (exc.detail.get("problems") if exc else [])), "5. gate asks for the site visit attendance rule")
        await workflow.update_details(db, primary, tid, {
            "site_visit_status": "required", "bid_security_currency": "USD", "bid_security_form": "Bank guarantee",
            "bid_security_validity": "118 days", "submission_instructions": "Upload on e-GP", "outstanding_notes": "Confirm BOQ quantities for culverts",
        }, is_admin=False)
        await db.commit()
        await expect_http(workflow.submit_review(db, primary, tid, confirm=False, note=None, is_admin=False), 422,
                          "5. submitting without the explicit confirmation")
        await db.rollback()

        # 6. Completed review routes to QS (round robin)
        await workflow.submit_review(db, primary, tid, confirm=True, note="All checked against e-GP.", is_admin=False)
        await db.commit()
        t1 = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=tid))[0]
        check(t1["review_workflow_status"] == workflow.PENDING_QS and str(t1["qs_assigned_user_id"]) == qs_x["user_id"],
              "6. completed review -> Pending QS Verification, assigned to the first QS")
        check(t1["review_submitted_by"] is not None and t1["review_submitted_at"] is not None, "6. who submitted the review, and when, recorded")
        review_open = await scalar(db, """SELECT count(*) FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_intake_review'
                                         AND status <> 'completed'""", t=tid)
        check(review_open == 0, "6. review tasks closed by the submission")
        qs_task = await scalar(db, "SELECT assigned_to_user_id FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_qs_verification'", t=tid)
        check(str(qs_task) == qs_x["user_id"], "6. QS verification task created for the assigned QS")
        if len(tenders) > 1:
            t2 = str(tenders[1]["id"])
            p2 = rev_a if str(tenders[1]["review_primary_user_id"]) == rev_a["user_id"] else rev_b
            for key, _, _ in workflow.REVIEW_ITEMS:
                await workflow.update_item(db, p2, t2, key, status="not_applicable" if key == "site_visit_confirmed" else "done",
                                           not_applicable_reason="No site visit in the documents" if key == "site_visit_confirmed" else None,
                                           notes=None, is_admin=False)
            await workflow.update_details(db, p2, t2, {"bid_security_form": "Bid-securing declaration"}, is_admin=False)
            await workflow.submit_review(db, p2, t2, confirm=True, note=None, is_admin=False)
            await db.commit()
            qs2 = await scalar(db, "SELECT qs_assigned_user_id FROM crm.tenders WHERE id = :t", t=t2)
            check(str(qs2) == qs_y["user_id"], "6. next reviewed tender goes to the other QS (round robin)")

        # 7. QS returns for correction, reviewer resubmits, QS verifies
        await expect_http(workflow.qs_decision(db, qs_y, tid, decision="verified", notes=None, reopen_items=[], is_admin=False), 403,
                          "permissions: a QS not assigned to the tender cannot decide")
        await db.rollback()
        await expect_http(workflow.qs_decision(db, qs_x, tid, decision="return", notes="short", reopen_items=[], is_admin=False), 422,
                          "7. returning needs real correction notes")
        await db.rollback()
        await workflow.qs_decision(db, qs_x, tid, decision="return", notes="Bid bond validity is wrong - the SBD says 90 days + 28.",
                                   reopen_items=["bid_bond_confirmed"], is_admin=False)
        await db.commit()
        t1 = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=tid))[0]
        item = (await rows(db, "SELECT * FROM crm.tender_review_items WHERE tender_id = :t AND item_key = 'bid_bond_confirmed'", t=tid))[0]
        corr = await scalar(db, "SELECT count(*) FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_review_correction'", t=tid)
        check(t1["review_workflow_status"] == workflow.RETURNED and t1["review_round"] == 2 and item["status"] == "pending" and corr == 1,
              "7. QS returned it: status, round 2, reopened item and a correction task")
        await expect_http(workflow.submit_review(db, primary, tid, confirm=True, note=None, is_admin=False), 422,
                          "7. resubmitting before fixing the reopened item")
        await db.rollback()
        await workflow.update_details(db, primary, tid, {"bid_security_validity": "90 days + 28 days"}, is_admin=False)
        await workflow.update_item(db, primary, tid, "bid_bond_confirmed", status="done", not_applicable_reason=None, notes="fixed", is_admin=False)
        await workflow.submit_review(db, primary, tid, confirm=True, note="Corrected.", is_admin=False)
        await db.commit()
        t1 = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=tid))[0]
        check(t1["review_workflow_status"] == workflow.PENDING_QS and str(t1["qs_assigned_user_id"]) == qs_x["user_id"],
              "7. resubmission goes back to the same QS")
        await workflow.qs_decision(db, qs_x, tid, decision="verified", notes="Ready to price.", reopen_items=[], is_admin=False)
        await db.commit()
        t1 = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=tid))[0]
        prep = await rows(db, "SELECT title FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_qs_preparation'", t=tid)
        check(t1["review_workflow_status"] == workflow.QS_PREPARATION and t1["stage"] == "Bid Prep",
              "7. verified -> QS Preparation and stage Bid Prep")
        check(len(prep) == 3, f"7. preparation tasks: site visit, BOQ, clarifications ({[p['title'][:30] for p in prep]})")
        prep_id = await scalar(db, """SELECT id FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_qs_preparation'
                                      ORDER BY created_at LIMIT 1""", t=tid)
        try:
            await crm_tasks.update_task(prep_id, crm_tasks.TaskUpdate(status="completed", evidence_ref="BOQ priced"),
                                        BackgroundTasks(), user=qs_x, db=db)
            prep_status = await scalar(db, "SELECT status FROM crm.tasks WHERE id = :i", i=prep_id)
        except HTTPException as exc:
            await db.rollback()
            prep_status = f"HTTP {exc.status_code}: {exc.detail}"
        check(prep_status in ("completed", "under_review"),
              f"7. the QS can complete a preparation task from the Tasks page ({prep_status})")
        events = await rows(db, "SELECT action FROM crm.tender_workflow_events WHERE tender_id = :t ORDER BY created_at", t=tid)
        actions = [e["action"] for e in events]
        check({"captured", "review_assigned", "source_material_collected", "review_submitted", "qs_assigned",
               "returned_for_correction", "qs_verified"} <= set(actions), "audit trail covers every transition")

        # Manual entry: same workflow + email; a temporary email failure is retried, never duplicated
        FAIL_ONCE.add(gloria["email"].lower())
        bt = BackgroundTasks()
        created = await crm_router.create_tender(crm_router.TenderCreate(tender_name=f"Manual tender {tag}", stage="Tender Identified"),
                                                 bt, user=admin, db=db)
        await bt()
        mid = created["data"]["id"]
        mt = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=mid))[0]
        check(mt["review_workflow_status"] == workflow.PENDING_REVIEW, "4. a tender entered by hand also starts the review")
        failed = await rows(db, "SELECT * FROM crm.tender_notification_deliveries WHERE tender_id = :t AND status = 'failed'", t=mid)
        check(len(failed) == 1 and failed[0]["next_attempt_at"] is not None, "9. temporary email failure recorded with a retry time")
        overview = await tw.admin_overview(user=admin, db=db)
        check(any(p["tender_id"] == mt["id"] for p in overview["data"]["email_problems"]), "9. failure visible in the admin view")
        await db.execute(text("UPDATE crm.tender_notification_deliveries SET next_attempt_at = NOW() - INTERVAL '1 minute' WHERE id = :i"),
                         {"i": failed[0]["id"]})
        await db.commit()
        await notify.deliver_pending(db, tender_id=mid)
        await notify.deliver_pending(db, tender_id=mid)
        sent_to_gloria = [s for s in SENT if s[0] == gloria["email"].lower() and f"Manual tender {tag}" in s[1]]
        check(len(sent_to_gloria) == 1, f"9. retried once and delivered once ({len(sent_to_gloria)})")

        # No reviewers configured: the tender waits in Captured, then moves to
        # review as soon as reviewers are saved.
        await db.execute(text("UPDATE crm.tender_automation_settings SET review_user_ids = '[]' WHERE organization_id = :org"), {"org": org_id})
        await db.commit()
        bt = BackgroundTasks()
        created = await crm_router.create_tender(crm_router.TenderCreate(tender_name=f"Captured tender {tag}", stage="Tender Identified"),
                                                 bt, user=admin, db=db)
        cid = created["data"]["id"]
        check(await scalar(db, "SELECT review_workflow_status FROM crm.tenders WHERE id = :t", t=cid) == workflow.CAPTURED,
              "4. with no reviewers configured a new tender waits in Captured")
        saved = await tw.update_settings(tw.SettingsUpdate(review_user_ids=[rev_a["user_id"], rev_b["user_id"]]), user=admin, db=db)
        ct = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :t", t=cid))[0]
        review_tasks = await scalar(db, """SELECT count(*) FROM crm.tasks WHERE entity_id = :t AND source_event = 'tender_intake_review'
                                           AND is_deleted = false""", t=cid)
        check(ct["review_workflow_status"] == workflow.PENDING_REVIEW and ct["review_primary_user_id"] is not None and review_tasks == 2
              and "moved to initial review" in saved["message"],
              f"4. saving reviewers moves the waiting tender to review with tasks ({ct['review_workflow_status']}, {review_tasks})")
        again = await workflow.start_workflow(db, org_id=org_id, tender_id=cid, actor=admin["user_id"], origin="admin_start")
        await db.rollback()
        check(again.get("already_started") is True, "4. starting it again leaves it as it is")

        view = await tw._tender_view(db, admin, tid, await tw._perms(db, admin))
        check(view["workflow"]["status"] == workflow.QS_PREPARATION and view["documents"], "tender record view loads with documents and history")

    print("\nCalendar sync calls (stubbed):", len(CALENDAR), "| files stored (stubbed):", len(STORED), "| emails (stubbed):", len(SENT))
    if FAILURES:
        print(f"\n{len(FAILURES)} FAILED:")
        for f in FAILURES:
            print("  -", f)
        sys.exit(1)
    print("\nALL CHECKS PASSED")


if __name__ == "__main__":
    with block_outbound():
        asyncio.run(main())
