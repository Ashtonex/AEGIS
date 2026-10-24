"""What has to happen every time an opportunity or tender changes stage.

Two rules, enforced server-side so no client can skip them:

1. Whoever moves the record writes an activity-log note saying why. The note
   is stored in crm.activities against the record (opportunity_id or, since
   migration 244, tender_id) so the pipeline history reads as a story, not a
   list of bare stage flips.

2. When the move brings in a new task pack (or ends the record), the open
   tasks from the stage being left are marked COMPLETED - not superseded -
   with the mover's note as their outcome. The move itself is the evidence
   that stage's work is done. Moves into a stage with no pack of its own
   (e.g. tender Identified -> Bid Prep) leave the work in flight, exactly as
   should_supersede_on_stage_change() decides.
"""

from typing import Optional

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification
from app.shared.task_gates import complete_stage_pack
from core.logging import logger

STAGE_NOTE_MIN_LENGTH = 10
STAGE_NOTE_MAX_LENGTH = 4000

_ACTIVITY_LINK_COLUMN = {"opportunity": "opportunity_id", "tender": "tender_id"}


def require_stage_note(note: Optional[str]) -> str:
    cleaned = " ".join((note or "").split())
    if len(cleaned) < STAGE_NOTE_MIN_LENGTH:
        raise HTTPException(
            status_code=422,
            detail=(
                "Moving to a new stage needs an activity log note: what happened and why it is moving "
                f"(at least {STAGE_NOTE_MIN_LENGTH} characters)."
            ),
        )
    return cleaned[:STAGE_NOTE_MAX_LENGTH]


async def complete_open_stage_tasks(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: str,
    from_stage: Optional[str],
    to_stage: str,
    note: str,
    user_id: Optional[str],
) -> int:
    """Marks the record's open tasks completed. Tasks wired to a project gate
    (contribution_target_id) are left for the gate to settle - completing them
    here would tick a pre-mobilisation check nobody actually performed."""
    result = await db.execute(
        text("""
            UPDATE crm.tasks t
            SET status = 'completed',
                completed_at = NOW(),
                outcome = COALESCE(NULLIF(t.outcome, ''), :outcome),
                evidence_ref = COALESCE(t.evidence_ref, :evidence),
                evidence_status = CASE WHEN t.evidence_required THEN 'accepted' ELSE t.evidence_status END,
                review_status = CASE WHEN t.review_status IN ('not_required', 'accepted') THEN t.review_status ELSE 'accepted' END,
                verified_by_user_id = COALESCE(t.verified_by_user_id, CAST(:user_id AS uuid)),
                verified_at = COALESCE(t.verified_at, NOW()),
                contribution_percent = t.weight,
                updated_at = NOW()
            WHERE t.organization_id = :org_id
              AND t.entity_type = :entity_type
              AND t.entity_id = CAST(:entity_id AS uuid)
              AND t.is_deleted = false
              AND t.contribution_target_id IS NULL
              AND t.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable', 'rejected')
            RETURNING t.id
        """),
        {
            "org_id": org_id,
            "entity_type": entity_type,
            "entity_id": str(entity_id),
            "user_id": user_id,
            "outcome": f"Completed on stage move {from_stage or '-'} -> {to_stage}: {note}",
            "evidence": f"Stage move {from_stage or '-'} -> {to_stage}",
        },
    )
    return len(result.fetchall())


async def log_stage_move(
    db: AsyncSession,
    *,
    org_id: str,
    entity_type: str,
    entity_id: str,
    from_stage: Optional[str],
    to_stage: str,
    note: str,
    user_id: Optional[str],
    tasks_completed: int = 0,
) -> None:
    column = _ACTIVITY_LINK_COLUMN.get(entity_type)
    if not column:
        raise ValueError(f"No activity log link for entity_type {entity_type!r}")
    description = note
    if tasks_completed:
        description += f"\n\n{tasks_completed} open task(s) from the {from_stage or 'previous'} stage marked complete."
    await db.execute(
        text(f"""
            INSERT INTO crm.activities (
                organization_id, created_by, owner_user_id, {column},
                type, subject, description, activity_date, status, priority
            ) VALUES (
                :org_id, CAST(:user_id AS uuid), CAST(:user_id AS uuid), CAST(:entity_id AS uuid),
                'Stage Change', :subject, :description, NOW(), 'Completed', 'normal'
            )
        """),  # nosec B608 - column comes from the fixed _ACTIVITY_LINK_COLUMN map
        {
            "org_id": org_id,
            "user_id": user_id,
            "entity_id": str(entity_id),
            "subject": f"Stage moved: {from_stage or '-'} -> {to_stage}"[:255],
            "description": description,
        },
    )


async def close_quote_preparation(
    db: AsyncSession,
    *,
    org_id: str,
    opportunity_id: str,
    evidence_ref: str,
    user_id: Optional[str],
    notify_user_id: Optional[str] = None,
    notify_message: str = "",
) -> int:
    """After a client quotation is recorded: completes the quote-preparation
    work it evidences (the Quotation pack and the opportunity's generic
    Rate Buildup / Quotation Preparation pack) and tells the deal owner.
    Best-effort - the quotation itself is already committed, so a failure
    here is logged rather than surfaced. Returns tasks completed."""
    try:
        closed = 0
        for pack_stage in ("Quotation", "opportunity"):
            closed += await complete_stage_pack(
                db, org_id=org_id, entity_type="opportunity", entity_id=opportunity_id,
                stage=pack_stage, evidence_ref=evidence_ref, user_id=user_id,
            )
        if notify_user_id:
            await emit_notification(
                db, org_id=org_id, user_id=notify_user_id,
                title="Quotation sent to client", message=notify_message,
                notification_type="crm", action_url="/dashboard/crm/opportunities",
            )
        await db.commit()
        return closed
    except Exception:
        await db.rollback()
        logger.exception("crm.client_quotation_followups_failed", opportunity_id=opportunity_id)
        return 0
