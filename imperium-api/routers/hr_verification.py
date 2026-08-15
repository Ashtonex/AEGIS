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

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification
from app.shared.pagination import ok
from core.database import get_db
from core.security import get_current_user, require_permission

router = APIRouter()


class VendorVerificationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    decision: str = Field(pattern=r"^(approve|reject)$")
    notes: Optional[str] = Field(default=None, max_length=1000)


@router.get("/queue", summary="List supplier/subcontractor profiles awaiting HR verification")
async def list_vendor_verification_queue(
    stage: Optional[str] = Query(default="system_verified"),
    user: dict = Depends(require_permission("hr.vendor_verification.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    filters = ["s.organization_id = :org_id", "s.is_deleted = false"]
    params: dict = {"org_id": org_id}
    if stage:
        filters.append("s.verification_stage = :stage")
        params["stage"] = stage
    where = " AND ".join(filters)

    rows = await db.execute(
        text(f"""
        SELECT
            s.id, s.name, s.registration_number, s.tax_clearance_number,
            s.contact_name, s.contact_email, s.contact_phone,
            s.compliance_status, s.verification_stage,
            s.system_verified_at, s.system_verification_notes,
            s.hr_verified_by, s.hr_verified_at, s.hr_verification_notes,
            s.submission_data->>'account_type' AS account_type,
            s.created_at
        FROM crm.subcontractors s
        WHERE {where}
        ORDER BY s.system_verified_at DESC NULLS LAST, s.created_at DESC
    """),
        params,
    )
    return ok([dict(r._mapping) for r in rows], "Vendor verification queue loaded.")


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
