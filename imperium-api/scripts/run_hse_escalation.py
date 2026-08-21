"""Cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): escalates HSE incidents that are still 'open' past
a severity-based SLA (critical: 4h, high: 24h, medium/low: 72h). Runs
hourly - safety incidents need a tighter check interval than the daily HR/
compliance sweeps. Runs across every tenant - each row carries its own
organization_id.

Like run_activity_reminders.py, this calls emit_role_notification directly
instead of going through the crm.automation_rules engine.

Usage: docker compose exec -T imperium-api python3 scripts/run_hse_escalation.py
"""

import asyncio
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.shared.events import emit_role_notification

SLA_HOURS = {"critical": 4, "high": 24, "medium": 72, "low": 72}
# Dedup window: re-escalate at most once per SLA period rather than every run.
DEDUP_HOURS = 4


async def _already_alerted(db, source_id: str) -> bool:
    return bool(
        (
            await db.execute(
                text("""
                    SELECT 1 FROM core.notifications
                    WHERE notification_type = 'hse_incident_escalation'
                      AND metadata->>'source_id' = :source_id
                      AND created_at > NOW() - make_interval(hours => :hours)
                    LIMIT 1
                """),
                {"source_id": source_id, "hours": DEDUP_HOURS},
            )
        ).scalar()
    )


async def main() -> None:
    async with AsyncSessionLocal() as db:
        sent = 0
        for severity, sla_hours in SLA_HOURS.items():
            rows = (
                await db.execute(
                    text("""
                        SELECT id, organization_id, title, location, created_at
                        FROM projects.hse_incidents
                        WHERE is_deleted = false
                          AND status = 'open'
                          AND severity = :severity
                          AND created_at <= NOW() - make_interval(hours => :sla_hours)
                        LIMIT 500
                    """),
                    {"severity": severity, "sla_hours": sla_hours},
                )
            ).mappings().all()

            for row in rows:
                if await _already_alerted(db, str(row["id"])):
                    continue
                await emit_role_notification(
                    db,
                    org_id=str(row["organization_id"]),
                    role_names=["HSE / Safety Officer", "Compliance Officer"],
                    title="Unresolved HSE incident",
                    message=f"{severity.title()} severity incident \"{row['title'] or 'Untitled'}\""
                    + (f" at {row['location']}" if row["location"] else "")
                    + f" has been open since {row['created_at'].strftime('%Y-%m-%d %H:%M')} - past the {sla_hours}h SLA.",
                    notification_type="hse_incident_escalation",
                    priority="urgent",
                    action_url="/dashboard/compliance/incidents",
                    metadata={"source_id": str(row["id"])},
                )
                sent += 1

        await db.commit()
        logger.info(f"HSE escalation check sent {sent} escalation(s).")


if __name__ == "__main__":
    asyncio.run(main())
