from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission, user_has_permission

router = APIRouter()


class TeamCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=160)


class TeamMemberAdd(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    user_id: UUID


@router.get("/")
async def list_teams(
    user: dict = Depends(require_permission("teams.read")),
    db: AsyncSession = Depends(get_db),
):
    # Baseline teams.read only sees teams the caller belongs to -
    # teams.read_all (the same admin/lead tier that already held teams.read
    # before this scoping existed) still sees every team org-wide.
    scope_clause = ""
    params: dict = {"org_id": user["org_id"]}
    if not await user_has_permission(db, user, "teams.read_all"):
        scope_clause = """
            AND EXISTS (
                SELECT 1 FROM core.team_members mine
                WHERE mine.team_id = t.id AND mine.user_id = :caller_id
            )
        """
        params["caller_id"] = user["user_id"]

    result = await db.execute(
        text(f"""
            SELECT t.id, t.name, t.created_at, COUNT(tm.user_id) AS member_count
            FROM core.teams t
            LEFT JOIN core.team_members tm ON tm.team_id = t.id
            WHERE t.organization_id = :org_id AND t.is_deleted = false
            {scope_clause}
            GROUP BY t.id, t.name, t.created_at
            ORDER BY t.name
        """),  # nosec B608 - scope_clause is a fixed literal, never user input
        params,
    )
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Teams listed.", "meta": {"total": len(items)}}


@router.post("/")
async def create_team(
    payload: TeamCreate,
    user: dict = Depends(require_permission("teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        team_id = (
            await db.execute(
                text("""
                    INSERT INTO core.teams (organization_id, name, created_by)
                    VALUES (:org_id, :name, :user_id)
                    RETURNING id
                """),
                {"org_id": user["org_id"], "name": payload.name, "user_id": user["user_id"]},
            )
        ).scalar()
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail="A team with this name already exists.") from e
    return {"success": True, "data": {"id": str(team_id)}, "message": "Team created.", "meta": {}}


@router.delete("/{team_id}")
async def delete_team(
    team_id: UUID,
    user: dict = Depends(require_permission("teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE core.teams SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
            RETURNING id
        """),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Team not found.")
    await db.commit()
    return {"success": True, "data": {"id": str(team_id)}, "message": "Team deleted.", "meta": {}}


@router.get("/{team_id}/members")
async def list_team_members(
    team_id: UUID,
    user: dict = Depends(require_permission("teams.read")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Team not found.")

    if not await user_has_permission(db, user, "teams.read_all"):
        membership_check = await db.execute(
            text("""
                SELECT 1 FROM core.team_members
                WHERE team_id = :team_id AND user_id = :user_id
            """),
            {"team_id": team_id, "user_id": user["user_id"]},
        )
        if not membership_check.first():
            raise HTTPException(status_code=403, detail="You can only view members of teams you belong to.")

    result = await db.execute(
        text("""
            SELECT u.id, u.full_name, u.email, tm.is_lead
            FROM core.team_members tm
            JOIN core.users u ON u.id = tm.user_id AND u.is_deleted = false
            WHERE tm.team_id = :team_id
            ORDER BY tm.is_lead DESC, u.full_name
        """),
        {"team_id": team_id},
    )
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Team members listed.", "meta": {"total": len(items)}}


@router.post("/{team_id}/members")
async def add_team_member(
    team_id: UUID,
    payload: TeamMemberAdd,
    user: dict = Depends(require_permission("teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Team not found.")

    user_check = await db.execute(
        text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.user_id, "org_id": user["org_id"]},
    )
    if not user_check.first():
        raise HTTPException(status_code=404, detail="User not found.")

    await db.execute(
        text("""
            INSERT INTO core.team_members (team_id, user_id) VALUES (:team_id, :user_id)
            ON CONFLICT (team_id, user_id) DO NOTHING
        """),
        {"team_id": team_id, "user_id": payload.user_id},
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Member added.", "meta": {}}


@router.delete("/{team_id}/members/{member_user_id}")
async def remove_team_member(
    team_id: UUID,
    member_user_id: UUID,
    user: dict = Depends(require_permission("teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Team not found.")

    await db.execute(
        text("DELETE FROM core.team_members WHERE team_id = :team_id AND user_id = :user_id"),
        {"team_id": team_id, "user_id": member_user_id},
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Member removed.", "meta": {}}


class TeamLeadPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    is_lead: bool


@router.patch("/{team_id}/members/{member_user_id}")
async def set_team_member_lead(
    team_id: UUID,
    member_user_id: UUID,
    payload: TeamLeadPayload,
    user: dict = Depends(require_permission("teams.manage")),
    db: AsyncSession = Depends(get_db),
):
    team_check = await db.execute(
        text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": team_id, "org_id": user["org_id"]},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Team not found.")

    result = await db.execute(
        text("""
            UPDATE core.team_members SET is_lead = :is_lead
            WHERE team_id = :team_id AND user_id = :user_id
            RETURNING team_id
        """),
        {"is_lead": payload.is_lead, "team_id": team_id, "user_id": member_user_id},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Member not found on this team.")
    await db.commit()
    return {"success": True, "data": None, "message": "Team lead updated.", "meta": {}}
