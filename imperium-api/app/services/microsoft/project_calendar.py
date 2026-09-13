"""Phase 15/16: Project mobilisation + milestones -> Microsoft Calendar bridge.

Covers the two places projects.* actually has a schedulable date today:
  - projects.project_profiles.approved_mobilisation_date, set once via
    routers/projects.py's POST /{project_id}/pre-mobilisation/approve
    (Phase 15's "mobilisation").
  - projects.project_milestones, a generic named-date table already used for
    major milestones, handovers and completion targets (status/baseline_
    date/forecast_date/actual_date - see migrations/015_project_delivery_
    controls.sql). Each milestone is its OWN calendar event, since a project
    can have many.

"Site meetings" and "inspections" from Phase 15's example list have no
dedicated scheduling field on this schema today (site_operations/site
reports are logged after the fact, not scheduled ahead of time) - not
wired, same documented-gap treatment as tenders' clarification deadlines.

Every public function is best-effort by construction: called after the
underlying AEGIS write has already committed, never raises (Phase 22).
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

# Milestone/mobilisation dates are calendar DATEs, not timestamps - these are
# the default local wall-clock start times used to turn a bare date into a
# schedulable block. Chosen to land at the start of a normal site working
# day rather than implying a specific real meeting time nobody set.
MOBILISATION_DEFAULT_TIME = time(8, 0)
MOBILISATION_DURATION_MINUTES = 120
MILESTONE_DEFAULT_TIME = time(9, 0)
MILESTONE_DURATION_MINUTES = 60

MILESTONE_ENTITY_TYPE = "milestone"
MOBILISATION_ENTITY_TYPE = "mobilisation"


async def _organisation_name(db: AsyncSession, organization_id) -> str:
    row = (
        await db.execute(text("SELECT name FROM core.organizations WHERE id = :id"), {"id": organization_id})
    ).mappings().first()
    return (row["name"] if row else None) or "AEGIS"


def _as_local_datetime(value: date, at: time) -> datetime:
    """Deliberately naive - see calendar_service._local_naive_iso, which
    treats a naive datetime as already being local wall-clock time (there is
    no absolute instant to convert from a bare `date`)."""
    return datetime.combine(value, at)


async def sync_mobilisation(
    db: AsyncSession, *, organization_id, project_id: UUID, project_name: str,
    project_code: Optional[str], mobilisation_date: date,
) -> None:
    try:
        start_at = _as_local_datetime(mobilisation_date, MOBILISATION_DEFAULT_TIME)
        extra_fields: dict[str, str] = {"Project": project_name}
        if project_code:
            extra_fields["Project Code"] = project_code

        await calendar_service.upsert_event(
            db,
            organization_id=organization_id,
            source_module="projects",
            source_entity_type=MOBILISATION_ENTITY_TYPE,
            source_entity_id=project_id,
            subject=f"PROJECT MOBILISATION — {project_name}",
            start_at=start_at,
            end_at=start_at + timedelta(minutes=MOBILISATION_DURATION_MINUTES),
            location=None,
            owner_user_id=None,
            calendar_category="Projects",
            aegis_reference=f"PROJ-{str(project_id)[:8].upper()}",
            organisation_name=await _organisation_name(db, organization_id),
            extra_fields=extra_fields,
            deep_link=f"{settings.frontend_base_url}/dashboard/projects/{project_id}",
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001 - deliberately broad, see module docstring
        logger.warning("microsoft_graph.project_mobilisation_sync_failed", project_id=str(project_id), error=str(exc))


async def sync_milestone(
    db: AsyncSession, *, organization_id, project_id: UUID, milestone_id: UUID, milestone_name: str,
    status: str, project_name: str, milestone_date: Optional[date],
) -> None:
    """A milestone with no date, or marked cancelled, has its Microsoft
    event (if any) cancelled - there's nothing left to schedule. A milestone
    marked 'complete' keeps its event as-is (it's now a historical record of
    something that already happened, same reasoning as CRM's 'Completed')."""
    try:
        if milestone_date is None or status == "cancelled":
            await calendar_service.cancel_event(
                db, organization_id=organization_id, source_module="projects",
                source_entity_type=MILESTONE_ENTITY_TYPE, source_entity_id=milestone_id,
            )
            return

        start_at = _as_local_datetime(milestone_date, MILESTONE_DEFAULT_TIME)
        await calendar_service.upsert_event(
            db,
            organization_id=organization_id,
            source_module="projects",
            source_entity_type=MILESTONE_ENTITY_TYPE,
            source_entity_id=milestone_id,
            subject=f"PROJECT MILESTONE — {milestone_name} | {project_name}",
            start_at=start_at,
            end_at=start_at + timedelta(minutes=MILESTONE_DURATION_MINUTES),
            location=None,
            owner_user_id=None,
            calendar_category="Projects",
            aegis_reference=f"PROJ-{str(project_id)[:8].upper()}-MS-{str(milestone_id)[:8].upper()}",
            organisation_name=await _organisation_name(db, organization_id),
            extra_fields={"Project": project_name, "Milestone": milestone_name},
            deep_link=f"{settings.frontend_base_url}/dashboard/projects/{project_id}",
        )
    except MicrosoftIntegrationNotReady:
        pass
    except Exception as exc:  # noqa: BLE001
        logger.warning("microsoft_graph.project_milestone_sync_failed", milestone_id=str(milestone_id), error=str(exc))
