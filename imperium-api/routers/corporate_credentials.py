"""Corporate Credentials Vault - see app/services/compliance_credentials.py
and migrations/198_corporate_credentials_vault.sql.
"""

from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import compliance_credentials as credentials
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()

CREDENTIAL_TYPES = {
    "certificate_of_incorporation", "cr6", "cr14", "cr5", "company_constitution",
    "company_profile", "registered_address", "director_particulars",
    "signing_authority", "power_of_attorney",
    "praz_registration", "praz_supplier_category", "praz_contractor_category",
    "zimra_tax_clearance", "vat_registration", "other_tax_evidence",
    "nssa_compliance",
    "cifoz_registration", "cifoz_category", "cifoz_classification",
    "zbca_registration", "zbca_category", "zbca_classification",
    "other_construction_registration", "engineering_registration",
    "local_authority_registration", "specialist_contractor_registration",
    "insurance_public_liability", "insurance_contractors_all_risks",
    "insurance_workers_liability", "insurance_motor", "insurance_plant",
    "insurance_professional_indemnity", "insurance_other",
    "hse_policy", "environmental_policy", "quality_policy", "risk_management_policy",
    "audited_financial_statements", "management_accounts", "bank_statements",
    "bank_reference_letter", "facility_letter", "turnover_evidence",
    "plant_register", "equipment_ownership_records", "hire_agreements",
    "personnel_cvs", "professional_qualifications", "project_references",
    "completion_certificates", "award_letters",
}
CREDENTIAL_STATUSES = {"valid", "expiring", "expired", "pending_verification", "unverified", "not_applicable"}


class CredentialWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    credential_type: str
    issuing_organisation: Optional[str] = Field(default=None, max_length=255)
    registration_number: Optional[str] = Field(default=None, max_length=120)
    category: Optional[str] = Field(default=None, max_length=120)
    classification_grade: Optional[str] = Field(default=None, max_length=120)
    permitted_scope: Optional[str] = None
    value_limit: Optional[float] = Field(default=None, ge=0)
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    review_date: Optional[date] = None
    status: str = "unverified"
    evidence_document_id: Optional[UUID] = None
    notes: Optional[str] = None
    applicability: Optional[str] = None

    @field_validator("credential_type")
    @classmethod
    def _valid_type(cls, value: str) -> str:
        if value not in CREDENTIAL_TYPES:
            raise ValueError(f"Unknown credential_type: {value!r}")
        return value

    @field_validator("status")
    @classmethod
    def _valid_status(cls, value: str) -> str:
        if value not in CREDENTIAL_STATUSES:
            raise ValueError(f"Unknown status: {value!r}")
        return value


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: str = Field(pattern=r"^(valid|expired|not_applicable)$")


@router.get("")
async def list_corporate_credentials(
    category: Optional[str] = Query(default=None),
    credential_type: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    expiring_within_days: Optional[int] = Query(default=None, ge=0, le=3650),
    user: dict = Depends(require_permission("compliance_credentials.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await credentials.list_credentials(
        db,
        org_id=user["org_id"],
        category=category,
        credential_type=credential_type,
        status=status_filter,
        expiring_within_days=expiring_within_days,
    )
    return ok(items, "Corporate credentials listed.", total=len(items))


@router.get("/expiring-soon")
async def list_expiring_soon(
    within_days: int = Query(default=30, ge=1, le=365),
    user: dict = Depends(require_permission("compliance_credentials.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await credentials.list_credentials(db, org_id=user["org_id"], expiring_within_days=within_days)
    items = [item for item in items if item["status"] in ("expiring", "expired")]
    return ok(items, "Credentials expiring soon listed.", total=len(items))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_corporate_credential(
    payload: CredentialWrite,
    user: dict = Depends(require_permission("compliance_credentials.create")),
    db: AsyncSession = Depends(get_db),
):
    # Plain model_dump() (not mode="json") - date fields must stay real
    # datetime.date objects for asyncpg's date codec, not ISO strings.
    credential = await credentials.create_credential(db, org_id=user["org_id"], user_id=user["sub"], payload=payload.model_dump())
    await db.commit()
    return ok(credential, "Corporate credential added.")


@router.get("/{credential_id}")
async def get_corporate_credential(
    credential_id: UUID,
    user: dict = Depends(require_permission("compliance_credentials.read")),
    db: AsyncSession = Depends(get_db),
):
    credential = await credentials.get_credential(db, org_id=user["org_id"], credential_id=credential_id)
    if not credential:
        raise HTTPException(status_code=404, detail="Corporate credential not found.")
    return ok(credential, "Corporate credential retrieved.")


@router.put("/{credential_id}")
async def update_corporate_credential(
    credential_id: UUID,
    payload: CredentialWrite,
    user: dict = Depends(require_permission("compliance_credentials.update")),
    db: AsyncSession = Depends(get_db),
):
    credential = await credentials.update_credential(
        db, org_id=user["org_id"], user_id=user["sub"], credential_id=credential_id, payload=payload.model_dump()
    )
    if not credential:
        raise HTTPException(status_code=404, detail="Corporate credential not found.")
    await db.commit()
    return ok(credential, "Corporate credential updated.")


@router.post("/{credential_id}/verify")
async def verify_corporate_credential(
    credential_id: UUID,
    payload: VerifyRequest,
    user: dict = Depends(require_permission("compliance_credentials.update")),
    db: AsyncSession = Depends(get_db),
):
    credential = await credentials.verify_credential(
        db, org_id=user["org_id"], user_id=user["sub"], credential_id=credential_id, status=payload.status
    )
    if not credential:
        raise HTTPException(status_code=404, detail="Corporate credential not found.")
    await db.commit()
    return ok(credential, "Corporate credential verification recorded.")


@router.delete("/{credential_id}")
async def delete_corporate_credential(
    credential_id: UUID,
    user: dict = Depends(require_permission("compliance_credentials.delete")),
    db: AsyncSession = Depends(get_db),
):
    deleted = await credentials.delete_credential(db, org_id=user["org_id"], credential_id=credential_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Corporate credential not found.")
    await db.commit()
    return ok({"id": str(credential_id)}, "Corporate credential removed.")
