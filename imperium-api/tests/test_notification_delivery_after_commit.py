"""
Regression tests for REG-010 (SYSTEM_REPAIR_REGISTER.md): push/email for a
notification went out inside the request, before its transaction committed,
and an expired push subscription made dispatch_user_pushes commit the
caller's half-finished transaction.
"""

import asyncio
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

import app.shared.notification_delivery as delivery

ROOT = Path(__file__).resolve().parents[1]
EVENTS = (ROOT / "app" / "shared" / "events.py").read_text(encoding="utf-8")


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.delivered: list = []
        self._real = delivery.deliver_notifications

        async def record(items):
            self.delivered.extend(items)

        delivery.deliver_notifications = record
        self.engine = create_engine("sqlite://")

    def tearDown(self):
        delivery.deliver_notifications = self._real

    def _queue(self, db, nid="n1"):
        return delivery.queue_notification_delivery(
            db, notification_id=nid, org_id="o", user_id="u",
            payload={"title": "t"}, email_urgent=False,
        )

    def _run(self, body):
        async def main():
            session = Session(self.engine)
            body(SimpleNamespace(sync_session=session), session)
            await asyncio.sleep(0)  # let scheduled tasks run
            await asyncio.sleep(0)
            session.close()
        asyncio.run(main())

    def test_nothing_is_sent_before_commit(self):
        def body(db, session):
            session.execute(text("SELECT 1"))
            self.assertTrue(self._queue(db))
            self.assertEqual(self.delivered, [])
        self._run(body)
        self.assertEqual(self.delivered, [])  # never committed -> never sent

    def test_sent_after_commit(self):
        def body(db, session):
            session.execute(text("SELECT 1"))
            self._queue(db, "n1")
            self._queue(db, "n2")
            session.commit()
        self._run(body)
        self.assertEqual([i["notification_id"] for i in self.delivered], ["n1", "n2"])

    def test_dropped_on_rollback(self):
        def body(db, session):
            session.execute(text("SELECT 1"))
            self._queue(db)
            session.rollback()
            session.execute(text("SELECT 1"))
            session.commit()  # a later commit must not resurrect them
        self._run(body)
        self.assertEqual(self.delivered, [])

    def test_test_doubles_are_ignored(self):
        self.assertFalse(self._queue(MagicMock()))


class DeliveryTests(unittest.TestCase):
    def test_skips_notifications_that_did_not_survive(self):
        session = AsyncMock()
        session.execute = AsyncMock(return_value=MagicMock(scalar=MagicMock(return_value=None)))
        factory = MagicMock(return_value=MagicMock(__aenter__=AsyncMock(return_value=session), __aexit__=AsyncMock(return_value=False)))
        sent = AsyncMock()
        import core.database as database

        real_factory, real_dispatch = database.AsyncSessionLocal, delivery.dispatch_user_pushes
        database.AsyncSessionLocal, delivery.dispatch_user_pushes = factory, sent
        try:
            asyncio.run(delivery.deliver_notifications([
                {"notification_id": "gone", "org_id": "o", "user_id": "u", "payload": {}, "email_urgent": True},
            ]))
        finally:
            database.AsyncSessionLocal, delivery.dispatch_user_pushes = real_factory, real_dispatch
        sent.assert_not_awaited()


class EmitNotificationContract(unittest.TestCase):
    def test_emit_notification_only_queues(self):
        body = EVENTS[EVENTS.index("async def emit_notification("):EVENTS.index("async def emit_role_notification(")]
        self.assertIn("queue_notification_delivery(", body)
        self.assertNotIn("dispatch_user_pushes(", body)
        self.assertNotIn("send_email(", body)


if __name__ == "__main__":
    unittest.main()
