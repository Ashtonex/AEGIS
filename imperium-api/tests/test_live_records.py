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
        self.assertEqual(calls, [("crm.communication_events", "INSERT", ORG, "m9", ("crm_communications.read",))])


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
