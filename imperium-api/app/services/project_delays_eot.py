"""
Contractual Delay Events & Extension of Time (EOT) Service
Enforces FIDIC / NEC / JBCC commercial delay protocols:
1. Notice Time-Barring: Validates whether notice was served within the mandatory window (e.g. 28 days).
2. Critical Path Verification: Validates delay impact against CPM schedule critical path milestones.
3. EOT Determination: Tracks Engineer determinations, approved days, prolongation costs, and revised completion dates.
"""
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional, Dict, Any, List
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException


async def list_project_delays(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> List[Dict[str, Any]]:
    """Returns all contractual delay events with time-bar status."""
    rows = (
        await db.execute(
            text("""
                SELECT 
                    d.id,
                    d.event_number,
                    d.title,
                    d.cause_category,
                    d.contract_clause_reference,
                    d.event_occurred_date,
                    d.event_ended_date,
                    d.notice_required_days,
                    d.notice_served_date,
                    d.notice_status,
                    d.estimated_days_impact,
                    d.mitigation_actions,
                    d.description,
                    d.created_at,
                    u.full_name AS created_by_name,
                    (SELECT COUNT(*) FROM projects.extension_of_time_claims c 
                     WHERE c.delay_event_id = d.id AND c.is_deleted = false) AS eot_claims_count
                FROM projects.contractual_delay_events d
                LEFT JOIN core.users u ON u.id = d.created_by
                WHERE d.project_id = CAST(:project_id AS uuid)
                  AND d.organization_id = CAST(:org_id AS uuid)
                  AND d.is_deleted = false
                ORDER BY d.event_occurred_date DESC
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    today = date.today()
    results = []
    for r in rows:
        item = dict(r)
        occurred = item["event_occurred_date"]
        notice_days = item["notice_required_days"] or 28
        deadline = occurred + timedelta(days=notice_days)
        served = item["notice_served_date"]

        days_remaining_to_notice = (deadline - today).days
        is_past_deadline = today > deadline
        is_time_barred = (
            item["notice_status"] == "time_barred" or 
            (served is None and is_past_deadline) or
            (served is not None and served > deadline)
        )

        item["id"] = str(item["id"])
        item["event_occurred_date"] = occurred.isoformat() if occurred else None
        item["event_ended_date"] = item["event_ended_date"].isoformat() if item["event_ended_date"] else None
        item["notice_served_date"] = served.isoformat() if served else None
        item["notice_deadline"] = deadline.isoformat()
        item["days_remaining_to_notice"] = days_remaining_to_notice
        item["is_time_barred"] = is_time_barred
        item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
        results.append(item)

    return results


async def create_project_delay(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Creates a new contractual delay event."""
    occurred = payload.get("event_occurred_date")
    if isinstance(occurred, str):
        occurred = date.fromisoformat(occurred)
    elif not occurred:
        occurred = date.today()

    served = payload.get("notice_served_date")
    if isinstance(served, str):
        served = date.fromisoformat(served)

    ended = payload.get("event_ended_date")
    if isinstance(ended, str):
        ended = date.fromisoformat(ended)

    notice_days = int(payload.get("notice_required_days") or 28)
    deadline = occurred + timedelta(days=notice_days)

    # Determine initial notice status
    notice_status = payload.get("notice_status") or "draft"
    if served:
        if served > deadline:
            notice_status = "time_barred"
        else:
            notice_status = "served_within_time"

    row = (
        await db.execute(
            text("""
                INSERT INTO projects.contractual_delay_events (
                    organization_id,
                    project_id,
                    event_number,
                    title,
                    cause_category,
                    contract_clause_reference,
                    event_occurred_date,
                    event_ended_date,
                    notice_required_days,
                    notice_served_date,
                    notice_status,
                    estimated_days_impact,
                    mitigation_actions,
                    description,
                    created_by
                ) VALUES (
                    CAST(:org_id AS uuid),
                    CAST(:project_id AS uuid),
                    :event_number,
                    :title,
                    :cause_category,
                    :contract_clause_reference,
                    :event_occurred_date,
                    :event_ended_date,
                    :notice_required_days,
                    :notice_served_date,
                    :notice_status,
                    :estimated_days_impact,
                    :mitigation_actions,
                    :description,
                    CAST(:user_id AS uuid)
                )
                RETURNING id
            """),
            {
                "org_id": str(org_id),
                "project_id": str(project_id),
                "event_number": payload.get("event_number"),
                "title": payload.get("title"),
                "cause_category": payload.get("cause_category"),
                "contract_clause_reference": payload.get("contract_clause_reference"),
                "event_occurred_date": occurred,
                "event_ended_date": ended,
                "notice_required_days": notice_days,
                "notice_served_date": served,
                "notice_status": notice_status,
                "estimated_days_impact": int(payload.get("estimated_days_impact") or 0),
                "mitigation_actions": payload.get("mitigation_actions"),
                "description": payload.get("description"),
                "user_id": str(user_id),
            },
        )
    ).first()

    await db.commit()
    return {"id": str(row[0]), "notice_status": notice_status, "notice_deadline": deadline.isoformat()}


async def list_project_eot_claims(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
) -> List[Dict[str, Any]]:
    """Returns all Extension of Time claims with milestone and prolongation details."""
    rows = (
        await db.execute(
            text("""
                SELECT 
                    c.id,
                    c.claim_reference,
                    c.title,
                    c.delay_event_id,
                    d.event_number AS delay_event_number,
                    d.cause_category AS delay_cause_category,
                    c.days_requested,
                    c.impacted_milestone_id,
                    m.name AS impacted_milestone_name,
                    COALESCE(m.is_critical, false) AS milestone_is_critical,
                    c.is_critical_path_impact,
                    c.prolongation_cost_claimed,
                    c.submission_date,
                    c.status,
                    c.days_granted,
                    c.prolongation_cost_approved,
                    c.determination_date,
                    c.determination_notes,
                    c.engineer_representative_name,
                    c.revised_contractual_completion_date,
                    c.created_at,
                    u.full_name AS created_by_name
                FROM projects.extension_of_time_claims c
                LEFT JOIN projects.contractual_delay_events d ON d.id = c.delay_event_id
                LEFT JOIN projects.project_milestones m ON m.id = c.impacted_milestone_id
                LEFT JOIN core.users u ON u.id = c.created_by
                WHERE c.project_id = CAST(:project_id AS uuid)
                  AND c.organization_id = CAST(:org_id AS uuid)
                  AND c.is_deleted = false
                ORDER BY c.submission_date DESC, c.created_at DESC
            """),
            {"project_id": str(project_id), "org_id": str(org_id)},
        )
    ).mappings().all()

    results = []
    for r in rows:
        item = dict(r)
        item["id"] = str(item["id"])
        item["delay_event_id"] = str(item["delay_event_id"]) if item["delay_event_id"] else None
        item["impacted_milestone_id"] = str(item["impacted_milestone_id"]) if item["impacted_milestone_id"] else None
        item["submission_date"] = item["submission_date"].isoformat() if item["submission_date"] else None
        item["determination_date"] = item["determination_date"].isoformat() if item["determination_date"] else None
        item["revised_contractual_completion_date"] = (
            item["revised_contractual_completion_date"].isoformat()
            if item["revised_contractual_completion_date"]
            else None
        )
        item["prolongation_cost_claimed"] = float(item["prolongation_cost_claimed"] or 0)
        item["prolongation_cost_approved"] = float(item["prolongation_cost_approved"] or 0)
        item["created_at"] = item["created_at"].isoformat() if item["created_at"] else None
        results.append(item)

    return results


async def create_project_eot_claim(
    db: AsyncSession,
    project_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Creates a formal EOT claim and verifies critical path impact against CPM milestone."""
    sub_date = payload.get("submission_date")
    if isinstance(sub_date, str):
        sub_date = date.fromisoformat(sub_date)
    elif not sub_date:
        sub_date = date.today()

    milestone_id = payload.get("impacted_milestone_id")
    is_critical = bool(payload.get("is_critical_path_impact", True))

    # If milestone provided, check if milestone is critical on CPM schedule
    if milestone_id:
        m_row = (
            await db.execute(
                text("""
                    SELECT is_critical FROM projects.project_milestones
                    WHERE id = CAST(:m_id AS uuid) AND project_id = CAST(:p_id AS uuid)
                """),
                {"m_id": str(milestone_id), "p_id": str(project_id)},
            )
        ).first()
        if m_row and m_row[0] is not None:
            is_critical = bool(m_row[0])

    delay_id = payload.get("delay_event_id")

    row = (
        await db.execute(
            text("""
                INSERT INTO projects.extension_of_time_claims (
                    organization_id,
                    project_id,
                    delay_event_id,
                    claim_reference,
                    title,
                    days_requested,
                    impacted_milestone_id,
                    is_critical_path_impact,
                    prolongation_cost_claimed,
                    submission_date,
                    status,
                    created_by
                ) VALUES (
                    CAST(:org_id AS uuid),
                    CAST(:project_id AS uuid),
                    CAST(:delay_id AS uuid),
                    :claim_reference,
                    :title,
                    :days_requested,
                    CAST(:milestone_id AS uuid),
                    :is_critical,
                    :prolongation_cost_claimed,
                    :submission_date,
                    'submitted',
                    CAST(:user_id AS uuid)
                )
                RETURNING id
            """),
            {
                "org_id": str(org_id),
                "project_id": str(project_id),
                "delay_id": str(delay_id) if delay_id else None,
                "claim_reference": payload.get("claim_reference"),
                "title": payload.get("title"),
                "days_requested": int(payload.get("days_requested")),
                "milestone_id": str(milestone_id) if milestone_id else None,
                "is_critical": is_critical,
                "prolongation_cost_claimed": Decimal(str(payload.get("prolongation_cost_claimed") or "0")),
                "submission_date": sub_date,
                "user_id": str(user_id),
            },
        )
    ).first()

    await db.commit()
    return {"id": str(row[0]), "is_critical_path_impact": is_critical}


async def determine_project_eot_claim(
    db: AsyncSession,
    project_id: UUID,
    claim_id: UUID,
    org_id: UUID,
    user_id: UUID,
    payload: Dict[str, Any],
) -> Dict[str, Any]:
    """Records the Engineer / Client determination on an EOT claim."""
    claim = (
        await db.execute(
            text("""
                SELECT id, days_requested, impacted_milestone_id
                FROM projects.extension_of_time_claims
                WHERE id = CAST(:c_id AS uuid)
                  AND project_id = CAST(:p_id AS uuid)
                  AND organization_id = CAST(:org_id AS uuid)
                  AND is_deleted = false
            """),
            {"c_id": str(claim_id), "p_id": str(project_id), "org_id": str(org_id)},
        )
    ).first()

    if not claim:
        raise HTTPException(status_code=404, detail="EOT claim not found.")

    days_granted = int(payload.get("days_granted") or 0)
    prolongation_approved = Decimal(str(payload.get("prolongation_cost_approved") or "0"))
    determination_date = payload.get("determination_date") or date.today()
    if isinstance(determination_date, str):
        determination_date = date.fromisoformat(determination_date)

    verdict = payload.get("status") or ("determined" if days_granted > 0 else "rejected")
    revised_date = payload.get("revised_contractual_completion_date")
    if isinstance(revised_date, str):
        revised_date = date.fromisoformat(revised_date)

    await db.execute(
        text("""
            UPDATE projects.extension_of_time_claims SET
                status = :status,
                days_granted = :days_granted,
                prolongation_cost_approved = :prolongation_cost_approved,
                determination_date = :determination_date,
                determination_notes = :determination_notes,
                engineer_representative_name = :engineer_representative_name,
                revised_contractual_completion_date = :revised_contractual_completion_date,
                updated_at = NOW()
            WHERE id = CAST(:c_id AS uuid)
        """),
        {
            "c_id": str(claim_id),
            "status": verdict,
            "days_granted": days_granted,
            "prolongation_cost_approved": prolongation_approved,
            "determination_date": determination_date,
            "determination_notes": payload.get("determination_notes"),
            "engineer_representative_name": payload.get("engineer_representative_name"),
            "revised_contractual_completion_date": revised_date,
        },
    )

    # If days granted > 0 and milestone was linked, extend the milestone forecast/target date
    milestone_id = claim[2]
    if days_granted > 0 and milestone_id:
        await db.execute(
            text("""
                UPDATE projects.project_milestones SET
                    target_date = target_date + CAST(:days AS integer),
                    updated_at = NOW()
                WHERE id = CAST(:m_id AS uuid)
            """),
            {"days": days_granted, "m_id": str(milestone_id)},
        )

    await db.commit()
    return {
        "id": str(claim_id),
        "status": verdict,
        "days_granted": days_granted,
        "prolongation_cost_approved": float(prolongation_approved),
    }
