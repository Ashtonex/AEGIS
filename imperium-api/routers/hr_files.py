"""Employee files: contracts, credentials and assets issued.

Mounted at /api/v1/hr/files. The HR Contracts & Docs, Credentials and Assets
pages list current staff from /overview; picking someone opens their person
card on the matching tab, which reads and writes through the per-person
routes here. Scans and signed copies go to SharePoint
(06_HR_WORKFORCE/Employees/<number> - <name>/<kind>) through the existing
document service, never through Supabase Storage.
"""

from __future__ import annotations

import mimetypes
from datetime import date, timedelta
from pathlib import Path as FilePath
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.hr import expiry_alerts
from app.shared.pagination import ok
from core.config import settings
from core.database import get_db
from core.security import require_permission

router = APIRouter()

READ = "hr.operations.read"
WRITE = "hr.operations.update"
CONTRACT_TYPES = ("permanent", "fixed_term", "probation", "casual", "internship", "consultancy")
CREDENTIAL_TYPES = ("certification", "drivers_licence", "professional_registration", "vehicle_registration",
                    "medical", "induction", "work_permit", "passport", "other")
ASSET_TYPES = ("ppe", "tool", "vehicle", "equipment", "phone", "laptop", "other")
EMPLOYMENT_TYPE_FOR_CONTRACT = {
    "permanent": "permanent", "probation": "permanent", "fixed_term": "fixed_term",
    "casual": "casual", "internship": "intern", "consultancy": "consultant",
}


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ContractChange(Input):
    action: Literal["terminate", "mark_signed", "update"]
    ends_on: Optional[date] = None
    signed_on: Optional[date] = None
    reason: Optional[str] = Field(default=None, max_length=2000)
    notes: Optional[str] = Field(default=None, max_length=4000)


class CredentialChange(Input):
    verification_status: Optional[Literal["pending", "verified", "rejected"]] = None
    expires_on: Optional[date] = None
    notes: Optional[str] = Field(default=None, max_length=4000)


class AssetIssue(Input):
    asset_type: Literal["ppe", "tool", "vehicle", "equipment", "phone", "laptop", "other"]
    asset_label: str = Field(min_length=2, max_length=200)
    asset_reference: Optional[str] = Field(default=None, max_length=120)
    serial_number: Optional[str] = Field(default=None, max_length=120)
    quantity: int = Field(default=1, ge=1, le=10000)
    asset_value: Optional[float] = Field(default=None, ge=0)
    issued_on: date
    due_back_on: Optional[date] = None
    condition_out: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=2000)
    acknowledged: bool = False


class AssetReturn(Input):
    outcome: Literal["returned", "lost", "damaged", "written_off"] = "returned"
    returned_on: date
    condition_in: Optional[str] = Field(default=None, max_length=120)
    notes: Optional[str] = Field(default=None, max_length=2000)


# --------------------------------------------------------------------------- helpers

async def _employee(db: AsyncSession, org_id, employee_id) -> dict:
    row = (await db.execute(text("""
        SELECT id, employee_name, employee_number, employment_status, start_date, employment_type
        FROM hr.employees WHERE organization_id=:org AND id=:id AND is_deleted=false
    """), {"org": org_id, "id": employee_id})).mappings().first()
    if not row:
        raise HTTPException(404, "Person not found")
    return dict(row)


async def _store_file(db: AsyncSession, user: dict, employee: dict, upload: Optional[UploadFile], folder: str) -> Optional[UUID]:
    """Upload a scan to the employee's SharePoint folder; returns the file_attachments id."""
    if upload is None or not upload.filename:
        return None
    from app.services.microsoft.document_service import MicrosoftIntegrationNotReady, upload_document
    from app.services.microsoft.errors import GraphError
    from app.services.microsoft.routing import RoutingDenied

    extension = FilePath(upload.filename).suffix.lower()
    if extension not in settings.allowed_upload_extensions:
        raise HTTPException(400, f"Unsupported file type '{extension}'.")
    content = await upload.read()
    if not content:
        raise HTTPException(400, "The file is empty.")
    if len(content) > settings.FILE_STORAGE_MAX_BYTES:
        raise HTTPException(413, "File exceeds the upload size limit.")
    mime = upload.content_type or mimetypes.guess_type(upload.filename)[0] or "application/octet-stream"
    person_folder = f"Employees/{employee['employee_number'] or 'UNNUMBERED'} - {employee['employee_name']}/{folder}"
    try:
        attachment = await upload_document(
            db, organization_id=user["org_id"], uploaded_by=user["user_id"], module="hr",
            file_name=upload.filename, content=content, mime_type=mime,
            confidentiality_level="confidential", subfolder=person_folder,
        )
    except RoutingDenied as exc:
        await db.rollback()
        raise HTTPException(400, str(exc))
    except MicrosoftIntegrationNotReady as exc:
        await db.rollback()
        raise HTTPException(503, f"SharePoint is not ready: {exc}")
    except GraphError as exc:
        await db.rollback()
        raise HTTPException(502, f"SharePoint upload failed: {exc}")
    # The file now exists in SharePoint; keep its record even if the next step fails.
    await db.commit()
    return attachment["id"]


def _contract_state(row: dict, today: date) -> str:
    if row["status"] != "active":
        return row["status"]
    if row["starts_on"] > today:
        return "upcoming"
    if row["ends_on"] and row["ends_on"] < today:
        return "expired"
    return "current"


def _days_left(value: Optional[date], today: date) -> Optional[int]:
    return (value - today).days if value else None


async def _contracts(db, org_id, employee_id) -> list[dict]:
    today = date.today()
    rows = (await db.execute(text("""
        SELECT c.*, fa.file_name, fa.sharepoint_web_url, u.full_name AS created_by_name
        FROM hr.employee_contracts c
        LEFT JOIN core.file_attachments fa ON fa.id = c.file_attachment_id
        LEFT JOIN core.users u ON u.id = c.created_by
        WHERE c.organization_id=:org AND c.employee_id=:id AND c.is_deleted=false
        ORDER BY c.starts_on DESC, c.created_at DESC
    """), {"org": org_id, "id": employee_id})).mappings()
    out = []
    for r in rows:
        item = dict(r)
        item["state"] = _contract_state(item, today)
        item["days_left"] = _days_left(item["ends_on"], today) if item["state"] in ("current", "upcoming") else None
        out.append(item)
    return out


async def _credentials(db, org_id, employee_id) -> list[dict]:
    today = date.today()
    rows = (await db.execute(text("""
        SELECT c.id, c.credential_type, c.certification_name, c.issuing_authority, c.certificate_number,
               c.licence_class, c.vehicle_registration, c.issued_on, c.expires_on, c.verification_status,
               c.notes, c.file_attachment_id, fa.file_name, c.created_at
        FROM hr.employee_certifications c LEFT JOIN core.file_attachments fa ON fa.id = c.file_attachment_id
        WHERE c.organization_id=:org AND c.employee_id=:id AND c.is_deleted=false
        ORDER BY c.expires_on NULLS LAST, c.certification_name
    """), {"org": org_id, "id": employee_id})).mappings()
    out = []
    for r in rows:
        item = dict(r)
        item["days_left"] = _days_left(item["expires_on"], today)
        item["state"] = ("expired" if item["days_left"] is not None and item["days_left"] < 0
                         else "expiring" if item["days_left"] is not None and item["days_left"] <= 60 else "valid")
        out.append(item)
    return out


async def _assets(db, org_id, employee_id) -> list[dict]:
    today = date.today()
    rows = (await db.execute(text("""
        SELECT a.id, a.asset_type, a.asset_label, a.asset_reference, a.serial_number, a.quantity, a.asset_value,
               a.issued_on, a.due_back_on, a.returned_on, a.condition_out, a.condition_in, a.status, a.notes,
               a.acknowledged_at, a.file_attachment_id, fa.file_name,
               ib.full_name AS issued_by_name, rt.full_name AS returned_to_name
        FROM hr.employee_asset_assignments a
        LEFT JOIN core.file_attachments fa ON fa.id = a.file_attachment_id
        LEFT JOIN core.users ib ON ib.id = a.issued_by
        LEFT JOIN core.users rt ON rt.id = a.returned_to
        WHERE a.organization_id=:org AND a.employee_id=:id AND a.is_deleted=false
        ORDER BY (a.status = 'issued') DESC, a.issued_on DESC
    """), {"org": org_id, "id": employee_id})).mappings()
    out = []
    for r in rows:
        item = dict(r)
        item["overdue"] = bool(item["status"] == "issued" and item["due_back_on"] and item["due_back_on"] < today)
        out.append(item)
    return out


# --------------------------------------------------------------------------- overview

@router.get("/overview")
async def files_overview(
    kind: Literal["contracts", "credentials", "assets"] = "contracts",
    include_left: bool = False,
    user: dict = Depends(require_permission(READ)),
    db: AsyncSession = Depends(get_db),
):
    """One row per person with the summary the chosen page needs."""
    today = date.today()
    rows = (await db.execute(text("""
        SELECT e.id, e.employee_number, e.employee_name, e.job_title, e.employment_status, e.employment_type,
               p.name AS position_name, d.name AS department_name,
               c.contract_number, c.contract_type, c.starts_on, c.ends_on, c.signed_on, c.file_attachment_id AS contract_file,
               c.review_meeting_at,
               (SELECT COUNT(*) FROM hr.employee_contracts x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false) AS contracts,
               (SELECT COUNT(*) FROM hr.employee_certifications x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false) AS credentials,
               (SELECT COUNT(*) FROM hr.employee_certifications x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false
                  AND x.expires_on IS NOT NULL AND x.expires_on < :today) AS credentials_expired,
               (SELECT COUNT(*) FROM hr.employee_certifications x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false
                  AND x.expires_on IS NOT NULL AND x.expires_on BETWEEN :today AND :soon) AS credentials_expiring,
               (SELECT MIN(x.expires_on) FROM hr.employee_certifications x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false
                  AND x.expires_on >= :today) AS next_credential_expiry,
               (SELECT COUNT(*) FROM hr.employee_certifications x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false
                  AND x.credential_type='drivers_licence') AS drivers_licences,
               (SELECT COALESCE(SUM(x.quantity),0) FROM hr.employee_asset_assignments x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false AND x.status='issued') AS assets_held,
               (SELECT COUNT(*) FROM hr.employee_asset_assignments x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false AND x.status='issued'
                  AND x.due_back_on < :today) AS assets_overdue,
               (SELECT COALESCE(SUM(x.asset_value * x.quantity),0) FROM hr.employee_asset_assignments x WHERE x.organization_id=e.organization_id AND x.employee_id=e.id AND x.is_deleted=false AND x.status='issued') AS assets_value
        FROM hr.employees e
        LEFT JOIN hr.positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
        LEFT JOIN finance.departments d ON d.id=e.department_id AND d.organization_id=e.organization_id
        LEFT JOIN LATERAL (
            SELECT * FROM hr.employee_contracts c WHERE c.organization_id=e.organization_id AND c.employee_id=e.id
              AND c.is_deleted=false AND c.status='active' AND c.starts_on <= :today
            ORDER BY c.starts_on DESC LIMIT 1
        ) c ON true
        WHERE e.organization_id=:org AND e.is_deleted=false AND (:include_left OR e.employment_status <> 'terminated')
        ORDER BY e.employee_number NULLS LAST, e.employee_name
    """), {"org": user["org_id"], "today": today, "soon": today + timedelta(days=60), "include_left": include_left})).mappings()
    people = []
    for r in rows:
        item = dict(r)
        item["contract_days_left"] = _days_left(item["ends_on"], today)
        if not item["contract_number"]:
            item["contract_state"] = "none"
        elif item["ends_on"] and item["ends_on"] < today:
            item["contract_state"] = "expired"
        elif item["ends_on"] and item["contract_days_left"] <= 60:
            item["contract_state"] = "ending"
        else:
            item["contract_state"] = "current"
        people.append(item)
    totals = {
        "people": len(people),
        "no_contract": sum(1 for p in people if p["contract_state"] == "none"),
        "contracts_ending": sum(1 for p in people if p["contract_state"] == "ending"),
        "contracts_expired": sum(1 for p in people if p["contract_state"] == "expired"),
        "unsigned": sum(1 for p in people if p["contract_number"] and not p["contract_file"]),
        "credentials_expiring": sum(int(p["credentials_expiring"]) for p in people),
        "credentials_expired": sum(int(p["credentials_expired"]) for p in people),
        "drivers": sum(1 for p in people if int(p["drivers_licences"])),
        "assets_held": sum(int(p["assets_held"]) for p in people),
        "assets_overdue": sum(int(p["assets_overdue"]) for p in people),
        "assets_value": float(sum(float(p["assets_value"] or 0) for p in people)),
    }
    return ok({"people": people, "totals": totals}, f"{kind} overview.")


# --------------------------------------------------------------------------- contracts

@router.get("/people/{employee_id}/contracts")
async def list_contracts(employee_id: UUID, user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    await _employee(db, user["org_id"], employee_id)
    return ok(await _contracts(db, user["org_id"], employee_id), "Contracts.")


@router.post("/people/{employee_id}/contracts", status_code=201)
async def add_contract(
    employee_id: UUID,
    contract_type: str = Form(...),
    starts_on: date = Form(...),
    ends_on: Optional[date] = Form(default=None),
    signed_on: Optional[date] = Form(default=None),
    probation_ends_on: Optional[date] = Form(default=None),
    notice_period_days: Optional[int] = Form(default=None, ge=0, le=365),
    basic_salary: Optional[float] = Form(default=None, ge=0),
    currency: Optional[str] = Form(default="USD", max_length=3),
    title: Optional[str] = Form(default=None, max_length=200),
    notes: Optional[str] = Form(default=None, max_length=4000),
    renewal_of: Optional[UUID] = Form(default=None),
    file: Optional[UploadFile] = File(default=None),
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    """Record a contract (new, renewal or replacement). The person's previous
    active contract is closed: 'renewed' when this renews it, otherwise
    'superseded', ending the day before this one starts if it overlapped."""
    org = user["org_id"]
    if contract_type not in CONTRACT_TYPES:
        raise HTTPException(422, f"contract_type must be one of {', '.join(CONTRACT_TYPES)}")
    if ends_on and ends_on < starts_on:
        raise HTTPException(422, "The contract cannot end before it starts")
    if contract_type in ("fixed_term", "probation", "internship", "casual", "consultancy") and not ends_on:
        raise HTTPException(422, "A fixed-term, probation, internship, casual or consultancy contract needs an end date")
    employee = await _employee(db, org, employee_id)
    if employee["employment_status"] == "terminated":
        raise HTTPException(409, "This person has left the organisation; reinstate them first")
    if renewal_of:
        prior = (await db.execute(text("SELECT 1 FROM hr.employee_contracts WHERE organization_id=:org AND employee_id=:emp AND id=:id AND is_deleted=false"),
                                  {"org": org, "emp": employee_id, "id": renewal_of})).scalar()
        if not prior:
            raise HTTPException(422, "The contract being renewed was not found for this person")

    file_id = await _store_file(db, user, employee, file, "Contracts")
    seq = (await db.execute(text("SELECT COUNT(*) + 1 FROM hr.employee_contracts WHERE organization_id=:org AND employee_id=:emp"),
                            {"org": org, "emp": employee_id})).scalar_one()
    number = f"CTR-{employee['employee_number'] or 'X'}-{seq:02d}"

    await db.execute(text("""
        UPDATE hr.employee_contracts
        SET status = CASE WHEN id = CAST(:renewal_of AS uuid) THEN 'renewed' ELSE 'superseded' END,
            ends_on = CASE WHEN ends_on IS NULL OR ends_on >= CAST(:starts_on AS date)
                           THEN GREATEST(starts_on, CAST(:starts_on AS date) - 1) ELSE ends_on END,
            updated_at = now()
        WHERE organization_id=:org AND employee_id=:emp AND is_deleted=false AND status='active' AND starts_on < CAST(:starts_on AS date)
    """), {"org": org, "emp": employee_id, "starts_on": starts_on, "renewal_of": renewal_of})
    contract_id = (await db.execute(text("""
        INSERT INTO hr.employee_contracts (organization_id, employee_id, contract_number, contract_type, title, starts_on, ends_on,
          signed_on, probation_ends_on, notice_period_days, basic_salary, currency, status, renewal_of, file_attachment_id, notes, created_by)
        VALUES (:org, :emp, :number, :type, :title, :starts_on, :ends_on, :signed_on, :probation_ends_on, :notice, :salary,
          :currency, 'active', :renewal_of, :file_id, :notes, :actor)
        RETURNING id
    """), {"org": org, "emp": employee_id, "number": number, "type": contract_type, "title": title, "starts_on": starts_on,
           "ends_on": ends_on, "signed_on": signed_on, "probation_ends_on": probation_ends_on, "notice": notice_period_days,
           "salary": basic_salary, "currency": (currency or "USD").upper(), "renewal_of": renewal_of, "file_id": file_id,
           "notes": notes, "actor": user["user_id"]})).scalar_one()
    # Keep the person card in step: employment type, start date (earliest contract), planned end.
    await db.execute(text("""
        UPDATE hr.employees SET employment_type = :employment_type,
            start_date = LEAST(COALESCE(start_date, :starts_on), :starts_on),
            end_date = CASE WHEN :ends_on_set THEN CAST(:ends_on AS date) ELSE NULL END,
            version = version + 1, updated_at = now()
        WHERE organization_id=:org AND id=:emp
    """), {"org": org, "emp": employee_id, "employment_type": EMPLOYMENT_TYPE_FOR_CONTRACT[contract_type],
           "starts_on": starts_on, "ends_on": ends_on, "ends_on_set": ends_on is not None})
    await db.commit()
    return ok({"id": str(contract_id), "contract_number": number, "contracts": await _contracts(db, org, employee_id)},
              f"Contract {number} recorded.")


@router.post("/contracts/{contract_id}/file")
async def attach_contract_file(
    contract_id: UUID,
    file: UploadFile = File(...),
    mark_signed_on: Optional[date] = Form(default=None),
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    row = (await db.execute(text("SELECT employee_id FROM hr.employee_contracts WHERE organization_id=:org AND id=:id AND is_deleted=false"),
                            {"org": org, "id": contract_id})).first()
    if not row:
        raise HTTPException(404, "Contract not found")
    employee = await _employee(db, org, row.employee_id)
    file_id = await _store_file(db, user, employee, file, "Contracts")
    await db.execute(text("""UPDATE hr.employee_contracts SET file_attachment_id=:file_id,
        signed_on = COALESCE(CAST(:signed AS date), signed_on), updated_at=now() WHERE id=:id"""),
                     {"file_id": file_id, "signed": mark_signed_on, "id": contract_id})
    await db.commit()
    return ok(await _contracts(db, org, row.employee_id), "Signed copy attached.")


@router.patch("/contracts/{contract_id}")
async def change_contract(
    contract_id: UUID,
    payload: ContractChange,
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    row = (await db.execute(text("SELECT employee_id, starts_on, status FROM hr.employee_contracts WHERE organization_id=:org AND id=:id AND is_deleted=false"),
                            {"org": org, "id": contract_id})).mappings().first()
    if not row:
        raise HTTPException(404, "Contract not found")
    if payload.action == "terminate":
        if not payload.reason:
            raise HTTPException(422, "Give a reason for ending the contract early")
        end = payload.ends_on or date.today()
        if end < row["starts_on"]:
            raise HTTPException(422, "The end date is before the contract started")
        await db.execute(text("""UPDATE hr.employee_contracts SET status='terminated', ends_on=:end, ended_reason=:reason, updated_at=now()
            WHERE id=:id"""), {"end": end, "reason": payload.reason, "id": contract_id})
    elif payload.action == "mark_signed":
        await db.execute(text("UPDATE hr.employee_contracts SET signed_on=:signed, updated_at=now() WHERE id=:id"),
                         {"signed": payload.signed_on or date.today(), "id": contract_id})
    else:
        if row["status"] != "active":
            raise HTTPException(409, "Only an active contract can be changed")
        if payload.ends_on and payload.ends_on < row["starts_on"]:
            raise HTTPException(422, "The contract cannot end before it starts")
        await db.execute(text("""UPDATE hr.employee_contracts SET
            ends_on = COALESCE(CAST(:ends_on AS date), ends_on), notes = COALESCE(CAST(:notes AS text), notes),
            review_meeting_at = CASE WHEN CAST(:ends_on AS date) IS NOT NULL THEN NULL ELSE review_meeting_at END,
            updated_at=now() WHERE id=:id"""), {"ends_on": payload.ends_on, "notes": payload.notes, "id": contract_id})
    await db.commit()
    return ok(await _contracts(db, org, row["employee_id"]), "Contract updated.")


# --------------------------------------------------------------------------- credentials

@router.get("/people/{employee_id}/credentials")
async def list_credentials(employee_id: UUID, user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    await _employee(db, user["org_id"], employee_id)
    return ok(await _credentials(db, user["org_id"], employee_id), "Credentials.")


@router.post("/people/{employee_id}/credentials", status_code=201)
async def add_credential(
    employee_id: UUID,
    credential_type: str = Form(...),
    certification_name: str = Form(..., min_length=2, max_length=200),
    issuing_authority: Optional[str] = Form(default=None, max_length=200),
    certificate_number: Optional[str] = Form(default=None, max_length=120),
    licence_class: Optional[str] = Form(default=None, max_length=40),
    vehicle_registration: Optional[str] = Form(default=None, max_length=40),
    issued_on: Optional[date] = Form(default=None),
    expires_on: Optional[date] = Form(default=None),
    notes: Optional[str] = Form(default=None, max_length=4000),
    file: Optional[UploadFile] = File(default=None),
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    if credential_type not in CREDENTIAL_TYPES:
        raise HTTPException(422, f"credential_type must be one of {', '.join(CREDENTIAL_TYPES)}")
    if issued_on and expires_on and expires_on < issued_on:
        raise HTTPException(422, "Expiry cannot be before the issue date")
    if credential_type == "drivers_licence" and not licence_class:
        raise HTTPException(422, "Give the licence class (e.g. 2, 4, EC)")
    if credential_type == "vehicle_registration" and not vehicle_registration:
        raise HTTPException(422, "Give the vehicle registration number")
    employee = await _employee(db, org, employee_id)
    file_id = await _store_file(db, user, employee, file, "Credentials")
    await db.execute(text("""
        INSERT INTO hr.employee_certifications (organization_id, employee_id, credential_type, certification_name, issuing_authority,
          certificate_number, licence_class, vehicle_registration, issued_on, expires_on, verification_status, file_attachment_id,
          notes, created_by)
        VALUES (:org, :emp, :type, :name, :authority, :number, :class, :reg, :issued, :expires,
          CASE WHEN CAST(:expires AS date) < CURRENT_DATE THEN 'expired' ELSE 'pending' END, :file_id, :notes, :actor)
    """), {"org": org, "emp": employee_id, "type": credential_type, "name": certification_name, "authority": issuing_authority,
           "number": certificate_number, "class": licence_class, "reg": (vehicle_registration or "").upper() or None,
           "issued": issued_on, "expires": expires_on, "file_id": file_id, "notes": notes, "actor": user["user_id"]})
    await db.commit()
    return ok(await _credentials(db, org, employee_id), "Credential recorded.")


@router.patch("/credentials/{credential_id}")
async def change_credential(
    credential_id: UUID,
    payload: CredentialChange,
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    row = (await db.execute(text("SELECT employee_id FROM hr.employee_certifications WHERE organization_id=:org AND id=:id AND is_deleted=false"),
                            {"org": org, "id": credential_id})).first()
    if not row:
        raise HTTPException(404, "Credential not found")
    await db.execute(text("""UPDATE hr.employee_certifications SET
        verification_status = COALESCE(CAST(:status AS varchar), verification_status),
        verified_at = CASE WHEN CAST(:status AS varchar) = 'verified' THEN now() ELSE verified_at END,
        verified_by = CASE WHEN CAST(:status AS varchar) = 'verified' THEN CAST(:actor AS uuid) ELSE verified_by END,
        expires_on = COALESCE(CAST(:expires AS date), expires_on),
        notes = COALESCE(CAST(:notes AS text), notes), updated_at = now()
        WHERE id=:id"""), {"status": payload.verification_status, "actor": user["user_id"], "expires": payload.expires_on,
                           "notes": payload.notes, "id": credential_id})
    await db.commit()
    return ok(await _credentials(db, org, row.employee_id), "Credential updated.")


@router.delete("/credentials/{credential_id}")
async def remove_credential(credential_id: UUID, user: dict = Depends(require_permission(WRITE)), db: AsyncSession = Depends(get_db)):
    org = user["org_id"]
    row = (await db.execute(text("""UPDATE hr.employee_certifications SET is_deleted=true, updated_at=now()
        WHERE organization_id=:org AND id=:id AND is_deleted=false RETURNING employee_id"""), {"org": org, "id": credential_id})).first()
    if not row:
        raise HTTPException(404, "Credential not found")
    await db.commit()
    return ok(await _credentials(db, org, row.employee_id), "Credential removed.")


# --------------------------------------------------------------------------- assets

@router.get("/people/{employee_id}/assets")
async def list_assets(employee_id: UUID, user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    await _employee(db, user["org_id"], employee_id)
    return ok(await _assets(db, user["org_id"], employee_id), "Assets.")


@router.post("/people/{employee_id}/assets", status_code=201)
async def issue_asset(
    employee_id: UUID,
    payload: AssetIssue,
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    employee = await _employee(db, org, employee_id)
    if employee["employment_status"] == "terminated":
        raise HTTPException(409, "This person has left the organisation")
    if payload.due_back_on and payload.due_back_on < payload.issued_on:
        raise HTTPException(422, "Due-back date is before the issue date")
    await db.execute(text("""
        INSERT INTO hr.employee_asset_assignments (organization_id, employee_id, asset_type, asset_label, asset_reference, serial_number,
          quantity, asset_value, issued_on, due_back_on, condition_out, status, notes, issued_by, acknowledged_at, created_by)
        VALUES (:org, :emp, :asset_type, :asset_label, :asset_reference, :serial_number, :quantity, :asset_value, :issued_on,
          :due_back_on, :condition_out, 'issued', :notes, :actor, CASE WHEN :acknowledged THEN now() END, :actor)
    """), {**payload.model_dump(), "org": org, "emp": employee_id, "actor": user["user_id"]})
    await db.commit()
    return ok(await _assets(db, org, employee_id), "Asset issued.")


@router.post("/assets/{assignment_id}/return")
async def return_asset(
    assignment_id: UUID,
    payload: AssetReturn,
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    row = (await db.execute(text("""SELECT employee_id, issued_on FROM hr.employee_asset_assignments
        WHERE organization_id=:org AND id=:id AND is_deleted=false AND status='issued'"""), {"org": org, "id": assignment_id})).mappings().first()
    if not row:
        raise HTTPException(404, "No issued asset found")
    if payload.returned_on < row["issued_on"]:
        raise HTTPException(422, "Return date is before it was issued")
    await db.execute(text("""UPDATE hr.employee_asset_assignments SET status=:outcome, returned_on=:returned_on,
        condition_in=:condition_in, returned_to=:actor, notes=COALESCE(CAST(:notes AS text), notes), updated_at=now() WHERE id=:id"""),
                     {**payload.model_dump(), "actor": user["user_id"], "id": assignment_id})
    await db.commit()
    return ok(await _assets(db, org, row["employee_id"]), "Asset closed out.")


@router.post("/assets/{assignment_id}/acknowledgement")
async def attach_asset_acknowledgement(
    assignment_id: UUID,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission(WRITE)),
    db: AsyncSession = Depends(get_db),
):
    org = user["org_id"]
    row = (await db.execute(text("SELECT employee_id FROM hr.employee_asset_assignments WHERE organization_id=:org AND id=:id AND is_deleted=false"),
                            {"org": org, "id": assignment_id})).first()
    if not row:
        raise HTTPException(404, "Asset record not found")
    employee = await _employee(db, org, row.employee_id)
    file_id = await _store_file(db, user, employee, file, "Assets")
    await db.execute(text("UPDATE hr.employee_asset_assignments SET file_attachment_id=:f, acknowledged_at=COALESCE(acknowledged_at, now()), updated_at=now() WHERE id=:id"),
                     {"f": file_id, "id": assignment_id})
    await db.commit()
    return ok(await _assets(db, org, row.employee_id), "Signed acknowledgement attached.")


# --------------------------------------------------------------------------- files + alerts

@router.get("/attachments/{attachment_id}/open")
async def open_attachment(attachment_id: UUID, user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    """Only files attached to an HR contract, credential or asset can be opened here."""
    owned = (await db.execute(text("""
        SELECT 1 FROM hr.employee_contracts WHERE organization_id=:org AND file_attachment_id=:id
        UNION ALL SELECT 1 FROM hr.employee_certifications WHERE organization_id=:org AND file_attachment_id=:id
        UNION ALL SELECT 1 FROM hr.employee_asset_assignments WHERE organization_id=:org AND file_attachment_id=:id
        LIMIT 1
    """), {"org": user["org_id"], "id": attachment_id})).scalar()
    if not owned:
        raise HTTPException(404, "File not found")
    from app.services.microsoft.document_service import get_document_access
    try:
        access = await get_document_access(db, organization_id=user["org_id"], file_attachment_id=attachment_id)
    except Exception as exc:  # noqa: BLE001 - surface a clean error instead of a 500
        raise HTTPException(502, f"Could not open the file: {exc}")
    return ok(access, "File access.")


@router.get("/alerts/preview")
async def preview_alerts(user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    """What the next expiry run would send, without sending anything."""
    return ok(await expiry_alerts.run(db, org_id=user["org_id"], dry_run=True), "Pending expiry warnings.")


@router.post("/alerts/run")
async def run_alerts(user: dict = Depends(require_permission(WRITE)), db: AsyncSession = Depends(get_db)):
    """Send due expiry warnings now instead of waiting for the hourly job."""
    return ok(await expiry_alerts.run(db, org_id=user["org_id"]), "Expiry warnings sent.")


@router.get("/alerts/history")
async def alert_history(
    limit: int = Query(50, ge=1, le=200),
    user: dict = Depends(require_permission(READ)),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(text("""
        SELECT a.source_type, a.threshold_days, a.expires_on, a.sent_at, a.channels, e.employee_name,
               COALESCE(c.contract_number, cr.certification_name, aa.asset_label) AS item
        FROM hr.expiry_alerts a
        LEFT JOIN hr.employee_contracts c ON a.source_type='contract' AND c.id=a.source_id
        LEFT JOIN hr.employee_certifications cr ON a.source_type='credential' AND cr.id=a.source_id
        LEFT JOIN hr.employee_asset_assignments aa ON a.source_type='asset' AND aa.id=a.source_id
        LEFT JOIN hr.employees e ON e.id = COALESCE(c.employee_id, cr.employee_id, aa.employee_id)
        WHERE a.organization_id=:org ORDER BY a.sent_at DESC LIMIT :limit
    """), {"org": user["org_id"], "limit": limit})).mappings()
    return ok([dict(r) for r in rows], "Recent expiry warnings.")
