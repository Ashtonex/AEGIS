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
) -> None:
    """Insert a notification into core.notifications.

    This is a synchronous write-path notification.  Asynchronous delivery
    (email, push) is handled separately by workers when they are wired.
    """
    await db.execute(
        text("""
            INSERT INTO core.notifications (organization_id, user_id, title, message)
            VALUES (:org_id, :user_id, :title, :message)
        """),
        {"org_id": org_id, "user_id": user_id, "title": title, "message": message},
    )
