import csv
import io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Literal

from core.database import get_db
from core.security import require_permission

router = APIRouter()

def _org_id(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(status_code=403, detail="Organization context required.")
    return str(org_id)

def _user_id(user: dict) -> str:
    return str(user.get("sub") or user.get("user_id"))

@router.post("/import/csv")
async def import_csv(
    target_type: Literal["contacts", "leads", "organizations"],
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("crm.import")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    user_id = _user_id(user)

    contents = await file.read()
    decoded = contents.decode("utf-8")
    reader = csv.DictReader(io.StringIO(decoded))

    imported_count = 0
    row_errors: list[dict] = []

    for row_number, row in enumerate(reader, start=1):
        try:
            async with db.begin_nested():
                if target_type == "contacts":
                    await db.execute(
                        text("""
                            INSERT INTO crm.contacts (organization_id, contact_name, email, phone, job_title, created_by)
                            VALUES (:org_id, :name, :email, :phone, :job_title, :user_id)
                        """),
                        {
                            "org_id": org_id,
                            "name": row.get("contact_name") or row.get("name"),
                            "email": row.get("email"),
                            "phone": row.get("phone"),
                            "job_title": row.get("job_title"),
                            "user_id": user_id,
                        }
                    )
                elif target_type == "leads":
                    await db.execute(
                        text("""
                            INSERT INTO crm.leads (organization_id, company_name, contact_name, contact_email, contact_phone, lead_source, status, created_by)
                            VALUES (:org_id, :company, :name, :email, :phone, :source, 'New', :user_id)
                        """),
                        {
                            "org_id": org_id,
                            "company": row.get("company_name") or row.get("company"),
                            "name": row.get("contact_name") or row.get("name"),
                            "email": row.get("contact_email") or row.get("email"),
                            "phone": row.get("contact_phone") or row.get("phone"),
                            "source": row.get("lead_source") or "CSV Import",
                            "user_id": user_id,
                        }
                    )
                elif target_type == "organizations":
                    name = row.get("name") or row.get("company_name")
                    if not name:
                        raise ValueError("Missing required 'name' (or 'company_name') column.")
                    await db.execute(
                        text("""
                            INSERT INTO crm.organizations (organization_id, name, industry, sector, website, phone, email, address, registration_number, tax_id, created_by)
                            VALUES (:org_id, :name, :industry, :sector, :website, :phone, :email, :address, :registration_number, :tax_id, :user_id)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "org_id": org_id,
                            "name": name,
                            "industry": row.get("industry"),
                            "sector": row.get("sector"),
                            "website": row.get("website"),
                            "phone": row.get("phone"),
                            "email": row.get("email"),
                            "address": row.get("address"),
                            "registration_number": row.get("registration_number"),
                            "tax_id": row.get("tax_id"),
                            "user_id": user_id,
                        }
                    )
        except Exception as exc:
            row_errors.append({"row": row_number, "error": str(exc)})
            continue
        imported_count += 1

    await db.commit()
    message = f"Imported {imported_count} {target_type}."
    if row_errors:
        message += f" {len(row_errors)} row(s) failed."
    return {
        "success": True,
        "message": message,
        "data": {"imported": imported_count, "failed": len(row_errors), "errors": row_errors},
    }

@router.post("/import/vcard")
async def import_vcard(
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("crm.import")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    user_id = _user_id(user)
    
    contents = await file.read()
    decoded = contents.decode("utf-8")
    
    # Basic vCard parser
    imported_count = 0
    card_number = 0
    row_errors: list[dict] = []
    current_contact = {}

    for line in decoded.splitlines():
        if line.startswith("BEGIN:VCARD"):
            current_contact = {}
        elif line.startswith("FN:"):
            current_contact["name"] = line.split(":", 1)[1].strip()
        elif line.startswith("EMAIL") and ":" in line:
            current_contact["email"] = line.split(":", 1)[1].strip()
        elif line.startswith("TEL") and ":" in line:
            current_contact["phone"] = line.split(":", 1)[1].strip()
        elif line.startswith("TITLE:"):
            current_contact["job_title"] = line.split(":", 1)[1].strip()
        elif line.startswith("END:VCARD"):
            card_number += 1
            if current_contact.get("name"):
                try:
                    async with db.begin_nested():
                        await db.execute(
                            text("""
                                INSERT INTO crm.contacts (organization_id, contact_name, email, phone, job_title, created_by)
                                VALUES (:org_id, :name, :email, :phone, :job_title, :user_id)
                            """),
                            {
                                "org_id": org_id,
                                "name": current_contact["name"],
                                "email": current_contact.get("email"),
                                "phone": current_contact.get("phone"),
                                "job_title": current_contact.get("job_title"),
                                "user_id": user_id,
                            }
                        )
                except Exception as exc:
                    row_errors.append({"card": card_number, "error": str(exc)})
                    continue
                imported_count += 1

    await db.commit()
    message = f"Imported {imported_count} contacts from vCard."
    if row_errors:
        message += f" {len(row_errors)} card(s) failed."
    return {
        "success": True,
        "message": message,
        "data": {"imported": imported_count, "failed": len(row_errors), "errors": row_errors},
    }

@router.get("/export/csv")
async def export_csv(
    target_type: Literal["contacts", "leads", "opportunities", "tickets"],
    status_filter: str | None = None,
    user: dict = Depends(require_permission("crm.export")),
    db: AsyncSession = Depends(get_db),
):
    org_id = _org_id(user)
    output = io.StringIO()
    writer = csv.writer(output)

    if target_type == "contacts":
        writer.writerow(["contact_name", "email", "phone", "job_title"])
        result = await db.execute(
            text("SELECT contact_name, email, phone, job_title FROM crm.contacts WHERE organization_id = :org_id AND is_deleted = false"),
            {"org_id": org_id}
        )
        for row in result:
            writer.writerow(list(row))
    elif target_type == "leads":
        writer.writerow(["company_name", "contact_name", "contact_email", "contact_phone", "lead_source", "status"])
        query = "SELECT company_name, contact_name, contact_email, contact_phone, lead_source, status FROM crm.leads WHERE organization_id = :org_id AND is_deleted = false"
        params: dict = {"org_id": org_id}
        if status_filter:
            query += " AND status = :status_filter"
            params["status_filter"] = status_filter
        result = await db.execute(text(query), params)
        for row in result:
            writer.writerow(list(row))
    elif target_type == "opportunities":
        writer.writerow(["name", "stage", "deal_value", "win_loss_status", "expected_close_date", "sales_owner_id"])
        query = "SELECT name, stage, COALESCE(deal_value, budget) AS deal_value, win_loss_status, expected_close_date, sales_owner_id FROM crm.opportunities WHERE organization_id = :org_id AND is_deleted = false"
        params = {"org_id": org_id}
        if status_filter:
            query += " AND win_loss_status = :status_filter"
            params["status_filter"] = status_filter
        result = await db.execute(text(query), params)
        for row in result:
            writer.writerow(list(row))
    else:
        writer.writerow(["ticket_number", "subject", "category", "priority", "status", "created_at"])
        query = "SELECT ticket_number, subject, category, priority, status, created_at FROM crm.support_tickets WHERE organization_id = :org_id AND is_deleted = false"
        params = {"org_id": org_id}
        if status_filter:
            query += " AND status = :status_filter"
            params["status_filter"] = status_filter
        result = await db.execute(text(query), params)
        for row in result:
            writer.writerow(list(row))

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode("utf-8")),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={target_type}_export.csv"}
    )
