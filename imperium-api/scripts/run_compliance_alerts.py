"""Cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): flips overdue corrective actions to 'overdue' and
notifies Compliance Officers, warns about statutory obligations coming due,
and re-reminds about deployment gates that are still blocked a day after
the immediate alert (core/compliance.py::validate_employee_deployment)
already fired. Runs across every tenant - each row carries its own
organization_id.

Like run_activity_reminders.py, this calls emit_notification/
emit_role_notification directly instead of going through the
crm.automation_rules engine.

Usage: docker compose exec -T imperium-api python3 scripts/run_compliance_alerts.py
"""

import asyncio
import os
import sys

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.shared.events import emit_role_notification

OBLIGATION_WARNING_DAYS = 14
# Dedup window: skip anything already alerted within this many hours.
DEDUP_HOURS = 20


async def _already_alerted(db, notification_type: str, source_id: str) -> bool:
    return bool(
        (
            await db.execute(
                text("""
                    SELECT 1 FROM core.notifications
                    WHERE notification_type = :notification_type
                      AND metadata->>'source_id' = :source_id
                      AND created_at > NOW() - make_interval(hours => :hours)
                    LIMIT 1
                """),
                {
                    "notification_type": notification_type,
                    "source_id": source_id,
                    "hours": DEDUP_HOURS,
                },
            )
        ).scalar()
    )


async def _check_overdue_corrective_actions(db) -> int:
    sent = 0
    rows = (
        await db.execute(
            text("""
                UPDATE compliance.corrective_actions
                SET status = 'overdue', updated_at = NOW()
                WHERE is_deleted = false
                  AND status IN ('open', 'in_progress')
                  AND due_date < CURRENT_DATE
                RETURNING id, organization_id, finding_trigger, responsible_person, due_date, priority
            """)
        )
    ).mappings().all()

    for row in rows:
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["Compliance Officer"],
            title="Corrective action overdue",
            message=f"{row['finding_trigger']} (assigned to {row['responsible_person']}) was due {row['due_date']} and is now overdue.",
            notification_type="compliance_corrective_action_overdue",
            priority="urgent" if row["priority"] == "critical" else "normal",
            action_url="/dashboard/compliance",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    return sent


async def _check_obligations_due(db) -> int:
    sent = 0
    rows = (
        await db.execute(
            text("""
                SELECT id, organization_id, certificate_name, expiry_date, authority
                FROM core.compliance_items
                WHERE is_deleted = false
                  AND expiry_date IS NOT NULL
                  AND expiry_date <= CURRENT_DATE + make_interval(days => :warning_days)
                LIMIT 500
            """),
            {"warning_days": OBLIGATION_WARNING_DAYS},
        )
    ).mappings().all()

    for row in rows:
        if await _already_alerted(db, "compliance_obligation_due", str(row["id"])):
            continue
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["Compliance Officer"],
            title="Statutory obligation due soon",
            message=f"{row['certificate_name']} ({row['authority']}) is due {row['expiry_date']}.",
            notification_type="compliance_obligation_due",
            priority="normal",
            action_url="/dashboard/compliance",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    return sent


async def _check_blocked_deployment_gates(db) -> int:
    sent = 0
    rows = (
        await db.execute(
            text("""
                SELECT c.id, c.organization_id, c.gate_type, e.employee_name, c.checked_at
                FROM compliance.deployment_gate_checks c
                JOIN hr.employees e ON e.id = c.subject_employee_id AND e.organization_id = c.organization_id
                WHERE c.is_deleted = false
                  AND c.status = 'blocked'
                  AND c.checked_at <= NOW() - INTERVAL '24 hours'
                LIMIT 500
            """)
        )
    ).mappings().all()

    for row in rows:
        if await _already_alerted(db, "compliance_deployment_blocked_reminder", str(row["id"])):
            continue
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["Compliance Officer", "HSE / Safety Officer"],
            title="Deployment gate still blocked",
            message=f"{row['employee_name']}'s {row['gate_type'].replace('_', ' ')} has been blocked since {row['checked_at'].date()}.",
            notification_type="compliance_deployment_blocked_reminder",
            priority="normal",
            action_url="/dashboard/compliance",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    return sent


async def main() -> None:
    async with AsyncSessionLocal() as db:
        overdue = await _check_overdue_corrective_actions(db)
        obligations = await _check_obligations_due(db)
        blocked = await _check_blocked_deployment_gates(db)
        await db.commit()
        logger.info(
            f"Compliance alert check sent {overdue} overdue corrective action alert(s), "
            f"{obligations} obligation-due alert(s), and {blocked} blocked-gate reminder(s)."
        )


if __name__ == "__main__":
    asyncio.run(main())
