from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from uuid import UUID
from datetime import date
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import require_permission, user_has_permission
from app.shared.events import emit_notification
from app.shared.task_stacks import ENTITY_DEPARTMENT_CODE, generate_task_stack

router = APIRouter()

DEPARTMENT_ENTITY_TYPES: dict[str, list[str]] = {}
for _entity_type, _department in ENTITY_DEPARTMENT_CODE.items():
    DEPARTMENT_ENTITY_TYPES.setdefault(_department, []).append(_entity_type)

# entity_type -> the table/id-column pair backfill-stacks sweeps to generate
# stacks for every pre-existing record that predates auto-generation on
# create (738de2a) or predates fleet/machinery being wired up as sources.
BACKFILL_SOURCES: list[tuple[str, str]] = [
    ("lead", "crm.leads"),
    ("opportunity", "crm.opportunities"),
    ("tender", "crm.tenders"),
    ("project", "projects.projects"),
    ("fleet", "fleet.fleet"),
    ("machinery", "fleet.equipment_assets"),
]


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


class StackAssignPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    entity_type: str = Field(min_length=1, max_length=40)
    entity_id: UUID
    assigned_to_team_id: UUID


class TaskTemplateCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    entity_type: str = Field(min_length=1, max_length=40)
    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    sort_order: int = 0


@router.get("/")
async def list_tasks(
    assigned_to_user_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    entity_type: Optional[str] = None,
    entity_id: Optional[UUID] = None,
    department: Optional[str] = None,
    user: dict = Depends(require_permission("crm_tasks.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = """
        SELECT t.*, u.full_name AS assigned_to_name, c.full_name AS created_by_name, tm.name AS assigned_to_team_name
        FROM crm.tasks t
        LEFT JOIN core.users u ON u.id = t.assigned_to_user_id
        LEFT JOIN core.users c ON c.id = t.created_by
        LEFT JOIN core.teams tm ON tm.id = t.assigned_to_team_id
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
    if department:
        dept_entity_types = DEPARTMENT_ENTITY_TYPES.get(department.strip().lower())
        if not dept_entity_types:
            raise HTTPException(status_code=422, detail=f"Unknown department: {department}")
        query_str += " AND t.entity_type = ANY(:department_entity_types)"
        params["department_entity_types"] = dept_entity_types

    # Baseline crm_tasks.read only sees tasks assigned directly to the
    # caller or belonging to a team they're a member of - crm_tasks.read_all
    # (the same admin/lead tier that already held crm_tasks.read before this
    # scoping existed) still sees everything org-wide, unchanged.
    if not await user_has_permission(db, user, "crm_tasks.read_all"):
        query_str += """ AND (
            t.assigned_to_user_id = :caller_id
            OR t.assigned_to_team_id IN (SELECT team_id FROM core.team_members WHERE user_id = :caller_id)
        )"""
        params["caller_id"] = user["user_id"]

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
            text("SELECT title, assigned_to_user_id, assigned_to_team_id, status FROM crm.tasks WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
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

    # Reassigning a task to a specific person (a lead "distributing" one
    # item out of a team-assigned stack) implicitly clears any team
    # assignment - a task is either on a team's plate or one person's, not
    # both at once.
    clear_team = "assigned_to_user_id" in safe_keys and values["assigned_to_user_id"]

    # Redistributing a task OUT of a team is a lead's call, not any holder of
    # crm_tasks.update - unless the caller already has org-wide reach via
    # crm_tasks.read_all (the same admin/lead tier that can assign a whole
    # stack to a team in the first place via assign-stack).
    if clear_team and current["assigned_to_team_id"]:
        is_lead = (
            await db.execute(
                text("SELECT 1 FROM core.team_members WHERE team_id = :team_id AND user_id = :user_id AND is_lead = true"),
                {"team_id": current["assigned_to_team_id"], "user_id": user["user_id"]},
            )
        ).first()
        if not is_lead and not await user_has_permission(db, user, "crm_tasks.read_all"):
            raise HTTPException(
                status_code=403,
                detail="Only that team's lead can redistribute its tasks to individual members.",
            )

    set_clause = ", ".join(f"{column} = :{column}" for column in safe_keys)
    if clear_team:
        set_clause += ", assigned_to_team_id = NULL"
    # completed_at tracks the moment status actually transitioned to 'done'
    # (distinct from updated_at, which any field edit touches) - cleared if
    # a completed task is reopened, so re-marking it done later gets a fresh
    # timestamp rather than keeping a stale one from a prior completion.
    if "status" in safe_keys:
        if values["status"] == "done" and current["status"] != "done":
            set_clause += ", completed_at = NOW()"
        elif values["status"] != "done" and current["status"] == "done":
            set_clause += ", completed_at = NULL"
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


@router.post("/assign-stack")
async def assign_stack_to_team(
    payload: StackAssignPayload,
    user: dict = Depends(require_permission("crm_tasks.update")),
    db: AsyncSession = Depends(get_db),
):
    """Assigns every open task linked to one entity to a team in one call -
    the "hand the whole stack to a team" action a lead then distributes
    from. Notifies each team member once, not once per task."""
    org_id = user["org_id"]
    team_check = await db.execute(
        text("SELECT 1 FROM core.teams WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.assigned_to_team_id, "org_id": org_id},
    )
    if not team_check.first():
        raise HTTPException(status_code=404, detail="Team not found.")

    entity_key = payload.entity_type.strip().lower()
    result = await db.execute(
        text("""
            UPDATE crm.tasks
            SET assigned_to_team_id = :team_id, assigned_to_user_id = NULL, updated_at = NOW()
            WHERE organization_id = :org_id AND entity_type = :entity_type AND entity_id = :entity_id
              AND is_deleted = false AND status NOT IN ('done', 'cancelled')
            RETURNING id
        """),
        {
            "team_id": payload.assigned_to_team_id,
            "org_id": org_id,
            "entity_type": entity_key,
            "entity_id": payload.entity_id,
        },
    )
    updated_ids = [row.id for row in result]
    if not updated_ids:
        await db.rollback()
        raise HTTPException(status_code=404, detail="No open tasks found for that record.")

    member_rows = await db.execute(
        text("SELECT user_id FROM core.team_members WHERE team_id = :team_id"),
        {"team_id": payload.assigned_to_team_id},
    )
    for member in member_rows:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(member.user_id),
            title="New task stack assigned to your team",
            message=f"Your team was assigned {len(updated_ids)} task(s) for this {entity_key}.",
            notification_type="task",
            action_url="/dashboard/crm/tasks",
        )

    await db.commit()
    return {
        "success": True,
        "data": {"task_count": len(updated_ids)},
        "message": "Task stack assigned to team.",
        "meta": {},
    }


@router.post("/backfill-stacks")
async def backfill_task_stacks(
    user: dict = Depends(require_permission("crm_tasks.templates.manage")),
    db: AsyncSession = Depends(get_db),
):
    """One-time (safe to re-run) sweep that generates the standard task
    stack for every existing lead/opportunity/tender/project/fleet-asset/
    equipment-asset that predates auto-generation firing on create, or
    predates fleet/machinery being wired up as sources at all.
    generate_task_stack() already no-ops per record via its own
    source='template' existence check, so re-running this is always safe."""
    org_id = user["org_id"]
    created_by = user["user_id"]
    created_total = 0
    records_checked = 0
    for entity_type, table_name in BACKFILL_SOURCES:
        rows = await db.execute(
            text(f"SELECT id FROM {table_name} WHERE organization_id = :org_id AND is_deleted = false"),  # nosec B608 - table_name drawn from a fixed allowlist above, never user input
            {"org_id": org_id},
        )
        for row in rows:
            records_checked += 1
            created_total += await generate_task_stack(
                db, org_id=org_id, entity_type=entity_type, entity_id=row.id, created_by=created_by,
            )
    return {
        "success": True,
        "data": {"records_checked": records_checked, "tasks_created": created_total},
        "message": f"Backfill complete: {created_total} task(s) created across {records_checked} record(s).",
        "meta": {},
    }


@router.get("/templates")
async def list_task_templates(
    entity_type: Optional[str] = None,
    user: dict = Depends(require_permission("crm_tasks.read")),
    db: AsyncSession = Depends(get_db),
):
    query_str = """
        SELECT * FROM crm.task_templates
        WHERE organization_id = :org_id AND is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if entity_type:
        query_str += " AND entity_type = :entity_type"
        params["entity_type"] = entity_type.strip().lower()
    query_str += " ORDER BY entity_type, sort_order"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return {"success": True, "data": items, "message": "Task templates listed.", "meta": {"total": len(items)}}


@router.post("/templates")
async def create_task_template(
    payload: TaskTemplateCreate,
    user: dict = Depends(require_permission("crm_tasks.templates.manage")),
    db: AsyncSession = Depends(get_db),
):
    template_id = (
        await db.execute(
            text("""
                INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
                VALUES (:org_id, :entity_type, :title, :description, :sort_order)
                RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "entity_type": payload.entity_type.strip().lower(),
                "title": payload.title,
                "description": payload.description,
                "sort_order": payload.sort_order,
            },
        )
    ).scalar()
    await db.commit()
    return {"success": True, "data": {"id": str(template_id)}, "message": "Task template created.", "meta": {}}


@router.delete("/templates/{template_id}")
async def delete_task_template(
    template_id: UUID,
    user: dict = Depends(require_permission("crm_tasks.templates.manage")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            UPDATE crm.task_templates SET is_deleted = true
            WHERE id = :id AND organization_id = :org_id
            RETURNING id
        """),
        {"id": template_id, "org_id": user["org_id"]},
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Task template not found.")
    await db.commit()
    return {"success": True, "data": {"id": str(template_id)}, "message": "Task template deleted.", "meta": {}}
