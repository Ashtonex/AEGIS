"""Phase 15/16: CRM activity -> Microsoft Calendar bridge.

Only genuine scheduled obligations become calendar events - client meetings
and scheduled calls that are still upcoming (status='Pending'). Phase 15
explicitly excludes routine workflow activity from the calendar; in this
schema that means:
  - type not in {Meeting, Call} (Email/Task/Note stay CRM-only), and
  - status != 'Pending' (a 'Completed' activity is a logged record of
    something that already happened, not something to schedule).

Called from routers/crm_activities.py as a best-effort side effect, always
AFTER the underlying CRM write has already committed: a Microsoft outage,
missing configuration, or any other Graph failure must never fail or roll
back a CRM activity (Phase 22) - every public function here swallows its
own errors and logs them rather than raising.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger
from app.services.microsoft import calendar_service
from app.services.microsoft.document_service import MicrosoftIntegrationNotReady

CALENDAR_RELEVANT_TYPES = {"meeting", "call"}
DEFAULT_DURATION_MINUTES = {"meeting": 60, "call": 30}
FALLBACK_DURATION_MINUTES = 30


def is_calendar_relevant(activity_type: Optional[str], status: Optional[str]) -> bool:
    if not activity_type:
        return False
    if (status or "").strip().lower() != "pending":
        return False
    return activity_type.strip().lower() in CALENDAR_RELEVANT_TYPES


async def _organisation_name(db: AsyncSession, organization_id: UUID) -> str:
    row = (
        await db.execute(
            text("SELECT name FROM core.organizations WHERE id = :id"),
            {"id": organization_id},
        )
    ).mappings().first()
    return (row["name"] if row else None) or "AEGIS"


async def sync_activity(
    db: AsyncSession,
    *,
    organization_id: UUID,
    activity_id: UUID,
    activity_type: str,
    subject: str,
    description: Optional[str],
    activity_date: datetime,
    owner_user_id: Optional[UUID],
    owner_name: Optional[str],
    contact_name: Optional[str],
    lead_company: Optional[str],
    opportunity_name: Optional[str],
) -> None:
    """Create the Microsoft event on first sync for this activity, update
    the same event (via calendar_service's idempotent upsert) on every
    later call - e.g. the user moved the meeting time in AEGIS. Never
    raises; logs and returns on any failure."""
    try:
        type_key = activity_type.strip().lower()
        duration = DEFAULT_DURATION_MINUTES.get(type_key, FALLBACK_DURATION_MINUTES)
        end_at = activity_date + timedelta(minutes=duration)
        client_label = contact_name or lead_company or opportunity_name or "Client"

        extra_fields: dict[str, str] = {"Owner": owner_name or "Unassigned"}
        if contact_name:
            extra_fields["Client"] = contact_name
        elif lead_company:
            extra_fields["Client"] = lead_company
        if opportunity_name:
            extra_fields["Opportunity"] = opportunity_name
        if description:
            extra_fields["Purpose"] = description

        await calendar_service.upsert_event(
            db,
            organization_id=organization_id,
            source_module="crm",
            source_entity_type="activity",
            source_entity_id=activity_id,
            subject=f"CRM — {activity_type} | {client_label}",
            start_at=activity_date,
            end_at=end_at,
            location=None,
            owner_user_id=owner_user_id,
            calendar_category="CRM",
            aegis_reference=f"CRM-ACT-{str(activity_id)[:8].upper()}",
            organisation_name=await _organisation_name(db, organization_id),
            extra_fields=extra_fields,
            deep_link=f"{settings.frontend_base_url}/dashboard/crm/activities",
        )
    except MicrosoftIntegrationNotReady:
        # Not connected/enabled for this organisation - nothing to sync,
        # not an error worth logging on every single activity write.
        pass
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see module docstring
        logger.warning(
            "microsoft_graph.crm_activity_sync_failed",
            activity_id=str(activity_id), organization_id=str(organization_id), error=str(exc),
        )


async def cancel_activity(db: AsyncSession, *, organization_id: UUID, activity_id: UUID) -> None:
    """Phase 17: an activity being deleted/cancelled in AEGIS cancels its
    Microsoft event, if one was ever created. Never raises."""
    try:
        await calendar_service.cancel_event(
            db, organization_id=organization_id, source_module="crm",
            source_entity_type="activity", source_entity_id=activity_id,
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "microsoft_graph.crm_activity_cancel_failed",
            activity_id=str(activity_id), organization_id=str(organization_id), error=str(exc),
        )
