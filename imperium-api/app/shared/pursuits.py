"""Resolves or creates the crm.pursuits spine row for a Lead/Opportunity/
Tender chain, and updates its status.

crm_leads.py's /qualify endpoint creates a pursuit row the moment a Lead
becomes an Opportunity. Not every Opportunity or Tender originates that way
(an Opportunity can be created directly, a Tender can be logged without a
prior Lead), so the Award/Loss/Clarification task-pack triggers need a
find-or-create here rather than assuming a pursuit already exists.

Deliberately does NOT call db.commit() - callers thread this into their own
transaction (typically right before their own commit), matching how
generate_task_stack() is always called AFTER the caller's commit instead.
"""

from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def get_or_create_pursuit(
    db: AsyncSession,
    *,
    org_id: str,
    lead_id: Optional[str] = None,
    opportunity_id: Optional[str] = None,
    tender_id: Optional[str] = None,
    status: Optional[str] = None,
    created_by: Optional[str] = None,
) -> str:
    existing = (
        await db.execute(
            text("""
                SELECT id FROM crm.pursuits
                WHERE organization_id = :org_id AND is_deleted = false
                  AND (
                      (CAST(:opportunity_id AS uuid) IS NOT NULL AND opportunity_id = CAST(:opportunity_id AS uuid))
                      OR (CAST(:tender_id AS uuid) IS NOT NULL AND tender_id = CAST(:tender_id AS uuid))
                      OR (CAST(:lead_id AS uuid) IS NOT NULL AND lead_id = CAST(:lead_id AS uuid))
                  )
                ORDER BY created_at DESC
                LIMIT 1
            """),
            {"org_id": org_id, "opportunity_id": opportunity_id, "tender_id": tender_id, "lead_id": lead_id},
        )
    ).scalar()

    if existing:
        # Backfill whichever FK this call knows about that the existing row
        # doesn't yet (e.g. a Tender awarded against an Opportunity-only
        # pursuit), so the chain keeps completing itself rather than
        # spawning a second pursuit row for the same deal.
        await db.execute(
            text("""
                UPDATE crm.pursuits
                SET status = COALESCE(:status, status),
                    lead_id = COALESCE(lead_id, :lead_id),
                    opportunity_id = COALESCE(opportunity_id, :opportunity_id),
                    tender_id = COALESCE(tender_id, :tender_id),
                    updated_at = NOW()
                WHERE id = :id
            """),
            {
                "id": existing,
                "status": status,
                "lead_id": lead_id,
                "opportunity_id": opportunity_id,
                "tender_id": tender_id,
            },
        )
        return str(existing)

    inserted = (
        await db.execute(
            text("""
                INSERT INTO crm.pursuits (organization_id, lead_id, opportunity_id, tender_id, status, created_by)
                VALUES (:org_id, :lead_id, :opportunity_id, :tender_id, COALESCE(:status, 'pursuing'), :created_by)
                RETURNING id
            """),
            {
                "org_id": org_id,
                "lead_id": lead_id,
                "opportunity_id": opportunity_id,
                "tender_id": tender_id,
                "status": status,
                "created_by": created_by,
            },
        )
    ).scalar()
    return str(inserted)
