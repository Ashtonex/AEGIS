from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.database import get_db
from core.security import get_current_user
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql

router = APIRouter()

ORGANIZATION_COLUMNS = ("name", "industry", "website", "phone", "email", "address")


class OrganizationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    industry: Optional[str] = Field(default=None, max_length=100)
    website: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None


def _payload_values(payload: OrganizationPayload) -> dict:
    return payload.model_dump(exclude_unset=True, exclude_none=False)


"""
Module: crm_organizations
Description: CRUD endpoints for crm.organizations (client organizations).
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    query = text("""
        SELECT *
        FROM crm.organizations
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY name ASC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_organizations listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    payload: OrganizationPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in ORGANIZATION_COLUMNS if column in values]

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if not values.get("name"):
        raise HTTPException(status_code=422, detail="name is required.")

    params = {k: values[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.organizations", safe_keys, ORGANIZATION_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "crm_organizations created.",
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
        FROM crm.organizations
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "crm_organizations retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    payload: OrganizationPayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    values = _payload_values(payload)
    safe_keys = [column for column in ORGANIZATION_COLUMNS if column in values]

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: values[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = user["org_id"]

    query = update_returning_id_sql("crm.organizations", safe_keys, ORGANIZATION_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_organizations updated.",
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
        UPDATE crm.organizations
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
        "message": "crm_organizations deleted (soft delete).",
        "meta": {},
    }
