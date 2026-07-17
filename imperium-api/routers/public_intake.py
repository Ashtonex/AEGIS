"""Public website intake. This router deliberately never accepts a tenant ID from a visitor."""

import json
import re
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db

router = APIRouter()

_IDEMPOTENCY_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$")


def _idempotency_key(value: Optional[str]) -> str:
    """Require a client-generated key so retries cannot create more CRM records."""
    if not value or not _IDEMPOTENCY_KEY.fullmatch(value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A valid Idempotency-Key header is required.",
        )
    return value


class IntakePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    honeypot: Optional[str] = Field(default=None, max_length=0)

    @field_validator("honeypot")
    @classmethod
    def reject_honeypot(cls, value: Optional[str]) -> Optional[str]:
        if value:
            raise ValueError("Invalid submission")
        return value


class EnquiryPayload(IntakePayload):
    fullName: str = Field(min_length=2, max_length=255)
    company: str = Field(min_length=2, max_length=255)
    jobTitle: str = Field(min_length=2, max_length=100)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=50)
    type: str = Field(min_length=2, max_length=100)
    province: str = Field(min_length=2, max_length=100)
    budget: Optional[Decimal] = Field(default=None, ge=0)
    message: str = Field(min_length=10, max_length=5000)


class SupplierPayload(IntakePayload):
    companyName: str = Field(min_length=2, max_length=255)
    registrationNumber: str = Field(min_length=2, max_length=100)
    taxClearanceNumber: str = Field(min_length=2, max_length=100)
    prazNumber: Optional[str] = Field(default=None, max_length=100)
    yearEstablished: int = Field(ge=1800, le=2100)
    employees: int = Field(ge=1, le=10_000_000)
    address: str = Field(min_length=10, max_length=2000)
    contactPerson: str = Field(min_length=2, max_length=255)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=50)
    website: Optional[str] = Field(default=None, max_length=255)
    categories: list[str] = Field(min_length=1, max_length=20)
    description: str = Field(min_length=10, max_length=5000)
    provinces: list[str] = Field(min_length=1, max_length=20)
    references: str = Field(min_length=10, max_length=5000)
    documents: Optional["SupplierDocuments"] = None

    @field_validator("categories", "provinces")
    @classmethod
    def unique_list_values(cls, values: list[str]) -> list[str]:
        cleaned = [value.strip() for value in values if value.strip()]
        if len(cleaned) != len(set(value.casefold() for value in cleaned)):
            raise ValueError("List values must be unique")
        return cleaned


def _document_link(value: Optional[str]) -> Optional[str]:
    """Accept an actual document URL, never a client-side placeholder."""
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    parsed = urlparse(cleaned)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Document links must be absolute HTTP(S) URLs")
    if cleaned.casefold() in {"pending", "placeholder", "n/a"}:
        raise ValueError("Document links must reference uploaded files")
    return cleaned


class SupplierDocuments(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    profileUrl: Optional[str] = Field(default=None, max_length=2048)
    taxClearanceUrl: Optional[str] = Field(default=None, max_length=2048)
    incorporationUrl: Optional[str] = Field(default=None, max_length=2048)
    prazUrl: Optional[str] = Field(default=None, max_length=2048)
    isoUrl: Optional[str] = Field(default=None, max_length=2048)

    _validate_document_links = field_validator(
        "profileUrl", "taxClearanceUrl", "incorporationUrl", "prazUrl", "isoUrl"
    )(_document_link)


class ApplicationDocuments(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    cvUrl: Optional[str] = Field(default=None, max_length=2048)
    idUrl: Optional[str] = Field(default=None, max_length=2048)
    certificatesUrl: Optional[str] = Field(default=None, max_length=2048)

    _validate_document_links = field_validator("cvUrl", "idUrl", "certificatesUrl")(
        _document_link
    )


class ApplicationPayload(IntakePayload):
    positionId: str = Field(min_length=1, max_length=100)
    fullName: str = Field(min_length=2, max_length=255)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=50)
    idNumber: str = Field(min_length=5, max_length=100)
    province: str = Field(min_length=2, max_length=100)
    nationality: str = Field(min_length=2, max_length=100)
    experienceYears: int = Field(ge=0, le=80)
    highestQualification: str = Field(min_length=2, max_length=255)
    institution: str = Field(min_length=2, max_length=255)
    coverNote: str = Field(min_length=10, max_length=5000)
    documents: Optional[ApplicationDocuments] = None


class TenderInterestPayload(IntakePayload):
    companyName: str = Field(min_length=2, max_length=255)
    contactPerson: str = Field(min_length=2, max_length=255)
    email: EmailStr
    phone: str = Field(min_length=6, max_length=50)
    registrationNumber: str = Field(min_length=2, max_length=100)
    prazNumber: Optional[str] = Field(default=None, max_length=100)


async def _public_org_id(db: AsyncSession) -> str:
    rows = (
        (
            await db.execute(
                text(
                    "SELECT id FROM core.organizations WHERE is_deleted = false ORDER BY created_at LIMIT 2"
                )
            )
        )
        .scalars()
        .all()
    )
    if len(rows) != 1:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Public intake is not configured for this tenant.",
        )
    return str(rows[0])


async def _contact_id(
    db: AsyncSession, org_id: str, name: str, email: str, phone: str
) -> str:
    row = (
        await db.execute(
            text(
                "SELECT id FROM crm.contacts WHERE organization_id = :org_id AND lower(email) = lower(:email) AND is_deleted = false ORDER BY created_at LIMIT 1"
            ),
            {"org_id": org_id, "email": email},
        )
    ).scalar()
    if row:
        return str(row)
    return str(
        (
            await db.execute(
                text(
                    "INSERT INTO crm.contacts (organization_id, contact_name, email, phone) VALUES (:org_id, :name, :email, :phone) RETURNING id"
                ),
                {"org_id": org_id, "name": name, "email": email, "phone": phone},
            )
        ).scalar()
    )


async def _reserve_intake(
    db: AsyncSession, org_id: str, intake_type: str, payload: BaseModel, key: str
) -> tuple[str, str, bool]:
    """Claim a request before side effects. The unique index serializes concurrent retries."""
    result = await db.execute(
        text("""
        INSERT INTO crm.web_intakes (organization_id, intake_type, payload, idempotency_key)
        VALUES (:org_id, :intake_type, CAST(:payload AS jsonb), :key)
        ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
        RETURNING id, public_reference
    """),
        {
            "org_id": org_id,
            "intake_type": intake_type,
            "payload": json.dumps(payload.model_dump(mode="json", exclude_none=True)),
            "key": key,
        },
    )
    row = result.one_or_none()
    if row:
        return str(row.id), row.public_reference, True

    # A prior request completed; returning its opaque receipt is intentionally idempotent.
    existing = (
        await db.execute(
            text("""
        SELECT id, public_reference FROM crm.web_intakes
        WHERE organization_id = :org_id AND idempotency_key = :key
    """),
            {"org_id": org_id, "key": key},
        )
    ).one()
    return str(existing.id), existing.public_reference, False


async def _complete_intake(db: AsyncSession, intake_id: str, **links: Any) -> None:
    await db.execute(
        text("""
        UPDATE crm.web_intakes
        SET lead_id = :lead_id, opportunity_id = :opportunity_id, subcontractor_id = :subcontractor_id
        WHERE id = :intake_id
    """),
        {
            "intake_id": intake_id,
            "lead_id": links.get("lead_id"),
            "opportunity_id": links.get("opportunity_id"),
            "subcontractor_id": links.get("subcontractor_id"),
        },
    )


def _receipt(reference: str, message: str) -> dict[str, Any]:
    # Internal primary keys must never cross the public API boundary.
    return {
        "success": True,
        "data": {"reference": reference},
        "message": message,
        "meta": {},
    }


@router.get("/tenders")
async def list_public_tenders(db: AsyncSession = Depends(get_db)):
    """Return only live tender details that are suitable for public publication."""
    try:
        org_id = await _public_org_id(db)
        result = await db.execute(
            text("""
            SELECT id, tender_name, stage, submission_deadline
            FROM crm.tenders
            WHERE organization_id = :org_id
              AND is_deleted = false
              AND lower(trim(COALESCE(stage, ''))) IN ('open', 'published')
              AND (submission_deadline IS NULL OR submission_deadline >= NOW())
            ORDER BY submission_deadline ASC NULLS LAST, created_at DESC
        """),
            {"org_id": org_id},
        )
        tenders = [dict(row._mapping) for row in result]
        return {
            "success": True,
            "data": tenders,
            "message": "Published tenders fetched.",
            "meta": {"total": len(tenders)},
        }
    except SQLAlchemyError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch published tenders.",
        )


@router.post("/enquiry")
async def submit_enquiry(
    payload: EnquiryPayload,
    idempotency_key: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    try:
        org_id = await _public_org_id(db)
        intake_id, reference, created = await _reserve_intake(
            db, org_id, "enquiry", payload, key
        )
        if not created:
            await db.commit()
            return _receipt(reference, "Enquiry received.")
        contact_id = await _contact_id(
            db, org_id, payload.fullName, str(payload.email), payload.phone
        )
        lead_id = str(
            (
                await db.execute(
                    text("""
            INSERT INTO crm.leads (organization_id, lead_source, status, company_name, contact_name, contact_email, contact_phone, sector, estimated_budget)
            VALUES (:org_id, 'Website', 'new', :company, :name, :email, :phone, :sector, :budget) RETURNING id
        """),
                    {
                        "org_id": org_id,
                        "company": payload.company,
                        "name": payload.fullName,
                        "email": str(payload.email),
                        "phone": payload.phone,
                        "sector": payload.type,
                        "budget": payload.budget,
                    },
                )
            ).scalar()
        )
        opportunity_id = None
        if payload.type in {"New Project", "Plant Hire", "Joint Venture"}:
            opportunity_id = str(
                (
                    await db.execute(
                        text(
                            "INSERT INTO crm.opportunities (organization_id, client_id, lead_id, name, stage, budget, probability) VALUES (:org_id, :contact_id, :lead_id, :name, 'Inquiry', :budget, 0) RETURNING id"
                        ),
                        {
                            "org_id": org_id,
                            "contact_id": contact_id,
                            "lead_id": lead_id,
                            "name": f"{payload.company} - {payload.type}",
                            "budget": payload.budget or 0,
                        },
                    )
                ).scalar()
            )
        await _complete_intake(
            db, intake_id, lead_id=lead_id, opportunity_id=opportunity_id
        )
        await db.execute(
            text(
                "UPDATE crm.leads SET website_intake_id = :intake_id WHERE id = :lead_id"
            ),
            {"intake_id": intake_id, "lead_id": lead_id},
        )
        await db.execute(
            text(
                "INSERT INTO crm.activities (organization_id, contact_id, lead_id, opportunity_id, type, subject, description, status) VALUES (:org_id, :contact_id, :lead_id, :opportunity_id, 'Website enquiry', :subject, :description, 'Pending')"
            ),
            {
                "org_id": org_id,
                "contact_id": contact_id,
                "lead_id": lead_id,
                "opportunity_id": opportunity_id,
                "subject": f"{payload.type} enquiry from website",
                "description": payload.message,
            },
        )
        await db.commit()
        return _receipt(reference, "Enquiry received.")
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to process enquiry. Please retry.",
        )


@router.post("/supplier")
async def submit_supplier(
    payload: SupplierPayload,
    idempotency_key: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    try:
        org_id = await _public_org_id(db)
        intake_id, reference, created = await _reserve_intake(
            db, org_id, "supplier", payload, key
        )
        if not created:
            await db.commit()
            return _receipt(reference, "Supplier registration received.")
        result = await db.execute(
            text("""
            INSERT INTO crm.subcontractors (organization_id, name, capability_tags, compliance_status, praz_number, registration_number, tax_clearance_number, contact_name, contact_email, contact_phone, address, coverage_provinces, submission_data)
            VALUES (:org_id, :name, :tags, 'pending_review', :praz, :registration, :tax, :contact, :email, :phone, :address, :provinces, CAST(:payload AS jsonb))
            ON CONFLICT (organization_id, registration_number) WHERE registration_number IS NOT NULL AND is_deleted = false DO UPDATE SET updated_at = NOW()
            RETURNING id
        """),
            {
                "org_id": org_id,
                "name": payload.companyName,
                "tags": payload.categories,
                "praz": payload.prazNumber,
                "registration": payload.registrationNumber,
                "tax": payload.taxClearanceNumber,
                "contact": payload.contactPerson,
                "email": str(payload.email),
                "phone": payload.phone,
                "address": payload.address,
                "provinces": payload.provinces,
                "payload": json.dumps(
                    payload.model_dump(mode="json", exclude_none=True)
                ),
            },
        )
        subcontractor_id = str(result.scalar())
        await _complete_intake(db, intake_id, subcontractor_id=subcontractor_id)
        await db.commit()
        return _receipt(reference, "Supplier registration received.")
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to process registration. Please retry.",
        )


@router.post("/application")
async def submit_application(
    payload: ApplicationPayload,
    idempotency_key: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    try:
        org_id = await _public_org_id(db)
        intake_id, reference, created = await _reserve_intake(
            db, org_id, "application", payload, key
        )
        if not created:
            await db.commit()
            return _receipt(reference, "Application received.")
        await db.execute(
            text(
                "INSERT INTO hr.applications (organization_id, position_id, full_name, email, phone, province, application_data) VALUES (:org_id, :position_id, :name, :email, :phone, :province, CAST(:payload AS jsonb))"
            ),
            {
                "org_id": org_id,
                "position_id": payload.positionId,
                "name": payload.fullName,
                "email": str(payload.email),
                "phone": payload.phone,
                "province": payload.province,
                "payload": json.dumps(
                    payload.model_dump(mode="json", exclude_none=True)
                ),
            },
        )
        await db.commit()
        return _receipt(reference, "Application received.")
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to process application. Please retry.",
        )


@router.post("/tender-interest/{tender_id}")
async def submit_tender_interest(
    tender_id: str,
    payload: TenderInterestPayload,
    idempotency_key: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    key = _idempotency_key(idempotency_key)
    try:
        org_id = await _public_org_id(db)
        if not (
            await db.execute(
                text(
                    "SELECT 1 FROM crm.tenders WHERE id = :tender_id AND organization_id = :org_id AND is_deleted = false"
                ),
                {"tender_id": tender_id, "org_id": org_id},
            )
        ).scalar():
            raise HTTPException(status_code=404, detail="Tender not found")
        intake_id, reference, created = await _reserve_intake(
            db, org_id, "tender_interest", payload, key
        )
        if not created:
            await db.commit()
            return _receipt(reference, "Tender interest received.")
        contact_id = await _contact_id(
            db, org_id, payload.contactPerson, str(payload.email), payload.phone
        )
        await db.execute(
            text(
                "INSERT INTO crm.tender_interests (organization_id, tender_id, contact_id, company_name, registration_number, praz_number) VALUES (:org_id, :tender_id, :contact_id, :company, :registration, :praz)"
            ),
            {
                "org_id": org_id,
                "tender_id": tender_id,
                "contact_id": contact_id,
                "company": payload.companyName,
                "registration": payload.registrationNumber,
                "praz": payload.prazNumber,
            },
        )
        await db.commit()
        return _receipt(reference, "Tender interest received.")
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to process tender interest. Please retry.",
        )


@router.get("/website-content")
async def get_public_website_content(db: AsyncSession = Depends(get_db)):
    """Return published website content segments for the public site."""
    try:
        org_id = await _public_org_id(db)
        result = await db.execute(
            text("""
            SELECT page_key, section_key, title, subtitle, body, status, metadata
            FROM settings.website_content
            WHERE organization_id = :org_id
              AND is_deleted = false
              AND status = 'published'
        """),
            {"org_id": org_id},
        )
        content_items = [dict(row._mapping) for row in result]
        return {
            "success": True,
            "data": content_items,
            "message": "Public website content fetched.",
            "meta": {"total": len(content_items)},
        }
    except SQLAlchemyError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch website content.",
        )


@router.get("/broadcast-feeds")
async def list_public_broadcast_feeds(db: AsyncSession = Depends(get_db)):
    """Return all active broadcasted images for public publication."""
    try:
        org_id = await _public_org_id(db)
        result = await db.execute(
            text("""
            SELECT id, title, description, image_url, created_at
            FROM settings.broadcast_feeds
            WHERE organization_id = :org_id
              AND is_deleted = false
            ORDER BY created_at DESC
        """),
            {"org_id": org_id},
        )
        rows = [dict(row._mapping) for row in result]
        for row in rows:
            row["id"] = str(row["id"])
            row["created_at"] = row["created_at"].isoformat()
        return {
            "success": True,
            "data": rows,
            "message": "Public broadcast feeds fetched.",
            "meta": {"total": len(rows)},
        }
    except SQLAlchemyError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to fetch broadcast feeds.",
        )
