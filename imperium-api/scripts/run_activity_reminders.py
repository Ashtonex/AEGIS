"""Cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): finds crm.activities coming up within the next hour
that are still 'Pending' and haven't been reminded yet, and notifies each
activity's owner directly via core.notifications.

This intentionally does not go through the crm.automation_rules engine like
run_stale_quote_check.py / run_weekly_digest.py do - a reminder needs to
reach the owner every time regardless of whether the org has configured a
matching automation rule, so it calls emit_notification directly.

Usage: docker compose exec -T imperium-api python3 scripts/run_activity_reminders.py
"""

import asyncio
import os
import sys
from datetime import datetime, timezone

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.shared.events import emit_notification

REMINDER_WINDOW_MINUTES = 60


async def main() -> None:
    async with AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                text("""
                    SELECT a.id, a.organization_id, a.owner_user_id, a.subject, a.type, a.activity_date
                    FROM crm.activities a
                    WHERE a.is_deleted = false
                      AND a.status = 'Pending'
                      AND a.reminder_sent_at IS NULL
                      AND a.owner_user_id IS NOT NULL
                      AND a.activity_date BETWEEN NOW() AND NOW() + make_interval(mins => :window)
                    LIMIT 500
                """),
                {"window": REMINDER_WINDOW_MINUTES},
            )
        ).mappings().all()

        sent = 0
        for row in rows:
            activity_id = str(row["id"])
            await emit_notification(
                db,
                org_id=str(row["organization_id"]),
                user_id=str(row["owner_user_id"]),
                title="Upcoming CRM activity",
                message=f"{row['type']}: {row['subject']} at {row['activity_date'].strftime('%H:%M')}",
                notification_type="crm_activity_reminder",
                priority="normal",
                action_url="/dashboard/crm/activities",
                metadata={"activity_id": activity_id},
            )
            await db.execute(
                text("UPDATE crm.activities SET reminder_sent_at = NOW() WHERE id = :id"),
                {"id": activity_id},
            )
            sent += 1

        await db.commit()
        logger.info(f"Activity reminder check sent {sent} reminder(s) at {datetime.now(timezone.utc).isoformat()}.")


if __name__ == "__main__":
    asyncio.run(main())
