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
from app.shared.vendor_verification import run_system_verification_check
from core.logging import logger

router = APIRouter()

"""
Module: supplier_records
Description: Auto-generated CRUD endpoints for procurement.suppliers.
"""

SUPPLIER_EDIT_COLUMNS = {
    "supplier_name",
    "supplier_code",
    "trading_name",
    "registration_number",
    "tax_number",
    "praz_number",
    "nssa_number",
    "primary_contact_name",
    "primary_contact_email",
    "primary_contact_phone",
    "payment_terms_days",
    "currency",
    "status",
    "compliance_status",
    "performance_score",
    "on_time_delivery_pct",
}


async def ensure_supplier_subcontractor_bridge(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    supplier_id: str,
) -> str:
    row = await db.execute(
        text("""
            SELECT sc.id
            FROM crm.subcontractors sc
            WHERE sc.organization_id = :org_id
              AND sc.linked_supplier_id = :supplier_id
              AND sc.is_deleted = false
            LIMIT 1
        """),
        {"org_id": org_id, "supplier_id": supplier_id},
    )
    existing_id = row.scalar()
    if existing_id:
        return str(existing_id)

    supplier_row = await db.execute(
        text("""
            SELECT supplier_name, trading_name, registration_number, tax_number, praz_number, nssa_number,
                   primary_contact_name, primary_contact_email, primary_contact_phone, compliance_status
            FROM procurement.suppliers
            WHERE id = :supplier_id AND organization_id = :org_id AND is_deleted = false
        """),
        {"org_id": org_id, "supplier_id": supplier_id},
    )
    supplier = supplier_row.first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    data = dict(supplier._mapping)
    created = await db.execute(
        text("""
            INSERT INTO crm.subcontractors (
                organization_id, created_by, name, registration_number, tax_clearance_number,
                praz_number, nssa_number, contact_name, contact_email, contact_phone,
                compliance_status, linked_supplier_id, submission_data
            )
            VALUES (
                :org_id, :user_id, :name, :registration_number, :tax_clearance_number,
                :praz_number, :nssa_number, :contact_name, :contact_email, :contact_phone,
                :compliance_status, :supplier_id, CAST(:submission_data AS jsonb)
            )
            RETURNING id
        """),
        {
            "org_id": org_id,
            "user_id": user_id,
            "name": data.get("supplier_name") or data.get("trading_name") or "Supplier",
            "registration_number": data.get("registration_number"),
            "tax_clearance_number": data.get("tax_number"),
            "praz_number": data.get("praz_number"),
            "nssa_number": data.get("nssa_number"),
            "contact_name": data.get("primary_contact_name"),
            "contact_email": data.get("primary_contact_email"),
            "contact_phone": data.get("primary_contact_phone"),
            "compliance_status": data.get("compliance_status") or "pending",
            "supplier_id": supplier_id,
            "submission_data": "{}",
        },
    )
    return str(created.scalar())


async def sync_supplier_subcontractor_bridge(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    supplier_id: str,
) -> None:
    subcontractor_id = await ensure_supplier_subcontractor_bridge(
        db, org_id=org_id, user_id=user_id, supplier_id=supplier_id
    )
    await db.execute(
        text("""
            UPDATE crm.subcontractors sc
            SET name = COALESCE(s.supplier_name, sc.name),
                registration_number = COALESCE(s.registration_number, sc.registration_number),
                tax_clearance_number = COALESCE(s.tax_number, sc.tax_clearance_number),
                praz_number = COALESCE(s.praz_number, sc.praz_number),
                nssa_number = COALESCE(s.nssa_number, sc.nssa_number),
                contact_name = COALESCE(s.primary_contact_name, sc.contact_name),
                contact_email = COALESCE(s.primary_contact_email, sc.contact_email),
                contact_phone = COALESCE(s.primary_contact_phone, sc.contact_phone),
                compliance_status = COALESCE(s.compliance_status, sc.compliance_status),
                updated_at = NOW()
            FROM procurement.suppliers s
            WHERE sc.id = :subcontractor_id
              AND sc.organization_id = :org_id
              AND s.id = :supplier_id
              AND s.organization_id = :org_id
        """),
        {"org_id": org_id, "supplier_id": supplier_id, "subcontractor_id": subcontractor_id},
    )


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

    # issue_portal_login isn't a procurement.suppliers column - safe_payload_columns
    # only strips RESERVED_MUTATION_COLUMNS (id/org_id/etc.), not unknown
    # columns, so it must be popped out here or it leaks into the raw INSERT.
    issue_portal_login = bool(payload.pop("issue_portal_login", False))

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

        # Always bridge into crm.subcontractors, regardless of whether a
        # portal login is also requested - suppliers registered here were
        # previously invisible to the HR vendor-verification queue, which
        # only reads crm.subcontractors. Mirrors crm.py's create_subcontractor,
        # which already bridges unconditionally the other direction.
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
        try:
            await run_system_verification_check(
                db, org_id=user["org_id"], subcontractor_id=str(subcontractor_id)
            )
        except Exception:
            logger.exception(
                "System verification check failed for newly created subcontractor",
                subcontractor_id=str(subcontractor_id),
            )

        temp_password = None
        if issue_portal_login:
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
    safe_keys = [
        key for key in safe_payload_columns(payload.keys()) if key in SUPPLIER_EDIT_COLUMNS
    ]

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

        await sync_supplier_subcontractor_bridge(
            db, org_id=user["org_id"], user_id=user["sub"], supplier_id=item_id
        )
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


@router.post("/{item_id}/portal-login")
async def issue_supplier_portal_login(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_records.update")),
):
    if not await user_has_permission(db, user, "settings.update"):
        raise HTTPException(
            status_code=403,
            detail="Issuing supplier portal logins requires settings.update.",
        )

    supplier_row = await db.execute(
        text("""
            SELECT supplier_name, primary_contact_name, primary_contact_email
            FROM procurement.suppliers
            WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
        """),
        {"item_id": item_id, "org_id": user["org_id"]},
    )
    supplier = supplier_row.first()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier_data = dict(supplier._mapping)
    email = supplier_data.get("primary_contact_email")
    if not email:
        raise HTTPException(
            status_code=422,
            detail="Add a primary contact email before issuing supplier portal login details.",
        )

    try:
        subcontractor_id = await ensure_supplier_subcontractor_bridge(
            db, org_id=user["org_id"], user_id=user["sub"], supplier_id=item_id
        )
        portal_user_id, temp_password = await provision_portal_user(
            db,
            org_id=user["org_id"],
            email=email,
            full_name=supplier_data.get("primary_contact_name")
            or supplier_data.get("supplier_name")
            or "Supplier contact",
            account_type="supplier",
        )
        await db.execute(
            text("""
                INSERT INTO crm.supplier_portal_access (user_id, organization_id, subcontractor_id, is_active)
                VALUES (:user_id, :org_id, :subcontractor_id, true)
                ON CONFLICT (user_id, organization_id) DO UPDATE SET
                    subcontractor_id=EXCLUDED.subcontractor_id, is_active=true, updated_at=NOW()
            """),
            {
                "user_id": portal_user_id,
                "org_id": user["org_id"],
                "subcontractor_id": subcontractor_id,
            },
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Portal login could not be issued: {str(e)}")

    return {
        "success": True,
        "data": {
            "id": item_id,
            "email": email,
            "temporary_password": temp_password,
            "portal_path": "/portal/supplier",
        },
        "message": "Supplier portal login issued.",
        "meta": {},
    }


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
