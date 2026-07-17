from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any, Optional
from pydantic import BaseModel

from core.database import get_db
from core.security import require_permission
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql

router = APIRouter()

# Leads are a separate CRM resource.  Do not reuse opportunity permissions here:
# lead qualification creates related CRM records and therefore has its own grant.
LEAD_READ_PERMISSION = "crm_leads.read"
LEAD_CREATE_PERMISSION = "crm_leads.create"
LEAD_UPDATE_PERMISSION = "crm_leads.update"
LEAD_DELETE_PERMISSION = "crm_leads.delete"
LEAD_QUALIFY_PERMISSION = "crm_leads.qualify"
RESERVED_COLUMNS = {
    "id",
    "created_at",
    "updated_at",
    "organization_id",
    "created_by",
    "is_deleted",
}
MUTABLE_COLUMNS = {
    "lead_source",
    "status",
    "company_name",
    "contact_name",
    "contact_email",
    "contact_phone",
    "sector",
    "estimated_budget",
    "ai_score",
    "ai_rationale",
    "assigned_to",
    "labels",
    "expected_close_date",
}

"""
Module: crm_leads
Description: Auto-generated CRUD endpoints for crm.leads.
"""


def _validated_payload_keys(payload: Dict[str, Any]) -> list[str]:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object.")

    rejected = [
        key
        for key in payload
        if key not in MUTABLE_COLUMNS and key not in RESERVED_COLUMNS
    ]
    if rejected:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported lead field(s): {', '.join(sorted(rejected))}",
        )

    return [key for key in payload if key in MUTABLE_COLUMNS]


def _require_org_id(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=403, detail="User does not belong to an organization."
        )
    return org_id


@router.get("/")
async def list_items(
    user: dict = Depends(require_permission(LEAD_READ_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    # Fetch active records scoped to the user's organization
    query = text("""
        SELECT *
        FROM crm.leads
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 100
    """)
    result = await db.execute(query, {"org_id": _require_org_id(user)})
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_leads listed.",
        "meta": {"total": len(items)},
    }


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(require_permission(LEAD_CREATE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = _validated_payload_keys(payload)

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = _require_org_id(user)
    params["user_id"] = user["sub"]

    query = insert_returning_id_sql("crm.leads", safe_keys, MUTABLE_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        return {
            "success": True,
            "data": {"id": new_id},
            "message": "crm_leads created.",
            "meta": {},
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{item_id}")
async def get_item(
    item_id: str,
    user: dict = Depends(require_permission(LEAD_READ_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        SELECT *
        FROM crm.leads
        WHERE id = :item_id AND organization_id = :org_id AND is_deleted = false
    """)
    result = await db.execute(
        query, {"item_id": item_id, "org_id": _require_org_id(user)}
    )
    item = result.first()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {
        "success": True,
        "data": dict(item._mapping),
        "message": "crm_leads retrieved.",
        "meta": {},
    }


@router.put("/{item_id}")
async def update_item(
    item_id: str,
    request: Request,
    user: dict = Depends(require_permission(LEAD_UPDATE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()
    safe_keys = _validated_payload_keys(payload)

    if not safe_keys:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    params = {k: payload[k] for k in safe_keys}
    params["item_id"] = item_id
    params["org_id"] = _require_org_id(user)

    query = update_returning_id_sql("crm.leads", safe_keys, MUTABLE_COLUMNS)

    try:
        result = await db.execute(query, params)
        if not result.first():
            raise HTTPException(status_code=404, detail="Item not found")

        await db.commit()
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "crm_leads updated.",
            "meta": {},
        }
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/{item_id}")
async def delete_item(
    item_id: str,
    user: dict = Depends(require_permission(LEAD_DELETE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    query = text("""
        UPDATE crm.leads
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :item_id AND organization_id = :org_id
        RETURNING id
    """)

    result = await db.execute(
        query, {"item_id": item_id, "org_id": _require_org_id(user)}
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Item not found")

    await db.commit()
    return {
        "success": True,
        "data": None,
        "message": "crm_leads deleted (soft delete).",
        "meta": {},
    }


class OrganizationQualify(BaseModel):
    name: str
    sector: Optional[str] = None
    website: Optional[str] = None
    registration_number: Optional[str] = None
    tax_id: Optional[str] = None
    address: Optional[str] = None


class ContactQualify(BaseModel):
    contact_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    job_title: Optional[str] = None
    whatsapp_preference: Optional[bool] = None


class OpportunityQualify(BaseModel):
    name: str
    stage: str
    budget: Optional[float] = None
    probability: Optional[int] = 0


class ActivityQualify(BaseModel):
    type: str
    notes: Optional[str] = None
    due_date: Optional[str] = None


class QualifyLeadPayload(BaseModel):
    organization: OrganizationQualify
    contact: ContactQualify
    opportunity: OpportunityQualify
    activity: Optional[ActivityQualify] = None


@router.post("/{lead_id}/qualify")
async def qualify_lead(
    lead_id: str,
    payload: QualifyLeadPayload,
    user: dict = Depends(require_permission(LEAD_QUALIFY_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    """
    Converts a Lead into an Opportunity and marks the Lead as Qualified
    """
    org_id = _require_org_id(user)
    user_id = user.get("sub")

    try:
        async with db.begin():
            # 0. Fetch and verify Lead exists and belongs to the user's organization
            lead_query = text("""
                SELECT id FROM crm.leads
                WHERE id = :lead_id AND organization_id = :org_id AND is_deleted = false
            """)
            lead_res = await db.execute(
                lead_query, {"lead_id": lead_id, "org_id": org_id}
            )
            lead_row = lead_res.first()
            if not lead_row:
                raise HTTPException(status_code=404, detail="Lead not found")

            # 1. Check if client organization exists in crm.organizations (by name)
            org_data = payload.organization
            fetch_org_query = text("""
                SELECT id FROM crm.organizations
                WHERE LOWER(name) = LOWER(:name) AND organization_id = :org_id AND is_deleted = false
                LIMIT 1
            """)
            org_res = await db.execute(
                fetch_org_query, {"name": org_data.name, "org_id": org_id}
            )
            org_row = org_res.first()

            if org_row:
                client_org_id = org_row[0]
            else:
                insert_org_query = text("""
                    INSERT INTO crm.organizations (
                        organization_id, name, sector, industry, website, registration_number, tax_id, address, created_by
                    ) VALUES (
                        :org_id, :name, :sector, :sector, :website, :registration_number, :tax_id, :address, :user_id
                    ) RETURNING id
                """)
                insert_org_res = await db.execute(
                    insert_org_query,
                    {
                        "org_id": org_id,
                        "name": org_data.name,
                        "sector": org_data.sector,
                        "website": org_data.website,
                        "registration_number": org_data.registration_number,
                        "tax_id": org_data.tax_id,
                        "address": org_data.address,
                        "user_id": user_id,
                    },
                )
                client_org_id = insert_org_res.scalar()

            # 2. Check if contact exists in crm.contacts (by email), if not, create it linked to the organization
            contact_data = payload.contact
            contact_id = None
            if contact_data.email:
                fetch_contact_query = text("""
                    SELECT id FROM crm.contacts
                    WHERE LOWER(email) = LOWER(:email) AND organization_id = :org_id AND is_deleted = false
                    LIMIT 1
                """)
                contact_res = await db.execute(
                    fetch_contact_query, {"email": contact_data.email, "org_id": org_id}
                )
                contact_row = contact_res.first()
                if contact_row:
                    contact_id = contact_row[0]

            if not contact_id:
                insert_contact_query = text("""
                    INSERT INTO crm.contacts (
                        organization_id, client_org_id, contact_name, email, phone, job_title, whatsapp_preference, created_by
                    ) VALUES (
                        :org_id, :client_org_id, :contact_name, :email, :phone, :job_title, :whatsapp_preference, :user_id
                    ) RETURNING id
                """)
                insert_contact_res = await db.execute(
                    insert_contact_query,
                    {
                        "org_id": org_id,
                        "client_org_id": client_org_id,
                        "contact_name": contact_data.contact_name,
                        "email": contact_data.email,
                        "phone": contact_data.phone,
                        "job_title": contact_data.job_title,
                        "whatsapp_preference": contact_data.whatsapp_preference,
                        "user_id": user_id,
                    },
                )
                contact_id = insert_contact_res.scalar()

            # 3. Create the opportunity in crm.opportunities linked to the organization and contact
            opp_data = payload.opportunity
            insert_opp_query = text("""
                INSERT INTO crm.opportunities (
                    organization_id, client_id, name, stage, budget, probability, created_by, lead_id
                ) VALUES (
                    :org_id, :client_id, :name, :stage, :budget, :probability, :user_id, :lead_id
                ) RETURNING id
            """)
            insert_opp_res = await db.execute(
                insert_opp_query,
                {
                    "org_id": org_id,
                    "client_id": contact_id,
                    "name": opp_data.name,
                    "stage": opp_data.stage,
                    "budget": opp_data.budget,
                    "probability": opp_data.probability,
                    "user_id": user_id,
                    "lead_id": lead_id,
                },
            )
            opportunity_id = insert_opp_res.scalar()

            # 4. If activity is provided, create it in crm.activities linked to the contact and opportunity
            if payload.activity:
                act_data = payload.activity
                insert_activity_query = text("""
                    INSERT INTO crm.activities (
                        organization_id, contact_id, lead_id, opportunity_id, type, subject, description, activity_date, status, created_by
                    ) VALUES (
                        :org_id, :contact_id, :lead_id, :opportunity_id, :type, :subject, :description, :activity_date, 'Pending', :user_id
                    )
                """)
                await db.execute(
                    insert_activity_query,
                    {
                        "org_id": org_id,
                        "contact_id": contact_id,
                        "lead_id": lead_id,
                        "opportunity_id": opportunity_id,
                        "type": act_data.type,
                        "subject": f"Qualify Lead Activity: {act_data.type}",
                        "description": act_data.notes,
                        "activity_date": act_data.due_date,
                        "user_id": user_id,
                    },
                )

            # 5. Mark the lead status = 'Qualified'
            update_lead_query = text("""
                UPDATE crm.leads
                SET status = 'Qualified', updated_at = NOW()
                WHERE id = :lead_id AND organization_id = :org_id
            """)
            await db.execute(update_lead_query, {"lead_id": lead_id, "org_id": org_id})

        return {
            "success": True,
            "message": "Lead qualified and converted to Opportunity",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Database error during lead qualification: {str(e)}",
        )
