from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from pydantic import BaseModel, ConfigDict, EmailStr, Field

from core.database import get_db
from core.security import get_current_user, user_has_permission
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql
from app.services.auth_provisioning import provision_portal_user

router = APIRouter()

ORGANIZATION_COLUMNS = (
    "name",
    "industry",
    "sector",
    "website",
    "phone",
    "email",
    "address",
    "registration_number",
    "tax_id",
    "credit_limit",
    "total_contract_value",
    "risk_rating",
    "parent_org_id",
)


class OrganizationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    industry: Optional[str] = Field(default=None, max_length=100)
    sector: Optional[str] = Field(default=None, max_length=100)
    website: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=50)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    registration_number: Optional[str] = Field(default=None, max_length=100)
    tax_id: Optional[str] = Field(default=None, max_length=100)
    credit_limit: Optional[float] = None
    total_contract_value: Optional[float] = None
    risk_rating: Optional[str] = Field(default=None, max_length=50)
    parent_org_id: Optional[str] = None
    # Optional: provision an immediately-active client portal login using
    # this organization's own email in the same call, instead of a separate
    # trip through Settings > Managed Accounts. Requires settings.update on
    # top of plain organization-create access.
    issue_portal_login: bool = False


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
    if payload.issue_portal_login:
        if not await user_has_permission(db, user, "settings.update"):
            raise HTTPException(
                status_code=403,
                detail="Issuing a portal login requires settings.update, in addition to organization-create access.",
            )
        if not payload.email:
            raise HTTPException(status_code=422, detail="An email is required to issue a portal login.")

    params = {k: values[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.organizations", safe_keys, ORGANIZATION_COLUMNS)

    try:
        result = await db.execute(query, params)
        new_id = result.scalar()

        temp_password = None
        if payload.issue_portal_login:
            portal_user_id, temp_password = await provision_portal_user(
                db,
                org_id=user["org_id"],
                email=str(payload.email),
                full_name=payload.name,
                account_type="client",
            )
            contact_row = await db.execute(
                text("""
                    INSERT INTO crm.contacts (organization_id, created_by, client_org_id, contact_name, email, phone)
                    VALUES (:org_id, :user_id, :client_org_id, :contact_name, :email, :phone)
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "user_id": user["sub"],
                    "client_org_id": new_id,
                    "contact_name": payload.name,
                    "email": str(payload.email),
                    "phone": payload.phone,
                },
            )
            contact_id = contact_row.scalar()
            await db.execute(
                text("""
                    INSERT INTO crm.client_portal_access (user_id, organization_id, contact_id, is_active)
                    VALUES (:user_id, :org_id, :contact_id, true)
                    ON CONFLICT (user_id, organization_id) DO UPDATE SET
                        contact_id=EXCLUDED.contact_id, is_active=true, updated_at=NOW()
                """),
                {"user_id": portal_user_id, "org_id": user["org_id"], "contact_id": contact_id},
            )

        await db.commit()
        response_data = {"id": str(new_id)}
        if temp_password:
            response_data["temporary_password"] = temp_password
        return {
            "success": True,
            "data": response_data,
            "message": "crm_organizations created." if not temp_password else "Organization created and portal login issued.",
            "meta": {},
        }
    except HTTPException:
        await db.rollback()
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
