from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.database import get_db
from core.security import require_permission
from app.shared.events import emit_notification

router = APIRouter()

# entity_type -> (table, user assignee column, team assignee column, record
# display-name column, frontend route to deep-link a notification to).
# crm.leads keeps its pre-existing `assigned_to` column name rather than
# being renamed to assigned_to_user_id, to avoid touching every existing
# reader of that column.
_ASSIGNABLE_ENTITIES = {
    "lead": ("crm.leads", "assigned_to", "assigned_to_team_id", "company_name", "/dashboard/crm/leads"),
    "opportunity": ("crm.opportunities", "assigned_to_user_id", "assigned_to_team_id", "name", "/dashboard/crm/opportunities"),
    "tender": ("crm.tenders", "assigned_to_user_id", "assigned_to_team_id", "tender_name", "/dashboard/crm/tenders"),
    "project": ("projects.projects", "assigned_to_user_id", "assigned_to_team_id", "name", "/dashboard/projects"),
    "fleet": ("fleet.fleet", "assigned_to_user_id", "assigned_to_team_id", "vehicle_registration", "/dashboard/fleet"),
    "machinery": ("fleet.equipment_assets", "assigned_to_user_id", "assigned_to_team_id", "asset_name", "/dashboard/equipment"),
}


class AssignmentPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    entity_type: str = Field(min_length=1, max_length=40)
    entity_id: UUID
    assigned_to_user_id: Optional[UUID] = None
    assigned_to_team_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _mutually_exclusive(self):
        if self.assigned_to_user_id and self.assigned_to_team_id:
            raise ValueError("Assign to a person or a team, not both.")
        return self


def _entity_config(entity_type: str):
    config = _ASSIGNABLE_ENTITIES.get(entity_type.strip().lower())
    if not config:
        raise HTTPException(
            status_code=400,
            detail=f"entity_type must be one of: {', '.join(_ASSIGNABLE_ENTITIES)}.",
        )
    return config


@router.get("/")
async def get_assignment(
    entity_type: str = Query(...),
    entity_id: UUID = Query(...),
    user: dict = Depends(require_permission("assignments.manage")),
    db: AsyncSession = Depends(get_db),
):
    table, user_col, team_col, name_col, _ = _entity_config(entity_type)
    row = (
        await db.execute(
            text(f"""
                SELECT e.{user_col} AS assigned_to_user_id, e.{team_col} AS assigned_to_team_id,
                       u.full_name AS assigned_user_name, t.name AS assigned_team_name
                FROM {table} e
                LEFT JOIN core.users u ON u.id = e.{user_col}
                LEFT JOIN core.teams t ON t.id = e.{team_col}
                WHERE e.id = :id AND e.organization_id = :org_id AND e.is_deleted = false
            """),  # nosec B608 - table/user_col/team_col are selected from a fixed allowlist above, never user input
            {"id": entity_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{entity_type} not found.")
    return {"success": True, "data": dict(row), "message": "Assignment retrieved.", "meta": {}}


@router.post("/")
async def set_assignment(
    payload: AssignmentPayload,
    user: dict = Depends(require_permission("assignments.manage")),
    db: AsyncSession = Depends(get_db),
):
    table, user_col, team_col, name_col, route = _entity_config(payload.entity_type)
    org_id = user["org_id"]

    entity_row = (
        await db.execute(
            text(f"""
                SELECT id, {name_col} AS display_name FROM {table}
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),  # nosec B608 - table/name_col are selected from a fixed allowlist above, never user input
            {"id": payload.entity_id, "org_id": org_id},
        )
    ).mappings().first()
    if not entity_row:
        raise HTTPException(status_code=404, detail=f"{payload.entity_type} not found.")

    if payload.assigned_to_user_id:
        target_check = await db.execute(
            text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.assigned_to_user_id, "org_id": org_id},
        )
        if not target_check.first():
            raise HTTPException(status_code=404, detail="Assignee not found.")

    if payload.assigned_to_team_id:
        team_check = await db.execute(
            text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.assigned_to_team_id, "org_id": org_id},
        )
        if not team_check.first():
            raise HTTPException(status_code=404, detail="Team not found.")

    await db.execute(
        text(f"""
            UPDATE {table}
            SET {user_col} = :assigned_to_user_id, {team_col} = :assigned_to_team_id, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),  # nosec B608 - table/user_col/team_col are selected from a fixed allowlist above, never user input
        {
            "assigned_to_user_id": payload.assigned_to_user_id,
            "assigned_to_team_id": payload.assigned_to_team_id,
            "id": payload.entity_id,
            "org_id": org_id,
        },
    )

    recipients: list[str] = []
    if payload.assigned_to_user_id:
        recipients = [str(payload.assigned_to_user_id)]
    elif payload.assigned_to_team_id:
        member_rows = await db.execute(
            text("SELECT user_id FROM core.team_members WHERE team_id = :team_id"),
            {"team_id": payload.assigned_to_team_id},
        )
        recipients = [str(row.user_id) for row in member_rows]

    display_name = entity_row["display_name"] or payload.entity_type.title()
    for recipient_id in recipients:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=recipient_id,
            title=f"You've been assigned a {payload.entity_type}",
            message=f'"{display_name}" was assigned to you.',
            notification_type="assignment",
            action_url=route,
        )

    await db.commit()
    return {"success": True, "data": {"id": str(payload.entity_id)}, "message": "Assignment updated.", "meta": {}}
