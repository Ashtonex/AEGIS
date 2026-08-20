from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.task_stacks import generate_task_stack

router = APIRouter()

PURSUIT_STATUSES = (
    "draft", "active", "under_qualification", "bid_decision_required",
    "pursuing", "tender_preparation", "awaiting_approval", "submitted",
    "clarification", "negotiation", "won", "lost", "withdrawn", "closed",
)


@router.get("/")
async def list_pursuits(
    status: Optional[str] = None,
    user: dict = Depends(require_permission("pursuits.read")),
    db: AsyncSession = Depends(get_db),
):
    """
    Lists pursuits with the Lead/Opportunity/Tender names and the currently
    active pursuit team resolved inline, so the pursuit-team formation page
    and a future pursuit timeline view don't need N+1 lookups.
    """
    params: dict = {"org_id": user["org_id"]}
    status_clause = ""
    if status:
        if status not in PURSUIT_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(PURSUIT_STATUSES)}")
        status_clause = "AND p.status = :status"
        params["status"] = status

    result = await db.execute(
        text(f"""
            SELECT
                p.id, p.status, p.risk_status, p.outcome, p.next_action,
                p.lead_id, p.opportunity_id, p.tender_id, p.pursuit_team_id,
                p.created_at, p.updated_at,
                l.company_name AS lead_company_name,
                o.name AS opportunity_name,
                t.tender_name AS tender_reference,
                pt.name AS pursuit_team_name,
                pt.team_lead_user_id AS pursuit_team_lead_user_id
            FROM crm.pursuits p
            LEFT JOIN crm.leads l ON l.id = p.lead_id
            LEFT JOIN crm.opportunities o ON o.id = p.opportunity_id
            LEFT JOIN crm.tenders t ON t.id = p.tender_id
            LEFT JOIN crm.pursuit_teams pt ON pt.id = p.pursuit_team_id AND pt.is_deleted = false
            WHERE p.organization_id = :org_id AND p.is_deleted = false
            {status_clause}
            ORDER BY p.created_at DESC
        """),  # nosec B608 - status_clause is a fixed literal, never user input
        params,
    )
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Pursuits listed.", "meta": {"total": len(items)}}


@router.get("/{pursuit_id}")
async def get_pursuit(
    pursuit_id: UUID,
    user: dict = Depends(require_permission("pursuits.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT
                p.id, p.status, p.risk_status, p.outcome, p.next_action,
                p.lead_id, p.opportunity_id, p.tender_id, p.pursuit_team_id,
                p.created_at, p.updated_at
            FROM crm.pursuits p
            WHERE p.id = :id AND p.organization_id = :org_id AND p.is_deleted = false
        """),
        {"id": pursuit_id, "org_id": user["org_id"]},
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Pursuit not found.")
    return {"success": True, "data": dict(row._mapping), "message": "Pursuit fetched.", "meta": {}}


class PursuitUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    status: Optional[str] = None
    risk_status: Optional[str] = Field(default=None, pattern="^(low|medium|high|critical)$")
    outcome: Optional[str] = None
    next_action: Optional[str] = None


@router.patch("/{pursuit_id}")
async def update_pursuit(
    pursuit_id: UUID,
    payload: PursuitUpdate,
    user: dict = Depends(require_permission("pursuits.update")),
    db: AsyncSession = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    if "status" in updates and updates["status"] not in PURSUIT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(PURSUIT_STATUSES)}")
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    org_id = user["org_id"]
    current = (
        await db.execute(
            text("SELECT status FROM crm.pursuits WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": pursuit_id, "org_id": org_id},
        )
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Pursuit not found.")

    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    params = {**updates, "id": pursuit_id, "org_id": org_id}
    await db.execute(
        text(f"""
            UPDATE crm.pursuits SET {set_clause}, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),  # nosec B608 - set_clause keys come from a fixed Pydantic model, never raw user input
        params,
    )
    await db.commit()

    # Clarification and Negotiation Team task pack: fires the moment a
    # pursuit enters 'clarification', same generate_task_stack() mechanism
    # every other entity_type already uses - not a new generation path.
    if updates.get("status") == "clarification" and current["status"] != "clarification":
        await generate_task_stack(db, org_id=org_id, entity_type="clarification", entity_id=pursuit_id, created_by=user["user_id"])

    return {"success": True, "data": {"id": str(pursuit_id)}, "message": "Pursuit updated.", "meta": {}}
