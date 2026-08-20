from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from core.database import get_db
from core.security import get_current_user, require_permission, user_has_permission
from app.shared.sql import (
    insert_returning_id_sql,
    safe_payload_columns,
    update_returning_id_sql,
)
from app.services.auth_provisioning import provision_portal_user

router = APIRouter()

"""
Module: supplier_records
Description: Auto-generated CRUD endpoints for procurement.suppliers.
"""


@router.get("/")
async def list_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_records.read")),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM procurement.suppliers
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": user["org_id"]})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "supplier_records listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_records.create")),
):
    payload = await request.json()

    # issue_portal_login isn't a procurement.suppliers column - read it off
    # the raw body before safe_payload_columns filters it out below.
    issue_portal_login = bool(payload.get("issue_portal_login"))

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = safe_payload_columns(payload.keys())

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")
    if issue_portal_login:
        if not await user_has_permission(db, user, "settings.update"):
            raise HTTPException(
                status_code=403,
                detail="Issuing a portal login requires settings.update, in addition to supplier-create access.",
            )
        if not payload.get("primary_contact_email"):
            raise HTTPException(status_code=422, detail="primary_contact_email is required to issue a portal login.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = user["org_id"]
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("procurement.suppliers", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        new_id = result.scalar()

        temp_password = None
        if issue_portal_login:
            # Portal access is keyed to crm.subcontractors, not
            # procurement.suppliers directly - bridge a subcontractor
            # profile the same way Settings > Managed Accounts and the CRM
            # Subcontractors page do, so this supplier is reachable through
            # the one portal-access mechanism regardless of entry point.
            subcontractor_row = await db.execute(
                text("""
                    INSERT INTO crm.subcontractors (
                        organization_id, created_by, name, contact_name, contact_email, contact_phone,
                        compliance_status, linked_supplier_id
                    )
                    VALUES (:org_id, :user_id, :name, :contact_name, :contact_email, :contact_phone, :compliance_status, :supplier_id)
                    RETURNING id
                """),
                {
                    "org_id": user["org_id"],
                    "user_id": user["sub"],
                    "name": payload.get("supplier_name") or payload.get("primary_contact_name"),
                    "contact_name": payload.get("primary_contact_name"),
                    "contact_email": payload.get("primary_contact_email"),
                    "contact_phone": payload.get("primary_contact_phone"),
                    "compliance_status": payload.get("compliance_status"),
                    "supplier_id": new_id,
                },
            )
            subcontractor_id = subcontractor_row.scalar()

            portal_user_id, temp_password = await provision_portal_user(
                db,
                org_id=user["org_id"],
                email=payload["primary_contact_email"],
                full_name=payload.get("primary_contact_name") or payload.get("supplier_name") or "Supplier contact",
                account_type="supplier",
            )
            await db.execute(
                text("""
                    INSERT INTO crm.supplier_portal_access (user_id, organization_id, subcontractor_id, is_active)
                    VALUES (:user_id, :org_id, :subcontractor_id, true)
                    ON CONFLICT (user_id, organization_id) DO UPDATE SET
                        subcontractor_id=EXCLUDED.subcontractor_id, is_active=true, updated_at=NOW()
                """),
                {"user_id": portal_user_id, "org_id": user["org_id"], "subcontractor_id": subcontractor_id},
            )

        await db.commit()
        response_data = {"id": str(new_id)}
        if temp_password:
            response_data["temporary_password"] = temp_password
        return {
            "success": True,
            "data": response_data,
            "message": "supplier_records created." if not temp_password else "Supplier created and portal login issued.",
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
    _: dict = Depends(require_permission("supplier_records.read")),
):
    query = text("""
        SELECT *
        FROM procurement.suppliers
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(query, {"item_id": item_id, "org_id": user["org_id"]})
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "supplier_records retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_records.update")),
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

    query = update_returning_id_sql("procurement.suppliers", safe_keys, safe_keys)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "supplier_records updated.",
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
    _: dict = Depends(require_permission("supplier_records.delete")),
):
    query = text("""
        UPDATE procurement.suppliers
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
        "message": "supplier_records deleted (soft delete).",
        "meta": {},
    }
