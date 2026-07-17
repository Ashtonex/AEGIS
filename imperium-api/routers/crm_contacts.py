from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.database import get_db
from core.security import get_current_user
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql

router = APIRouter()

CONTACT_COLUMNS = (
    "contact_name",
    "email",
    "client_org_id",
    "phone",
    "job_title",
    "project_id",
)


class ContactPayload(BaseModel):
    """The only client-controlled columns for CRM contacts."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    contact_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    client_org_id: Optional[UUID] = None
    phone: Optional[str] = Field(default=None, max_length=50)
    job_title: Optional[str] = Field(default=None, max_length=100)
    project_id: Optional[UUID] = None


def _payload_values(payload: ContactPayload) -> dict:
    return payload.model_dump(exclude_unset=True, exclude_none=False)


"""
Module: crm_contacts
Description: Auto-generated CRUD endpoints for crm.contacts.
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM crm.contacts
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_contacts listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    payload: ContactPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in CONTACT_COLUMNS if column in values]

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if not values.get("contact_name"):
        raise HTTPException(status_code=422, detail="contact_name is required.")

    params = {k: values[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.contacts", safe_keys, CONTACT_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "crm_contacts created.",
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
):
    query = text("""
        SELECT *
        FROM crm.contacts
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "crm_contacts retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: ContactPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in CONTACT_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: values[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.contacts", safe_keys, CONTACT_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_contacts updated.",
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
        UPDATE crm.contacts
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
        "message": "crm_contacts deleted (soft delete).",
        "meta": {},
    }
