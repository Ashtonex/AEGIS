"""End-to-end verification of e-GP discovery -> review -> import -> recheck,
against an ISOLATED database with migration 275 applied, using controlled
portal fixtures (tests/egp_fixtures.py) through httpx.MockTransport. No
request reaches the real portal and outbound push/email is stubbed.

Refuses to run unless DATABASE_URL points at localhost - the import path
commits real rows (it calls the API endpoint functions as they run in
production), so it must never be pointed at the production database.

    set DATABASE_URL=postgresql://postgres@127.0.0.1:55432/aegis_test
    .venv/Scripts/python.exe scripts/verify_egp_tender_intake.py
"""

import asyncio
import os
import sys
import uuid
from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if (urlsplit(os.environ.get("DATABASE_URL", "")).hostname or "") not in ("127.0.0.1", "localhost"):
    sys.exit("Refusing to run: DATABASE_URL must point at an isolated local database.")

import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from sqlalchemy import text  # noqa: E402

from _rollback_harness import FAILURES, OUTBOUND_CALLS, block_outbound, check  # noqa: E402
from app.services.tenders.egp import portal  # noqa: E402
from app.services.tenders.egp import discovery as disc  # noqa: E402
from app.services.tenders.egp.intake import attach_document, decide_change, recheck_candidate  # noqa: E402
from core.database import AsyncSessionLocal  # noqa: E402
from core.security import require_permission  # noqa: E402
from routers import crm as crm_router  # noqa: E402
from routers import tender_discovery as td  # noqa: E402
from tests.egp_fixtures import (  # noqa: E402
    BULAWAYO_ROADS, CONSULTANCY, CULVERT_NYANGA, ROAD_MUTARE, STATIONERY,
    bulletin_page, captcha_page, login_shell, notice_page,
)

SECRET_COOKIE = "CAKEPHP=secret-session-value-should-never-be-stored"


class FakePortal:
    """Serves fixture pages; individual URLs can be made to fail."""

    def __init__(self, pages: list[list], notices: dict, *, failing: dict | None = None, total: int | None = None):
        self.pages, self.notices, self.failing, self.total = pages, notices, failing or {}, total
        self.requests: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        headers = {"set-cookie": SECRET_COOKIE, "date": "Mon, 26 Oct 2026 12:10:30 GMT"}
        for fragment, response in self.failing.items():
            if fragment in url:
                return response(request) if callable(response) else response
        if "/Indexes/viewLiveTenderDetails/" in url:
            nid = url.rsplit("/", 1)[-1]
            if nid not in self.notices:
                return httpx.Response(404, headers=headers)
            return httpx.Response(200, text=notice_page(self.notices[nid]), headers=headers)
        if "/Indexes/index" in url:
            page = int(request.url.params.get("page", "1"))
            rows = self.pages[page - 1] if page <= len(self.pages) else []
            total = self.total if self.total is not None else sum(len(p) for p in self.pages)
            return httpx.Response(200, text=bulletin_page(rows, page=page, pages=max(1, len(self.pages)), total=total), headers=headers)
        return httpx.Response(404)

    def factory(self):
        async def no_sleep(_):
            return None

        return lambda: portal.PortalClient(min_interval=0, backoff_base=0, transport=httpx.MockTransport(self.handler), sleeper=no_sleep)


def http(status):
    return httpx.Response(status)


async def scalar(db, sql, **p):
    return (await db.execute(text(sql), p)).scalar()


async def rows(db, sql, **p):
    return [dict(r) for r in (await db.execute(text(sql), p)).mappings().all()]


async def seed_users(db, org_id):
    users = {}
    for key, role in (("admin", "Executive (Admin)"), ("manager", "Tender / Bid Manager"), ("viewer", "Executive Read Only"),
                      ("outsider", "Site Engineer"), ("owner", "Quantity Surveyor")):
        uid = str(uuid.uuid4())
        await db.execute(text("INSERT INTO core.users (id, organization_id, email, full_name, is_active, is_deleted) VALUES (:id, :org, :email, :name, true, false)"),
                         {"id": uid, "org": org_id, "email": f"{key}.{uid[:6]}@example.test", "name": f"Test {key.title()}"})
        role_id = await scalar(db, "SELECT id FROM core.roles WHERE organization_id = :org AND name = :name", org=org_id, name=role)
        await db.execute(text("INSERT INTO core.user_roles (user_id, role_id, organization_id) VALUES (:u, :r, :org)"), {"u": uid, "r": role_id, "org": org_id})
        users[key] = {"user_id": uid, "sub": uid, "org_id": org_id, "role": role}
    await db.commit()
    return users


async def allowed(db, user, key) -> bool:
    try:
        await require_permission(key)(user=user, db=db)
        return True
    except HTTPException as exc:
        return exc.status_code != 403


async def run_with(db, org_id, user, fake: FakePortal, *, filters=None, resumed_from=None, page_limit=None):
    profile = await disc.ensure_default_profile(db, org_id, user["user_id"])
    run = await disc.create_run(db, org_id=org_id, user_id=user["user_id"], profile=profile, filters=filters or {},
                                page_limit=page_limit, resumed_from=resumed_from)
    await db.commit()
    return await disc.execute_run(db, str(run["id"]), client_factory=fake.factory())


async def main() -> None:
    with block_outbound():
        async with AsyncSessionLocal() as db:
            org_id = str(await scalar(db, "SELECT id FROM core.organizations LIMIT 1"))
            for table in ("tender_source_changes", "tender_source_snapshots", "tender_candidate_documents", "tender_candidates", "tender_discovery_runs", "tender_sources"):
                await db.execute(text(f"DELETE FROM crm.{table}"))  # nosec B608 - isolated test DB reset
            for table in ("core.document_links", "core.documents", "core.file_attachments", "crm.tender_requirements"):
                await db.execute(text(f"DELETE FROM {table}"))  # nosec B608 - isolated test DB reset
            await db.execute(text("DELETE FROM crm.tasks WHERE source_event = 'egp_tender_import' OR entity_type = 'tender'"))
            await db.execute(text("DELETE FROM crm.tenders"))
            await db.commit()
            u = await seed_users(db, org_id)

            print("\n== 1/2. Authorisation")
            check(await allowed(db, u["manager"], "tender_discovery.import"), "Tender / Bid Manager may import")
            check(await allowed(db, u["viewer"], "tender_discovery.read"), "Executive Read Only may view")
            check(not await allowed(db, u["viewer"], "tender_discovery.import"), "Executive Read Only may NOT import")
            check(not await allowed(db, u["outsider"], "tender_discovery.read"), "Site Engineer may NOT use the connector")
            check(not await allowed(db, u["outsider"], "tender_discovery.run"), "Site Engineer may NOT run discovery")

            print("\n== 3. Connection state reflects the actual portal response")
            board = FakePortal([[ROAD_MUTARE, STATIONERY, CULVERT_NYANGA], [BULAWAYO_ROADS, CONSULTANCY]],
                               {n.notice_id: n for n in (ROAD_MUTARE, STATIONERY, CULVERT_NYANGA, BULAWAYO_ROADS, CONSULTANCY)})
            src = await disc.ensure_source(db, org_id)
            check(src["connection_state"] == "not_connected", "new source starts not connected")
            for label, fake, expected in (
                ("HTTP 503 x3", FakePortal([], {}, failing={"/Indexes/index": http(503)}), "connection_error"),
                ("HTTP 429", FakePortal([], {}, failing={"/Indexes/index": http(429)}), "access_restricted"),
                ("login shell", FakePortal([], {}, failing={"/Indexes/index": httpx.Response(200, text=login_shell())}), "access_restricted"),
                ("CAPTCHA", FakePortal([], {}, failing={"/Indexes/index": httpx.Response(200, text=captcha_page())}), "access_restricted"),
                ("parsed board", board, "connected_verified"),
            ):
                result = await disc.probe_connection(db, org_id=org_id, user_id=u["manager"]["user_id"], client_factory=fake.factory())
                await db.commit()
                check(result["connection_state"] == expected, f"{label} -> {result['connection_state']}")
            src = await disc.ensure_source(db, org_id)
            check(src["last_probe"].get("records_total") == 5 and src["last_probe"].get("timezone_consistent") is True,
                  "probe recorded notice count and Africa/Harare clock evidence")

            print("\n== 5/14. Full run over two pages; partial run; resume")
            run = await run_with(db, org_id, u["manager"], board)
            check(run["status"] == "completed" and run["outcome"] == "matches_found", f"complete run: {run['status']}/{run['outcome']}")
            check(run["pages_fetched"] == 2 and run["notices_seen"] == 5, f"read 2 pages / 5 notices ({run['pages_fetched']}/{run['notices_seen']})")
            staged = {r["source_notice_id"]: r for r in await rows(db, "SELECT * FROM crm.tender_candidates")}
            check("900003" not in staged, "irrelevant stationery notice was not staged")
            check(staged["900001"]["relevance_band"] == "strong" and staged["900001"]["detail_status"] == "fetched", "Mutare road notice staged strong with detail read")
            check(staged["900001"]["readiness"] == "requirements_missing", "readiness is requirements_missing (no documents/credentials) - not ready")
            closing = staged["900001"]["closing_at"]
            check(closing is not None and closing.astimezone(timezone.utc) == datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc),
                  "closing 20-Nov-2026 10:00 stored as 08:00 UTC (Africa/Harare)")
            evidence = staged["900001"]["fields"]["closing_at"]
            check(bool(evidence["excerpt"]) and evidence["source_url"].endswith("/900001") and evidence["extracted_at"], "closing date carries excerpt, URL and timestamp")
            before = await scalar(db, "SELECT count(*) FROM crm.tender_candidates")

            flaky = FakePortal(board.pages, board.notices, failing={"page=2": http(503)})
            partial = await run_with(db, org_id, u["manager"], flaky)
            check(partial["status"] == "partial" and partial["last_page_completed"] == 1, f"page-2 outage -> partial at page 1 ({partial['status']}, {partial['last_page_completed']})")
            check("resume continues from page 2" in (partial["summary"] or ""), "partial run says where resume continues")
            resumed = await run_with(db, org_id, u["manager"], board, resumed_from=partial)
            check(resumed["status"] == "completed" and resumed["pages_fetched"] == 1 and resumed["resumed_from_run_id"] == partial["id"],
                  "resume read only the missing page and completed")
            check(await scalar(db, "SELECT count(*) FROM crm.tender_candidates") == before, "resume/rerun created no duplicate candidates")

            print("\n== 14. 'No matches' vs 'nothing listed' vs failed access")
            none = await run_with(db, org_id, u["manager"], FakePortal([[STATIONERY]], {"900003": STATIONERY}))
            check(none["status"] == "completed" and none["outcome"] == "no_matches", f"only irrelevant notices -> {none['status']}/{none['outcome']}")
            empty = await run_with(db, org_id, u["manager"], FakePortal([[]], {}, total=0))
            check(empty["outcome"] == "no_notices_listed", f"empty board -> {empty['outcome']}")
            down = await run_with(db, org_id, u["manager"], FakePortal([], {}, failing={"/Indexes/index": http(503)}))
            check(down["status"] == "failed" and down["outcome"] == "access_failed", f"portal down -> {down['status']}/{down['outcome']}")
            limited = await run_with(db, org_id, u["manager"], FakePortal([], {}, failing={"/Indexes/index": http(429)}))
            check(limited["status"] == "failed" and limited["outcome"] == "restricted", f"rate limited -> {limited['status']}/{limited['outcome']}")
            capped = await run_with(db, org_id, u["manager"], board, page_limit=1)
            check(capped["status"] == "partial" and capped["coverage"]["page_limit_hit"], "page cap before the last page is labelled partial")

            print("\n== 13/6. Failed detail extraction; missing and conflicting values")
            odd_culvert = replace(CULVERT_NYANGA, detail_closing="27-Nov-2026 10:00 AM")
            no_closing = replace(BULAWAYO_ROADS, notice_id="900006", reference="BCC/RD/12/2026", title="REGRAVELLING OF HAUNA ROADS",
                                 detail_closing="", closing="")
            fake = FakePortal([[odd_culvert, no_closing, replace(ROAD_MUTARE, notice_id="900007", reference="X/7", title="ROAD MAINTENANCE IN RUSAPE")]],
                              {"900002": odd_culvert, "900006": no_closing},
                              failing={"viewLiveTenderDetails/900007": http(503)})
            run = await run_with(db, org_id, u["manager"], fake)
            check(run["status"] == "partial" and run["details_failed"] == 1, f"one failed notice page -> run partial ({run['status']}, failed={run['details_failed']})")
            c7 = (await rows(db, "SELECT * FROM crm.tender_candidates WHERE source_notice_id = '900007'"))[0]
            check(c7["detail_status"] == "failed" and c7["readiness"] == "unverified", "failed extraction stays 'failed'/'unverified', never reviewed")
            c2 = (await rows(db, "SELECT * FROM crm.tender_candidates WHERE source_notice_id = '900002'"))[0]
            check(len(c2["conflicts"]) == 1 and c2["conflicts"][0]["field"] == "closing_at", "board vs notice closing-date conflict kept with both values")
            c6 = (await rows(db, "SELECT * FROM crm.tender_candidates WHERE source_notice_id = '900006'"))[0]
            check(c6["closing_at"] is None and any("Closing date not found" in q for q in c6["unresolved_questions"]), "missing closing date stays null and flagged")
            check("estimated_value" not in c6["fields"] and any("Estimated value" in q for q in c6["unresolved_questions"]), "unpublished value never invented")

            print("\n== 7/8/10. Import -> persisted tender in the existing pipeline")
            cand = staged["900001"]
            review_day = (date.today() + timedelta(days=3)).isoformat()
            result = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=cand["id"])], responsible_user_id=u["owner"]["user_id"],
                                                               internal_review_date=review_day), user=u["manager"], db=db)
            first = result["data"][0]
            check(first["status"] == "imported" and first["tender_url"] == f"/dashboard/crm/tenders/{first['tender_id']}", f"import result {first['status']} with saved-record link")
            tid = first["tender_id"]
            tender = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :id", id=tid))[0]
            check(tender["source_notice_id"] == "900001" and tender["bid_number"] == "MCC/RD/01/2026" and tender["stage"] == "Tender Identified",
                  "tender carries source id, official reference and the pipeline's first stage")
            check(tender["submission_deadline"].astimezone(timezone.utc) == datetime(2026, 11, 20, 8, 0, tzinfo=timezone.utc), "deadline = published closing time")
            check(str(tender["assigned_to_user_id"]) == u["owner"]["user_id"] and str(tender["imported_by"]) == u["manager"]["user_id"], "owner and importing user recorded")
            pipeline = await crm_router.list_tenders(limit=None, offset=0, user=u["manager"], db=db)
            check(any(str(t["id"]) == tid for t in pipeline["data"]), "tender appears in the existing /crm/tenders pipeline list")
            check((await crm_router.get_tender_by_id(tid, user=u["manager"], db=db))["data"]["tender_name"] == cand["title"], "tender readable via existing detail endpoint")
            reqs = await rows(db, "SELECT source, label, source_excerpt, linked_task_id, responsible_user_id FROM crm.tender_requirements WHERE tender_id = :id", id=tid)
            published = [r for r in reqs if r["source"] == "EGP_PUBLISHED"]
            internal = [r for r in reqs if r["source"] == "SNC_INTERNAL"]
            check(published and all(r["source_excerpt"] for r in published), f"{len(published)} published requirements, each with its source excerpt")
            check(internal and all(r["source_excerpt"] is None for r in internal), f"{len(internal)} SNC internal checklist items kept separate")
            tasks = await rows(db, "SELECT id, title, assigned_to_user_id, due_date, deduplication_key FROM crm.tasks WHERE entity_id = :id AND deduplication_key LIKE 'EGP_INTAKE:%'", id=tid)
            check(len(tasks) == 2 and all(str(t["assigned_to_user_id"]) == u["owner"]["user_id"] for t in tasks), "decision + documents tasks created for the responsible person")
            check(any(t["due_date"] == date.fromisoformat(review_day) for t in tasks), "decision task due on the internal review date")
            linked = {str(r["linked_task_id"]) for r in internal if r["linked_task_id"]}
            check(linked == {str(t["id"]) for t in tasks}, "checklist items link to their tasks")
            check(await scalar(db, "SELECT count(*) FROM core.audit_log WHERE record_id = :id AND action = 'EGP_IMPORT' AND created_by = :u", id=tid, u=u["manager"]["user_id"]) == 1,
                  "audit log row attributes the import to the user")
            check(await scalar(db, "SELECT count(*) FROM core.domain_events WHERE aggregate_id = :id AND event_type = 'tender.egp_imported.v1'", id=tid) == 1, "domain event recorded")
            check(await scalar(db, "SELECT count(*) FROM core.notifications WHERE user_id = :u AND title = 'e-GP tender assigned to you'", u=u["owner"]["user_id"]) == 1,
                  "responsible person notified in-app")

            print("\n== 9. Reimport and retry create no duplicates")
            counts = lambda: scalar(db, "SELECT count(*) FROM crm.tenders") , lambda: scalar(db, "SELECT count(*) FROM crm.tasks WHERE deduplication_key LIKE 'EGP_INTAKE:%'")  # noqa: E731
            t0, k0 = await counts[0](), await counts[1]()
            again = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=cand["id"])]), user=u["manager"], db=db)
            check(again["data"][0]["status"] == "already_imported", "re-import -> already_imported")
            await db.execute(text("UPDATE crm.tender_candidates SET review_status = 'new', tender_id = NULL WHERE id = :id"), {"id": cand["id"]})
            await db.commit()
            retry = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=cand["id"])]), user=u["manager"], db=db)
            check(retry["data"][0]["status"] == "linked_existing" and retry["data"][0]["tender_id"] == tid, "retry after a lost response links to the same tender")
            check(await counts[0]() == t0 and await counts[1]() == k0, "no extra tenders or tasks after reimport/retry")
            dup_reqs = await scalar(db, "SELECT count(*) - count(DISTINCT dedupe_key) FROM crm.tender_requirements WHERE tender_id = :id AND dedupe_key IS NOT NULL", id=tid)
            check(dup_reqs == 0, "no duplicate checklist rows")

            print("\n== 9b. Uncertain match is flagged, not silently merged")
            manual = await crm_router.create_tender(crm_router.TenderCreate(tender_name=BULAWAYO_ROADS.title, stage="Tender Identified"), user=u["manager"], db=db)
            manual_id = manual["data"]["id"]
            bcand = (await rows(db, "SELECT id FROM crm.tender_candidates WHERE source_notice_id = '900004'"))[0]["id"]
            flagged = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=bcand)]), user=u["manager"], db=db)
            check(flagged["data"][0]["status"] == "needs_dedupe_review" and flagged["data"][0]["possible_duplicates"][0]["id"] == str(manual_id),
                  "same title as a manual tender -> needs_dedupe_review")
            linked_res = await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=bcand, link_to_tender_id=manual_id)]), user=u["manager"], db=db)
            check(linked_res["data"][0]["status"] == "linked_existing" and linked_res["data"][0]["tender_id"] == str(manual_id), "reviewer links it to the manual tender")
            check(await scalar(db, "SELECT source_notice_id FROM crm.tenders WHERE id = :id", id=manual_id) == "900004", "manual tender now carries the e-GP source")

            print("\n== 11/12. Recheck preserves user edits; addenda produce change history")
            await td.import_selected(td.ImportRequest(items=[td.ImportItem(candidate_id=cand["id"])]), user=u["manager"], db=db)
            await db.execute(text("UPDATE crm.tenders SET bid_amount = 12345, assigned_to_user_id = :a, stage = 'Bid Prep', region = 'Edited by SNC' WHERE id = :id"),
                             {"a": u["admin"]["user_id"], "id": tid})
            await db.commit()
            amended = replace(ROAD_MUTARE, closing="27-Nov-2026 10:00 AM", detail_closing="27-Nov-2026 10:00 AM", addenda="1", location="Dangamvura, Mutare")
            amended_portal = FakePortal([], {"900001": amended})
            notif_before = await scalar(db, "SELECT count(*) FROM core.notifications WHERE title = 'e-GP notice changed'")
            rc = await recheck_candidate(db, u["manager"], cand["id"], client_factory=amended_portal.factory())
            await db.commit()
            check(rc["detail_status"] == "fetched" and rc["changes_detected"] >= 3, f"recheck detected {rc['changes_detected']} change(s)")
            after = (await rows(db, "SELECT * FROM crm.tenders WHERE id = :id", id=tid))[0]
            check(after["submission_deadline"] == tender["submission_deadline"], "deadline NOT silently replaced by the recheck")
            check(float(after["bid_amount"]) == 12345 and str(after["assigned_to_user_id"]) == u["admin"]["user_id"]
                  and after["stage"] == "Bid Prep" and after["region"] == "Edited by SNC", "budget, owner, stage and edited region untouched")
            changes = {c["field_key"]: c for c in await rows(db, "SELECT * FROM crm.tender_source_changes WHERE candidate_id = :c AND review_status = 'pending'", c=cand["id"])}
            check({"closing_at", "addenda_count", "project_location"} <= set(changes), f"changes recorded: {sorted(changes)}")
            check(changes["closing_at"]["old_value"] == "2026-11-20T10:00:00+02:00" and changes["closing_at"]["new_value"] == "2026-11-27T10:00:00+02:00",
                  "old and new closing values kept")
            check(bool(changes["closing_at"]["new_evidence"]["excerpt"]), "change carries new evidence excerpt")
            check(await scalar(db, "SELECT count(*) FROM core.notifications WHERE title = 'e-GP notice changed'") == notif_before + 1, "responsible user notified of the change")
            applied = await decide_change(db, u["manager"], str(changes["closing_at"]["id"]), "apply", None)
            await db.commit()
            new_deadline = await scalar(db, "SELECT submission_deadline FROM crm.tenders WHERE id = :id", id=tid)
            check(new_deadline.astimezone(timezone.utc) == datetime(2026, 11, 27, 8, 0, tzinfo=timezone.utc) and applied["calendar_sync"], "applied closing change moved the deadline (+ calendar sync flagged)")
            loc = await decide_change(db, u["manager"], str(changes["project_location"]["id"]), "apply", None)
            await db.commit()
            check(bool(loc["kept"]) and await scalar(db, "SELECT region FROM crm.tenders WHERE id = :id", id=tid) == "Edited by SNC", "edited region kept when location change applied")
            add = await decide_change(db, u["manager"], str(changes["addenda_count"]["id"]), "apply", None)
            await db.commit()
            check(any("task" in a for a in add["applied"]) and await scalar(db, "SELECT count(*) FROM crm.tasks WHERE deduplication_key LIKE :k", k=f"EGP_INTAKE:{tid}:addendum:%") == 1,
                  "addendum change created a follow-up task")
            check(await scalar(db, "SELECT count(*) FROM crm.tender_source_snapshots WHERE candidate_id = :c", c=cand["id"]) >= 2, "version history holds both versions")
            gone = await recheck_candidate(db, u["manager"], cand["id"], client_factory=FakePortal([], {}).factory())
            await db.commit()
            check(gone["detail_status"] == "unavailable" and await scalar(db, "SELECT count(*) FROM crm.tender_source_changes WHERE candidate_id = :c AND change_kind = 'withdrawn_or_unavailable'", c=cand["id"]) == 1,
                  "notice disappearing is flagged as withdrawn/unavailable, not assumed cancelled")

            print("\n== 13b. Document handling")
            fa = await scalar(db, "INSERT INTO core.file_attachments (organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes, extraction_status) VALUES (:o, :u, 'bidding.pdf', 'egp/x/bidding.pdf', 'application/pdf', 1000, 'failed') RETURNING id",
                              o=org_id, u=u["manager"]["user_id"])
            doc = await scalar(db, "INSERT INTO core.documents (organization_id, title, file_attachment_id, file_name, tender_id, created_by) VALUES (:o, 'bidding', :fa, 'bidding.pdf', :t, :u) RETURNING id",
                               o=org_id, fa=fa, t=tid, u=u["manager"]["user_id"])
            await db.commit()
            res = await attach_document(db, u["manager"], cand["id"], document_id=str(doc), candidate_document_id=None, label="Bidding document")
            await db.commit()
            check(res["readiness"] != "ready_for_internal_decision", "document whose extraction failed does not make the notice 'ready'")
            fa2 = await scalar(db, "INSERT INTO core.file_attachments (organization_id, file_name, storage_path, size_bytes) VALUES (:o, 'payload.exe', 'x/payload.exe', 10) RETURNING id", o=org_id)
            doc2 = await scalar(db, "INSERT INTO core.documents (organization_id, title, file_attachment_id, file_name) VALUES (:o, 'bad', :fa, 'payload.exe') RETURNING id", o=org_id, fa=fa2)
            await db.commit()
            try:
                await attach_document(db, u["manager"], cand["id"], document_id=str(doc2), candidate_document_id=None, label=None)
                check(False, ".exe attachment rejected")
            except HTTPException as exc:
                await db.rollback()
                check(exc.status_code == 422, ".exe attachment rejected (422)")
            viewer_view = await td.get_candidate(cand["id"], user=u["viewer"], db=db)
            has_docs_read = await allowed(db, u["viewer"], "documents.read")
            restricted = [d for d in viewer_view["data"]["documents"] if d.get("restricted")]
            check(has_docs_read or (restricted and all(d["document_id"] is None for d in restricted)),
                  f"user without documents.read cannot reach stored documents (documents.read={has_docs_read})")

            print("\n== 4. Interrupted run is recoverable")
            stuck = await disc.create_run(db, org_id=org_id, user_id=u["manager"]["user_id"], profile=await disc.ensure_default_profile(db, org_id, None), filters={}, page_limit=None)
            await db.execute(text("UPDATE crm.tender_discovery_runs SET status='running', last_page_completed=1, heartbeat_at = NOW() - interval '20 minutes' WHERE id = :id"), {"id": stuck["id"]})
            await db.commit()
            try:
                fresh = await disc.create_run(db, org_id=org_id, user_id=None, profile={}, filters={}, page_limit=None)
                await db.commit()
                stale = (await rows(db, "SELECT status, outcome, last_page_completed FROM crm.tender_discovery_runs WHERE id = :id", id=stuck["id"]))[0]
                check(stale["status"] == "partial" and stale["outcome"] == "interrupted" and stale["last_page_completed"] == 1,
                      "stale run closed as partial/interrupted with its checkpoint, so it is resumable")
                check(fresh["status"] == "queued", "a new run can start once the stale one is closed")
            except disc.ActiveRunExists:
                check(False, "stale run should not block a new run")
            await db.execute(text("UPDATE crm.tender_discovery_runs SET status='cancelled' WHERE status IN ('queued','running')"))
            await db.commit()

            print("\n== 15. No session/credential material stored")
            leaked = 0
            for table in ("tender_sources", "tender_discovery_runs", "tender_candidates", "tender_source_snapshots", "tender_source_changes"):
                leaked += await scalar(db, f"SELECT count(*) FROM crm.{table} t WHERE t::text ILIKE '%secret-session-value%' OR t::text ILIKE '%CAKEPHP%' OR t::text ILIKE '%csrfToken%'")  # nosec B608
            check(leaked == 0, "portal cookies/CSRF tokens never persisted")
            check(all(c[0] in ("web_push", "email_escalation") for c in OUTBOUND_CALLS) and not any(c[0] == "email" for c in OUTBOUND_CALLS),
                  f"no email sent ({len(OUTBOUND_CALLS)} stubbed push call(s))")

    print("\nRESULT:", "ALL CHECKS PASSED" if not FAILURES else f"{len(FAILURES)} FAILURE(S):")
    for failure in FAILURES:
        print("  -", failure)
    sys.exit(1 if FAILURES else 0)


asyncio.run(main())
