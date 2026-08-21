"""Shared vendor/subcontractor system-verification check.

Two-stage verification for crm.subcontractors: this module runs the
deterministic "system" check (required profile fields + required
compliance documents present and unexpired) - no human judgment involved.
routers/hr_verification.py exposes the manual second stage on top of it.

Originally this only ran from the supplier portal's self-service
"submit for review" action (routers/portals.py), which left subcontractors
created directly by staff (routers/crm.py, routers/supplier_records.py)
stuck at the 'incomplete' default forever - there was no other trigger to
move them along. This function is reusable so both the portal's
self-service flow and a staff-triggered check (routers/hr_verification.py)
share one implementation.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_role_notification

REQUIRED_VENDOR_PROFILE_FIELDS = (
    "registration_number", "tax_clearance_number", "nssa_number",
    "contact_name", "contact_email", "contact_phone", "address",
)
REQUIRED_COMPLIANCE_CATEGORIES = ("registration_certificate", "tax_clearance")


async def run_system_verification_check(
    db: AsyncSession, *, org_id: str, subcontractor_id: str
) -> dict[str, Any]:
    """Runs the deterministic profile/document check for one subcontractor
    and persists the resulting verification_stage. Returns the outcome so
    callers can render it without a second query."""
    profile_row = (
        await db.execute(
            text("""
            SELECT name, registration_number, tax_clearance_number, nssa_number,
                   contact_name, contact_email, contact_phone, address
            FROM crm.subcontractors WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        """),
            {"id": subcontractor_id, "org_id": org_id},
        )
    ).first()
    if not profile_row:
        raise ValueError("Subcontractor not found.")

    missing = [f for f in REQUIRED_VENDOR_PROFILE_FIELDS if not getattr(profile_row, f, None)]

    doc_rows = await db.execute(
        text("""
        SELECT d.category, d.expiry_date
        FROM core.document_links dl
        JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id AND d.is_deleted = false
        WHERE dl.organization_id = :org_id AND dl.entity_type = 'subcontractor' AND dl.entity_id = :id
          AND dl.link_role = 'compliance' AND dl.is_deleted = false
    """),
        {"org_id": org_id, "id": subcontractor_id},
    )
    docs = [dict(r._mapping) for r in doc_rows]
    present_categories = {d["category"] for d in docs if d["category"]}
    missing_categories = [c for c in REQUIRED_COMPLIANCE_CATEGORIES if c not in present_categories]
    expired = [d["category"] for d in docs if d["expiry_date"] and d["expiry_date"] < date.today()]

    problems: list[str] = []
    if missing:
        problems.append("Missing profile fields: " + ", ".join(missing))
    if missing_categories:
        problems.append("Missing compliance documents: " + ", ".join(missing_categories))
    if expired:
        problems.append("Expired compliance documents: " + ", ".join(expired))

    if problems:
        await db.execute(
            text("""
            UPDATE crm.subcontractors
            SET verification_stage = 'system_pending', system_verification_notes = :notes, updated_at = NOW()
            WHERE id = :id AND organization_id = :org_id
        """),
            {"notes": " | ".join(problems), "id": subcontractor_id, "org_id": org_id},
        )
        return {"verification_stage": "system_pending", "problems": problems}

    await db.execute(
        text("""
        UPDATE crm.subcontractors
        SET verification_stage = 'system_verified', system_verified_at = NOW(),
            system_verification_notes = NULL, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {"id": subcontractor_id, "org_id": org_id},
    )
    await emit_role_notification(
        db,
        org_id=org_id,
        role_names=["HR Manager", "HR Officer"],
        title="Vendor profile ready for verification",
        message=f"{profile_row.name} passed automated checks and is awaiting HR verification.",
        notification_type="vendor_verification",
        action_url="/dashboard/hr?tab=vendor-verification",
    )
    return {"verification_stage": "system_verified", "problems": []}
