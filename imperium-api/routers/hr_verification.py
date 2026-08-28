"""HR vendor verification queue.

Two-stage verification for supplier/subcontractor portal profiles
(crm.subcontractors): a deterministic "system" check runs when the vendor
submits their profile for review (see routers/portals.py,
POST /portals/supplier/profile/submit-for-review), and this router exposes
the manual second stage - an HR reviewer approving or rejecting a profile
that has already passed the system check. Only hr_verified vendors are
treated as eligible counterparties for new payment requests.
"""
from __future__ import annotations

import json
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_event, emit_notification, emit_role_notification
from app.shared.pagination import ok
from app.shared.vendor_verification import normalize_compliance_category, run_system_verification_check
from core.database import get_db, supabase
from core.security import SUPERADMIN_ROLE, get_current_user, require_permission

router = APIRouter()

DOCUMENTS_BUCKET = "documents"
SIGNED_URL_TTL_SECONDS = 300
SUPPLIER_COMPLIANCE_DOCUMENT_TYPES = {
    "tax_clearance": "Tax Clearance",
    "nssa": "NSSA",
    "praz": "PRAZ",
    "vat": "VAT",
    "company_registration": "Company Registration",
}

VENDOR_PROFILE_FIELD_LABELS = {
    "name": "Company name",
    "registration_number": "Registration number",
    "tax_clearance_number": "Tax / clearance number",
    "nssa_number": "NSSA number",
    "praz_number": "PRAZ number",
    "contact_name": "Primary contact",
    "contact_email": "Primary contact email",
    "contact_phone": "Primary contact phone",
    "address": "Address",
    "preferred_contact_method": "Preferred contact method",
    "alternate_contact_name": "Alternate contact",
    "alternate_contact_email": "Alternate contact email",
    "alternate_contact_phone": "Alternate contact phone",
    "accounts_contact_email": "Accounts contact email",
    "accounts_contact_phone": "Accounts contact phone",
}


class VendorVerificationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    decision: str = Field(pattern=r"^(approve|reject)$")
    notes: Optional[str] = Field(default=None, max_length=1000)


class VendorVerificationExceptionAccept(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    notes: Optional[str] = Field(default=None, max_length=1000)


class VendorDocumentDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    status: str = Field(pattern=r"^(verified|rejected|needs_update|pending_review)$")
    review_notes: Optional[str] = Field(default=None, max_length=1000)


async def _supplier_compliance_documents_available(db: AsyncSession) -> bool:
    row = (
        await db.execute(
            text("SELECT to_regclass('procurement.supplier_compliance_documents') IS NOT NULL AS exists")
        )
    ).mappings().first()
    return bool(row and row["exists"])


def _value_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


async def _vendor_missing_onboarding_items(
    db: AsyncSession, *, org_id: str, subcontractor_id: str, linked_supplier_id: Optional[str]
) -> list[str]:
    profile_row = (
        await db.execute(
            text("""
                SELECT
                    COALESCE(NULLIF(s.name, ''), NULLIF(ps.supplier_name, ''), NULLIF(ps.trading_name, '')) AS name,
                    COALESCE(NULLIF(s.registration_number, ''), NULLIF(ps.registration_number, ''), NULLIF(s.submission_data->>'registration_number', ''), NULLIF(s.submission_data->>'company_registration_number', '')) AS registration_number,
                    COALESCE(NULLIF(s.tax_clearance_number, ''), NULLIF(ps.tax_number, ''), NULLIF(s.submission_data->>'tax_clearance_number', ''), NULLIF(s.submission_data->>'tax_number', ''), NULLIF(s.submission_data->>'zimra_number', '')) AS tax_clearance_number,
                    COALESCE(NULLIF(s.nssa_number, ''), NULLIF(ps.nssa_number, ''), NULLIF(s.submission_data->>'nssa_number', '')) AS nssa_number,
                    COALESCE(NULLIF(s.praz_number, ''), NULLIF(ps.praz_number, ''), NULLIF(s.submission_data->>'praz_number', '')) AS praz_number,
                    COALESCE(NULLIF(s.contact_name, ''), NULLIF(ps.primary_contact_name, ''), NULLIF(s.submission_data->>'contact_name', ''), NULLIF(s.submission_data->>'primary_contact_name', '')) AS contact_name,
                    COALESCE(NULLIF(s.contact_email, ''), NULLIF(ps.primary_contact_email, ''), NULLIF(s.submission_data->>'contact_email', ''), NULLIF(s.submission_data->>'primary_contact_email', ''), NULLIF(s.submission_data->>'alternate_contact_email', ''), NULLIF(s.submission_data->>'accounts_contact_email', '')) AS contact_email,
                    COALESCE(NULLIF(s.contact_phone, ''), NULLIF(ps.primary_contact_phone, ''), NULLIF(s.submission_data->>'contact_phone', ''), NULLIF(s.submission_data->>'primary_contact_phone', ''), NULLIF(s.submission_data->>'alternate_contact_phone', ''), NULLIF(s.submission_data->>'accounts_contact_phone', '')) AS contact_phone,
                    COALESCE(NULLIF(s.address, ''), NULLIF(ps.address, ''), NULLIF(s.submission_data->>'address', ''), NULLIF(s.submission_data->>'company_address', '')) AS address
                FROM crm.subcontractors s
                LEFT JOIN procurement.suppliers ps
                  ON ps.id = s.linked_supplier_id
                 AND ps.organization_id = s.organization_id
                 AND ps.is_deleted = false
                WHERE s.id = :id AND s.organization_id = :org_id AND s.is_deleted = false
            """),
            {"id": subcontractor_id, "org_id": org_id},
        )
    ).mappings().first()
    if not profile_row:
        raise HTTPException(status_code=404, detail="Vendor profile not found.")

    missing_items = [
        label
        for key, label in VENDOR_PROFILE_FIELD_LABELS.items()
        if key in profile_row and _value_missing(profile_row[key])
    ]
    documents = await _vendor_document_rows(
        db,
        org_id=org_id,
        subcontractor_id=subcontractor_id,
        supplier_id=linked_supplier_id,
    )
    verified_types = {
        category
        for category in (normalize_compliance_category(doc.get("document_type") or doc.get("category")) for doc in documents if doc.get("status") == "verified")
        if category
    }
    missing_items.extend(
        f"{label} document"
        for key, label in SUPPLIER_COMPLIANCE_DOCUMENT_TYPES.items()
        if key not in verified_types
    )
    return missing_items


@router.get("/queue", summary="List supplier/subcontractor profiles awaiting HR verification")
async def list_vendor_verification_queue(
    stage: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission("hr.vendor_verification.read")),
    db: AsyncSession = Depends(get_db),
):
    """Defaults to every non-terminal stage (incomplete, system_pending,
    system_verified) - not just system_verified - so vendors created
    directly by staff (which start at 'incomplete' and have no other
    trigger to move forward) are visible here instead of invisibly stuck.
    Pass an explicit stage to narrow to just one."""
    org_id = user["org_id"]
    filters = ["s.organization_id = :org_id", "s.is_deleted = false"]
    params: dict = {"org_id": org_id}
    if stage:
        filters.append("s.verification_stage = :stage")
        params["stage"] = stage
    else:
        filters.append("s.verification_stage IN ('incomplete', 'system_pending', 'system_verified')")
    where = " AND ".join(filters)
    documents_available = await _supplier_compliance_documents_available(db)
    if documents_available:
        document_count_columns = """
            COALESCE(doc_stats.total_documents, 0) AS compliance_document_count,
            COALESCE(doc_stats.verified_documents, 0) AS verified_document_count,
            COALESCE(doc_stats.pending_documents, 0) AS pending_document_count
        """
        document_count_join = """
        LEFT JOIN LATERAL (
            SELECT
                COUNT(DISTINCT scd.document_type) AS total_documents,
                COUNT(DISTINCT scd.document_type) FILTER (WHERE scd.status = 'verified') AS verified_documents,
                COUNT(DISTINCT scd.document_type) FILTER (WHERE scd.status IN ('pending_review', 'needs_update', 'rejected')) AS pending_documents
            FROM procurement.supplier_compliance_documents scd
            WHERE scd.organization_id = s.organization_id
              AND (scd.subcontractor_id = s.id OR scd.supplier_id = s.linked_supplier_id)
              AND scd.is_deleted = false
        ) doc_stats ON true
        """
    else:
        document_count_columns = """
            0::integer AS compliance_document_count,
            0::integer AS verified_document_count,
            0::integer AS pending_document_count
        """
        document_count_join = ""

    rows = await db.execute(
        text(f"""
        SELECT
            s.id,
            COALESCE(NULLIF(s.name, ''), NULLIF(ps.supplier_name, ''), NULLIF(ps.trading_name, '')) AS name,
            COALESCE(NULLIF(s.registration_number, ''), NULLIF(ps.registration_number, ''), NULLIF(s.submission_data->>'registration_number', ''), NULLIF(s.submission_data->>'company_registration_number', '')) AS registration_number,
            COALESCE(NULLIF(s.tax_clearance_number, ''), NULLIF(ps.tax_number, ''), NULLIF(s.submission_data->>'tax_clearance_number', ''), NULLIF(s.submission_data->>'tax_number', ''), NULLIF(s.submission_data->>'zimra_number', '')) AS tax_clearance_number,
            COALESCE(NULLIF(s.contact_name, ''), NULLIF(ps.primary_contact_name, ''), NULLIF(s.submission_data->>'contact_name', ''), NULLIF(s.submission_data->>'primary_contact_name', '')) AS contact_name,
            COALESCE(NULLIF(s.contact_email, ''), NULLIF(ps.primary_contact_email, ''), NULLIF(s.submission_data->>'contact_email', ''), NULLIF(s.submission_data->>'primary_contact_email', ''), NULLIF(s.submission_data->>'alternate_contact_email', ''), NULLIF(s.submission_data->>'accounts_contact_email', '')) AS contact_email,
            COALESCE(NULLIF(s.contact_phone, ''), NULLIF(ps.primary_contact_phone, ''), NULLIF(s.submission_data->>'contact_phone', ''), NULLIF(s.submission_data->>'primary_contact_phone', ''), NULLIF(s.submission_data->>'alternate_contact_phone', ''), NULLIF(s.submission_data->>'accounts_contact_phone', '')) AS contact_phone,
            s.compliance_status, s.verification_stage,
            s.system_verified_at, s.system_verification_notes,
            s.hr_verified_by, s.hr_verified_at, s.hr_verification_notes,
            s.linked_supplier_id,
            s.submission_data->>'account_type' AS account_type,
            s.submission_data->'onboarding_bypass' AS onboarding_bypass,
            COALESCE((s.submission_data->'onboarding_bypass'->>'enabled')::boolean, false) AS onboarding_bypass_enabled,
            s.submission_data->'onboarding_bypass'->>'message' AS onboarding_bypass_message,
            s.created_at,
            {document_count_columns}
        FROM crm.subcontractors s
        {document_count_join}
        LEFT JOIN procurement.suppliers ps
          ON ps.id = s.linked_supplier_id
         AND ps.organization_id = s.organization_id
         AND ps.is_deleted = false
        WHERE {where}
        ORDER BY s.system_verified_at DESC NULLS LAST, s.created_at DESC
    """),
        params,
    )
    return ok([dict(r._mapping) for r in rows], "Vendor verification queue loaded.")


@router.get("/{subcontractor_id}", summary="Get a combined supplier/subcontractor profile for HR review")
async def get_vendor_verification_detail(
    subcontractor_id: UUID,
    user: dict = Depends(require_permission("hr.vendor_verification.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    row = (
        await db.execute(
            text("""
                SELECT
                    s.id,
                    s.linked_supplier_id,
                    s.compliance_status,
                    s.verification_stage,
                    s.system_verified_at,
                    s.system_verification_notes,
                    s.hr_verified_at,
                    s.hr_verification_notes,
                    s.submission_data->>'account_type' AS account_type,
                    s.submission_data->'onboarding_bypass' AS onboarding_bypass,
                    COALESCE((s.submission_data->'onboarding_bypass'->>'enabled')::boolean, false) AS onboarding_bypass_enabled,
                    s.submission_data->'onboarding_bypass'->>'message' AS onboarding_bypass_message,
                    COALESCE(NULLIF(s.name, ''), NULLIF(ps.supplier_name, ''), NULLIF(ps.trading_name, '')) AS name,
                    COALESCE(NULLIF(s.registration_number, ''), NULLIF(ps.registration_number, ''), NULLIF(s.submission_data->>'registration_number', ''), NULLIF(s.submission_data->>'company_registration_number', '')) AS registration_number,
                    COALESCE(NULLIF(s.tax_clearance_number, ''), NULLIF(ps.tax_number, ''), NULLIF(s.submission_data->>'tax_clearance_number', ''), NULLIF(s.submission_data->>'tax_number', ''), NULLIF(s.submission_data->>'zimra_number', '')) AS tax_clearance_number,
                    COALESCE(NULLIF(s.nssa_number, ''), NULLIF(ps.nssa_number, ''), NULLIF(s.submission_data->>'nssa_number', '')) AS nssa_number,
                    COALESCE(NULLIF(s.praz_number, ''), NULLIF(ps.praz_number, ''), NULLIF(s.submission_data->>'praz_number', '')) AS praz_number,
                    COALESCE(NULLIF(s.contact_name, ''), NULLIF(ps.primary_contact_name, ''), NULLIF(s.submission_data->>'contact_name', ''), NULLIF(s.submission_data->>'primary_contact_name', '')) AS contact_name,
                    COALESCE(NULLIF(s.contact_email, ''), NULLIF(ps.primary_contact_email, ''), NULLIF(s.submission_data->>'contact_email', ''), NULLIF(s.submission_data->>'primary_contact_email', ''), NULLIF(s.submission_data->>'alternate_contact_email', ''), NULLIF(s.submission_data->>'accounts_contact_email', '')) AS contact_email,
                    COALESCE(NULLIF(s.contact_phone, ''), NULLIF(ps.primary_contact_phone, ''), NULLIF(s.submission_data->>'contact_phone', ''), NULLIF(s.submission_data->>'primary_contact_phone', ''), NULLIF(s.submission_data->>'alternate_contact_phone', ''), NULLIF(s.submission_data->>'accounts_contact_phone', '')) AS contact_phone,
                    COALESCE(NULLIF(s.address, ''), NULLIF(ps.address, ''), NULLIF(s.submission_data->>'address', ''), NULLIF(s.submission_data->>'company_address', '')) AS address,
                    s.coverage_provinces,
                    s.submission_data->>'preferred_contact_method' AS preferred_contact_method,
                    s.submission_data->>'alternate_contact_name' AS alternate_contact_name,
                    s.submission_data->>'alternate_contact_email' AS alternate_contact_email,
                    s.submission_data->>'alternate_contact_phone' AS alternate_contact_phone,
                    s.submission_data->>'accounts_contact_email' AS accounts_contact_email,
                    s.submission_data->>'accounts_contact_phone' AS accounts_contact_phone,
                    ps.supplier_name,
                    ps.trading_name,
                    ps.supplier_code,
                    ps.status AS supplier_status,
                    ps.compliance_status AS supplier_compliance_status,
                    ps.payment_terms_days,
                    ps.currency
                FROM crm.subcontractors s
                LEFT JOIN procurement.suppliers ps
                  ON ps.id = s.linked_supplier_id
                 AND ps.organization_id = s.organization_id
                 AND ps.is_deleted = false
                WHERE s.id = :id AND s.organization_id = :org_id AND s.is_deleted = false
            """),
            {"id": str(subcontractor_id), "org_id": org_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Vendor profile not found.")

    profile = dict(row)
    documents = await _vendor_document_rows(
        db,
        org_id=org_id,
        subcontractor_id=str(subcontractor_id),
        supplier_id=str(profile["linked_supplier_id"]) if profile.get("linked_supplier_id") else None,
    )
    filled_fields = [
        {"key": key, "label": label, "value": profile.get(key)}
        for key, label in VENDOR_PROFILE_FIELD_LABELS.items()
        if profile.get(key)
    ]
    return ok(
        {
            "vendor": profile,
            "filled_fields": filled_fields,
            "documents": documents,
        },
        "Vendor verification detail loaded.",
    )


async def _vendor_document_rows(
    db: AsyncSession, *, org_id: str, subcontractor_id: str, supplier_id: Optional[str]
) -> list[dict[str, Any]]:
    if not await _supplier_compliance_documents_available(db):
        return []

    rows = await db.execute(
        text("""
            SELECT DISTINCT ON (scd.document_id, scd.document_type)
                scd.id,
                scd.supplier_id,
                scd.subcontractor_id,
                scd.document_id,
                scd.document_type,
                scd.status,
                scd.uploaded_by_party,
                scd.review_notes,
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
              AND (scd.subcontractor_id = :subcontractor_id OR scd.supplier_id = :supplier_id)
              AND scd.is_deleted = false
            ORDER BY scd.document_id, scd.document_type, scd.created_at DESC
        """),
        {"org_id": org_id, "subcontractor_id": subcontractor_id, "supplier_id": supplier_id},
    )
    return [dict(row._mapping) for row in rows]


@router.get("/{subcontractor_id}/documents", summary="List compliance documents attached to a vendor profile")
async def list_vendor_documents_for_review(
    subcontractor_id: UUID,
    user: dict = Depends(require_permission("supplier_compliance_documents.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    vendor = (
        await db.execute(
            text("""
                SELECT id, linked_supplier_id
                FROM crm.subcontractors
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": str(subcontractor_id), "org_id": org_id},
        )
    ).mappings().first()
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor profile not found.")
    items = await _vendor_document_rows(
        db,
        org_id=org_id,
        subcontractor_id=str(subcontractor_id),
        supplier_id=str(vendor["linked_supplier_id"]) if vendor["linked_supplier_id"] else None,
    )
    return ok(items, "Vendor compliance documents loaded.")


@router.get("/{subcontractor_id}/documents/{document_id}/signed-url")
async def get_vendor_document_signed_url_for_review(
    subcontractor_id: UUID,
    document_id: UUID,
    user: dict = Depends(require_permission("supplier_compliance_documents.read")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
                SELECT fa.storage_path, fa.mime_type, fa.file_name
                FROM procurement.supplier_compliance_documents scd
                JOIN crm.subcontractors s
                  ON s.organization_id = scd.organization_id
                 AND s.id = :subcontractor_id
                 AND s.is_deleted = false
                JOIN core.documents d
                  ON d.id = scd.document_id
                 AND d.organization_id = scd.organization_id
                 AND d.is_deleted = false
                JOIN core.file_attachments fa
                  ON fa.id = d.file_attachment_id
                 AND fa.is_deleted = false
                WHERE scd.organization_id = :org_id
                  AND (scd.subcontractor_id = s.id OR scd.supplier_id = s.linked_supplier_id)
                  AND scd.document_id = :document_id
                  AND scd.is_deleted = false
                LIMIT 1
            """),
            {"org_id": user["org_id"], "subcontractor_id": str(subcontractor_id), "document_id": str(document_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Vendor document not found.")
    try:
        signed = supabase.storage.from_(DOCUMENTS_BUCKET).create_signed_url(
            row["storage_path"], SIGNED_URL_TTL_SECONDS
        )
    except Exception:
        raise HTTPException(status_code=502, detail="Could not generate a view link for this file. Try again.")
    signed_url = signed.get("signedURL")
    if not signed_url:
        raise HTTPException(status_code=502, detail="Could not generate a view link for this file. Try again.")
    return ok(
        {
            "url": signed_url,
            "file_name": row["file_name"],
            "mime_type": row["mime_type"],
            "expires_in": SIGNED_URL_TTL_SECONDS,
        },
        "Document view link generated.",
    )


@router.post("/{subcontractor_id}/documents/{document_id}/decision")
async def decide_vendor_document_for_review(
    subcontractor_id: UUID,
    document_id: UUID,
    payload: VendorDocumentDecision,
    user: dict = Depends(require_permission("supplier_compliance_documents.verify")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
                UPDATE procurement.supplier_compliance_documents scd
                SET status = :status,
                    review_notes = :review_notes,
                    reviewed_by = :user_id,
                    reviewed_at = NOW(),
                    updated_at = NOW()
                FROM crm.subcontractors s
                WHERE scd.organization_id = :org_id
                  AND s.organization_id = scd.organization_id
                  AND s.id = :subcontractor_id
                  AND s.is_deleted = false
                  AND (scd.subcontractor_id = s.id OR scd.supplier_id = s.linked_supplier_id)
                  AND scd.document_id = :document_id
                  AND scd.is_deleted = false
                RETURNING scd.id, scd.document_type
            """),
            {
                "org_id": user["org_id"],
                "subcontractor_id": str(subcontractor_id),
                "document_id": str(document_id),
                "status": payload.status,
                "review_notes": payload.review_notes,
                "user_id": user["user_id"],
            },
        )
    ).first()
    if not row:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Vendor document not found.")
    if payload.status in {"rejected", "needs_update"}:
        await db.execute(
            text("""
                UPDATE crm.subcontractors
                SET verification_stage = 'incomplete',
                    system_verified_at = NULL,
                    hr_verified_at = NULL,
                    updated_at = NOW()
                WHERE id = :subcontractor_id AND organization_id = :org_id
            """),
            {"org_id": user["org_id"], "subcontractor_id": str(subcontractor_id)},
        )
    await db.commit()
    return ok(
        {"id": str(row.id), "document_type": row.document_type, "status": payload.status},
        "Vendor document decision recorded.",
    )


@router.post(
    "/{subcontractor_id}/run-system-check",
    summary="Run the deterministic profile/document check for a vendor that hasn't gone through the supplier portal",
)
async def run_vendor_system_check(
    subcontractor_id: UUID,
    user: dict = Depends(require_permission("hr.vendor_verification.read")),
    db: AsyncSession = Depends(get_db),
):
    """Vendors created directly by staff (crm.py, supplier_records.py) start
    at verification_stage='incomplete' with no other way to reach
    'system_verified' since the automated check otherwise only runs from
    the vendor's own portal self-service action. This lets HR run it
    on-demand instead."""
    try:
        outcome = await run_system_verification_check(
            db, org_id=user["org_id"], subcontractor_id=str(subcontractor_id)
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    await db.commit()
    return ok(outcome, "System verification check complete.")


@router.post("/{subcontractor_id}/decision", summary="Approve or reject a system-verified vendor profile")
async def decide_vendor_verification(
    subcontractor_id: UUID,
    payload: VendorVerificationDecision,
    user: dict = Depends(require_permission("hr.vendor_verification.decide")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    row = (
        await db.execute(
            text("""
            SELECT id, name, verification_stage FROM crm.subcontractors
            WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
            {"id": str(subcontractor_id), "org_id": org_id},
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Vendor profile not found.")
    if row.verification_stage != "system_verified":
        raise HTTPException(
            status_code=409,
            detail=f"Profile must be 'system_verified' before HR review. Currently '{row.verification_stage}'.",
        )
    if payload.decision == "reject" and not payload.notes:
        raise HTTPException(status_code=422, detail="A reason is required to reject a vendor profile.")

    if payload.decision == "approve":
        docs = await db.execute(
            text("""
                SELECT document_type, status
                FROM procurement.supplier_compliance_documents scd
                JOIN crm.subcontractors s
                  ON s.organization_id = scd.organization_id
                 AND s.id = :subcontractor_id
                 AND s.is_deleted = false
                 AND (scd.subcontractor_id = s.id OR scd.supplier_id = s.linked_supplier_id)
                WHERE scd.organization_id = :org_id
                  AND scd.is_deleted = false
            """),
            {"org_id": org_id, "subcontractor_id": str(subcontractor_id)},
        )
        verified_types = {
            category
            for category in (normalize_compliance_category(doc.document_type) for doc in docs if doc.status == "verified")
            if category
        }
        missing_verified = [
            label
            for key, label in SUPPLIER_COMPLIANCE_DOCUMENT_TYPES.items()
            if key not in verified_types
        ]
        if missing_verified:
            raise HTTPException(
                status_code=409,
                detail="Verify these documents before approving the vendor: " + ", ".join(missing_verified),
            )

    new_stage = "hr_verified" if payload.decision == "approve" else "rejected"
    await db.execute(
        text("""
        UPDATE crm.subcontractors
        SET verification_stage = :stage,
            hr_verified_by = :user_id,
            hr_verified_at = NOW(),
            hr_verification_notes = :notes,
            updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {
            "stage": new_stage,
            "user_id": user["user_id"],
            "notes": payload.notes,
            "id": str(subcontractor_id),
            "org_id": org_id,
        },
    )

    portal_users = await db.execute(
        text("""
        SELECT user_id FROM crm.supplier_portal_access
        WHERE subcontractor_id = :id AND organization_id = :org_id AND is_active = true
    """),
        {"id": str(subcontractor_id), "org_id": org_id},
    )
    title = "Profile verified" if payload.decision == "approve" else "Profile verification rejected"
    message = (
        f"Your AEGIS vendor profile has been verified by HR."
        if payload.decision == "approve"
        else f"Your AEGIS vendor profile verification was rejected: {payload.notes}"
    )
    for portal_user in portal_users:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(portal_user.user_id),
            title=title,
            message=message,
            notification_type="vendor_verification",
            action_url="/portal/supplier",
        )

    await db.commit()
    return ok({"id": str(subcontractor_id), "verification_stage": new_stage}, "Vendor verification decision recorded.")


@router.post("/{subcontractor_id}/accept-with-gaps", summary="Accept a vendor while flagging incomplete onboarding")
async def accept_vendor_with_onboarding_gaps(
    subcontractor_id: UUID,
    payload: VendorVerificationExceptionAccept,
    user: dict = Depends(require_permission("hr.vendor_verification.decide")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    row = (
        await db.execute(
            text("""
            SELECT s.id, s.name, s.linked_supplier_id, s.submission_data, s.submission_data->>'account_type' AS account_type,
                   u.full_name AS actor_name, u.email AS actor_email
            FROM crm.subcontractors s
            LEFT JOIN core.users u
              ON u.id = :user_id
             AND u.organization_id = s.organization_id
             AND u.is_deleted = false
            WHERE s.id = :id AND s.organization_id = :org_id AND s.is_deleted = false
        """),
            {"id": str(subcontractor_id), "org_id": org_id, "user_id": user["user_id"]},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Vendor profile not found.")

    missing_items = await _vendor_missing_onboarding_items(
        db,
        org_id=org_id,
        subcontractor_id=str(subcontractor_id),
        linked_supplier_id=str(row["linked_supplier_id"]) if row.get("linked_supplier_id") else None,
    )
    actor_name = row.get("actor_name") or row.get("actor_email") or user.get("email") or str(user["user_id"])
    bypass_metadata = {
        "enabled": True,
        "accepted_by": user["user_id"],
        "accepted_by_name": actor_name,
        "accepted_at": "__NOW__",
        "missing_items": missing_items,
        "notes": payload.notes,
        "message": "Vendor was accepted before onboarding was complete. Complete onboarding properly before relying on this vendor as fully compliant.",
    }

    await db.execute(
        text("""
        UPDATE crm.subcontractors
        SET verification_stage = 'hr_verified',
            hr_verified_by = :user_id,
            hr_verified_at = NOW(),
            hr_verification_notes = :notes,
            submission_data = COALESCE(submission_data, '{}'::jsonb)
                || jsonb_build_object(
                    'account_type', COALESCE(submission_data->>'account_type', :account_type, 'vendor'),
                    'onboarding_bypass', jsonb_build_object(
                        'enabled', true,
                        'accepted_by', :user_id,
                        'accepted_by_name', :actor_name,
                        'accepted_at', NOW(),
                        'missing_items', CAST(:missing_items AS jsonb),
                        'notes', :notes,
                        'message', 'Vendor was accepted before onboarding was complete. Complete onboarding properly before relying on this vendor as fully compliant.'
                    )
                ),
            updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {
            "user_id": user["user_id"],
            "actor_name": actor_name,
            "notes": payload.notes or "Accepted with incomplete onboarding.",
            "missing_items": json.dumps(missing_items),
            "account_type": row.get("account_type"),
            "id": str(subcontractor_id),
            "org_id": org_id,
        },
    )

    if row.get("linked_supplier_id"):
        await db.execute(
            text("""
            UPDATE procurement.suppliers
            SET status = 'active',
                updated_at = NOW()
            WHERE id = :supplier_id AND organization_id = :org_id AND is_deleted = false
        """),
            {"supplier_id": str(row["linked_supplier_id"]), "org_id": org_id},
        )

    await emit_role_notification(
        db,
        org_id=org_id,
        role_names=[SUPERADMIN_ROLE],
        title="Vendor accepted with onboarding gaps",
        message=f"{actor_name} accepted {row['name']} while onboarding is incomplete: {', '.join(missing_items) if missing_items else 'no gaps were reported'}.",
        notification_type="vendor_onboarding_bypass",
        priority="urgent",
        action_url="/dashboard/hr?tab=vendor-verification",
        metadata={
            "subcontractor_id": str(subcontractor_id),
            "linked_supplier_id": str(row["linked_supplier_id"]) if row.get("linked_supplier_id") else None,
            "accepted_by": user["user_id"],
            "accepted_by_name": actor_name,
            "missing_items": missing_items,
        },
    )
    await emit_event(
        db,
        user=user,
        event_type="vendor.onboarding_bypass.accepted.v1",
        aggregate_type="vendor",
        aggregate_id=str(subcontractor_id),
        event_data={
            "vendor_name": row["name"],
            "linked_supplier_id": str(row["linked_supplier_id"]) if row.get("linked_supplier_id") else None,
            "accepted_by": user["user_id"],
            "accepted_by_name": actor_name,
            "missing_items": missing_items,
            "notes": payload.notes,
        },
        idempotency_suffix=f"{user['user_id']}",
    )

    portal_users = await db.execute(
        text("""
        SELECT user_id FROM crm.supplier_portal_access
        WHERE subcontractor_id = :id AND organization_id = :org_id AND is_active = true
    """),
        {"id": str(subcontractor_id), "org_id": org_id},
    )
    for portal_user in portal_users:
        await emit_notification(
            db,
            org_id=org_id,
            user_id=str(portal_user.user_id),
            title="Vendor profile accepted with required follow-up",
            message="Your vendor profile has been accepted, but onboarding is still incomplete. Please upload or update the missing information before further work is processed as fully compliant.",
            notification_type="vendor_verification",
            priority="high",
            action_url="/portal/supplier",
            metadata={"missing_items": missing_items},
        )

    await db.commit()
    return ok(
        {
            "id": str(subcontractor_id),
            "verification_stage": "hr_verified",
            "onboarding_bypass": {
                key: value for key, value in bypass_metadata.items() if key != "accepted_at"
            },
        },
        "Vendor accepted with onboarding gaps flagged.",
    )
