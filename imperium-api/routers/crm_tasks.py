from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from datetime import date
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission
from app.shared.events import emit_notification

router = APIRouter()


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    entity_type: Optional[str] = Field(default=None, max_length=40)
    entity_id: Optional[UUID] = None
    assigned_to_user_id: Optional[UUID] = None
    due_date: Optional[date] = None
    priority: str = Field(default="normal", pattern="^(low|normal|high|urgent)$")


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    assigned_to_user_id: Optional[UUID] = None
    due_date: Optional[date] = None
    status: Optional[str] = Field(default=None, pattern="^(open|in_progress|done|cancelled)$")
    priority: Optional[str] = Field(default=None, pattern="^(low|normal|high|urgent)$")


TASK_UPDATE_COLUMNS = ("title", "description", "assigned_to_user_id", "due_date", "status", "priority")


@router.get("/")
async def list_tasks(
    assigned_to_user_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    entity_type: Optional[str] = None,
    entity_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("crm_tasks.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = """
        SELECT t.*, u.full_name AS assigned_to_name, c.full_name AS created_by_name
        FROM crm.tasks t
        LEFT JOIN core.users u ON u.id = t.assigned_to_user_id
        LEFT JOIN core.users c ON c.id = t.created_by
        WHERE t.organization_id = :org_id AND t.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if assigned_to_user_id:
        query_str += " AND t.assigned_to_user_id = :assigned_to_user_id"
        params["assigned_to_user_id"] = assigned_to_user_id
    if status_filter:
        query_str += " AND t.status = :status"
        params["status"] = status_filter
    if entity_type:
        query_str += " AND t.entity_type = :entity_type"
        params["entity_type"] = entity_type.strip().lower()
    if entity_id:
        query_str += " AND t.entity_id = :entity_id"
        params["entity_id"] = entity_id
    query_str += " ORDER BY (t.due_date IS NULL), t.due_date, t.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Tasks listed.", "meta": {"total": len(items)}}


@router.post("/")
async def create_task(
    payload: TaskCreate,
    user: dict = Depends(require_permission("crm_tasks.create")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    if payload.assigned_to_user_id:
        target_check = await db.execute(
            text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": payload.assigned_to_user_id, "org_id": org_id},
        )
        if not target_check.first():
            raise HTTPException(status_code=404, detail="Assignee not found.")

    task_id = (
        await db.execute(
            text("""
                INSERT INTO crm.tasks (
                    organization_id, title, description, entity_type, entity_id,
                    assigned_to_user_id, due_date, priority, created_by
                ) VALUES (
                    :org_id, :title, :description, :entity_type, :entity_id,
                    :assigned_to_user_id, :due_date, :priority, :user_id
                ) RETURNING id
            """),
            {
                "org_id": org_id,
                "title": payload.title,
                "description": payload.description,
                "entity_type": payload.entity_type.strip().lower() if payload.entity_type else None,
                "entity_id": payload.entity_id,
                "assigned_to_user_id": payload.assigned_to_user_id,
                "due_date": payload.due_date,
                "priority": payload.priority,
                "user_id": user["user_id"],
            },
        )
    ).scalar()

    if payload.assigned_to_user_id and str(payload.assigned_to_user_id) != user["user_id"]:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(payload.assigned_to_user_id),
            title="New task assigned to you",
            message=f'"{payload.title}" was assigned to you.',
            notification_type="task",
            action_url="/dashboard/crm/tasks",
        )

    await db.commit()
    return {"success": True, "data": {"id": str(task_id)}, "message": "Task created.", "meta": {}}


@router.patch("/{task_id}")
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    user: dict = Depends(require_permission("crm_tasks.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    current = (
        await db.execute(
            text("SELECT title, assigned_to_user_id FROM crm.tasks WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": task_id, "org_id": org_id},
        )
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Task not found.")

    values = payload.model_dump(exclude_unset=True, exclude_none=False)
    safe_keys = [column for column in TASK_UPDATE_COLUMNS if column in values]
    if not safe_keys:
        return {"success": True, "data": {"id": str(task_id)}, "message": "No fields to update.", "meta": {}}

    if "assigned_to_user_id" in safe_keys and values["assigned_to_user_id"]:
        target_check = await db.execute(
            text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": values["assigned_to_user_id"], "org_id": org_id},
        )
        if not target_check.first():
            raise HTTPException(status_code=404, detail="Assignee not found.")

    set_clause = ", ".join(f"{column} = :{column}" for column in safe_keys)
    params = {k: values[k] for k in safe_keys}
    params["id"] = task_id
    params["org_id"] = org_id
    await db.execute(
        text(f"UPDATE crm.tasks SET {set_clause}, updated_at = NOW() WHERE id = :id AND organization_id = :org_id"),  # nosec B608 - safe_keys drawn from a fixed allowlist above, never user input
        params,
    )

    reassigned_to = values.get("assigned_to_user_id")
    previous_assignee = str(current["assigned_to_user_id"]) if current["assigned_to_user_id"] else None
    if (
        "assigned_to_user_id" in safe_keys
        and reassigned_to
        and str(reassigned_to) != previous_assignee
        and str(reassigned_to) != user["user_id"]
    ):
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(reassigned_to),
            title="Task assigned to you",
            message=f'"{values.get("title") or current["title"]}" was assigned to you.',
            notification_type="task",
            action_url="/dashboard/crm/tasks",
        )

    await db.commit()
    return {"success": True, "data": {"id": str(task_id)}, "message": "Task updated.", "meta": {}}


@router.delete("/{task_id}")
async def delete_task(
    task_id: UUID,
    user: dict = Depends(require_permission("crm_tasks.delete")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE crm.tasks SET is_deleted = true, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
            RETURNING id
        """),
        {"id": task_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Task not found.")
    await db.commit()
    return {"success": True, "data": {"id": str(task_id)}, "message": "Task deleted.", "meta": {}}
