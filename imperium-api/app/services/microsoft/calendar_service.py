"""Phase 14/16/17/18 orchestration: map one AEGIS scheduled-obligation record
to exactly one Microsoft Calendar event, and keep it in sync AEGIS -> Microsoft
(phase one of Phase 17 - Microsoft is never authoritative yet).

Idempotency (Phase 18) comes from the database, not from this code: the
UNIQUE(organization_id, source_module, source_entity_type, source_entity_id)
constraint on core.calendar_event_map means a second call for the same AEGIS
record updates the existing mapping row instead of creating a second one,
even under retry.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from app.services.microsoft import calendar as ms_calendar
from app.services.microsoft.document_service import MicrosoftIntegrationNotReady
from app.services.microsoft.errors import GraphError, GraphNotConfiguredError
from app.services.microsoft.graph_client import GraphClient

DEFAULT_TIMEZONE = "Africa/Harare"


def _local_naive_iso(value: datetime, tz_name: str) -> str:
    """Microsoft Graph's dateTimeTimeZone resource wants a LOCAL wall-clock
    string with no UTC offset, paired with a separate `timeZone` field - a
    string with an offset (e.g. from tz-aware_datetime.isoformat()) is
    outside that contract and gets misinterpreted (Graph reads only the
    naive portion, silently shifting the event by the zone's UTC offset).

    A tz-aware `value` is a real absolute instant, so it's converted into
    the target zone's wall-clock time first. A naive `value` is treated as
    already being local wall-clock time in that zone (e.g. a bare `date`
    combined with a deliberately-chosen time of day, which has no absolute
    instant to convert from)."""
    if value.tzinfo is not None:
        value = value.astimezone(ZoneInfo(tz_name))
    return value.replace(tzinfo=None).isoformat()


@dataclass
class CalendarConnection:
    tenant_id: str
    calendar_owner_id: str
    calendar_id: str
    is_group: bool
    timezone: str


async def _load_connection(db: AsyncSession, organization_id: UUID) -> CalendarConnection:
    row = (
        await db.execute(
            text("""
                SELECT tenant_id, calendar_owner_id, calendar_id, calendar_timezone, enabled, sync_calendar
                FROM core.organisation_integrations
                WHERE organization_id = :org_id AND provider = 'microsoft365' AND is_deleted = false
            """),
            {"org_id": organization_id},
        )
    ).mappings().first()

    if not row or not row["enabled"] or not row["sync_calendar"]:
        raise MicrosoftIntegrationNotReady("Microsoft 365 calendar sync is not enabled for this organisation.")
    if not row["calendar_owner_id"] or not row["calendar_id"]:
        raise MicrosoftIntegrationNotReady("Microsoft 365 is connected but no calendar is selected yet.")

    tenant_id = row["tenant_id"] or settings.MICROSOFT_GRAPH_TENANT_ID
    if not tenant_id:
        raise GraphNotConfiguredError("No Microsoft tenant configured for this organisation.")

    owner_id = str(row["calendar_owner_id"])
    # A Microsoft 365 Group's object ID and a user's object ID are both plain
    # GUIDs from Graph's perspective - which mailbox kind this is was
    # recorded explicitly when the setup wizard's 'Select Calendar' step
    # resolved it, stored as a UPN-shaped owner (contains '@') for a shared
    # mailbox/user or a bare GUID for a group. This mirrors how that step
    # persists calendar_owner_id; see routers/integrations_microsoft.py.
    is_group = "@" not in owner_id

    return CalendarConnection(
        tenant_id=tenant_id, calendar_owner_id=owner_id, calendar_id=row["calendar_id"],
        is_group=is_group, timezone=row["calendar_timezone"] or DEFAULT_TIMEZONE,
    )


def _build_body_html(
    *, aegis_reference: str, organisation_name: str, extra_fields: dict[str, str], deep_link: Optional[str]
) -> str:
    """Phase 16's metadata block, rendered as simple HTML for the Outlook
    event body."""
    rows = "".join(f"<tr><td><b>{key}</b></td><td>{value}</td></tr>" for key, value in extra_fields.items())
    link_html = f'<p><a href="{deep_link}">Open in AEGIS</a></p>' if deep_link else ""
    return (
        f"<p><b>AEGIS Reference:</b> {aegis_reference}<br/>"
        f"<b>Organisation:</b> {organisation_name}</p>"
        f"<table>{rows}</table>{link_html}"
    )


async def upsert_event(
    db: AsyncSession,
    *,
    organization_id: UUID,
    source_module: str,
    source_entity_type: str,
    source_entity_id: UUID,
    subject: str,
    start_at: datetime,
    end_at: datetime,
    location: Optional[str],
    owner_user_id: Optional[UUID],
    calendar_category: str,
    aegis_reference: str,
    organisation_name: str,
    extra_fields: dict[str, str],
    deep_link: Optional[str] = None,
) -> dict:
    """Create the Microsoft event on first call for this (module, entity
    type, entity id); update the same event on every subsequent call (e.g.
    the user changed the meeting time in AEGIS - Phase 17)."""
    connection = await _load_connection(db, organization_id)
    client = GraphClient(tenant_id=connection.tenant_id)
    body_html = _build_body_html(
        aegis_reference=aegis_reference, organisation_name=organisation_name,
        extra_fields=extra_fields, deep_link=deep_link,
    )

    existing = (
        await db.execute(
            text("""
                SELECT id, microsoft_event_id FROM core.calendar_event_map
                WHERE organization_id = :org_id AND source_module = :module
                  AND source_entity_type = :entity_type AND source_entity_id = :entity_id
            """),
            {"org_id": organization_id, "module": source_module, "entity_type": source_entity_type, "entity_id": source_entity_id},
        )
    ).mappings().first()

    start_iso = _local_naive_iso(start_at, connection.timezone)
    end_iso = _local_naive_iso(end_at, connection.timezone)

    try:
        if existing and existing["microsoft_event_id"]:
            event = await ms_calendar.update_event(
                client, owner_id=connection.calendar_owner_id, is_group=connection.is_group,
                event_id=existing["microsoft_event_id"], subject=subject, body_html=body_html,
                start_at_iso=start_iso, end_at_iso=end_iso, timezone=connection.timezone, location=location,
            )
        else:
            event = await ms_calendar.create_event(
                client, owner_id=connection.calendar_owner_id, calendar_id=connection.calendar_id,
                is_group=connection.is_group, subject=subject, body_html=body_html,
                start_at_iso=start_iso, end_at_iso=end_iso, timezone=connection.timezone, location=location,
                categories=[calendar_category],
            )
        sync_status, sync_error = "synced", None
    except GraphError as exc:
        sync_status, sync_error = "failed", str(exc)
        event = None

    row = (
        await db.execute(
            text("""
                INSERT INTO core.calendar_event_map (
                    organization_id, source_module, source_entity_type, source_entity_id,
                    microsoft_event_id, microsoft_calendar_id, microsoft_change_key,
                    subject, description, start_at, end_at, timezone, location,
                    owner_user_id, calendar_category, sync_status, sync_error, last_synced_at
                ) VALUES (
                    :org_id, :module, :entity_type, :entity_id,
                    :event_id, :calendar_id, :change_key,
                    :subject, :description, :start_at, :end_at, :timezone, :location,
                    :owner_user_id, :category, :sync_status, :sync_error,
                    CASE WHEN :sync_status_check = 'synced' THEN NOW() ELSE NULL END
                )
                ON CONFLICT (organization_id, source_module, source_entity_type, source_entity_id) DO UPDATE SET
                    microsoft_event_id = COALESCE(EXCLUDED.microsoft_event_id, core.calendar_event_map.microsoft_event_id),
                    microsoft_change_key = COALESCE(EXCLUDED.microsoft_change_key, core.calendar_event_map.microsoft_change_key),
                    subject = EXCLUDED.subject, description = EXCLUDED.description,
                    start_at = EXCLUDED.start_at, end_at = EXCLUDED.end_at, location = EXCLUDED.location,
                    sync_status = EXCLUDED.sync_status, sync_error = EXCLUDED.sync_error,
                    last_synced_at = CASE WHEN EXCLUDED.sync_status = 'synced' THEN NOW() ELSE core.calendar_event_map.last_synced_at END,
                    updated_at = NOW()
                RETURNING *
            """),
            {
                "org_id": organization_id, "module": source_module, "entity_type": source_entity_type,
                "entity_id": source_entity_id, "event_id": event.event_id if event else None,
                "calendar_id": connection.calendar_id, "change_key": event.change_key if event else None,
                "subject": subject, "description": body_html, "start_at": start_at, "end_at": end_at,
                "timezone": connection.timezone, "location": location, "owner_user_id": owner_user_id,
                "category": calendar_category, "sync_status": sync_status, "sync_status_check": sync_status,
                "sync_error": sync_error,
            },
        )
    ).mappings().first()

    return dict(row)


async def cancel_event(
    db: AsyncSession, *, organization_id: UUID, source_module: str, source_entity_type: str, source_entity_id: UUID,
) -> Optional[dict]:
    """Phase 17: cancelling the AEGIS activity cancels the Microsoft event.
    A no-op (returns None) if no event was ever created for this record."""
    connection = await _load_connection(db, organization_id)
    existing = (
        await db.execute(
            text("""
                SELECT id, microsoft_event_id FROM core.calendar_event_map
                WHERE organization_id = :org_id AND source_module = :module
                  AND source_entity_type = :entity_type AND source_entity_id = :entity_id
                  AND cancelled_at IS NULL
            """),
            {"org_id": organization_id, "module": source_module, "entity_type": source_entity_type, "entity_id": source_entity_id},
        )
    ).mappings().first()
    if not existing:
        return None

    if existing["microsoft_event_id"]:
        client = GraphClient(tenant_id=connection.tenant_id)
        await ms_calendar.cancel_event(
            client, owner_id=connection.calendar_owner_id, is_group=connection.is_group,
            event_id=existing["microsoft_event_id"],
        )

    row = (
        await db.execute(
            text("""
                UPDATE core.calendar_event_map
                SET cancelled_at = NOW(), sync_status = 'cancelled', updated_at = NOW()
                WHERE id = :id
                RETURNING *
            """),
            {"id": existing["id"]},
        )
    ).mappings().first()
    return dict(row)
