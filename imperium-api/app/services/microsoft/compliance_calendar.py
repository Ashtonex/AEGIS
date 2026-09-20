"""Phase 15/16: Compliance corrective-action due dates -> Microsoft Calendar bridge.

compliance.corrective_actions.due_date (the CAPA register - see
routers/compliance_items.py) is a real scheduled obligation, so each
corrective action gets its own Microsoft event, tracked as one
core.calendar_event_map row keyed by source_entity_type
'corrective_action_due'.

Every public function here is best-effort by construction: called from
routers/compliance_items.py after its own write has already committed, and
never raises - a Microsoft/Graph failure must never fail or roll back a
corrective-action edit (Phase 22, mirrors tender_calendar.py).
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger
from app.services.microsoft import calendar_service
from app.services.microsoft.document_service import MicrosoftIntegrationNotReady

DUE_EVENT_DURATION_MINUTES = 30
DUE_EVENT_HOUR = 9  # due_date has no time-of-day; book a fixed morning slot


async def _organisation_name(db: AsyncSession, organization_id) -> str:
    row = (
        await db.execute(text("SELECT name FROM core.organizations WHERE id = :id"), {"id": organization_id})
    ).mappings().first()
    return (row["name"] if row else None) or "AEGIS"


async def sync_corrective_action(
    db: AsyncSession,
    *,
    organization_id,
    corrective_action_id: UUID,
    finding_trigger: str,
    responsible_person: str,
    due_date: Optional[date],
    priority: str,
) -> None:
    """Upserts the Microsoft event for one corrective action's due date, or
    cancels it if due_date is None (e.g. the action was resolved before a
    due date existed)."""
    if due_date is None:
        await _cancel(db, organization_id=organization_id, corrective_action_id=corrective_action_id)
        return
    try:
        start_at = datetime.combine(due_date, time(hour=DUE_EVENT_HOUR))
        await calendar_service.upsert_event(
            db,
            organization_id=organization_id,
            source_module="compliance",
            source_entity_type="corrective_action_due",
            source_entity_id=corrective_action_id,
            subject=f"COMPLIANCE DUE — {finding_trigger}",
            start_at=start_at,
            end_at=start_at + timedelta(minutes=DUE_EVENT_DURATION_MINUTES),
            location=None,
            owner_user_id=None,
            calendar_category="Compliance",
            aegis_reference=f"CAPA-{str(corrective_action_id)[:8].upper()}",
            organisation_name=await _organisation_name(db, organization_id),
            extra_fields={"Responsible": responsible_person, "Priority": priority},
            deep_link=f"{settings.frontend_base_url}/dashboard/compliance",
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001 - see module docstring
        logger.warning(
            "microsoft_graph.compliance_calendar_sync_failed",
            corrective_action_id=str(corrective_action_id), error=str(exc),
        )


async def _cancel(db: AsyncSession, *, organization_id, corrective_action_id: UUID) -> None:
    try:
        await calendar_service.cancel_event(
            db, organization_id=organization_id, source_module="compliance",
            source_entity_type="corrective_action_due", source_entity_id=corrective_action_id,
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "microsoft_graph.compliance_calendar_cancel_failed",
            corrective_action_id=str(corrective_action_id), error=str(exc),
        )
