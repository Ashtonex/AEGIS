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

# The key vendor requirements are the registered company name, the company
# registration number, tax clearance and VAT (a VAT number, or an explicit
# "not VAT registered" declaration). NSSA and PRAZ are still captured and
# shown but don't block verification.
REQUIRED_VENDOR_PROFILE_FIELDS = (
    "name", "registration_number", "tax_clearance_number",
    "contact_name", "contact_email", "contact_phone", "address",
)
REQUIRED_COMPLIANCE_CATEGORIES = (
    "tax_clearance",
    "company_registration",
    "vat",
)
OPTIONAL_COMPLIANCE_CATEGORIES = (
    "nssa",
    "praz",
)
VAT_STATUSES = ("registered", "not_registered")
COMPLIANCE_DOCUMENT_LABELS = {
    "tax_clearance": "Tax clearance certificate",
    "company_registration": "Company registration certificate",
    "vat": "VAT certificate",
    "nssa": "NSSA",
    "praz": "PRAZ",
}

VENDOR_FIELD_LABELS = {
    "name": "Registered company name",
    "registration_number": "Company registration number",
    "tax_clearance_number": "Tax clearance number",
    "vat_number": "VAT number",
    "contact_name": "Primary contact",
    "contact_email": "Primary contact email",
    "contact_phone": "Primary contact phone",
    "address": "Address",
}

# One definition of where each vendor profile value comes from, for every
# reader: the subcontractor row first, then its linked procurement.suppliers
# row, then the raw registration submission. Needs "crm.subcontractors s"
# LEFT JOINed to "procurement.suppliers ps".
_VAT_NUMBER_SQL = (
    "COALESCE(NULLIF(s.vat_number, ''), NULLIF(ps.vat_registration_number, ''), "
    "NULLIF(s.submission_data->>'vat_number', ''), NULLIF(s.submission_data->>'vatNumber', ''))"
)
VENDOR_PROFILE_SQL = {
    "name": "COALESCE(NULLIF(s.name, ''), NULLIF(ps.supplier_name, ''), NULLIF(ps.trading_name, ''))",
    "registration_number": "COALESCE(NULLIF(s.registration_number, ''), NULLIF(ps.registration_number, ''), NULLIF(s.submission_data->>'registration_number', ''), NULLIF(s.submission_data->>'company_registration_number', ''))",
    "tax_clearance_number": "COALESCE(NULLIF(s.tax_clearance_number, ''), NULLIF(ps.tax_number, ''), NULLIF(s.submission_data->>'tax_clearance_number', ''), NULLIF(s.submission_data->>'tax_number', ''), NULLIF(s.submission_data->>'zimra_number', ''))",
    "vat_number": _VAT_NUMBER_SQL,
    "vat_status": (
        "COALESCE(s.vat_status, ps.vat_status, NULLIF(s.submission_data->>'vat_status', ''), "
        f"CASE WHEN {_VAT_NUMBER_SQL} IS NOT NULL THEN 'registered' END)"
    ),
    "nssa_number": "COALESCE(NULLIF(s.nssa_number, ''), NULLIF(ps.nssa_number, ''), NULLIF(s.submission_data->>'nssa_number', ''))",
    "praz_number": "COALESCE(NULLIF(s.praz_number, ''), NULLIF(ps.praz_number, ''), NULLIF(s.submission_data->>'praz_number', ''))",
    "contact_name": "COALESCE(NULLIF(s.contact_name, ''), NULLIF(ps.primary_contact_name, ''), NULLIF(s.submission_data->>'contact_name', ''), NULLIF(s.submission_data->>'primary_contact_name', ''))",
    "contact_email": "COALESCE(NULLIF(s.contact_email, ''), NULLIF(ps.primary_contact_email, ''), NULLIF(s.submission_data->>'contact_email', ''), NULLIF(s.submission_data->>'primary_contact_email', ''), NULLIF(s.submission_data->>'alternate_contact_email', ''), NULLIF(s.submission_data->>'accounts_contact_email', ''))",
    "contact_phone": "COALESCE(NULLIF(s.contact_phone, ''), NULLIF(ps.primary_contact_phone, ''), NULLIF(s.submission_data->>'contact_phone', ''), NULLIF(s.submission_data->>'primary_contact_phone', ''), NULLIF(s.submission_data->>'alternate_contact_phone', ''), NULLIF(s.submission_data->>'accounts_contact_phone', ''))",
    "address": "COALESCE(NULLIF(s.address, ''), NULLIF(ps.address, ''), NULLIF(s.submission_data->>'address', ''), NULLIF(s.submission_data->>'company_address', ''))",
}


def vendor_profile_columns(*keys: str) -> str:
    """SELECT-list fragment "<expr> AS <key>, ..." for the given profile keys
    (all of them when none are given)."""
    return ",\n".join(f"{VENDOR_PROFILE_SQL[key]} AS {key}" for key in (keys or VENDOR_PROFILE_SQL))


def required_compliance_categories(vat_status: str | None) -> tuple[str, ...]:
    """A vendor that has declared it isn't VAT registered has no VAT
    certificate to provide."""
    if vat_status == "not_registered":
        return tuple(c for c in REQUIRED_COMPLIANCE_CATEGORIES if c != "vat")
    return REQUIRED_COMPLIANCE_CATEGORIES


def missing_profile_fields(profile: Any) -> list[str]:
    """Required profile keys that are blank, including VAT: a VAT number is
    required unless the vendor has declared it isn't VAT registered."""
    def value(key: str) -> str:
        raw = profile.get(key) if isinstance(profile, dict) else getattr(profile, key, None)
        return str(raw or "").strip()

    missing = [f for f in REQUIRED_VENDOR_PROFILE_FIELDS if not value(f)]
    if value("vat_status") != "not_registered" and not value("vat_number"):
        missing.append("vat_number")
    return missing
COMPLIANCE_CATEGORY_ALIASES = {
    "tax": "tax_clearance",
    "tax_clearance_certificate": "tax_clearance",
    "zimra_tax_clearance": "tax_clearance",
    "nssa_certificate": "nssa",
    "nssa_clearance": "nssa",
    "praz_certificate": "praz",
    "praz_registration": "praz",
    "vat_certificate": "vat",
    "vat_registration": "vat",
    "vat_number": "vat",
    "registration": "company_registration",
    "registration_certificate": "company_registration",
    "company_reg": "company_registration",
    "company_registration_certificate": "company_registration",
    "certificate_of_incorporation": "company_registration",
}


def normalize_compliance_category(value: Any) -> str | None:
    if not value:
        return None
    normalized = str(value).strip().lower().replace("-", "_").replace(" ", "_")
    return COMPLIANCE_CATEGORY_ALIASES.get(normalized, normalized)


async def _supplier_compliance_documents_available(db: AsyncSession) -> bool:
    row = (
        await db.execute(
            text("SELECT to_regclass('procurement.supplier_compliance_documents') IS NOT NULL AS exists")
        )
    ).mappings().first()
    return bool(row and row["exists"])


async def run_system_verification_check(
    db: AsyncSession, *, org_id: str, subcontractor_id: str
) -> dict[str, Any]:
    """Runs the deterministic profile/document check for one subcontractor
    and persists the resulting verification_stage. Returns the outcome so
    callers can render it without a second query."""
    profile_row = (
        await db.execute(
            text(f"""
            SELECT
                {vendor_profile_columns()}
            FROM crm.subcontractors s
            LEFT JOIN procurement.suppliers ps
              ON ps.id = s.linked_supplier_id
             AND ps.organization_id = s.organization_id
             AND ps.is_deleted = false
            WHERE s.id = :id AND s.organization_id = :org_id AND s.is_deleted = false
        """),
            {"id": subcontractor_id, "org_id": org_id},
        )
    ).first()
    if not profile_row:
        raise ValueError("Subcontractor not found.")

    missing = [VENDOR_FIELD_LABELS[f] for f in missing_profile_fields(profile_row)]
    vat_status = getattr(profile_row, "vat_status", None)

    if await _supplier_compliance_documents_available(db):
        doc_sql = """
            SELECT DISTINCT ON (COALESCE(scd.document_type, d.category, dl.link_role))
                   COALESCE(scd.document_type, d.category, dl.link_role) AS category,
                   d.expiry_date
            FROM core.document_links dl
            JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id AND d.is_deleted = false
            LEFT JOIN procurement.supplier_compliance_documents scd
              ON scd.document_id = d.id
             AND scd.organization_id = dl.organization_id
             AND scd.is_deleted = false
             AND scd.status NOT IN ('rejected', 'needs_update')
            JOIN crm.subcontractors s
              ON s.id = :id
             AND s.organization_id = dl.organization_id
             AND s.is_deleted = false
            WHERE dl.organization_id = :org_id
              AND (
                  (dl.entity_type = 'subcontractor' AND dl.entity_id = s.id)
                  OR (dl.entity_type = 'supplier' AND dl.entity_id = s.linked_supplier_id)
              )
              AND dl.link_role IN ('compliance', 'tax_clearance', 'nssa', 'praz', 'vat', 'company_registration', 'registration_certificate')
              AND dl.is_deleted = false
            UNION
            SELECT DISTINCT ON (scd.document_type)
                   scd.document_type AS category,
                   d.expiry_date
            FROM procurement.supplier_compliance_documents scd
            JOIN core.documents d
              ON d.id = scd.document_id
             AND d.organization_id = scd.organization_id
             AND d.is_deleted = false
            JOIN crm.subcontractors s
              ON s.organization_id = scd.organization_id
             AND s.is_deleted = false
             AND (scd.subcontractor_id = s.id OR scd.supplier_id = s.linked_supplier_id)
            WHERE scd.organization_id = :org_id
              AND s.id = :id
              AND scd.status NOT IN ('rejected', 'needs_update')
              AND scd.is_deleted = false
        """
    else:
        doc_sql = """
            SELECT DISTINCT ON (COALESCE(d.category, dl.link_role))
                   COALESCE(d.category, dl.link_role) AS category,
                   d.expiry_date
            FROM core.document_links dl
            JOIN core.documents d
              ON d.id = dl.document_id
             AND d.organization_id = dl.organization_id
             AND d.is_deleted = false
            JOIN crm.subcontractors s
              ON s.id = :id
             AND s.organization_id = dl.organization_id
             AND s.is_deleted = false
            WHERE dl.organization_id = :org_id
              AND (
                  (dl.entity_type = 'subcontractor' AND dl.entity_id = s.id)
                  OR (dl.entity_type = 'supplier' AND dl.entity_id = s.linked_supplier_id)
              )
              AND dl.link_role IN ('compliance', 'tax_clearance', 'nssa', 'praz', 'vat', 'company_registration', 'registration_certificate')
              AND dl.is_deleted = false
        """

    doc_rows = await db.execute(text(doc_sql), {"org_id": org_id, "id": subcontractor_id})
    docs = [dict(r._mapping) for r in doc_rows]
    present_categories = {
        category for category in (normalize_compliance_category(d["category"]) for d in docs) if category
    }
    required_categories = required_compliance_categories(vat_status)
    missing_categories = [c for c in required_categories if c not in present_categories]
    # An expired NSSA/PRAZ certificate doesn't block, same as a missing one.
    expired = sorted({
        normalize_compliance_category(d["category"])
        for d in docs
        if d["expiry_date"] and d["expiry_date"] < date.today()
        and normalize_compliance_category(d["category"]) in required_categories
    })

    problems: list[str] = []
    if missing:
        problems.append("Missing profile fields: " + ", ".join(missing))
    if missing_categories:
        problems.append("Missing compliance documents: " + ", ".join(COMPLIANCE_DOCUMENT_LABELS[c] for c in missing_categories))
    if expired:
        problems.append("Expired compliance documents: " + ", ".join(COMPLIANCE_DOCUMENT_LABELS[c] for c in expired))

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
