"""Shared domain event emission utility.

All modules that need to emit domain events must import from here.
This ensures consistent structure, idempotency key formatting,
and schema version tracking across every aggregate.
"""

from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pwa import dispatch_user_pushes


async def emit_event(
    db: AsyncSession,
    *,
    user: dict,
    event_type: str,
    aggregate_type: str,
    aggregate_id: UUID | str,
    project_id: Optional[UUID | str] = None,
    event_data: dict[str, Any],
    schema_version: int = 1,
    idempotency_suffix: str = "",
) -> None:
    """Insert a domain event into core.domain_events.

    The call is idempotent — if the same (org, idempotency_key) already
    exists, the insert is silently skipped.  Callers must commit the
    surrounding transaction.

    Args:
        db: Active async SQLAlchemy session.
        user: Current-user dict containing ``user_id`` and ``org_id``.
        event_type: Dot-namespaced event name, e.g.
            ``site.daily_report.approved.v1``.
        aggregate_type: Type name of the root entity, e.g.
            ``daily_site_report``.
        aggregate_id: UUID of the root entity.
        project_id: Optional project scope for this event.
        event_data: Arbitrary JSON-serialisable payload.
        schema_version: Payload schema version (default 1).
        idempotency_suffix: Optional suffix appended to the default key
            ``{event_type}:{aggregate_id}`` to allow multiple distinct
            events of the same type on the same aggregate in one transaction.
    """
    base_key = f"{event_type}:{aggregate_id}"
    idempotency_key = (
        f"{base_key}:{idempotency_suffix}" if idempotency_suffix else base_key
    )

    await db.execute(
        text("""
            INSERT INTO core.domain_events (
                organization_id, event_type, schema_version, aggregate_type,
                aggregate_id, project_id, actor_id, idempotency_key, payload
            ) VALUES (
                :org_id, :event_type, :schema_version, :aggregate_type,
                :aggregate_id, :project_id, :actor_id, :idempotency_key,
                CAST(:payload AS jsonb)
            )
            ON CONFLICT (organization_id, idempotency_key) DO NOTHING
        """),
        {
            "org_id": user["org_id"],
            "event_type": event_type,
            "schema_version": schema_version,
            "aggregate_type": aggregate_type,
            "aggregate_id": str(aggregate_id),
            "project_id": str(project_id) if project_id else None,
            "actor_id": user["user_id"],
            "idempotency_key": idempotency_key,
            "payload": json.dumps(event_data, default=str),
        },
    )


async def emit_notification(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    title: str,
    message: str,
    notification_type: str = "system",
    priority: str = "normal",
    action_url: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """Insert a notification into core.notifications.

    This is a synchronous write-path notification.  Asynchronous delivery
    (email, push) is handled separately by workers when they are wired.
    """
    result = await db.execute(
        text("""
            INSERT INTO core.notifications (
                organization_id, user_id, title, message, notification_type,
                priority, action_url, metadata
            )
            VALUES (
                :org_id, :user_id, :title, :message, :notification_type,
                :priority, :action_url, CAST(:metadata AS jsonb)
            )
            RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "title": title,
            "message": message,
            "notification_type": notification_type,
            "priority": priority,
            "action_url": action_url,
            "metadata": json.dumps(metadata or {}, default=str),
        },
    )
    row = result.first()
    if row:
        await dispatch_user_pushes(
            db,
            org_id=org_id,
            user_id=user_id,
            payload={
                "id": str(row.id),
                "title": title,
                "message": message,
                "notification_type": notification_type,
                "priority": priority,
                "action_url": action_url,
                "metadata": metadata or {},
            },
        )


async def emit_role_notification(
    db: AsyncSession,
    *,
    org_id: str,
    role_names: list[str],
    title: str,
    message: str,
    notification_type: str = "system",
    priority: str = "normal",
    action_url: Optional[str] = None,
    metadata: Optional[dict[str, Any]] = None,
) -> int:
    """Insert one notification per active user assigned to any listed role."""
    recipients = (
        await db.execute(
            text("""
            SELECT DISTINCT u.id
            FROM core.users u
            JOIN core.user_roles ur ON ur.user_id = u.id
             AND ur.organization_id = u.organization_id
            JOIN core.roles r ON r.id = ur.role_id
             AND r.organization_id = u.organization_id
             AND r.is_deleted = false
            WHERE u.organization_id = :org_id
              AND u.is_active = true
              AND u.is_deleted = false
              AND upper(r.name) = ANY(:role_names)
        """),
            {"org_id": org_id, "role_names": [role.upper() for role in role_names]},
        )
    ).scalars().all()

    for recipient_id in recipients:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(recipient_id),
            title=title,
            message=message,
            notification_type=notification_type,
            priority=priority,
            action_url=action_url,
            metadata=metadata,
        )

    return len(recipients)
