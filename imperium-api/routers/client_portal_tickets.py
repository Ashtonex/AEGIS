from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from pydantic import BaseModel

from core.database import get_db
from core.security import get_current_user, require_permission
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    update_returning_id_sql,
)

router = APIRouter()

"""
Module: client_portal_tickets
Description: Auto-generated CRUD endpoints for crm.support_tickets.
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT
            t.*,
            c.contact_name,
            c.email,
            co.name AS company_name
        FROM crm.support_tickets t
        LEFT JOIN crm.contacts c ON c.id = t.contact_id
         AND c.organization_id = t.organization_id
         AND c.is_deleted = false
        LEFT JOIN crm.organizations co ON co.id = c.client_org_id
         AND co.organization_id = t.organization_id
         AND co.is_deleted = false
        WHERE t.organization_id = :org_id AND t.is_deleted = false
        ORDER BY t.created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "client_portal_tickets listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.create")),
):
    payload = await request.json()

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.support_tickets", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        new_id = str(result.scalar())
        
        # SLA calculation
        priority = str(payload.get("priority") or "normal").lower()
        if priority == "urgent":
            resp_hours, resol_hours = 4, 12
        elif priority == "high":
            resp_hours, resol_hours = 12, 24
        elif priority == "low":
            resp_hours, resol_hours = 48, 120
        else: # normal
            resp_hours, resol_hours = 24, 72
            
        await db.execute(
            text("""
                INSERT INTO crm.ticket_sla_events (
                    organization_id, ticket_id, event_type, deadline, status, created_by
                ) VALUES (
                    :org_id, :ticket_id, 'ResponseDeadline', NOW() + :resp_hours * INTERVAL '1 hour', 'Active', :user_id
                )
            """),
            {"org_id": user["org_id"], "ticket_id": new_id, "resp_hours": resp_hours, "user_id": user["sub"]}
        )
        await db.execute(
            text("""
                INSERT INTO crm.ticket_sla_events (
                    organization_id, ticket_id, event_type, deadline, status, created_by
                ) VALUES (
                    :org_id, :ticket_id, 'ResolutionDeadline', NOW() + :resol_hours * INTERVAL '1 hour', 'Active', :user_id
                )
            """),
            {"org_id": user["org_id"], "ticket_id": new_id, "resol_hours": resol_hours, "user_id": user["sub"]}
        )
        await db.commit()
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "client_portal_tickets created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.read")),
):
    query = text("""
        SELECT *
        FROM crm.support_tickets
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "client_portal_tickets retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.update")),
):
    payload = await request.json()
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.support_tickets", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "client_portal_tickets updated.",
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
    _: dict = Depends(require_permission("client_portal_tickets.delete")),
):
    query = text("""
        UPDATE crm.support_tickets
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
        "message": "client_portal_tickets deleted (soft delete).",
        "meta": {},
    }


class CommentPayload(BaseModel):
    body: str
    visibility: str = "internal"


@router.post("/{ticket_id}/comments", status_code=status.HTTP_201_CREATED)
async def create_ticket_comment(
    ticket_id: str,
    payload: CommentPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.update")),
):
    # Verify ticket exists and scopes to organization
    ticket_row = await db.execute(
        text("SELECT id FROM crm.support_tickets WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false"),
        {"ticket_id": ticket_id, "org_id": user["org_id"]},
    )
    if not ticket_row.first():
        raise HTTPException(status_code=404, detail="Support ticket not found.")

    visibility = payload.visibility if payload.visibility in ("internal", "client") else "internal"
    result = await db.execute(
        text("""
            INSERT INTO crm.ticket_comments (organization_id, ticket_id, body, visibility, created_by)
            VALUES (:org_id, :ticket_id, :body, :visibility, :user_id)
            RETURNING id
        """),
        {
            "org_id": user["org_id"],
            "ticket_id": ticket_id,
            "body": payload.body,
            "visibility": visibility,
            "user_id": user["sub"],
        },
    )
    await db.commit()
    return {"success": True, "data": {"id": str(result.scalar())}, "message": "Ticket comment added."}


@router.get("/{ticket_id}/comments")
async def list_ticket_comments(
    ticket_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("client_portal_tickets.read")),
):
    # Verify ticket exists and scopes to organization
    ticket_row = await db.execute(
        text("SELECT id FROM crm.support_tickets WHERE id = :ticket_id AND organization_id = :org_id AND is_deleted = false"),
        {"ticket_id": ticket_id, "org_id": user["org_id"]},
    )
    if not ticket_row.first():
        raise HTTPException(status_code=404, detail="Support ticket not found.")

    result = await db.execute(
        text("""
            SELECT * FROM crm.ticket_comments
            WHERE ticket_id = :ticket_id AND organization_id = :org_id AND is_deleted = false
            ORDER BY created_at ASC
        """),
        {"ticket_id": ticket_id, "org_id": user["org_id"]},
    )
    comments = [dict(row._mapping) for row in result]
    return {"success": True, "data": comments, "message": "Ticket comments retrieved."}

