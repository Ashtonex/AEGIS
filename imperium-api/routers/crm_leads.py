from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

from core.database import get_db
from core.security import require_permission, user_has_permission
from app.shared.sql import insert_returning_id_sql, update_returning_id_sql
from app.services.crm.automation_engine import fire_trigger
from app.services.crm.compliance_gap import check_and_alert_lead_compliance_gap

router = APIRouter()

# Leads are a separate CRM resource.  Do not reuse opportunity permissions here:
# lead qualification creates related CRM records and therefore has its own grant.
LEAD_READ_PERMISSION = "crm_leads.read"
LEAD_CREATE_PERMISSION = "crm_leads.create"
LEAD_UPDATE_PERMISSION = "crm_leads.update"
LEAD_DELETE_PERMISSION = "crm_leads.delete"
LEAD_QUALIFY_PERMISSION = "crm_leads.qualify"

# Once a lead has been decided - qualified (converted to an Opportunity) or
# disqualified - it's no longer an open lead a rep should be able to flip
# back and forth. Same rationale as crm.py's opportunity stage lock.
LOCKED_LEAD_STATUSES = {"converted", "disqualified"}
LEAD_STATUS_OVERRIDE_PERMISSION = "crm_leads.override_status"


async def _ensure_lead_status_unlocked(
    db: AsyncSession, user: dict, current_status: Optional[str]
) -> None:
    if (current_status or "").lower() not in LOCKED_LEAD_STATUSES:
        return
    if await user_has_permission(db, user, LEAD_STATUS_OVERRIDE_PERMISSION):
        return
    raise HTTPException(
        status_code=403,
        detail=(
            f"Lead is already {current_status} - only Admin, Executive, "
            "or Managing Director can change its status further."
        ),
    )
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
    "disqualification_reason",
    "client_org_id",
    "contact_id",
    "opportunity_id",
    "campaign_id",
    "budget_confirmed",
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

    # estimated_budget feeds directly into the opportunity created on
    # qualification (see handleQualifyLead's budget: lead.estimated_budget)
    # and is displayed unstyled-as-valid on the kanban card - a negative
    # value isn't a real-world budget and previously passed straight
    # through with no check on either create or update.
    if "estimated_budget" in payload and payload["estimated_budget"] is not None:
        try:
            budget_value = float(payload["estimated_budget"])
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="estimated_budget must be a number.")
        if budget_value < 0:
            raise HTTPException(status_code=400, detail="estimated_budget cannot be negative.")

    return [key for key in payload if key in MUTABLE_COLUMNS]


def _require_org_id(user: dict) -> str:
    org_id = user.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=403, detail="User does not belong to an organization."
        )
    return org_id


async def _sync_lead_compliance_requirements(
    db: AsyncSession, org_id: str, lead_id: str, codes: List[str], created_by: str
) -> None:
    """Makes crm.lead_compliance_requirements match `codes` exactly -
    removes any requirement no longer selected, adds any newly selected
    one. Unknown codes are silently ignored (the INSERT's JOIN just won't
    match them) rather than erroring, since this is a client-supplied list
    of type codes, not a validated enum."""
    codes = list(dict.fromkeys(codes or []))
    await db.execute(
        text("""
            DELETE FROM crm.lead_compliance_requirements
            WHERE lead_id = :lead_id AND organization_id = :org_id
              AND requirement_type_id NOT IN (
                  SELECT id FROM crm.compliance_requirement_types
                  WHERE organization_id = :org_id AND code = ANY(:codes)
              )
        """),
        {"lead_id": lead_id, "org_id": org_id, "codes": codes},
    )
    if codes:
        await db.execute(
            text("""
                INSERT INTO crm.lead_compliance_requirements (organization_id, lead_id, requirement_type_id, created_by)
                SELECT :org_id, :lead_id, t.id, :created_by
                FROM crm.compliance_requirement_types t
                WHERE t.organization_id = :org_id AND t.code = ANY(:codes) AND t.is_deleted = false
                ON CONFLICT (lead_id, requirement_type_id) DO NOTHING
            """),
            {"org_id": org_id, "lead_id": lead_id, "created_by": created_by, "codes": codes},
        )


@router.get("/compliance-requirement-types")
async def list_compliance_requirement_types(
    user: dict = Depends(require_permission(LEAD_READ_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
            SELECT id, code, label
            FROM crm.compliance_requirement_types
            WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
            ORDER BY label
        """),
        {"org_id": _require_org_id(user)},
    )
    items = [dict(row._mapping) for row in result]
    return {
        "success": True,
        "data": items,
        "message": "Compliance requirement types fetched.",
        "meta": {"total": len(items)},
    }


@router.get("/")
async def list_items(
    source: Optional[str] = Query(default=None),
    owner: Optional[str] = Query(default=None),
    sector: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    min_score: Optional[int] = Query(default=None, ge=0, le=100),
    user: dict = Depends(require_permission(LEAD_READ_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    # Fetch active records scoped to the user's organization. Two aggregate
    # subqueries surface compliance-requirement state without an N+1 fetch
    # per lead on the frontend: the codes currently selected (to prefill an
    # edit form) and the labels of any that are still unmet (to badge the
    # card) - "unmet" mirrors check_and_alert_lead_compliance_gap's own
    # satisfied-check exactly, so the badge never disagrees with the alert.
    query_sql = """
        SELECT l.*,
               (
                   SELECT COALESCE(array_agg(t.code ORDER BY t.code), ARRAY[]::text[])
                   FROM crm.lead_compliance_requirements lcr
                   JOIN crm.compliance_requirement_types t ON t.id = lcr.requirement_type_id
                   WHERE lcr.lead_id = l.id AND lcr.organization_id = l.organization_id
               ) AS required_compliance_types,
               (
                   SELECT COALESCE(array_agg(t.label ORDER BY t.label), ARRAY[]::text[])
                   FROM crm.lead_compliance_requirements lcr
                   JOIN crm.compliance_requirement_types t ON t.id = lcr.requirement_type_id
                   WHERE lcr.lead_id = l.id AND lcr.organization_id = l.organization_id
                     AND NOT EXISTS (
                         SELECT 1 FROM core.compliance_items ci
                         WHERE ci.organization_id = l.organization_id AND ci.requirement_type_id = t.id
                           AND ci.is_deleted = false
                           AND (ci.expiry_date IS NULL OR ci.expiry_date >= CURRENT_DATE)
                     )
               ) AS missing_compliance_labels
        FROM crm.leads l
        WHERE l.organization_id = :org_id AND l.is_deleted = false
    """
    params: Dict[str, Any] = {"org_id": _require_org_id(user)}
    if source:
        query_sql += " AND l.lead_source = :source"
        params["source"] = source
    if owner:
        query_sql += " AND (l.assigned_to::text = :owner OR l.owner_user_id::text = :owner)"
        params["owner"] = owner
    if sector:
        query_sql += " AND l.sector = :sector"
        params["sector"] = sector
    if status:
        query_sql += " AND lower(l.status) = lower(:status)"
        params["status"] = status
    if min_score is not None:
        query_sql += " AND COALESCE(l.ai_score, 0) >= :min_score"
        params["min_score"] = min_score
    query_sql += """
        ORDER BY l.created_at DESC
        LIMIT 100
    """
    result = await db.execute(text(query_sql), params)
    items = [dict(row._mapping) for row in result]

    return {
        "success": True,
        "data": items,
        "message": "crm_leads listed.",
        "meta": {"total": len(items)},
    }


@router.get("/duplicates")
async def find_duplicates(
    email: Optional[str] = Query(default=None),
    phone: Optional[str] = Query(default=None),
    company_name: Optional[str] = Query(default=None),
    user: dict = Depends(require_permission(LEAD_READ_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    if not (email or phone or company_name):
        raise HTTPException(status_code=422, detail="email, phone, or company_name is required.")
    org_id = _require_org_id(user)
    query = """
        SELECT id, company_name, contact_name, contact_email, contact_phone, status, ai_score, created_at
        FROM crm.leads
        WHERE organization_id=:org_id AND is_deleted=false AND (
            (:email IS NOT NULL AND lower(contact_email)=lower(:email))
            OR (:phone IS NOT NULL AND regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g') = regexp_replace(:phone, '[^0-9]', '', 'g'))
            OR (:company_name IS NOT NULL AND lower(company_name)=lower(:company_name))
        )
        ORDER BY created_at DESC
        LIMIT 25
    """
    rows = await db.execute(
        text(query),
        {"org_id": org_id, "email": email, "phone": phone, "company_name": company_name},
    )
    items = [dict(row._mapping) for row in rows]
    return {"success": True, "data": items, "message": "Duplicate lead candidates fetched.", "meta": {"total": len(items)}}


@router.post("/")
async def create_item(
    request: Request,
    user: dict = Depends(require_permission(LEAD_CREATE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    payload = await request.json()
    required_compliance_types = payload.pop("required_compliance_types", None)

    # Extract keys and values from JSON payload dynamically
    # Exclude reserved keys to prevent override
    safe_keys = _validated_payload_keys(payload)

    if not safe_keys:
        raise HTTPException(status_code=400, detail="Empty or invalid payload.")

    params = {k: payload[k] for k in safe_keys}
    params["org_id"] = _require_org_id(user)
    params["user_id"] = user["sub"]

    duplicate = await db.execute(
        text("""
        SELECT id
        FROM crm.leads
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND (
            (CAST(:contact_email AS text) IS NOT NULL AND lower(contact_email)=lower(CAST(:contact_email AS text)))
            OR (CAST(:contact_phone AS text) IS NOT NULL AND regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g') = regexp_replace(CAST(:contact_phone AS text), '[^0-9]', '', 'g'))
            OR (CAST(:company_name AS text) IS NOT NULL AND lower(company_name)=lower(CAST(:company_name AS text)))
          )
        LIMIT 1
        """),
        {
            "org_id": params["org_id"],
            "contact_email": params.get("contact_email") or None,
            "contact_phone": params.get("contact_phone") or None,
            "company_name": params.get("company_name") or None,
        },
    )
    duplicate_id = duplicate.scalar()
    if duplicate_id:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate lead candidate exists: {duplicate_id}",
        )

    query = insert_returning_id_sql("crm.leads", safe_keys, MUTABLE_COLUMNS)

    try:
        result = await db.execute(query, params)
        await db.commit()
        new_id = str(result.scalar())
        await fire_trigger(db, params["org_id"], user["sub"], "lead_created", {**params, "id": new_id})

        if required_compliance_types is not None:
            await _sync_lead_compliance_requirements(
                db, params["org_id"], new_id, required_compliance_types, user["sub"],
            )
            await db.commit()
            await check_and_alert_lead_compliance_gap(
                db, params["org_id"], new_id,
                params.get("company_name") or "Unnamed lead",
                params.get("estimated_budget"),
            )

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
    required_compliance_types = payload.pop("required_compliance_types", None)
    safe_keys = _validated_payload_keys(payload)
    org_id = _require_org_id(user)

    if not safe_keys and required_compliance_types is None:
        return {
            "success": True,
            "data": {"id": item_id},
            "message": "No fields to update.",
        }

    try:
        if safe_keys:
            params = {k: payload[k] for k in safe_keys}
            params["item_id"] = item_id
            params["org_id"] = org_id

            if "status" in params:
                current = await db.execute(
                    text("SELECT status FROM crm.leads WHERE id=:item_id AND organization_id=:org_id AND is_deleted=false"),
                    {"item_id": item_id, "org_id": org_id},
                )
                current_row = current.first()
                if not current_row:
                    raise HTTPException(status_code=404, detail="Item not found")
                if params["status"] != current_row.status:
                    await _ensure_lead_status_unlocked(db, user, current_row.status)

            query = update_returning_id_sql("crm.leads", safe_keys, MUTABLE_COLUMNS)
            result = await db.execute(query, params)
            if not result.first():
                raise HTTPException(status_code=404, detail="Item not found")

            await db.commit()
            if "ai_score" in params:
                await fire_trigger(
                    db, org_id, user["sub"], "lead_score_changed",
                    {"id": item_id, "lead_id": item_id, "ai_score": params["ai_score"]},
                )

        if required_compliance_types is not None:
            lead_row = await db.execute(
                text("SELECT id FROM crm.leads WHERE id=:item_id AND organization_id=:org_id AND is_deleted=false"),
                {"item_id": item_id, "org_id": org_id},
            )
            if not lead_row.first():
                raise HTTPException(status_code=404, detail="Item not found")

            await _sync_lead_compliance_requirements(
                db, org_id, item_id, required_compliance_types, user["sub"],
            )
            await db.commit()

            lead_summary = (
                await db.execute(
                    text("SELECT company_name, estimated_budget FROM crm.leads WHERE id=:item_id AND organization_id=:org_id"),
                    {"item_id": item_id, "org_id": org_id},
                )
            ).first()
            await check_and_alert_lead_compliance_gap(
                db, org_id, item_id,
                (lead_summary.company_name if lead_summary else None) or "Unnamed lead",
                lead_summary.estimated_budget if lead_summary else None,
            )

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
    budget_confirmed: Optional[bool] = False


class ActivityQualify(BaseModel):
    type: str
    notes: Optional[str] = None
    due_date: Optional[str] = None


class QualifyLeadPayload(BaseModel):
    organization: OrganizationQualify
    contact: ContactQualify
    opportunity: OpportunityQualify
    activity: Optional[ActivityQualify] = None


class DisqualifyLeadPayload(BaseModel):
    reason: str


class MergeLeadPayload(BaseModel):
    source_lead_ids: list[str]


@router.post("/{lead_id}/disqualify")
async def disqualify_lead(
    lead_id: str,
    payload: DisqualifyLeadPayload,
    user: dict = Depends(require_permission(LEAD_UPDATE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    org_id = _require_org_id(user)
    current = await db.execute(
        text("SELECT status FROM crm.leads WHERE id=:lead_id AND organization_id=:org_id AND is_deleted=false"),
        {"lead_id": lead_id, "org_id": org_id},
    )
    current_row = current.first()
    if not current_row:
        raise HTTPException(status_code=404, detail="Lead not found")
    await _ensure_lead_status_unlocked(db, user, current_row.status)

    result = await db.execute(
        text("""
        UPDATE crm.leads
        SET status='disqualified',
            disqualification_reason=:reason,
            updated_at=NOW()
        WHERE id=:lead_id AND organization_id=:org_id AND is_deleted=false
        RETURNING id
        """),
        {"lead_id": lead_id, "org_id": org_id, "reason": payload.reason},
    )
    if not result.first():
        raise HTTPException(status_code=404, detail="Lead not found")
    await db.commit()
    return {"success": True, "data": {"id": lead_id}, "message": "Lead disqualified.", "meta": {}}


@router.post("/{lead_id}/merge")
async def merge_leads(
    lead_id: str,
    payload: MergeLeadPayload,
    user: dict = Depends(require_permission(LEAD_UPDATE_PERMISSION)),
    db: AsyncSession = Depends(get_db),
):
    if not payload.source_lead_ids:
        raise HTTPException(status_code=422, detail="At least one source lead is required.")
    org_id = _require_org_id(user)
    result = await db.execute(
        text("""
        UPDATE crm.leads
        SET is_deleted=true,
            updated_at=NOW(),
            disqualification_reason=COALESCE(disqualification_reason, 'Merged into lead ' || :lead_id)
        WHERE id::text = ANY(:source_ids)
          AND id::text <> :lead_id
          AND organization_id=:org_id
          AND is_deleted=false
        RETURNING id
        """),
        {"lead_id": lead_id, "source_ids": payload.source_lead_ids, "org_id": org_id},
    )
    merged_ids = [str(row.id) for row in result]
    await db.execute(
        text("""
        UPDATE crm.leads
        SET labels = array(
                SELECT DISTINCT unnest(COALESCE(labels, '{}'::text[]) || ARRAY['merged'])
            ),
            updated_at=NOW()
        WHERE id=:lead_id AND organization_id=:org_id AND is_deleted=false
        """),
        {"lead_id": lead_id, "org_id": org_id},
    )
    await db.commit()
    return {"success": True, "data": {"id": lead_id, "merged_ids": merged_ids}, "message": "Duplicate leads merged.", "meta": {"merged": len(merged_ids)}}


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
        # 0. Fetch and verify Lead exists and belongs to the user's organization
        lead_query = text("""
            SELECT id, campaign_id, status FROM crm.leads
            WHERE id = :lead_id AND organization_id = :org_id AND is_deleted = false
        """)
        lead_res = await db.execute(
            lead_query, {"lead_id": lead_id, "org_id": org_id}
        )
        lead_row = lead_res.first()
        if not lead_row:
            raise HTTPException(status_code=404, detail="Lead not found")
        await _ensure_lead_status_unlocked(db, user, lead_row.status)

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
                organization_id, client_id, name, stage, budget, probability, created_by, lead_id, budget_confirmed
            ) VALUES (
                :org_id, :client_id, :name, :stage, :budget, :probability, :user_id, :lead_id, :budget_confirmed
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
                "budget_confirmed": bool(opp_data.budget_confirmed),
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

        # 5. Mark the lead converted and persist relationship links for traceability.
        update_lead_query = text("""
            UPDATE crm.leads
            SET status = 'converted',
                client_org_id = :client_org_id,
                contact_id = :contact_id,
                opportunity_id = :opportunity_id,
                converted_at = NOW(),
                updated_at = NOW()
            WHERE id = :lead_id AND organization_id = :org_id
        """)
        await db.execute(
            update_lead_query,
            {
                "lead_id": lead_id,
                "org_id": org_id,
                "client_org_id": client_org_id,
                "contact_id": contact_id,
                "opportunity_id": opportunity_id,
            },
        )
        if lead_row.campaign_id:
            await db.execute(
                text("""
                INSERT INTO crm.campaign_members (
                    organization_id, campaign_id, lead_id, contact_id, opportunity_id,
                    member_status, source, created_by
                )
                VALUES (
                    :org_id, :campaign_id, :lead_id, :contact_id, :opportunity_id,
                    'converted', 'lead_qualification', :user_id
                )
                """),
                {
                    "org_id": org_id,
                    "campaign_id": lead_row.campaign_id,
                    "lead_id": lead_id,
                    "contact_id": contact_id,
                    "opportunity_id": opportunity_id,
                    "user_id": user_id,
                },
            )

        await db.commit()
        return {
            "success": True,
            "data": {
                "organization_id": str(client_org_id),
                "contact_id": str(contact_id),
                "opportunity_id": str(opportunity_id),
            },
            "message": "Lead qualified and converted to Opportunity",
            "meta": {},
        }
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Database error during lead qualification: {str(e)}",
        )
