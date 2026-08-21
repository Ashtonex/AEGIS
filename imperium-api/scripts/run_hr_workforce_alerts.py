"""Cron entrypoint (run via system cron, not the arq worker - see
scripts/README-cron.md): finds employee certifications and equipment
credentials expiring soon (or already expired), and leave requests still
awaiting a decision after 2 days, and notifies the relevant people directly
via core.notifications. Runs across every tenant - each row carries its own
organization_id.

Like run_activity_reminders.py, this calls emit_notification/
emit_role_notification directly instead of going through the
crm.automation_rules engine - these alerts need to reach people
unconditionally, not depend on an org having configured a matching rule.

Usage: docker compose exec -T imperium-api python3 scripts/run_hr_workforce_alerts.py
"""

import asyncio
import os
import sys
from datetime import date

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text

from core.database import AsyncSessionLocal
from core.logging import logger
from app.shared.events import emit_notification, emit_role_notification

DEFAULT_WARNING_DAYS = 30
LEAVE_PENDING_DAYS = 2
# Dedup window: skip anything already alerted within this many hours, so a
# daily cron run doesn't re-notify people about the same item every day.
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


async def _check_expiring_credentials(db) -> int:
    """hr.employee_certifications and compliance.equipment_credentials
    expiring within the matching deployment_requirements.warning_days for
    that certification name (default 30 days if no requirement matches)."""
    sent = 0

    employee_rows = (
        await db.execute(
            text("""
                SELECT ec.id, ec.organization_id, ec.certification_name, ec.expires_on,
                       e.employee_name, e.linked_user_id,
                       COALESCE(MIN(dr.warning_days), :default_warning_days) AS warning_days
                FROM hr.employee_certifications ec
                JOIN hr.employees e
                  ON e.id = ec.employee_id AND e.organization_id = ec.organization_id AND e.is_deleted = false
                LEFT JOIN compliance.deployment_requirements dr
                  ON dr.organization_id = ec.organization_id
                 AND dr.is_active = true
                 AND dr.requirement_scope IN ('workforce_project_allocation', 'all_deployments')
                 AND lower(dr.certification_name) = lower(ec.certification_name)
                WHERE ec.is_deleted = false AND ec.expires_on IS NOT NULL
                GROUP BY ec.id, ec.organization_id, ec.certification_name, ec.expires_on, e.employee_name, e.linked_user_id
                HAVING ec.expires_on <= CURRENT_DATE + (COALESCE(MIN(dr.warning_days), :default_warning_days) || ' days')::interval
                LIMIT 500
            """),
            {"default_warning_days": DEFAULT_WARNING_DAYS},
        )
    ).mappings().all()

    for row in employee_rows:
        if await _already_alerted(db, "hr_certification_expiring", str(row["id"])):
            continue
        is_expired = row["expires_on"] < date.today()
        verb = "expired" if is_expired else "expires"
        message = f"{row['certification_name']} for {row['employee_name']} {verb} on {row['expires_on']}."
        if row["linked_user_id"]:
            await emit_notification(
                db,
                org_id=str(row["organization_id"]),
                user_id=str(row["linked_user_id"]),
                title="Certification expiring" if not is_expired else "Certification expired",
                message=message,
                notification_type="hr_certification_expiring",
                priority="urgent" if is_expired else "normal",
                action_url="/dashboard/hr",
                metadata={"source_id": str(row["id"])},
            )
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["HR Manager", "Compliance Officer"],
            title="Certification expiring" if not is_expired else "Certification expired",
            message=message,
            notification_type="hr_certification_expiring",
            priority="urgent" if is_expired else "normal",
            action_url="/dashboard/compliance",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    equipment_rows = (
        await db.execute(
            text("""
                SELECT ec.id, ec.organization_id, ec.credential_name, ec.expires_on,
                       COALESCE(f.asset_code, f.vehicle_registration, f.id::text) AS asset_name,
                       COALESCE(MIN(dr.warning_days), :default_warning_days) AS warning_days
                FROM compliance.equipment_credentials ec
                JOIN fleet.fleet f
                  ON f.id = ec.fleet_id AND f.organization_id = ec.organization_id AND f.is_deleted = false
                LEFT JOIN compliance.deployment_requirements dr
                  ON dr.organization_id = ec.organization_id
                 AND dr.is_active = true
                 AND dr.requirement_scope IN ('equipment_assignment', 'all_deployments')
                 AND lower(dr.certification_name) = lower(ec.credential_name)
                WHERE ec.is_deleted = false AND ec.expires_on IS NOT NULL
                GROUP BY ec.id, ec.organization_id, ec.credential_name, ec.expires_on, asset_name
                HAVING ec.expires_on <= CURRENT_DATE + (COALESCE(MIN(dr.warning_days), :default_warning_days) || ' days')::interval
                LIMIT 500
            """),
            {"default_warning_days": DEFAULT_WARNING_DAYS},
        )
    ).mappings().all()

    for row in equipment_rows:
        if await _already_alerted(db, "compliance_equipment_credential_expiring", str(row["id"])):
            continue
        is_expired = row["expires_on"] < date.today()
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["Compliance Officer", "HSE / Safety Officer"],
            title="Equipment credential expiring" if not is_expired else "Equipment credential expired",
            message=f"{row['credential_name']} for {row['asset_name']} "
            + ("expired" if is_expired else "expires")
            + f" on {row['expires_on']}.",
            notification_type="compliance_equipment_credential_expiring",
            priority="urgent" if is_expired else "normal",
            action_url="/dashboard/compliance",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    return sent


async def _check_pending_leave(db) -> int:
    sent = 0
    rows = (
        await db.execute(
            text("""
                SELECT lr.id, lr.organization_id, lr.leave_type, lr.created_at, e.employee_name
                FROM hr.leave_requests lr
                JOIN hr.employees e ON e.id = lr.employee_id AND e.organization_id = lr.organization_id
                WHERE lr.is_deleted = false AND lr.status = 'pending'
                  AND lr.created_at <= NOW() - make_interval(days => :pending_days)
                LIMIT 500
            """),
            {"pending_days": LEAVE_PENDING_DAYS},
        )
    ).mappings().all()

    for row in rows:
        if await _already_alerted(db, "hr_leave_pending_reminder", str(row["id"])):
            continue
        await emit_role_notification(
            db,
            org_id=str(row["organization_id"]),
            role_names=["HR Manager", "HR Officer"],
            title="Leave request awaiting decision",
            message=f"{row['employee_name']}'s {row['leave_type']} leave request has been pending for over {LEAVE_PENDING_DAYS} days.",
            notification_type="hr_leave_pending_reminder",
            priority="normal",
            action_url="/dashboard/hr",
            metadata={"source_id": str(row["id"])},
        )
        sent += 1

    return sent


async def main() -> None:
    async with AsyncSessionLocal() as db:
        credential_alerts = await _check_expiring_credentials(db)
        leave_alerts = await _check_pending_leave(db)
        await db.commit()
        logger.info(
            f"HR/workforce alert check sent {credential_alerts} credential alert(s) "
            f"and {leave_alerts} leave reminder(s)."
        )


if __name__ == "__main__":
    asyncio.run(main())
