"""Verifies notification delivery waits for commit, on the real async stack,
inside a transaction that is always rolled back (push/email stubbed).

    .venv/Scripts/python.exe scripts/verify_notification_delivery.py

  1. emit_notification + rollback          -> no delivery scheduled
  2. emit_notification + commit (savepoint) -> delivery task runs, but the
     row is not committed to the database, so nothing is pushed or emailed
"""

import asyncio

from sqlalchemy import text

from _rollback_harness import OUTBOUND_CALLS, block_outbound, check, finish, rollback_session
import app.shared.notification_delivery as delivery  # noqa: E402 (path set by the harness)
from app.shared.events import emit_notification  # noqa: E402

RUNS: list[list[str]] = []


async def run() -> None:
    real = delivery.deliver_notifications

    async def traced(items):
        RUNS.append([i["notification_id"] for i in items])
        await real(items)

    delivery.deliver_notifications = traced
    with block_outbound():
        async with rollback_session() as db:
            row = (await db.execute(text("SELECT id::text, organization_id::text FROM core.users LIMIT 1"))).first()
            kwargs = dict(org_id=row.organization_id, user_id=row.id, title="AEGIS delivery check",
                          message="verification - never delivered", priority="urgent")

            await emit_notification(db, **kwargs)
            await db.rollback()
            await asyncio.sleep(0.5)
            check(RUNS == [], "1. rolled-back notification schedules no delivery")

            await emit_notification(db, **kwargs)
            await db.commit()
            for _ in range(50):
                if RUNS:
                    break
                await asyncio.sleep(0.1)
            await asyncio.sleep(1.5)
            check(len(RUNS) == 1, "2. delivery task started only after commit")
            check(OUTBOUND_CALLS == [], "   row not committed to the database -> no push, no email")
    delivery.deliver_notifications = real
    finish()


if __name__ == "__main__":
    asyncio.run(run())
