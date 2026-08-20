from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission

router = APIRouter()


class PursuitTeamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    pursuit_id: UUID
    name: str = Field(min_length=1, max_length=160)
    objective: Optional[str] = None
    team_lead_user_id: Optional[UUID] = None


class PursuitTeamUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=160)
    objective: Optional[str] = None
    team_lead_user_id: Optional[UUID] = None
    status: Optional[str] = Field(default=None, pattern="^(active|closed)$")
    result: Optional[str] = None


class PursuitTeamMemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    user_id: UUID
    department_id: Optional[UUID] = None
    role_label: Optional[str] = Field(default=None, max_length=80)


@router.get("/")
async def list_pursuit_teams(
    pursuit_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("pursuit_teams.read")),
    db: AsyncSession = Depends(get_db),
):
    params: dict = {"org_id": user["org_id"]}
    pursuit_clause = ""
    if pursuit_id:
        pursuit_clause = "AND pt.pursuit_id = :pursuit_id"
        params["pursuit_id"] = pursuit_id

    result = await db.execute(
        text(f"""
            SELECT pt.id, pt.pursuit_id, pt.name, pt.objective, pt.team_lead_user_id,
                   pt.status, pt.started_at, pt.closed_at, pt.result,
                   u.full_name AS team_lead_name,
                   COUNT(ptm.user_id) AS member_count
            FROM crm.pursuit_teams pt
            LEFT JOIN core.users u ON u.id = pt.team_lead_user_id
            LEFT JOIN crm.pursuit_team_members ptm ON ptm.pursuit_team_id = pt.id AND ptm.removed_at IS NULL
            WHERE pt.organization_id = :org_id AND pt.is_deleted = false
            {pursuit_clause}
            GROUP BY pt.id, u.full_name
            ORDER BY pt.started_at DESC
        """),  # nosec B608 - pursuit_clause is a fixed literal, never user input
        params,
    )
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Pursuit teams listed.", "meta": {"total": len(items)}}


@router.post("/")
async def create_pursuit_team(
    payload: PursuitTeamCreate,
    user: dict = Depends(require_permission("pursuit_teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    pursuit_check = await db.execute(
        text("SELECT 1 FROM crm.pursuits WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.pursuit_id, "org_id": user["org_id"]},
    )
    if not pursuit_check.first():
        raise HTTPException(status_code=404, detail="Pursuit not found.")

    try:
        team_id = (
            await db.execute(
                text("""
                    INSERT INTO crm.pursuit_teams (organization_id, pursuit_id, name, objective, team_lead_user_id, created_by)
                    VALUES (:org_id, :pursuit_id, :name, :objective, :team_lead_user_id, :user_id)
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "pursuit_id": payload.pursuit_id,
                    "name": payload.name,
                    "objective": payload.objective,
                    "team_lead_user_id": payload.team_lead_user_id,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        # A pursuit team going up becomes the pursuit's current team - keeps
        # crm.pursuits.pursuit_team_id resolvable in one join (pursuits.py's
        # list endpoint) without a reverse lookup on the active-team index.
        await db.execute(
            text("UPDATE crm.pursuits SET pursuit_team_id = :team_id, updated_at = NOW() WHERE id = :pursuit_id"),
            {"team_id": team_id, "pursuit_id": payload.pursuit_id},
        )
        await db.commit()
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="Could not create pursuit team - the pursuit may already have an active team.") from e
    return {"success": True, "data": {"id": str(team_id)}, "message": "Pursuit team formed.", "meta": {}}


@router.patch("/{team_id}")
async def update_pursuit_team(
    team_id: UUID,
    payload: PursuitTeamUpdate,
    user: dict = Depends(require_permission("pursuit_teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update.")

    # Closing a team stamps closed_at automatically, same idiom crm_tasks.py
    # uses for completed_at alongside a status flip.
    set_parts = [f"{k} = :{k}" for k in updates]
    if updates.get("status") == "closed":
        set_parts.append("closed_at = NOW()")

    params = {**updates, "id": team_id, "org_id": user["org_id"]}
    result = await db.execute(
        text(f"""
            UPDATE crm.pursuit_teams SET {", ".join(set_parts)}, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            RETURNING id
        """),  # nosec B608 - set_parts keys come from a fixed Pydantic model, never raw user input
        params,
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Pursuit team not found.")
    await db.commit()
    return {"success": True, "data": {"id": str(team_id)}, "message": "Pursuit team updated.", "meta": {}}


@router.get("/{team_id}/members")
async def list_pursuit_team_members(
    team_id: UUID,
    user: dict = Depends(require_permission("pursuit_teams.read")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM crm.pursuit_teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Pursuit team not found.")

    result = await db.execute(
        text("""
            SELECT u.id, u.full_name, u.email, ptm.department_id, d.name AS department_name, ptm.role_label, ptm.added_at
            FROM crm.pursuit_team_members ptm
            JOIN core.users u ON u.id = ptm.user_id AND u.is_deleted = false
            LEFT JOIN finance.departments d ON d.id = ptm.department_id
            WHERE ptm.pursuit_team_id = :team_id AND ptm.removed_at IS NULL
            ORDER BY u.full_name
        """),
        {"team_id": team_id},
    )
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Pursuit team members listed.", "meta": {"total": len(items)}}


@router.post("/{team_id}/members")
async def add_pursuit_team_member(
    team_id: UUID,
    payload: PursuitTeamMemberAdd,
    user: dict = Depends(require_permission("pursuit_teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM crm.pursuit_teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Pursuit team not found.")

    user_check = await db.execute(
        text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.user_id, "org_id": user["org_id"]},
    )
    if not user_check.first():
        raise HTTPException(status_code=404, detail="User not found.")

    await db.execute(
        text("""
            INSERT INTO crm.pursuit_team_members (pursuit_team_id, user_id, department_id, role_label)
            VALUES (:team_id, :user_id, :department_id, :role_label)
            ON CONFLICT (pursuit_team_id, user_id)
            DO UPDATE SET department_id = EXCLUDED.department_id, role_label = EXCLUDED.role_label, removed_at = NULL
        """),
        {
            "team_id": team_id,
            "user_id": payload.user_id,
            "department_id": payload.department_id,
            "role_label": payload.role_label,
        },
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Member added.", "meta": {}}


@router.delete("/{team_id}/members/{member_user_id}")
async def remove_pursuit_team_member(
    team_id: UUID,
    member_user_id: UUID,
    user: dict = Depends(require_permission("pursuit_teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM crm.pursuit_teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Pursuit team not found.")

    # Soft-remove (removed_at) rather than DELETE - keeps the roster as a
    # historical record of who actually worked this pursuit, matching the
    # spec's "communication record" / institutional-learning intent.
    await db.execute(
        text("""
            UPDATE crm.pursuit_team_members SET removed_at = NOW()
            WHERE pursuit_team_id = :team_id AND user_id = :user_id
        """),
        {"team_id": team_id, "user_id": member_user_id},
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Member removed.", "meta": {}}
