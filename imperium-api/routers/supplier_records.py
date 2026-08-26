from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field

from core.database import get_db, supabase
from core.security import get_current_user, require_permission, user_has_permission
from app.shared.events import emit_role_notification
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
    "address",
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

DOCUMENTS_BUCKET = "documents"
SIGNED_URL_TTL_SECONDS = 300

SUPPLIER_COMPLIANCE_DOCUMENT_TYPES = {
    "tax_clearance": "Tax Clearance",
    "nssa": "NSSA",
    "praz": "PRAZ",
    "vat": "VAT",
    "company_registration": "Company Registration",
}


class SupplierComplianceDocumentRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    document_id: UUID
    document_type: str = Field(pattern=r"^(tax_clearance|nssa|praz|vat|company_registration)$")


class SupplierComplianceDocumentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: str = Field(pattern=r"^(verified|rejected|needs_update|pending_review)$")
    review_notes: Optional[str] = Field(default=None, max_length=1000)


async def _supplier_exists(db: AsyncSession, *, org_id: str, supplier_id: str) -> dict:
    row = (
        await db.execute(
            text("""
                SELECT id, supplier_name, primary_contact_email
                FROM procurement.suppliers
                WHERE id = :supplier_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"org_id": org_id, "supplier_id": supplier_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return dict(row)


async def _supplier_document_rows(db: AsyncSession, *, org_id: str, supplier_id: str) -> list[dict]:
    rows = await db.execute(
        text("""
            SELECT
                scd.id,
                scd.supplier_id,
                scd.subcontractor_id,
                scd.document_id,
                scd.document_type,
                scd.status,
                scd.uploaded_by_party,
                scd.review_notes,
                scd.reviewed_by,
                scd.reviewed_at,
                scd.created_at,
                d.title,
                d.category,
                d.expiry_date,
                d.file_name,
                d.file_size_bytes,
                fa.mime_type,
                u.full_name AS reviewed_by_name
            FROM procurement.supplier_compliance_documents scd
            JOIN core.documents d
              ON d.id = scd.document_id
             AND d.organization_id = scd.organization_id
             AND d.is_deleted = false
            LEFT JOIN core.file_attachments fa
              ON fa.id = d.file_attachment_id
             AND fa.is_deleted = false
            LEFT JOIN core.users u
              ON u.id = scd.reviewed_by
             AND u.organization_id = scd.organization_id
             AND u.is_deleted = false
            WHERE scd.organization_id = :org_id
              AND scd.supplier_id = :supplier_id
              AND scd.is_deleted = false
            ORDER BY scd.document_type ASC, scd.created_at DESC
        """),
        {"org_id": org_id, "supplier_id": supplier_id},
    )
    return [dict(row._mapping) for row in rows]


async def _signed_url_for_supplier_document(
    db: AsyncSession, *, org_id: str, supplier_id: str, document_id: str
) -> dict:
    row = (
        await db.execute(
            text("""
                SELECT fa.storage_path, fa.mime_type, fa.file_name
                FROM procurement.supplier_compliance_documents scd
                JOIN core.documents d
                  ON d.id = scd.document_id
                 AND d.organization_id = scd.organization_id
                 AND d.is_deleted = false
                JOIN core.file_attachments fa
                  ON fa.id = d.file_attachment_id
                 AND fa.is_deleted = false
                WHERE scd.organization_id = :org_id
                  AND scd.supplier_id = :supplier_id
                  AND scd.document_id = :document_id
                  AND scd.is_deleted = false
                LIMIT 1
            """),
            {"org_id": org_id, "supplier_id": supplier_id, "document_id": document_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Supplier document not found.")
    try:
        signed = supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            row["storage_path"], SIGNED_URL_TTL_SECONDS
        )
    except Exception:
        logger.exception("Failed to create signed URL for supplier document", document_id=document_id)
        raise HTTPException(status_code=502, detail="Could not generate a view link for this file. Try again.")
    signed_url = signed.get("signedURL")
    if not signed_url:
        raise HTTPException(status_code=502, detail="Could not generate a view link for this file. Try again.")
    return {
        "url": signed_url,
        "file_name": row["file_name"],
        "mime_type": row["mime_type"],
        "expires_in": SIGNED_URL_TTL_SECONDS,
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
            SELECT supplier_name, trading_name, registration_number, tax_number, praz_number, nssa_number, address,
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
                praz_number, nssa_number, address, contact_name, contact_email, contact_phone,
                compliance_status, linked_supplier_id, submission_data
            )
            VALUES (
                :org_id, :user_id, :name, :registration_number, :tax_clearance_number,
                :praz_number, :nssa_number, :address, :contact_name, :contact_email, :contact_phone,
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
            "address": data.get("address"),
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
                address = COALESCE(s.address, sc.address),
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
                    organization_id, created_by, name, registration_number, tax_clearance_number,
                    praz_number, nssa_number, address, contact_name, contact_email, contact_phone,
                    compliance_status, linked_supplier_id
                )
                VALUES (
                    :org_id, :user_id, :name, :registration_number, :tax_clearance_number,
                    :praz_number, :nssa_number, :address, :contact_name, :contact_email, :contact_phone,
                    :compliance_status, :supplier_id
                )
                RETURNING id
            """),
            {
                "org_id": user["org_id"],
                "user_id": user["sub"],
                "name": payload.get("supplier_name") or payload.get("primary_contact_name"),
                "registration_number": payload.get("registration_number"),
                "tax_clearance_number": payload.get("tax_number"),
                "praz_number": payload.get("praz_number"),
                "nssa_number": payload.get("nssa_number"),
                "address": payload.get("address"),
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


@router.get("/{item_id}/documents")
async def list_supplier_compliance_documents(
    item_id: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_compliance_documents.read")),
):
    await _supplier_exists(db, org_id=user["org_id"], supplier_id=item_id)
    items = await _supplier_document_rows(db, org_id=user["org_id"], supplier_id=item_id)
    return {
        "success": True,
        "data": items,
        "message": "Supplier compliance documents loaded.",
        "meta": {"required": list(SUPPLIER_COMPLIANCE_DOCUMENT_TYPES.keys()), "total": len(items)},
    }


@router.post("/{item_id}/documents", status_code=status.HTTP_201_CREATED)
async def record_supplier_compliance_document(
    item_id: str,
    payload: SupplierComplianceDocumentRecord,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_compliance_documents.upload")),
):
    supplier = await _supplier_exists(db, org_id=user["org_id"], supplier_id=item_id)
    doc_row = (
        await db.execute(
            text("""
                SELECT id FROM core.documents
                WHERE id = :document_id AND organization_id = :org_id AND is_deleted = false
            """),
            {"document_id": str(payload.document_id), "org_id": user["org_id"]},
        )
    ).first()
    if not doc_row:
        raise HTTPException(status_code=404, detail="Document not found.")

    try:
        subcontractor_id = await ensure_supplier_subcontractor_bridge(
            db, org_id=user["org_id"], user_id=user["sub"], supplier_id=item_id
        )
        await db.execute(
            text("""
                UPDATE core.documents
                SET category = :document_type, updated_at = NOW()
                WHERE id = :document_id AND organization_id = :org_id
            """),
            {"org_id": user["org_id"], "document_id": str(payload.document_id), "document_type": payload.document_type},
        )
        for entity_type, entity_id in (("supplier", item_id), ("subcontractor", subcontractor_id)):
            await db.execute(
                text("""
                    INSERT INTO core.document_links (
                        organization_id, document_id, entity_type, entity_id, link_role, linked_by
                    ) VALUES (
                        :org_id, :document_id, :entity_type, :entity_id, :document_type, :user_id
                    )
                    ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
                """),
                {
                    "org_id": user["org_id"],
                    "document_id": str(payload.document_id),
                    "entity_type": entity_type,
                    "entity_id": entity_id,
                    "document_type": payload.document_type,
                    "user_id": user["user_id"],
                },
            )
        await db.execute(
            text("""
                INSERT INTO procurement.supplier_compliance_documents (
                    organization_id, supplier_id, subcontractor_id, document_id, document_type,
                    uploaded_by_party, status, created_by
                ) VALUES (
                    :org_id, :supplier_id, :subcontractor_id, :document_id, :document_type,
                    'staff', 'pending_review', :user_id
                )
                ON CONFLICT (organization_id, document_id, document_type) DO UPDATE SET
                    supplier_id = EXCLUDED.supplier_id,
                    subcontractor_id = EXCLUDED.subcontractor_id,
                    status = 'pending_review',
                    uploaded_by_party = 'staff',
                    review_notes = NULL,
                    reviewed_by = NULL,
                    reviewed_at = NULL,
                    is_deleted = false,
                    updated_at = NOW()
            """),
            {
                "org_id": user["org_id"],
                "supplier_id": item_id,
                "subcontractor_id": subcontractor_id,
                "document_id": str(payload.document_id),
                "document_type": payload.document_type,
                "user_id": user["user_id"],
            },
        )
        await db.execute(
            text("""
                UPDATE crm.subcontractors
                SET verification_stage = 'incomplete',
                    system_verified_at = NULL,
                    hr_verified_at = NULL,
                    updated_at = NOW()
                WHERE id = :subcontractor_id AND organization_id = :org_id
            """),
            {"org_id": user["org_id"], "subcontractor_id": subcontractor_id},
        )
        await emit_role_notification(
            db,
            org_id=user["org_id"],
            role_names=["HR Manager", "HR Officer"],
            title="Supplier document ready for review",
            message=f"{supplier['supplier_name']} has a new {SUPPLIER_COMPLIANCE_DOCUMENT_TYPES[payload.document_type]} document awaiting verification.",
            notification_type="supplier_compliance_document",
            action_url="/dashboard/hr?tab=vendor-verification",
            metadata={"supplier_id": item_id, "document_id": str(payload.document_id), "document_type": payload.document_type},
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Supplier document could not be recorded: {str(e)}")

    items = await _supplier_document_rows(db, org_id=user["org_id"], supplier_id=item_id)
    return {
        "success": True,
        "data": items,
        "message": "Supplier compliance document recorded.",
        "meta": {"total": len(items)},
    }


@router.get("/{item_id}/documents/{document_id}/signed-url")
async def get_supplier_compliance_document_signed_url(
    item_id: str,
    document_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_compliance_documents.read")),
):
    await _supplier_exists(db, org_id=user["org_id"], supplier_id=item_id)
    data = await _signed_url_for_supplier_document(
        db, org_id=user["org_id"], supplier_id=item_id, document_id=str(document_id)
    )
    return {"success": True, "data": data, "message": "Document view link generated.", "meta": {}}


@router.post("/{item_id}/documents/{document_id}/decision")
async def decide_supplier_compliance_document(
    item_id: str,
    document_id: UUID,
    payload: SupplierComplianceDocumentDecision,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("supplier_compliance_documents.verify")),
):
    await _supplier_exists(db, org_id=user["org_id"], supplier_id=item_id)
    row = (
        await db.execute(
            text("""
                UPDATE procurement.supplier_compliance_documents
                SET status = :status,
                    review_notes = :review_notes,
                    reviewed_by = :user_id,
                    reviewed_at = NOW(),
                    updated_at = NOW()
                WHERE organization_id = :org_id
                  AND supplier_id = :supplier_id
                  AND document_id = :document_id
                  AND is_deleted = false
                RETURNING id, document_type, subcontractor_id
            """),
            {
                "org_id": user["org_id"],
                "supplier_id": item_id,
                "document_id": str(document_id),
                "status": payload.status,
                "review_notes": payload.review_notes,
                "user_id": user["user_id"],
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Supplier document not found.")
    if payload.status in {"rejected", "needs_update"} and row.subcontractor_id:
        await db.execute(
            text("""
                UPDATE crm.subcontractors
                SET verification_stage = 'incomplete',
                    system_verified_at = NULL,
                    hr_verified_at = NULL,
                    updated_at = NOW()
                WHERE id = :subcontractor_id AND organization_id = :org_id
            """),
            {"org_id": user["org_id"], "subcontractor_id": str(row.subcontractor_id)},
        )
    await db.commit()
    return {
        "success": True,
        "data": {"id": str(row.id), "document_type": row.document_type, "status": payload.status},
        "message": "Supplier document decision recorded.",
        "meta": {},
    }


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
