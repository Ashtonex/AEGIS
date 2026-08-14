from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql
from app.shared.events import emit_notification, emit_role_notification

router = APIRouter()

ACTIVITY_COLUMNS = (
    "contact_id",
    "lead_id",
    "opportunity_id",
    "type",
    "subject",
    "description",
    "activity_date",
    "status",
    "owner_user_id",
    "priority",
)

# Roles that see every org activity on the calendar/list, not just their own -
# mirrors the "management has org-wide visibility" convention already used
# for notifications in routers/quotations.py (COMMERCIAL_ALERT_ROLES).
MANAGEMENT_ROLES = {SUPERADMIN_ROLE.upper(), "EXECUTIVE (ADMIN)"}

# Roles notified when an activity is flagged high/urgent priority.
PRIORITY_ALERT_ROLES = ["Executive (Admin)", "CRM Associate"]
ESCALATED_PRIORITIES = {"high", "urgent"}


class ActivityPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    contact_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    type: Optional[str] = Field(default=None, min_length=1, max_length=50)
    subject: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    activity_date: Optional[datetime] = None
    status: Optional[str] = Field(default=None, max_length=50)
    owner_user_id: Optional[UUID] = None
    priority: Optional[str] = Field(default=None, max_length=20)


def _payload_values(payload: ActivityPayload) -> dict:
    return payload.model_dump(exclude_unset=True, exclude_none=False)


def _is_management(role: Optional[str]) -> bool:
    return bool(role) and role.strip().upper() in MANAGEMENT_ROLES


"""
Module: crm_activities
Description: CRUD endpoints for crm.activities. Visibility is role-scoped:
management roles (see MANAGEMENT_ROLES) see every org activity, everyone
else sees only activities they own or created - this is what backs both the
CRM activities page and the navbar calendar widget.
"""


@router.get("/")
async def list_items(
    start_date: Optional[datetime] = Query(default=None),
    end_date: Optional[datetime] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    conditions = ["a.organization_id = :org_id", "a.is_deleted = false"]
    params: dict = {"org_id": user["org_id"], "limit": limit}

    if not _is_management(user.get("role")):
        conditions.append("(a.owner_user_id = :user_id OR a.created_by = :user_id)")
        params["user_id"] = user["user_id"]

    if start_date is not None:
        conditions.append("a.activity_date >= :start_date")
        params["start_date"] = start_date
    if end_date is not None:
        conditions.append("a.activity_date <= :end_date")
        params["end_date"] = end_date

    where_sql = " AND ".join(conditions)
    query = text(f"""
        SELECT a.*,
               c.contact_name,
               l.company_name as lead_company,
               o.name as opportunity_name,
               u.full_name as owner_name
        FROM crm.activities a
        LEFT JOIN crm.contacts c ON a.contact_id = c.id
        LEFT JOIN crm.leads l ON a.lead_id = l.id
        LEFT JOIN crm.opportunities o ON a.opportunity_id = o.id
        LEFT JOIN core.users u ON a.owner_user_id = u.id
        WHERE {where_sql}
        ORDER BY a.activity_date DESC
        LIMIT :limit
    """)  # nosec B608 - where_sql built only from fixed literals above, no user input
    result = await db.execute(query, params)
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_activities listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    payload: ActivityPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)

    # An activity always has an owner - default to its creator so it shows
    # up on someone's calendar even if the caller didn't set one explicitly.
    if not values.get("owner_user_id"):
        values["owner_user_id"] = user["user_id"]

    safe_keys = [column for column in ACTIVITY_COLUMNS if column in values]

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if not values.get("type") or not values.get("subject"):
        raise HTTPException(status_code=422, detail="type and subject are required.")

    params = {k: values[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["user_id"]

    query = insert_returning_id_sql("crm.activities", safe_keys, ACTIVITY_COLUMNS)

    try:
        result = await db.execute(query, params)
        new_id = result.scalar()

        owner_id = str(values["owner_user_id"])
        priority = (values.get("priority") or "normal").lower()
        subject = values["subject"]

        if owner_id != user["user_id"]:
            await emit_notification(
                db,
                org_id=user["org_id"],
                user_id=owner_id,
                title="New CRM activity assigned",
                message=f"{values.get('type', 'Activity')}: {subject}",
                notification_type="crm_activity",
                priority="high" if priority in ESCALATED_PRIORITIES else "normal",
                action_url="/dashboard/crm/activities",
                metadata={"activity_id": str(new_id)},
            )

        if priority in ESCALATED_PRIORITIES:
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=PRIORITY_ALERT_ROLES,
                title=f"{priority.capitalize()}-priority CRM activity",
                message=f"{values.get('type', 'Activity')}: {subject}",
                notification_type="crm_activity",
                priority=priority,
                action_url="/dashboard/crm/activities",
                metadata={"activity_id": str(new_id)},
            )

        await db.commit()
        return {
            "success": True,
            "data": {"id": str(new_id)},
            "message": "crm_activities created.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        SELECT a.*,
               c.contact_name,
               l.company_name as lead_company,
               o.name as opportunity_name,
               u.full_name as owner_name
        FROM crm.activities a
        LEFT JOIN crm.contacts c ON a.contact_id = c.id
        LEFT JOIN crm.leads l ON a.lead_id = l.id
        LEFT JOIN crm.opportunities o ON a.opportunity_id = o.id
        LEFT JOIN core.users u ON a.owner_user_id = u.id
        WHERE a.id = :item_id AND a.organization_id = :org_id AND a.is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    row = dict(item._mapping)
    if not _is_management(user.get("role")) and str(row.get("owner_user_id")) != user["user_id"] and str(row.get("created_by")) != user["user_id"]:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": row,
        "message": "crm_activities retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: ActivityPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in ACTIVITY_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    existing = (
        await db.execute(
            text("""
                SELECT owner_user_id, priority, subject, type
                FROM crm.activities
                WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"item_id": item_id, "org_id": user["org_id"]},
        )
    ).mappings().first()

    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")

    params = {k: values[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.activities", safe_keys, ACTIVITY_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        subject = values.get("subject", existing["subject"])
        activity_type = values.get("type", existing["type"])

        new_owner = values.get("owner_user_id")
        if new_owner is not None:
            new_owner_id = str(new_owner)
            prior_owner_id = str(existing["owner_user_id"]) if existing["owner_user_id"] else None
            if new_owner_id != prior_owner_id and new_owner_id != user["user_id"]:
                await emit_notification(
                    db,
                    org_id=user["org_id"],
                    user_id=new_owner_id,
                    title="CRM activity reassigned to you",
                    message=f"{activity_type}: {subject}",
                    notification_type="crm_activity",
                    action_url="/dashboard/crm/activities",
                    metadata={"activity_id": item_id},
                )

        new_priority = values.get("priority")
        if new_priority is not None:
            new_priority = new_priority.lower()
            prior_priority = (existing["priority"] or "normal").lower()
            if new_priority in ESCALATED_PRIORITIES and new_priority != prior_priority:
                await emit_role_notification(
                    db,
                    org_id=user["org_id"],
                    role_names=PRIORITY_ALERT_ROLES,
                    title=f"{new_priority.capitalize()}-priority CRM activity",
                    message=f"{activity_type}: {subject}",
                    notification_type="crm_activity",
                    priority=new_priority,
                    action_url="/dashboard/crm/activities",
                    metadata={"activity_id": item_id},
                )

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_activities updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        UPDATE crm.activities
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "crm_activities deleted (soft delete).",
        "meta": {},
    }
