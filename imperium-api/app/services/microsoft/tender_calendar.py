"""Phase 15/16: Tender deadlines -> Microsoft Calendar bridge.

crm.tenders has exactly two timestamptz fields a deadline can live in (see
routers/tender_bids.py's _TIMESTAMPTZ_COLUMNS): `submission_deadline` and
`site_visit_at`. Both are genuine scheduled obligations per Phase 15
("tender closing dates... site visits... submission deadlines") and each
gets its own Microsoft event, since a tender can have both on different
dates - they're tracked as two separate core.calendar_event_map rows for
the same tender_id, distinguished by source_entity_type
('tender_submission_deadline' / 'tender_site_visit').

"Clarification deadlines" and "compulsory meetings" from Phase 15's example
list have no corresponding column on crm.tenders today - adding one would be
a schema change beyond "wire the existing deadlines to a calendar", so this
only covers the two fields that actually exist. Note this limitation rather
than silently only doing half the phase.

Every public function here is best-effort by construction: called from
routers/tender_bids.py after its own write has already committed, and never
raises - a Microsoft/Graph failure must never fail or roll back a tender
edit (Phase 22).
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

SUBMISSION_DEADLINE_DURATION_MINUTES = 30
SITE_VISIT_DURATION_MINUTES = 60


async def _organisation_name(db: AsyncSession, organization_id) -> str:
    row = (
        await db.execute(text("SELECT name FROM core.organizations WHERE id = :id"), {"id": organization_id})
    ).mappings().first()
    return (row["name"] if row else None) or "AEGIS"


async def _upsert(
    db: AsyncSession,
    *,
    organization_id,
    tender_id: UUID,
    source_entity_type: str,
    subject: str,
    start_at: datetime,
    duration_minutes: int,
    tender_name: str,
    bid_number: Optional[str],
    region: Optional[str],
) -> None:
    try:
        extra_fields: dict[str, str] = {"Tender": tender_name}
        if bid_number:
            extra_fields["Bid Number"] = bid_number
        if region:
            extra_fields["Region"] = region

        await calendar_service.upsert_event(
            db,
            organization_id=organization_id,
            source_module="tenders",
            source_entity_type=source_entity_type,
            source_entity_id=tender_id,
            subject=subject,
            start_at=start_at,
            end_at=start_at + timedelta(minutes=duration_minutes),
            location=None,
            owner_user_id=None,
            calendar_category="Tenders",
            aegis_reference=f"TENDER-{str(tender_id)[:8].upper()}",
            organisation_name=await _organisation_name(db, organization_id),
            extra_fields=extra_fields,
            deep_link=f"{settings.frontend_base_url}/dashboard/crm/tenders",
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see module docstring
        logger.warning(
            "microsoft_graph.tender_calendar_sync_failed",
            tender_id=str(tender_id), source_entity_type=source_entity_type, error=str(exc),
        )


async def _cancel(db: AsyncSession, *, organization_id, tender_id: UUID, source_entity_type: str) -> None:
    try:
        await calendar_service.cancel_event(
            db, organization_id=organization_id, source_module="tenders",
            source_entity_type=source_entity_type, source_entity_id=tender_id,
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "microsoft_graph.tender_calendar_cancel_failed",
            tender_id=str(tender_id), source_entity_type=source_entity_type, error=str(exc),
        )


async def sync_submission_deadline(
    db: AsyncSession, *, organization_id, tender_id: UUID, tender_name: str,
    bid_number: Optional[str], region: Optional[str], submission_deadline: Optional[datetime],
) -> None:
    if submission_deadline is None:
        await _cancel(db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_submission_deadline")
        return
    await _upsert(
        db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_submission_deadline",
        subject=f"TENDER DEADLINE — {tender_name}", start_at=submission_deadline,
        duration_minutes=SUBMISSION_DEADLINE_DURATION_MINUTES, tender_name=tender_name, bid_number=bid_number, region=region,
    )


async def sync_site_visit(
    db: AsyncSession, *, organization_id, tender_id: UUID, tender_name: str,
    bid_number: Optional[str], region: Optional[str], site_visit_at: Optional[datetime],
) -> None:
    if site_visit_at is None:
        await _cancel(db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_site_visit")
        return
    await _upsert(
        db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_site_visit",
        subject=f"TENDER SITE VISIT — {tender_name}", start_at=site_visit_at,
        duration_minutes=SITE_VISIT_DURATION_MINUTES, tender_name=tender_name, bid_number=bid_number, region=region,
    )


async def cancel_all_for_tender(db: AsyncSession, *, organization_id, tender_id: UUID) -> None:
    """Tender deleted/lost/withdrawn - cancel both possible mapped events."""
    await _cancel(db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_submission_deadline")
    await _cancel(db, organization_id=organization_id, tender_id=tender_id, source_entity_type="tender_site_visit")
