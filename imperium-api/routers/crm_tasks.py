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

# finance.departments.name -> the Tasks page's fixed department-tab codes.
# Only used to re-bucket entity_type='project' tasks onto the project's own
# real department (see _effective_department) - every other entity type
# keeps the fixed ENTITY_DEPARTMENT_CODE mapping unchanged, since leads/
# opportunities/tenders/fleet/machinery don't carry as reliable a per-record
# department signal for this purpose. Departments with no match here (e.g.
# "Corporate Control Services", "Risk") fall through to the entity_type
# default, same as a project with no department set at all.
DEPARTMENT_NAME_TO_CODE: dict[str, str] = {
    "commercial": "commercial",
    "construction": "construction",
    "plant & equipment": "plant_equipment",
}


def _effective_department(entity_type: Optional[str], project_department_name: Optional[str]) -> Optional[str]:
    if entity_type == "project" and project_department_name:
        mapped = DEPARTMENT_NAME_TO_CODE.get(project_department_name.strip().lower())
        if mapped:
            return mapped
    return ENTITY_DEPARTMENT_CODE.get(entity_type) if entity_type else None

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


TASK_STATUS_PATTERN = "^(not_started|in_progress|waiting_on_third_party|blocked|under_review|completed|cancelled)$"


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    entity_type: Optional[str] = Field(default=None, max_length=40)
    entity_id: Optional[UUID] = None
    assigned_to_user_id: Optional[UUID] = None
    due_date: Optional[date] = None
    priority: str = Field(default="normal", pattern="^(low|normal|high|urgent)$")
    depends_on_task_id: Optional[UUID] = None
    evidence_required: bool = False
    approver_user_id: Optional[UUID] = None
    risk_flag: bool = False


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    assigned_to_user_id: Optional[UUID] = None
    due_date: Optional[date] = None
    status: Optional[str] = Field(default=None, pattern=TASK_STATUS_PATTERN)
    priority: Optional[str] = Field(default=None, pattern="^(low|normal|high|urgent)$")
    depends_on_task_id: Optional[UUID] = None
    evidence_required: Optional[bool] = None
    evidence_ref: Optional[str] = None
    approver_user_id: Optional[UUID] = None
    risk_flag: Optional[bool] = None
    outcome: Optional[str] = None
    next_action: Optional[str] = None


TASK_UPDATE_COLUMNS = (
    "title", "description", "assigned_to_user_id", "due_date", "status", "priority",
    "depends_on_task_id", "evidence_required", "evidence_ref", "approver_user_id",
    "risk_flag", "outcome", "next_action",
)


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
        SELECT t.*, u.full_name AS assigned_to_name, c.full_name AS created_by_name, tm.name AS assigned_to_team_name,
               ap.full_name AS approver_name, dep.title AS depends_on_title, dep.status AS depends_on_status,
               COALESCE(
                   (SELECT jsonb_agg(jsonb_build_object('id', u2.id, 'full_name', u2.full_name) ORDER BY u2.full_name)
                    FROM crm.task_contributors tc JOIN core.users u2 ON u2.id = tc.user_id
                    WHERE tc.task_id = t.id),
                   '[]'::jsonb
               ) AS contributors,
               COALESCE(
                   lead.company_name, lead.contact_name, opp.name, tender.tender_name, proj.name,
                   veh.vehicle_registration, veh.asset_code, eq.asset_name
               ) AS entity_name,
               proj_dept.name AS project_department_name
        FROM crm.tasks t
        LEFT JOIN core.users u ON u.id = t.assigned_to_user_id
        LEFT JOIN core.users c ON c.id = t.created_by
        LEFT JOIN core.teams tm ON tm.id = t.assigned_to_team_id
        LEFT JOIN core.users ap ON ap.id = t.approver_user_id
        LEFT JOIN crm.tasks dep ON dep.id = t.depends_on_task_id
        LEFT JOIN crm.leads lead ON t.entity_type = 'lead' AND lead.id = t.entity_id AND lead.organization_id = t.organization_id
        LEFT JOIN crm.opportunities opp ON t.entity_type = 'opportunity' AND opp.id = t.entity_id AND opp.organization_id = t.organization_id
        LEFT JOIN crm.tenders tender ON t.entity_type = 'tender' AND tender.id = t.entity_id AND tender.organization_id = t.organization_id
        LEFT JOIN projects.projects proj ON t.entity_type = 'project' AND proj.id = t.entity_id AND proj.organization_id = t.organization_id
        LEFT JOIN finance.departments proj_dept ON proj_dept.id = proj.department_id
        LEFT JOIN fleet.fleet veh ON t.entity_type = 'fleet' AND veh.id = t.entity_id AND veh.organization_id = t.organization_id
        LEFT JOIN fleet.equipment_assets eq ON t.entity_type = 'machinery' AND eq.id = t.entity_id AND eq.organization_id = t.organization_id
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
    department_code: Optional[str] = None
    if department:
        department_code = department.strip().lower()
        if department_code not in DEPARTMENT_ENTITY_TYPES:
            raise HTTPException(status_code=422, detail=f"Unknown department: {department}")
        # Broad SQL pre-filter (still narrows the row count for the common
        # case); entity_type='project' rows are always included here and
        # re-filtered precisely in Python below, since a project's real
        # department can differ from the fixed entity_type default.
        query_str += " AND (t.entity_type = ANY(:department_entity_types) OR t.entity_type = 'project')"
        params["department_entity_types"] = DEPARTMENT_ENTITY_TYPES[department_code]

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
    for item in items:
        item["department"] = _effective_department(item.get("entity_type"), item.pop("project_department_name", None))
    if department_code:
        items = [item for item in items if item["department"] == department_code]
    return {"success": True, "data": items, "message": "Tasks listed.", "meta": {"total": len(items)}}


@router.get("/progress-summary")
async def get_progress_summary(
    user: dict = Depends(require_permission("crm_tasks.read_all")),
    db: AsyncSession = Depends(get_db),
):
    """Org-wide task rollup for the Team Progress panel - gated on
    crm_tasks.read_all itself (the same admin/lead tier already used to scope
    list_tasks above) rather than the caller's own assignments, since this is
    specifically the "who is doing what, how far along" view for
    SUPERADMIN/ADMIN/Executive, not a personal task list."""
    org_id = user["org_id"]

    per_user = (
        await db.execute(
            text("""
                SELECT u.id, u.full_name,
                       COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'cancelled')) AS open,
                       COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
                       COUNT(*) FILTER (
                           WHERE t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
                             AND t.status NOT IN ('completed', 'cancelled')
                       ) AS overdue,
                       COUNT(*) AS total
                FROM crm.tasks t
                JOIN core.users u ON u.id = t.assigned_to_user_id
                WHERE t.organization_id = :org_id AND t.is_deleted = false
                GROUP BY u.id, u.full_name
                ORDER BY open DESC, total DESC
            """),
            {"org_id": org_id},
        )
    ).mappings().all()

    per_team = (
        await db.execute(
            text("""
                SELECT tm.id, tm.name,
                       COUNT(*) FILTER (WHERE t.status NOT IN ('completed', 'cancelled')) AS open,
                       COUNT(*) FILTER (WHERE t.status = 'completed') AS completed,
                       COUNT(*) FILTER (
                           WHERE t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE
                             AND t.status NOT IN ('completed', 'cancelled')
                       ) AS overdue,
                       COUNT(*) AS total
                FROM crm.tasks t
                JOIN core.teams tm ON tm.id = t.assigned_to_team_id
                WHERE t.organization_id = :org_id AND t.is_deleted = false
                GROUP BY tm.id, tm.name
                ORDER BY open DESC, total DESC
            """),
            {"org_id": org_id},
        )
    ).mappings().all()

    overall = (
        await db.execute(
            text("""
                SELECT COUNT(*) FILTER (WHERE status NOT IN ('completed', 'cancelled')) AS open,
                       COUNT(*) FILTER (WHERE status = 'completed') AS completed,
                       COUNT(*) FILTER (
                           WHERE due_date IS NOT NULL AND due_date < CURRENT_DATE
                             AND status NOT IN ('completed', 'cancelled')
                       ) AS overdue,
                       COUNT(*) AS total
                FROM crm.tasks
                WHERE organization_id = :org_id AND is_deleted = false
            """),
            {"org_id": org_id},
        )
    ).mappings().first()

    def _with_pct(row: dict) -> dict:
        total = row["total"] or 0
        pct = round((row["completed"] / total) * 100) if total else 0
        return {**row, "pct_complete": pct}

    return {
        "success": True,
        "data": {
            "users": [_with_pct(dict(row)) for row in per_user],
            "teams": [_with_pct(dict(row)) for row in per_team],
            "overall": _with_pct(dict(overall)) if overall else {"open": 0, "completed": 0, "overdue": 0, "total": 0, "pct_complete": 0},
        },
        "message": "Task progress summary.",
        "meta": {},
    }


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
                    assigned_to_user_id, due_date, priority, created_by,
                    depends_on_task_id, evidence_required, approver_user_id, risk_flag
                ) VALUES (
                    :org_id, :title, :description, :entity_type, :entity_id,
                    :assigned_to_user_id, :due_date, :priority, :user_id,
                    :depends_on_task_id, :evidence_required, :approver_user_id, :risk_flag
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
                "depends_on_task_id": payload.depends_on_task_id,
                "evidence_required": payload.evidence_required,
                "approver_user_id": payload.approver_user_id,
                "risk_flag": payload.risk_flag,
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
            text("""
                SELECT title, assigned_to_user_id, assigned_to_team_id, status,
                       depends_on_task_id, evidence_required, evidence_ref, approver_user_id
                FROM crm.tasks WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
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

    if "status" in safe_keys and values["status"] in ("in_progress", "completed") and current["depends_on_task_id"]:
        predecessor = (
            await db.execute(
                text("SELECT status FROM crm.tasks WHERE id = :id AND is_deleted = false"),
                {"id": current["depends_on_task_id"]},
            )
        ).mappings().first()
        if not predecessor or predecessor["status"] != "completed":
            raise HTTPException(
                status_code=409,
                detail="This task's predecessor must be completed first.",
            )

    # Evidence/approval gate: a task marked evidence_required cannot be
    # completed by just anyone flipping a status flag. evidence_ref may be
    # supplied in this same request (an approver attaching proof and
    # completing in one call) or may already be on the record.
    verifying = False
    if "status" in safe_keys and values["status"] == "completed" and current["status"] != "completed":
        evidence_required = values.get("evidence_required", current["evidence_required"])
        if evidence_required:
            effective_evidence_ref = values.get("evidence_ref", current["evidence_ref"])
            if not effective_evidence_ref:
                raise HTTPException(
                    status_code=400,
                    detail="Evidence must be attached before this task can be completed.",
                )
            approver_id = values.get("approver_user_id", current["approver_user_id"])
            is_approver = approver_id is not None and str(approver_id) == user["user_id"]
            if not is_approver and not await user_has_permission(db, user, "crm_tasks.read_all"):
                raise HTTPException(
                    status_code=403,
                    detail="Only this task's approver can verify and complete it.",
                )
            verifying = True

    set_clause = ", ".join(f"{column} = :{column}" for column in safe_keys)
    if clear_team:
        set_clause += ", assigned_to_team_id = NULL"
    # completed_at tracks the moment status actually transitioned to
    # 'completed' (distinct from updated_at, which any field edit touches) -
    # cleared if a completed task is reopened, so re-marking it done later
    # gets a fresh timestamp rather than keeping a stale one from a prior
    # completion. verified_by/verified_at follow the same reopen-clears rule,
    # only ever set via the evidence/approval gate above, never by a plain
    # status PATCH from someone who isn't the approver.
    if "status" in safe_keys:
        if values["status"] == "completed" and current["status"] != "completed":
            set_clause += ", completed_at = NOW()"
            if verifying:
                set_clause += ", verified_by_user_id = :verifier_id, verified_at = NOW()"
        elif values["status"] != "completed" and current["status"] == "completed":
            set_clause += ", completed_at = NULL, verified_by_user_id = NULL, verified_at = NULL"
    params = {k: values[k] for k in safe_keys}
    if verifying:
        params["verifier_id"] = user["user_id"]
    params["id"] = task_id
    params["org_id"] = org_id
    await db.execute(
        text(f"UPDATE crm.tasks SET {set_clause}, updated_at = NOW() WHERE id = :id AND organization_id = :org_id"),  # nosec B608 - safe_keys drawn from a fixed allowlist above, never user input
        params,
    )

    # A task converted from a tender requirement (migration 137) drives that
    # requirement's checkbox from here on - same "satisfied by an external
    # signal, not a manual tick" shape as the document auto-match in
    # documents.py's _auto_match_tender_requirements, just sourced from task
    # completion instead of a filename match. Reopening the task un-ticks it.
    if "status" in safe_keys and (values["status"] == "completed") != (current["status"] == "completed"):
        await db.execute(
            text("""
                UPDATE crm.tender_requirements
                SET is_satisfied = :is_satisfied, updated_at = NOW()
                WHERE linked_task_id = :task_id AND organization_id = :org_id
            """),
            {"is_satisfied": values["status"] == "completed", "task_id": task_id, "org_id": org_id},
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


class ContributorAdd(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    user_id: UUID


@router.post("/{task_id}/contributors")
async def add_task_contributor(
    task_id: UUID,
    payload: ContributorAdd,
    user: dict = Depends(require_permission("crm_tasks.update")),
    db: AsyncSession = Depends(get_db),
):
    task_check = await db.execute(
        text("SELECT 1 FROM crm.tasks WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": task_id, "org_id": user["org_id"]},
    )
    if not task_check.first():
        raise HTTPException(status_code=404, detail="Task not found.")

    user_check = await db.execute(
        text("SELECT 1 FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
        {"id": payload.user_id, "org_id": user["org_id"]},
    )
    if not user_check.first():
        raise HTTPException(status_code=404, detail="User not found.")

    await db.execute(
        text("""
            INSERT INTO crm.task_contributors (task_id, user_id) VALUES (:task_id, :user_id)
            ON CONFLICT (task_id, user_id) DO NOTHING
        """),
        {"task_id": task_id, "user_id": payload.user_id},
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Contributor added.", "meta": {}}


@router.delete("/{task_id}/contributors/{contributor_user_id}")
async def remove_task_contributor(
    task_id: UUID,
    contributor_user_id: UUID,
    user: dict = Depends(require_permission("crm_tasks.update")),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        text("DELETE FROM crm.task_contributors WHERE task_id = :task_id AND user_id = :user_id"),
        {"task_id": task_id, "user_id": contributor_user_id},
    )
    await db.commit()
    return {"success": True, "data": None, "message": "Contributor removed.", "meta": {}}


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
              AND is_deleted = false AND status NOT IN ('completed', 'cancelled')
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
