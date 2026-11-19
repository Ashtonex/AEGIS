"""Live records: the WebSocket push that carries the changed row itself
(core/realtime.py relay_live_record + core/live_records.py).

These run without a database. The row loaders and the DB session are
replaced with fakes, so what's checked is who receives what: org and
permission gating, the project-scope filter, the skip when no socket
qualifies, and the fallbacks when a load fails."""

import asyncio
import json
import re
import unittest
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal
from unittest import mock
from uuid import uuid4

from core import live_records, realtime
from core.live_records import LiveRecord

ORG = "11111111-1111-1111-1111-111111111111"
OTHER_ORG = "22222222-2222-2222-2222-222222222222"
PROJECT_A = "aaaaaaaa-0000-0000-0000-000000000001"
PROJECT_B = "bbbbbbbb-0000-0000-0000-000000000002"


class FakeSocket:
    def __init__(self, name: str):
        self.name = name
        self.sent: list[dict] = []

    async def send_text(self, message: str) -> None:
        self.sent.append(json.loads(message))


class FakeSession:
    def __init__(self):
        self.info = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


def run(coro):
    return asyncio.run(coro)


class LiveRecordRelayTest(unittest.TestCase):
    def setUp(self):
        self.manager = realtime.ConnectionManager()
        self.patches = [
            mock.patch.object(realtime, "manager", self.manager),
            mock.patch("core.database.AsyncSessionLocal", FakeSession),
            # A fresh semaphore per test: asyncio.run gives each test its own loop.
            mock.patch.object(realtime, "_relay_semaphore", None),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])

    async def _register(self, name, *, org=ORG, perms=("crm_communications.read",), user_id=None):
        ws = FakeSocket(name)
        uid = user_id or str(uuid4())
        await self.manager.register(ws, uid, org, set(perms), user={"user_id": uid, "org_id": org, "role": "STAFF"})
        return ws

    def test_pushes_row_to_eligible_sockets_only(self):
        loaded = []

        async def loader(db, org_id, row_id):
            loaded.append(row_id)
            return LiveRecord({"id": row_id, "body": "Concrete pour moved to 07:00", "started_at": datetime(2026, 11, 19, tzinfo=timezone.utc)})

        async def scenario():
            reader = await self._register("reader")
            no_perm = await self._register("no_perm", perms=("documents.read",))
            other_org = await self._register("other_org", org=OTHER_ORG)
            with mock.patch.dict(live_records.LOADERS, {"crm.communication_events": loader}):
                await realtime.relay_live_record("crm.communication_events", "INSERT", ORG, "m1", ("crm_communications.read",))
            return reader, no_perm, other_org

        reader, no_perm, other_org = run(scenario())
        self.assertEqual(loaded, ["m1"])
        self.assertEqual(len(reader.sent), 1)
        event = reader.sent[0]
        self.assertEqual(event["type"], "table_change")
        self.assertEqual(event["table"], "crm.communication_events")
        self.assertEqual(event["data"]["body"], "Concrete pour moved to 07:00")
        self.assertEqual(event["data"]["started_at"], "2026-11-19T00:00:00+00:00")
        self.assertEqual(no_perm.sent, [])
        self.assertEqual(other_org.sent, [])

    def test_no_row_load_when_no_socket_qualifies(self):
        async def loader(db, org_id, row_id):
            raise AssertionError("must not load a row nobody here can receive")

        async def scenario():
            await self._register("other_org", org=OTHER_ORG)
            with mock.patch.dict(live_records.LOADERS, {"crm.communication_events": loader}):
                await realtime.relay_live_record("crm.communication_events", "INSERT", ORG, "m1", ("crm_communications.read",))

        run(scenario())

    def test_project_scoped_record_goes_only_to_users_who_see_the_project(self):
        async def loader(db, org_id, row_id):
            return LiveRecord({"id": "doc-1", "report_id": "r1", "thumb_url": "https://x/t.jpg"}, project_id=PROJECT_A)

        perms = ("site_operations.daily_report.read",)
        scopes = {}

        async def fake_visible(db, user):
            return scopes[user["user_id"]]

        async def scenario():
            office = await self._register("office", perms=perms, user_id="u-office")
            on_a = await self._register("on_a", perms=perms, user_id="u-a")
            on_b = await self._register("on_b", perms=perms, user_id="u-b")
            scopes.update({"u-office": None, "u-a": [PROJECT_A], "u-b": [PROJECT_B]})
            with mock.patch.dict(live_records.LOADERS, {"core.document_links": loader}), \
                 mock.patch("core.project_scope.visible_project_ids", fake_visible):
                await realtime.relay_live_record("core.document_links", "INSERT", ORG, "link-1", perms)
            return office, on_a, on_b

        office, on_a, on_b = run(scenario())
        self.assertEqual([e["data"]["id"] for e in office.sent], ["doc-1"])
        self.assertEqual([e["data"]["id"] for e in on_a.sent], ["doc-1"])
        self.assertEqual(on_b.sent, [])

    def test_scope_lookup_is_cached_per_user(self):
        calls = []

        async def loader(db, org_id, row_id):
            return LiveRecord({"id": row_id}, project_id=PROJECT_A)

        async def fake_visible(db, user):
            calls.append(user["user_id"])
            return [PROJECT_A]

        perms = ("site_operations.daily_report.read",)

        async def scenario():
            await self._register("tab1", perms=perms, user_id="u-a")
            await self._register("tab2", perms=perms, user_id="u-a")
            with mock.patch.dict(live_records.LOADERS, {"core.document_links": loader}), \
                 mock.patch("core.project_scope.visible_project_ids", fake_visible):
                for i in range(3):
                    await realtime.relay_live_record("core.document_links", "INSERT", ORG, f"l{i}", perms)

        run(scenario())
        self.assertEqual(calls, ["u-a"])

    def test_failed_load_falls_back_to_bare_signal(self):
        async def loader(db, org_id, row_id):
            raise RuntimeError("db hiccup")

        async def scenario():
            reader = await self._register("reader")
            with mock.patch.dict(live_records.LOADERS, {"crm.communication_events": loader}):
                await realtime.relay_live_record("crm.communication_events", "UPDATE", ORG, "m1", ("crm_communications.read",))
            return reader

        reader = run(scenario())
        self.assertEqual(reader.sent, [{"type": "table_change", "table": "crm.communication_events", "op": "UPDATE", "id": "m1"}])

    def test_project_scoped_table_sends_nothing_without_the_row(self):
        async def loader(db, org_id, row_id):
            return None

        perms = ("site_operations.daily_report.read",)

        async def scenario():
            reader = await self._register("reader", perms=perms)
            with mock.patch.dict(live_records.LOADERS, {"core.document_links": loader}):
                await realtime.relay_live_record("core.document_links", "UPDATE", ORG, "l1", perms)
            return reader

        self.assertEqual(run(scenario()).sent, [])

    def test_removed_evidence_tombstone_is_project_scoped(self):
        # Shape the evidence loader returns for a removed link: id, report and
        # deleted flag, with the link's project for the scope check.
        async def loader(db, org_id, row_id):
            return LiveRecord({"id": "doc-9", "report_id": "r1", "deleted": True}, project_id=PROJECT_A)

        perms = ("site_operations.daily_report.read",)
        scopes = {"u-a": [PROJECT_A], "u-b": [PROJECT_B]}

        async def fake_visible(db, user):
            return scopes[user["user_id"]]

        async def scenario():
            on_a = await self._register("on_a", perms=perms, user_id="u-a")
            on_b = await self._register("on_b", perms=perms, user_id="u-b")
            with mock.patch.dict(live_records.LOADERS, {"core.document_links": loader}), \
                 mock.patch("core.project_scope.visible_project_ids", fake_visible):
                await realtime.relay_live_record("core.document_links", "UPDATE", ORG, "link-9", perms)
            return on_a, on_b

        on_a, on_b = run(scenario())
        self.assertEqual([e["data"] for e in on_a.sent], [{"id": "doc-9", "report_id": "r1", "deleted": True}])
        self.assertEqual(on_b.sent, [])

    def test_evidence_loader_returns_tombstone_for_removed_link(self):
        class Result:
            def __init__(self, row):
                self.row = row

            def mappings(self):
                return self

            def first(self):
                return self.row

        class Db:
            async def execute(self, *_a, **_k):
                return Result({"document_id": "doc-9", "report_id": "r1", "project_id": PROJECT_A})

        async def no_items(db, org_id, **kw):
            return []

        with mock.patch("routers.site_reports.load_report_evidence", no_items):
            record = run(live_records._load_report_evidence(Db(), ORG, "link-9"))
        self.assertEqual(record.data, {"id": "doc-9", "report_id": "r1", "deleted": True})
        self.assertEqual(record.project_id, PROJECT_A)

    def test_listener_routes_loader_tables_to_the_relay(self):
        calls = []

        async def fake_relay(*args):
            calls.append(args)

        async def scenario():
            with mock.patch.object(realtime, "relay_live_record", fake_relay):
                realtime._on_notification(
                    None, 0, realtime.LIVE_CHANGES_CHANNEL,
                    json.dumps({"table": "crm.communication_events", "op": "INSERT", "organization_id": ORG, "id": "m9"}),
                )
                await asyncio.sleep(0)

        run(scenario())
        self.assertEqual(calls, [("crm.communication_events", "INSERT", ORG, "m9", ("crm_communications.read",), {})])

    def test_parent_ids_travel_with_plain_signals(self):
        async def scenario():
            reader = await self._register("reader", perms=("tender_bids.read",))
            realtime._on_notification(
                None, 0, realtime.LIVE_CHANGES_CHANNEL,
                json.dumps({"table": "crm.tender_requirements", "op": "UPDATE", "organization_id": ORG,
                            "id": "req-1", "tender_id": "t-1"}),
            )
            for _ in range(5):
                await asyncio.sleep(0)
            return reader

        reader = run(scenario())
        self.assertEqual(reader.sent, [{"type": "table_change", "table": "crm.tender_requirements", "op": "UPDATE",
                                        "id": "req-1", "tender_id": "t-1"}])

    def test_tender_document_links_go_to_document_readers_as_a_signal(self):
        async def loader(db, org_id, row_id):
            raise AssertionError("tender links must not go through the report-evidence loader")

        async def scenario():
            docs = await self._register("docs", perms=("documents.read",))
            site = await self._register("site", perms=("site_operations.daily_report.read",))
            with mock.patch.dict(live_records.LOADERS, {"core.document_links": loader}):
                realtime._on_notification(
                    None, 0, realtime.LIVE_CHANGES_CHANNEL,
                    json.dumps({"table": "core.document_links", "op": "INSERT", "organization_id": ORG, "id": "l-1",
                                "entity_type": "tender", "entity_id": "t-1"}),
                )
                for _ in range(5):
                    await asyncio.sleep(0)
            return docs, site

        docs, site = run(scenario())
        self.assertEqual([(e["entity_type"], e["entity_id"]) for e in docs.sent], [("tender", "t-1")])
        self.assertEqual(site.sent, [])


class ProjectScopedSignalTest(unittest.TestCase):
    """Wave 2: plain change signals on project tables go only to users who
    may see the project, and a burst for one project becomes one event."""

    def setUp(self):
        self.manager = realtime.ConnectionManager()
        self.patches = [
            mock.patch.object(realtime, "manager", self.manager),
            mock.patch("core.database.AsyncSessionLocal", FakeSession),
            mock.patch.object(realtime, "_relay_semaphore", None),
            mock.patch.object(realtime, "SCOPED_SIGNAL_WINDOW_SECONDS", 0.01),
            mock.patch.dict(realtime._pending_scoped, {}, clear=True),
        ]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        self.scopes = {"u-office": None, "u-a": [PROJECT_A], "u-b": [PROJECT_B]}

        async def fake_visible(db, user):
            return self.scopes[user["user_id"]]

        p = mock.patch("core.project_scope.visible_project_ids", fake_visible)
        p.start()
        self.addCleanup(p.stop)

    async def _register(self, user_id, perms=("projects.read",)):
        ws = FakeSocket(user_id)
        await self.manager.register(ws, user_id, ORG, set(perms), user={"user_id": user_id, "org_id": ORG})
        return ws

    def _notify(self, **data):
        realtime._on_notification(None, 0, realtime.LIVE_CHANGES_CHANNEL, json.dumps({"organization_id": ORG, **data}))

    def test_signal_goes_only_to_users_who_see_the_project(self):
        async def scenario():
            office = await self._register("u-office")
            on_a = await self._register("u-a")
            on_b = await self._register("u-b")
            self._notify(table="projects.project_milestones", op="UPDATE", id="m1", project_id=PROJECT_A)
            await asyncio.sleep(0.1)
            return office, on_a, on_b

        office, on_a, on_b = run(scenario())
        self.assertEqual([e["project_id"] for e in office.sent], [PROJECT_A])
        self.assertEqual([e["id"] for e in on_a.sent], ["m1"])
        self.assertEqual(on_b.sent, [])

    def test_burst_for_one_project_becomes_one_bulk_event(self):
        async def scenario():
            on_a = await self._register("u-a")
            for i in range(50):
                self._notify(table="finance.boq_line_items", op="INSERT", id=f"l{i}", project_id=PROJECT_A)
            await asyncio.sleep(0.1)
            return on_a

        events = run(scenario()).sent
        self.assertEqual(len(events), 1)
        self.assertEqual((events[0]["op"], events[0]["count"], events[0]["project_id"]), ("BULK", 50, PROJECT_A))

    def test_row_without_project_goes_only_to_unrestricted_users(self):
        async def scenario():
            office, on_a = await self._register("u-office"), await self._register("u-a")
            self._notify(table="projects.sites", op="INSERT", id="s1")
            await asyncio.sleep(0.1)
            return office, on_a

        office, on_a = run(scenario())
        self.assertEqual(len(office.sent), 1)
        self.assertEqual(on_a.sent, [])

    def test_project_document_links_are_scoped_by_entity_project(self):
        async def scenario():
            on_a = await self._register("u-a", perms=("documents.read",))
            on_b = await self._register("u-b", perms=("documents.read",))
            self._notify(table="core.document_links", op="INSERT", id="dl1", entity_type="project", entity_id=PROJECT_A)
            await asyncio.sleep(0.1)
            return on_a, on_b

        on_a, on_b = run(scenario())
        self.assertEqual([(e["entity_type"], e["entity_id"]) for e in on_a.sent], [("project", PROJECT_A)])
        self.assertEqual(on_b.sent, [])

    def test_permission_still_required(self):
        async def scenario():
            no_finance = await self._register("u-office", perms=("projects.read",))
            self._notify(table="finance.progress_claims", op="INSERT", id="c1", project_id=PROJECT_A)
            await asyncio.sleep(0.1)
            return no_finance

        self.assertEqual(run(scenario()).sent, [])


class LiveRecordContractTest(unittest.TestCase):
    def test_every_loader_table_is_relayed(self):
        for table in live_records.LOADERS:
            self.assertIn(table, realtime.TABLE_PERMISSION_MAP, table)

    def test_every_use_live_record_table_has_a_loader(self):
        # Without a loader the event never carries `data`, and a page that
        # only reads rows off the event would quietly stop updating.
        web = Path(__file__).resolve().parents[2] / "aegis-web" / "src"
        pattern = re.compile(r'useLiveRecord(?:<[^>]*>)?\(\s*"([a-z_]+\.[a-z_]+)"')
        found = {
            table
            for path in web.rglob("*.ts*")
            for table in pattern.findall(path.read_text(encoding="utf-8"))
        }
        self.assertTrue(found, "expected at least one useLiveRecord subscriber")
        self.assertEqual(sorted(found - set(live_records.LOADERS)), [])

    def test_json_default_handles_db_types(self):
        encoded = json.dumps(
            {"a": Decimal("12.50"), "b": uuid4(), "c": datetime(2026, 1, 1)},
            default=realtime._json_default,
        )
        decoded = json.loads(encoded)
        self.assertEqual(decoded["a"], "12.50")
        self.assertEqual(decoded["c"], "2026-01-01T00:00:00")


if __name__ == "__main__":
    unittest.main()
