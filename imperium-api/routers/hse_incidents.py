from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.pagination import ok
from app.shared.events import emit_notification, emit_role_notification

router = APIRouter()

"""
Module: hse_incidents
Description: HSE incident register with a status lifecycle (open ->
investigating -> resolved) so unresolved incidents can be tracked and
escalated.
"""


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class HseIncidentCreate(Payload):
    incident_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    severity: Literal["low", "medium", "high", "critical"]
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=255)
    project_id: Optional[UUID] = None


class HseIncidentUpdate(Payload):
    status: Optional[Literal["open", "investigating", "resolved"]] = None
    severity: Optional[Literal["low", "medium", "high", "critical"]] = None
    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    location: Optional[str] = Field(default=None, max_length=255)


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hse_incidents.read")),
):
    query = text("""
        SELECT *
        FROM projects.hse_incidents
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]
    return ok(items, "hse_incidents listed.")


@router.post("/")
async def create_item(
    payload: HseIncidentCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hse_incidents.create")),
):
    try:
        new_id = (
            await db.execute(
                text("""
                    INSERT INTO projects.hse_incidents (
                        organization_id, created_by, incident_date, severity,
                        title, description, location, project_id, reported_by, status
                    ) VALUES (
                        :org_id, :user_id, CAST(:incident_date AS date), :severity,
                        :title, :description, :location, :project_id, :user_id, 'open'
                    )
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                    **payload.model_dump(),
                },
            )
        ).scalar()

        await emit_role_notification(
            db,
            org_id=user["org_id"],
            role_names=["HSE / Safety Officer", "Compliance Officer"],
            title=f"HSE incident reported: {payload.title}",
            message=f"{payload.severity.title()} severity incident logged"
            + (f" at {payload.location}" if payload.location else "")
            + f" on {payload.incident_date}.",
            notification_type="hse_incident_reported",
            priority="urgent" if payload.severity in ("critical", "high") else "normal",
            action_url="/dashboard/compliance/incidents",
            metadata={"incident_id": str(new_id)},
        )

        await db.commit()
        return ok({"id": str(new_id)}, "hse_incidents created.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hse_incidents.read")),
):
    query = text("""
        SELECT *
        FROM projects.hse_incidents
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return ok(dict(item._mapping), "hse_incidents retrieved.")


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: HseIncidentUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hse_incidents.update")),
):
    values = payload.model_dump(exclude_unset=True)
    if not values:
        return ok({"id": item_id}, "No fields to update.")

    resolving = values.get("status") == "resolved"
    set_clauses = [f"{key} = :{key}" for key in values]
    if resolving:
        set_clauses += ["resolved_at = NOW()", "resolved_by = :actor_id"]
    set_clauses.append("updated_at = NOW()")

    result = (
        await db.execute(
            text(f"""
                UPDATE projects.hse_incidents
                SET {", ".join(set_clauses)}
                WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
                RETURNING id, title, reported_by
            """),
            {
                **values,
                "item_id": item_id,
                "org_id": user["org_id"],
                "actor_id": user["user_id"],
            },
        )
    ).first()
    if not result:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Item not found")

    if resolving and result.reported_by:
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(result.reported_by),
            title="HSE incident resolved",
            message=f"The incident you reported ({result.title}) has been marked resolved.",
            notification_type="hse_incident_resolved",
            action_url="/dashboard/compliance/incidents",
            metadata={"incident_id": item_id},
        )

    await db.commit()
    return ok({"id": item_id}, "hse_incidents updated.")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hse_incidents.delete")),
):
    query = text("""
        UPDATE projects.hse_incidents
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")
    await db.commit()
    return ok(None, "hse_incidents deleted (soft delete).")
