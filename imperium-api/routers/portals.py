"""Server-side portal admission. A session alone never selects a portal."""

import json
from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_role_notification
from app.shared.vendor_verification import run_system_verification_check
from core.database import get_db
from core.security import get_current_user, resolve_primary_role

router = APIRouter()

_PORTALS = {
    "executive": "/dashboard/executive",
    "employee": "/dashboard/executive",
    "foreman": "/portal/foreman",
    "site-engineer": "/portal/site-engineer",
    "site-agent": "/portal/site-agent",
    "qs": "/portal/qs",
    "client": "/portal/client",
    "supplier": "/portal/supplier",
}


async def _get_client_portal_context(
    user: dict,
    db: AsyncSession,
):
    context = (
        await db.execute(
            text("""
            SELECT
                cpa.contact_id,
                c.client_org_id,
                c.contact_name,
                c.email,
                c.phone,
                c.job_title,
                c.whatsapp_preference,
                co.name AS company_name,
                co.email AS company_email,
                co.phone AS company_phone,
                co.address AS company_address
            FROM crm.client_portal_access cpa
            JOIN crm.contacts c ON c.id = cpa.contact_id
             AND c.organization_id = cpa.organization_id
             AND c.is_deleted = false
            LEFT JOIN crm.organizations co ON co.id = c.client_org_id
             AND co.organization_id = cpa.organization_id
             AND co.is_deleted = false
            WHERE cpa.user_id = :user_id
              AND cpa.organization_id = :org_id
              AND cpa.is_active = true
        """),
            {"user_id": user["user_id"], "org_id": user["org_id"]},
        )
    ).first()

    if not context:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not provisioned for the client portal.",
        )

    return dict(context._mapping)


class ClientProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    company_name: Optional[str] = Field(default=None, max_length=255)
    company_email: Optional[str] = Field(default=None, max_length=255)
    company_phone: Optional[str] = Field(default=None, max_length=50)
    company_address: Optional[str] = None
    contact_name: Optional[str] = Field(default=None, max_length=255)
    email: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=50)
    job_title: Optional[str] = Field(default=None, max_length=100)
    whatsapp_preference: Optional[bool] = None


async def _needs_password_setup(user: dict, db: AsyncSession) -> bool:
    value = (
        await db.execute(
            text("""
            SELECT must_change_password
            FROM core.users
            WHERE id = :user_id
              AND organization_id = :org_id
              AND is_deleted = false
        """),
            {"user_id": user["user_id"], "org_id": user["org_id"]},
        )
    ).scalar()
    return bool(value)


@router.get("/resolve-access")
async def resolve_portal_access(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve the user's role and automatically determine the destination portal.
    """
    if await _needs_password_setup(user, db):
        return {
            "success": True,
            "data": {"portal": "setup-password", "destination": "/setup-password"},
            "message": "Password setup is required for this account.",
            "meta": {},
        }

    params = {"user_id": user["user_id"], "org_id": user["org_id"]}
    roles = (
        (
            await db.execute(
                text("""
        SELECT r.name FROM core.user_roles ur
        JOIN core.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :user_id AND ur.organization_id = :org_id
          AND r.organization_id = :org_id AND r.is_deleted = false
    """),
                params,
            )
        )
        .scalars()
        .all()
    )
    role_names = {str(role).upper() for role in roles}

    # 1. Executive / Superadmin check
    if user.get("role") == "SUPERADMIN" or "SUPERADMIN" in role_names:
        return {
            "success": True,
            "data": {"portal": "executive", "destination": "/dashboard/executive"},
            "message": "Executive portal access confirmed.",
            "meta": {},
        }

    primary_role = None
    landing_path = None
    primary_role_name = ""
    if role_names:
        primary_role, landing_path = await resolve_primary_role(
            db, user["user_id"], user["org_id"], fallback_role="EMPLOYEE"
        )
        primary_role_name = primary_role.upper()

    # Internal commercial/office roles can hold secondary operational roles
    # for visibility, but their login destination must stay on their primary
    # workspace. Otherwise CRM Associates with an extra Quantity Surveyor
    # assignment get trapped in /portal/qs.
    portal_primary_roles = {
        "SITE ENGINEER",
        "SITE AGENT",
        "QUANTITY SURVEYOR",
        "FOREMAN",
        "SITE CLERK",
        "STOREKEEPER",
        "CLIENT",
        "SUPPLIER",
    }
    if role_names and primary_role_name not in portal_primary_roles:
        return {
            "success": True,
            "data": {
                "portal": "employee",
                "destination": landing_path or "/dashboard/executive",
            },
            "message": "Internal portal access confirmed.",
            "meta": {},
        }

    # 2. Site Engineer gets the technical control portal.
    if primary_role_name == "SITE ENGINEER":
        return {
            "success": True,
            "data": {"portal": "site-engineer", "destination": "/portal/site-engineer"},
            "message": "Site Engineer portal access confirmed.",
            "meta": {},
        }

    # 3. Site Agent gets the weekly execution and programme control portal.
    if primary_role_name == "SITE AGENT":
        return {
            "success": True,
            "data": {"portal": "site-agent", "destination": "/portal/site-agent"},
            "message": "Site Agent portal access confirmed.",
            "meta": {},
        }

    # 4. Quantity Surveyor gets the commercial entitlement portal.
    if primary_role_name == "QUANTITY SURVEYOR":
        return {
            "success": True,
            "data": {"portal": "qs", "destination": "/portal/qs"},
            "message": "QS portal access confirmed.",
            "meta": {},
        }

    # 5. Foreman / site-team check
    if primary_role_name in {"FOREMAN", "SITE CLERK", "STOREKEEPER"}:
        return {
            "success": True,
            "data": {"portal": "foreman", "destination": "/portal/foreman"},
            "message": "Foreman portal access confirmed.",
            "meta": {},
        }

    # 6. Client check - external accounts are confined to the client portal,
    # never falling through to the internal dashboard below.
    if primary_role_name == "CLIENT":
        client_access = (
            await db.execute(
                text("""
            SELECT 1 FROM crm.client_portal_access
            WHERE user_id = :user_id AND organization_id = :org_id AND is_active = true
        """),
                params,
            )
        ).scalar()
        if client_access:
            return {
                "success": True,
                "data": {"portal": "client", "destination": "/portal/client"},
                "message": "Client portal access confirmed.",
                "meta": {},
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not provisioned for the client portal.",
        )

    # 7. Supplier check - same confinement as clients.
    if primary_role_name == "SUPPLIER":
        supplier_access = (
            await db.execute(
                text("""
            SELECT 1 FROM crm.supplier_portal_access
            WHERE user_id = :user_id AND organization_id = :org_id AND is_active = true
        """),
                params,
            )
        ).scalar()
        if supplier_access:
            return {
                "success": True,
                "data": {"portal": "supplier", "destination": "/portal/supplier"},
                "message": "Supplier portal access confirmed.",
                "meta": {},
            }
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not provisioned for the supplier portal.",
        )

    # 8. Any other internal role (Executive (Admin), Finance Manager, Project
    # Manager, and the rest of the functional/management role catalog) lands
    # on that role's own working page - core.roles.default_landing_path,
    # resolved via the same primary-role precedence get_current_user uses
    # (functional role wins over the base EMPLOYEE assignment most staff also
    # hold). Falls back to the internal ERP dashboard for EMPLOYEE-only
    # accounts and any role with no landing page configured. Only the
    # external CLIENT/SUPPLIER roles and the site-team roles above are
    # confined elsewhere - everyone else holding a real, organization-scoped
    # role is internal staff.
    if role_names:
        return {
            "success": True,
            "data": {
                "portal": "employee",
                "destination": landing_path or "/dashboard/executive",
            },
            "message": "Internal portal access confirmed.",
            "meta": {},
        }

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="This account is not provisioned for any portal. Please contact an AEGIS administrator.",
    )


@router.post("/password-setup/complete")
async def complete_password_setup(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.users
        SET must_change_password = false, updated_at = NOW()
        WHERE id = :user_id
          AND organization_id = :org_id
          AND is_deleted = false
        RETURNING id
    """),
        {"user_id": user["user_id"], "org_id": user["org_id"]},
    )
    if not result.scalar():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User profile could not be updated.",
        )
    await db.commit()
    return {
        "success": True,
        "data": {"complete": True},
        "message": "Password setup completed.",
        "meta": {},
    }


@router.get("/access/{portal}")
async def get_portal_access(
    portal: str,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if portal not in _PORTALS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Portal not found."
        )

    if await _needs_password_setup(user, db):
        return {
            "success": True,
            "data": {"portal": "setup-password", "destination": "/setup-password"},
            "message": "Password setup is required for this account.",
            "meta": {},
        }

    params = {"user_id": user["user_id"], "org_id": user["org_id"]}
    roles = (
        (
            await db.execute(
                text("""
        SELECT r.name FROM core.user_roles ur
        JOIN core.roles r ON r.id = ur.role_id
        WHERE ur.user_id = :user_id AND ur.organization_id = :org_id
          AND r.organization_id = :org_id AND r.is_deleted = false
    """),
                params,
            )
        )
        .scalars()
        .all()
    )
    role_names = {str(role).upper() for role in roles}

    if portal == "executive":
        allowed = user.get("role") == "SUPERADMIN" or "SUPERADMIN" in role_names
    elif portal == "employee":
        allowed = user.get("role") == "SUPERADMIN" or bool(
            {"SUPERADMIN", "EMPLOYEE"} & role_names
        )
    elif portal == "foreman":
        allowed = user.get("role") == "SUPERADMIN" or bool(
            {"SUPERADMIN", "FOREMAN", "SITE AGENT", "SITE CLERK", "STOREKEEPER", "PROJECT MANAGER"} & role_names
        )
    elif portal == "site-engineer":
        allowed = user.get("role") == "SUPERADMIN" or bool(
            {"SUPERADMIN", "SITE ENGINEER", "PROJECT MANAGER"} & role_names
        )
    elif portal == "site-agent":
        allowed = user.get("role") == "SUPERADMIN" or bool(
            {"SUPERADMIN", "SITE AGENT", "PROJECT MANAGER"} & role_names
        )
    elif portal == "qs":
        allowed = user.get("role") == "SUPERADMIN" or bool(
            {"SUPERADMIN", "QUANTITY SURVEYOR", "COMMERCIAL MANAGER", "PROJECT MANAGER"} & role_names
        )
    elif portal == "client":
        allowed = "CLIENT" in role_names and bool(
            (
                await db.execute(
                    text("""
            SELECT 1 FROM crm.client_portal_access
            WHERE user_id = :user_id AND organization_id = :org_id AND is_active = true
        """),
                    params,
                )
            ).scalar()
        )
    else:
        allowed = "SUPPLIER" in role_names and bool(
            (
                await db.execute(
                    text("""
            SELECT 1 FROM crm.supplier_portal_access
            WHERE user_id = :user_id AND organization_id = :org_id AND is_active = true
        """),
                    params,
                )
            ).scalar()
        )

    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not provisioned for the requested portal.",
        )

    return {
        "success": True,
        "data": {"portal": portal, "destination": _PORTALS[portal]},
        "message": "Portal access confirmed.",
        "meta": {},
    }


@router.get("/client/workspace")
async def get_client_workspace(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    ticket_rows = await db.execute(
        text("""
        SELECT id, description AS issue_description, created_at, updated_at
        FROM crm.support_tickets
        WHERE organization_id = :org_id
          AND contact_id = :contact_id
          AND is_deleted = false
        ORDER BY created_at DESC
        LIMIT 50
    """),
        {"org_id": user["org_id"], "contact_id": client["contact_id"]},
    )
    tickets = [dict(row._mapping) for row in ticket_rows]
    message_rows = await db.execute(
        text("""
        SELECT
            ce.id,
            ce.channel,
            ce.direction,
            ce.subject,
            ce.body,
            ce.status,
            ce.started_at,
            ce.created_at,
            actor.full_name AS actor_name,
            actor.email AS actor_email
        FROM crm.communication_events ce
        LEFT JOIN core.users actor ON actor.id = ce.actor_user_id
        WHERE ce.organization_id = :org_id
          AND ce.contact_id = :contact_id
          AND ce.is_deleted = false
          AND ce.channel IN ('portal_message', 'email', 'manual_note')
        ORDER BY ce.started_at DESC
        LIMIT 50
    """),
        {"org_id": user["org_id"], "contact_id": client["contact_id"]},
    )
    messages = [dict(row._mapping) for row in message_rows]

    return {
        "success": True,
        "data": {
            "client": client,
            "tickets": tickets,
            "messages": messages,
            "modules": [
                {"key": "messages", "label": "Communication thread", "status": "active"},
                {"key": "tickets", "label": "Support tickets", "status": "active"},
                {"key": "documents", "label": "Project documents", "status": "pending"},
                {"key": "progress", "label": "Project progress", "status": "pending"},
                {"key": "commercial", "label": "Commercial records", "status": "pending"},
            ],
        },
        "message": "Client portal workspace loaded.",
        "meta": {"total_tickets": len(tickets), "total_messages": len(messages)},
    }


@router.patch("/client/profile")
async def update_client_profile(
    payload: ClientProfileUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No profile fields supplied.")

    contact_fields = {key: updates[key] for key in ("contact_name", "email", "phone", "job_title", "whatsapp_preference") if key in updates}
    if contact_fields:
        set_clauses = [f"{field} = :{field}" for field in contact_fields]
        set_clauses.append("updated_at = NOW()")
        await db.execute(
            text(f"""
            UPDATE crm.contacts
            SET {', '.join(set_clauses)}
            WHERE id = :contact_id
              AND organization_id = :org_id
              AND is_deleted = false
        """),
            {
                **contact_fields,
                "contact_id": client["contact_id"],
                "org_id": user["org_id"],
            },
        )

    company_fields = {
        key.replace("company_", ""): updates[key]
        for key in ("company_name", "company_email", "company_phone", "company_address")
        if key in updates
    }
    if company_fields:
        org_id = client.get("client_org_id")
        if not org_id:
            created = (
                await db.execute(
                    text("""
                    INSERT INTO crm.organizations (
                        organization_id, created_by, name, email, phone, address
                    )
                    VALUES (
                        :org_id, :user_id, :name, :email, :phone, :address
                    )
                    RETURNING id
                """),
                    {
                        "org_id": user["org_id"],
                        "user_id": user["user_id"],
                        "name": company_fields.get("name") or client.get("company_name") or "Client company",
                        "email": company_fields.get("email"),
                        "phone": company_fields.get("phone"),
                        "address": company_fields.get("address"),
                    },
                )
            ).scalar()
            org_id = str(created)
            await db.execute(
                text("""
                UPDATE crm.contacts
                SET client_org_id = :client_org_id, updated_at = NOW()
                WHERE id = :contact_id
                  AND organization_id = :org_id
                  AND is_deleted = false
            """),
                {
                    "client_org_id": org_id,
                    "contact_id": client["contact_id"],
                    "org_id": user["org_id"],
                },
            )
        else:
            set_clauses = [f"{field} = :company_{field}" for field in company_fields]
            set_clauses.append("updated_at = NOW()")
            await db.execute(
                text(f"""
                UPDATE crm.organizations
                SET {', '.join(set_clauses)}
                WHERE id = :client_org_id
                  AND organization_id = :org_id
                  AND is_deleted = false
            """),
                {
                    **{f"company_{key}": value for key, value in company_fields.items()},
                    "client_org_id": org_id,
                    "org_id": user["org_id"],
                },
            )

    await db.commit()
    return {"success": True, "data": {"contact_id": client["contact_id"]}, "message": "Client profile updated.", "meta": {}}


@router.post("/client/tickets")
async def create_client_ticket(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    payload = await request.json()
    issue_description = str(payload.get("issue_description") or "").strip()
    if len(issue_description) < 10:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please provide at least 10 characters describing the request.",
        )

    result = await db.execute(
        text("""
        INSERT INTO crm.support_tickets (
            organization_id,
            created_by,
            contact_id,
            subject,
            description
        )
        VALUES (:org_id, :user_id, :contact_id, :subject, :issue_description)
        RETURNING id, description AS issue_description, created_at, updated_at
    """),
        {
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "contact_id": client["contact_id"],
            "subject": issue_description[:255],
            "issue_description": issue_description,
        },
    )
    await db.commit()
    ticket = result.first()
    if ticket:
        await db.execute(
            text("""
            INSERT INTO crm.communication_events (
                organization_id,
                created_by,
                actor_user_id,
                contact_id,
                channel,
                direction,
                subject,
                body,
                status,
                metadata
            )
            VALUES (
                :org_id,
                :user_id,
                :user_id,
                :contact_id,
                'portal_message',
                'inbound',
                :subject,
                :body,
                'received',
                CAST(:metadata AS jsonb)
            )
        """),
            {
                "org_id": user["org_id"],
                "user_id": user["user_id"],
                "contact_id": client["contact_id"],
                "subject": "Client portal request",
                "body": issue_description,
                "metadata": json.dumps({"ticket_id": str(ticket.id), "source": "client_portal"}),
            },
        )
        await db.commit()

    return {
        "success": True,
        "data": dict(ticket._mapping) if ticket else None,
        "message": "Client portal ticket created.",
        "meta": {},
    }


@router.post("/client/messages", status_code=status.HTTP_201_CREATED)
async def create_client_message(
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    payload = await request.json()
    body = str(payload.get("body") or "").strip()
    subject = str(payload.get("subject") or "Client portal message").strip()
    if len(body) < 2:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Message body is required.",
        )

    result = await db.execute(
        text("""
        INSERT INTO crm.communication_events (
            organization_id,
            created_by,
            actor_user_id,
            contact_id,
            channel,
            direction,
            subject,
            body,
            status,
            from_address,
            metadata
        )
        VALUES (
            :org_id,
            :user_id,
            :user_id,
            :contact_id,
            'portal_message',
            'inbound',
            :subject,
            :body,
            'received',
            :from_address,
            CAST(:metadata AS jsonb)
        )
        RETURNING id, channel, direction, subject, body, status, started_at, created_at
    """),
        {
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "contact_id": client["contact_id"],
            "subject": subject[:255],
            "body": body,
            "from_address": client.get("email"),
            "metadata": json.dumps({"source": "client_portal"}),
        },
    )
    await db.commit()
    message = result.first()

    return {
        "success": True,
        "data": dict(message._mapping) if message else None,
        "message": "Client portal message sent.",
        "meta": {},
    }


# =============================================================================
# Supplier / Subcontractor portal
#
# Both "supplier" and "subcontractor" managed-account kinds share this single
# route (see PORTAL_ROLE_BY_ACCOUNT_TYPE in routers/settings.py - both map to
# the SUPPLIER role) and the same crm.subcontractors + supplier_portal_access
# identity. The frontend branches its copy/forms on the account's
# submission_data->>'account_type', not a different backend route.
# =============================================================================

async def _get_supplier_portal_context(user: dict, db: AsyncSession) -> dict:
    context = (
        await db.execute(
            text("""
            SELECT
                spa.subcontractor_id,
                s.name, s.registration_number, s.tax_clearance_number,
                s.nssa_number, s.praz_number, s.contact_name, s.contact_email,
                s.contact_phone, s.address, s.coverage_provinces,
                s.compliance_status, s.review_status, s.verification_stage,
                s.system_verified_at, s.system_verification_notes,
                s.hr_verified_at, s.hr_verification_notes,
                s.linked_supplier_id,
                s.submission_data->>'account_type' AS account_type,
                s.submission_data->>'preferred_contact_method' AS preferred_contact_method,
                s.submission_data->>'alternate_contact_name' AS alternate_contact_name,
                s.submission_data->>'alternate_contact_email' AS alternate_contact_email,
                s.submission_data->>'alternate_contact_phone' AS alternate_contact_phone,
                s.submission_data->>'accounts_contact_email' AS accounts_contact_email,
                s.submission_data->>'accounts_contact_phone' AS accounts_contact_phone
            FROM crm.supplier_portal_access spa
            JOIN crm.subcontractors s ON s.id = spa.subcontractor_id
             AND s.organization_id = spa.organization_id
             AND s.is_deleted = false
            WHERE spa.user_id = :user_id
              AND spa.organization_id = :org_id
              AND spa.is_active = true
        """),
            {"user_id": user["user_id"], "org_id": user["org_id"]},
        )
    ).first()

    if not context:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not provisioned for the supplier portal.",
        )

    return dict(context._mapping)


async def _pick_cash_account(db: AsyncSession, org_id: str, currency: str) -> str:
    account_id = (
        await db.execute(
            text("""
            SELECT id FROM finance.cash_accounts
            WHERE organization_id = :org_id AND is_active = true AND is_deleted = false
            ORDER BY (currency = :currency) DESC, created_at ASC
            LIMIT 1
        """),
            {"org_id": org_id, "currency": currency},
        )
    ).scalar()
    if not account_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No active cash account is configured. Ask Finance to set one up before clearing payments.",
        )
    return str(account_id)


class SupplierProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, max_length=255)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    tax_clearance_number: Optional[str] = Field(default=None, max_length=100)
    nssa_number: Optional[str] = Field(default=None, max_length=100)
    praz_number: Optional[str] = Field(default=None, max_length=100)
    contact_name: Optional[str] = Field(default=None, max_length=255)
    contact_email: Optional[str] = Field(default=None, max_length=255)
    contact_phone: Optional[str] = Field(default=None, max_length=50)
    address: Optional[str] = None
    coverage_provinces: Optional[list[str]] = None
    preferred_contact_method: Optional[str] = Field(default=None, max_length=40)
    alternate_contact_name: Optional[str] = Field(default=None, max_length=255)
    alternate_contact_email: Optional[str] = Field(default=None, max_length=255)
    alternate_contact_phone: Optional[str] = Field(default=None, max_length=50)
    accounts_contact_email: Optional[str] = Field(default=None, max_length=255)
    accounts_contact_phone: Optional[str] = Field(default=None, max_length=50)


class SupplierDocumentRegister(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    storage_path: str = Field(min_length=1, max_length=500)
    file_name: str = Field(min_length=1, max_length=255)
    mime_type: Optional[str] = Field(default=None, max_length=120)
    size_bytes: Optional[int] = None
    category: str = Field(min_length=1, max_length=80)
    expiry_date: Optional[date] = None


class VendorRateItemCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    rate_type: str = Field(pattern=r"^(material|transport|service)$")
    item_code: Optional[str] = Field(default=None, max_length=80)
    description: str = Field(min_length=1)
    unit_of_measure: str = Field(default="each", max_length=40)
    unit_price: float = Field(gt=0)
    currency: str = Field(default="USD", max_length=3)
    min_quantity: Optional[float] = None
    lead_time_days: Optional[int] = None
    route_from: Optional[str] = Field(default=None, max_length=255)
    route_to: Optional[str] = Field(default=None, max_length=255)


class SupplierRfqLineItem(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    description: str = Field(min_length=1, max_length=500)
    qty: Optional[float] = Field(default=None, gt=0)
    uom: Optional[str] = Field(default=None, max_length=40)
    unit_price: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=1000)


class SupplierRfqResponseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reference: Optional[str] = Field(default=None, max_length=160)
    total_amount: Optional[float] = Field(default=None, ge=0)
    delivery_days: Optional[int] = Field(default=None, gt=0, le=3650)
    validity_days: int = Field(default=30, gt=0, le=3650)
    notes: Optional[str] = None
    line_items: list[SupplierRfqLineItem] = Field(default_factory=list)
    quote_document_id: Optional[UUID] = None


class VendorPaymentRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: Optional[UUID] = None
    rate_type: Optional[str] = Field(default=None, pattern=r"^(material|transport|service)$")
    reference_description: str = Field(min_length=5)
    amount: float = Field(gt=0)
    currency: str = Field(default="USD", max_length=3)


class VendorPaymentRequestClear(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    receipt_document_id: UUID
    notes: Optional[str] = Field(default=None, max_length=1000)


@router.get("/supplier/workspace")
async def get_supplier_workspace(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    subcontractor_id = vendor["subcontractor_id"]

    rate_counts = await db.execute(
        text("""
        SELECT rate_type, COUNT(*) AS count
        FROM procurement.vendor_rate_items
        WHERE organization_id = :org_id AND subcontractor_id = :id AND is_deleted = false
        GROUP BY rate_type
    """),
        {"org_id": user["org_id"], "id": subcontractor_id},
    )

    payment_rows = await db.execute(
        text("""
        SELECT id, reference_description, amount, currency, status, submitted_at, cleared_at
        FROM finance.vendor_payment_requests
        WHERE organization_id = :org_id AND subcontractor_id = :id AND is_deleted = false
        ORDER BY submitted_at DESC LIMIT 50
    """),
        {"org_id": user["org_id"], "id": subcontractor_id},
    )
    payment_requests = [dict(r._mapping) for r in payment_rows]

    doc_rows = await db.execute(
        text("""
        SELECT d.id, d.title, d.category, d.expiry_date, d.created_at
        FROM core.document_links dl
        JOIN core.documents d ON d.id = dl.document_id AND d.organization_id = dl.organization_id AND d.is_deleted = false
        WHERE dl.organization_id = :org_id AND dl.entity_type = 'subcontractor' AND dl.entity_id = :id
          AND dl.is_deleted = false
        ORDER BY d.created_at DESC
    """),
        {"org_id": user["org_id"], "id": subcontractor_id},
    )
    documents = [dict(r._mapping) for r in doc_rows]
    open_requests = sum(1 for p in payment_requests if p["status"] in ("submitted", "acknowledged"))

    return {
        "success": True,
        "data": {
            "vendor": vendor,
            "rate_item_counts": {row.rate_type: row.count for row in rate_counts},
            "documents": documents,
            "payment_requests": payment_requests,
            "modules": [
                {"key": "profile", "label": "Company profile", "status": "active"},
                {"key": "documents", "label": "Compliance documents", "status": "active"},
                {"key": "rates", "label": "Rate catalog", "status": "active"},
                {"key": "payments", "label": "Payment requests", "status": "active"},
            ],
        },
        "message": "Supplier portal workspace loaded.",
        "meta": {"total_documents": len(documents), "open_payment_requests": open_requests},
    }


@router.patch("/supplier/profile")
async def update_supplier_profile(
    payload: SupplierProfileUpdate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No profile fields supplied.")

    metadata_fields = (
        "preferred_contact_method",
        "alternate_contact_name",
        "alternate_contact_email",
        "alternate_contact_phone",
        "accounts_contact_email",
        "accounts_contact_phone",
    )
    metadata_updates = {field: updates.pop(field) for field in metadata_fields if field in updates}
    set_clauses = []
    params: dict = {"id": vendor["subcontractor_id"], "org_id": user["org_id"]}
    for field, value in updates.items():
        if field == "coverage_provinces":
            set_clauses.append("coverage_provinces = CAST(:coverage_provinces AS text[])")
        else:
            set_clauses.append(f"{field} = :{field}")
        params[field] = value
    if metadata_updates:
        set_clauses.append(
            "submission_data = COALESCE(submission_data, '{}'::jsonb) || CAST(:submission_data_patch AS jsonb)"
        )
        params["submission_data_patch"] = json.dumps(metadata_updates)

    # Any profile edit invalidates a prior verification pass - re-review required.
    set_clauses.append("verification_stage = 'incomplete'")
    set_clauses.append("system_verified_at = NULL")
    set_clauses.append("hr_verified_at = NULL")
    set_clauses.append("updated_at = NOW()")

    await db.execute(
        text(f"UPDATE crm.subcontractors SET {', '.join(set_clauses)} WHERE id = :id AND organization_id = :org_id"),
        params,
    )
    await db.commit()
    return {"success": True, "data": {"id": vendor["subcontractor_id"]}, "message": "Profile updated.", "meta": {}}


@router.post("/supplier/profile/submit-for-review")
async def submit_supplier_profile_for_review(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    subcontractor_id = vendor["subcontractor_id"]

    outcome = await run_system_verification_check(
        db, org_id=user["org_id"], subcontractor_id=subcontractor_id
    )
    await db.commit()
    if outcome["problems"]:
        return {
            "success": True,
            "data": outcome,
            "message": "Profile is not yet complete for verification.",
            "meta": {},
        }
    return {
        "success": True,
        "data": outcome,
        "message": "Profile passed automated checks and has been sent to HR for verification.",
        "meta": {},
    }


@router.post("/supplier/documents", status_code=status.HTTP_201_CREATED)
async def register_supplier_document(
    payload: SupplierDocumentRegister,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    subcontractor_id = vendor["subcontractor_id"]

    attachment_id = (
        await db.execute(
            text("""
            INSERT INTO core.file_attachments (organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes)
            VALUES (:org_id, :user_id, :file_name, :storage_path, :mime_type, :size_bytes)
            RETURNING id
        """),
            {
                "org_id": user["org_id"], "user_id": user["user_id"], "file_name": payload.file_name,
                "storage_path": payload.storage_path, "mime_type": payload.mime_type, "size_bytes": payload.size_bytes,
            },
        )
    ).scalar()

    document = (
        await db.execute(
            text("""
            INSERT INTO core.documents (organization_id, created_by, title, file_attachment_id, category, file_size_bytes, file_name, expiry_date)
            VALUES (:org_id, :user_id, :title, :attachment_id, :category, :size_bytes, :file_name, :expiry_date)
            RETURNING id, title, category, expiry_date, created_at
        """),
            {
                "org_id": user["org_id"], "user_id": user["user_id"], "title": payload.file_name,
                "attachment_id": attachment_id, "category": payload.category, "size_bytes": payload.size_bytes,
                "file_name": payload.file_name, "expiry_date": payload.expiry_date,
            },
        )
    ).first()

    # Receipts and RFQ quote files are linked to their target workflow at the
    # point of use. Compliance uploads still attach to the vendor profile here.
    if payload.category not in {"receipt", "rfq_quote"}:
        await db.execute(
            text("""
            INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
            VALUES (:org_id, :document_id, 'subcontractor', :entity_id, 'compliance', :user_id)
            ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
        """),
            {"org_id": user["org_id"], "document_id": document.id, "entity_id": subcontractor_id, "user_id": user["user_id"]},
        )
    await db.commit()
    return {"success": True, "data": dict(document._mapping), "message": "Document registered.", "meta": {}}


@router.post("/client/documents", status_code=status.HTTP_201_CREATED)
async def register_client_document(
    payload: SupplierDocumentRegister,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register an uploaded file (currently: payment-request receipts only)
    for the client portal. The document is linked to its target entity at
    the point of use (e.g. clear_client_payment_request), not here."""
    await _get_client_portal_context(user, db)

    attachment_id = (
        await db.execute(
            text("""
            INSERT INTO core.file_attachments (organization_id, uploaded_by, file_name, storage_path, mime_type, size_bytes)
            VALUES (:org_id, :user_id, :file_name, :storage_path, :mime_type, :size_bytes)
            RETURNING id
        """),
            {
                "org_id": user["org_id"], "user_id": user["user_id"], "file_name": payload.file_name,
                "storage_path": payload.storage_path, "mime_type": payload.mime_type, "size_bytes": payload.size_bytes,
            },
        )
    ).scalar()

    document = (
        await db.execute(
            text("""
            INSERT INTO core.documents (organization_id, created_by, title, file_attachment_id, category, file_size_bytes, file_name)
            VALUES (:org_id, :user_id, :title, :attachment_id, :category, :size_bytes, :file_name)
            RETURNING id, title, category, created_at
        """),
            {
                "org_id": user["org_id"], "user_id": user["user_id"], "title": payload.file_name,
                "attachment_id": attachment_id, "category": payload.category, "size_bytes": payload.size_bytes,
                "file_name": payload.file_name,
            },
        )
    ).first()
    await db.commit()
    return {"success": True, "data": dict(document._mapping), "message": "Document registered.", "meta": {}}


@router.get("/supplier/rate-items")
async def list_supplier_rate_items(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    rows = await db.execute(
        text("""
        SELECT * FROM procurement.vendor_rate_items
        WHERE organization_id = :org_id AND subcontractor_id = :id AND is_deleted = false
        ORDER BY rate_type, created_at DESC
    """),
        {"org_id": user["org_id"], "id": vendor["subcontractor_id"]},
    )
    return {"success": True, "data": [dict(r._mapping) for r in rows], "message": "Rate items loaded.", "meta": {}}


@router.post("/supplier/rate-items", status_code=status.HTTP_201_CREATED)
async def create_supplier_rate_item(
    payload: VendorRateItemCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    try:
        row = (
            await db.execute(
                text("""
                INSERT INTO procurement.vendor_rate_items (
                    organization_id, subcontractor_id, rate_type, item_code, description,
                    unit_of_measure, unit_price, currency, min_quantity, lead_time_days,
                    route_from, route_to, submitted_by, created_by
                ) VALUES (
                    :org_id, :subcontractor_id, :rate_type, :item_code, :description,
                    :unit_of_measure, :unit_price, :currency, :min_quantity, :lead_time_days,
                    :route_from, :route_to, :user_id, :user_id
                ) RETURNING *
            """),
                {
                    "org_id": user["org_id"], "subcontractor_id": vendor["subcontractor_id"], "user_id": user["user_id"],
                    **payload.model_dump(),
                },
            )
        ).first()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="An item with this code and rate type already exists.") from exc
    await db.commit()
    return {"success": True, "data": dict(row._mapping), "message": "Rate item added.", "meta": {}}


@router.get("/supplier/rfqs")
async def list_supplier_rfqs(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    supplier_id = vendor.get("linked_supplier_id")
    if not supplier_id:
        return {"success": True, "data": [], "message": "No linked supplier account is available for RFQs.", "meta": {}}

    rows = await db.execute(
        text("""
        SELECT
            rfq.id,
            rfq.rfq_number,
            rfq.title,
            rfq.description,
            rfq.closing_date,
            rfq.status,
            rfq.issued_at,
            p.name AS project_name,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', rl.id,
                    'description', rl.description,
                    'qty', rl.qty,
                    'uom', rl.uom,
                    'work_package', rl.work_package,
                    'notes', rl.notes
                  )
                  ORDER BY rl.created_at ASC
                )
                FROM procurement.requisition_lines rl
                WHERE rl.organization_id = rfq.organization_id
                  AND rl.requisition_id = rfq.requisition_id
                  AND rl.is_deleted = false
              ),
              '[]'::jsonb
            ) AS requested_items,
            (
              SELECT jsonb_build_object(
                'id', rr.id,
                'reference', rr.reference,
                'total_amount', rr.total_amount,
                'delivery_days', rr.delivery_days,
                'validity_days', rr.validity_days,
                'notes', rr.notes,
                'line_items', rr.line_items,
                'status', rr.status,
                'received_at', rr.received_at,
                'documents', COALESCE((
                  SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', d.id,
                      'title', d.title,
                      'category', d.category,
                      'created_at', d.created_at
                    )
                    ORDER BY d.created_at DESC
                  )
                  FROM core.document_links dl
                  JOIN core.documents d ON d.id = dl.document_id
                   AND d.organization_id = dl.organization_id
                   AND d.is_deleted = false
                  WHERE dl.organization_id = rr.organization_id
                    AND dl.entity_type = 'rfq_response'
                    AND dl.entity_id = rr.id
                    AND dl.is_deleted = false
                ), '[]'::jsonb)
              )
              FROM procurement.rfq_responses rr
              WHERE rr.organization_id = rfq.organization_id
                AND rr.rfq_id = rfq.id
                AND rr.supplier_id = :supplier_id
                AND rr.is_deleted = false
              LIMIT 1
            ) AS response
        FROM procurement.rfqs rfq
        LEFT JOIN projects.projects p ON p.id = rfq.project_id
         AND p.organization_id = rfq.organization_id
        WHERE rfq.organization_id = :org_id
          AND rfq.status = 'issued'
          AND rfq.is_deleted = false
        ORDER BY rfq.closing_date ASC NULLS LAST, rfq.issued_at DESC NULLS LAST, rfq.created_at DESC
        LIMIT 100
    """),
        {"org_id": user["org_id"], "supplier_id": supplier_id},
    )
    data = [dict(row._mapping) for row in rows]
    return {"success": True, "data": data, "message": "Open RFQs loaded.", "meta": {"total": len(data)}}


@router.post("/supplier/rfqs/{rfq_id}/responses", status_code=status.HTTP_201_CREATED)
async def submit_supplier_rfq_response(
    rfq_id: UUID,
    payload: SupplierRfqResponseCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    supplier_id = vendor.get("linked_supplier_id")
    if not supplier_id:
        raise HTTPException(status_code=422, detail="This portal account is not linked to a procurement supplier record.")
    rfq = (
        await db.execute(
            text("""
            SELECT id, project_id, status, title
            FROM procurement.rfqs
            WHERE id = :id
              AND organization_id = :org_id
              AND is_deleted = false
        """),
            {"id": str(rfq_id), "org_id": user["org_id"]},
        )
    ).first()
    if not rfq:
        raise HTTPException(status_code=404, detail="RFQ not found.")
    if rfq.status != "issued":
        raise HTTPException(status_code=409, detail="This RFQ is not open for supplier responses.")
    if not payload.line_items and payload.quote_document_id is None:
        raise HTTPException(status_code=422, detail="Add line rates or upload a formal quotation before submitting.")

    line_items = [item.model_dump() for item in payload.line_items]
    total_amount = payload.total_amount
    if total_amount is None:
        total_amount = sum((item.get("qty") or 1) * item["unit_price"] for item in line_items)

    response_id = (
        await db.execute(
            text("""
            INSERT INTO procurement.rfq_responses (
                organization_id, rfq_id, supplier_id, reference, total_amount,
                delivery_days, validity_days, notes, line_items, created_by
            ) VALUES (
                :org_id, :rfq_id, :supplier_id, :reference, :total_amount,
                :delivery_days, :validity_days, :notes, CAST(:line_items AS jsonb), :user_id
            ) ON CONFLICT (organization_id, rfq_id, supplier_id)
              DO UPDATE SET
                reference = EXCLUDED.reference,
                total_amount = EXCLUDED.total_amount,
                delivery_days = EXCLUDED.delivery_days,
                validity_days = EXCLUDED.validity_days,
                notes = EXCLUDED.notes,
                line_items = EXCLUDED.line_items,
                status = 'received',
                updated_at = NOW()
            RETURNING id
        """),
            {
                "org_id": user["org_id"],
                "rfq_id": str(rfq_id),
                "supplier_id": supplier_id,
                "reference": payload.reference,
                "total_amount": total_amount,
                "delivery_days": payload.delivery_days,
                "validity_days": payload.validity_days,
                "notes": payload.notes,
                "line_items": json.dumps(line_items),
                "user_id": user["user_id"],
            },
        )
    ).scalar()

    if payload.quote_document_id:
        await _link_documents(
            db,
            org_id=user["org_id"],
            user_id=user["user_id"],
            document_ids=[payload.quote_document_id],
            entity_type="rfq_response",
            entity_id=str(response_id),
            link_role="supplier_quote",
        )

    await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=["Procurement Manager", "Finance Manager", "Executive (Admin)"],
        title="Supplier RFQ response received",
        message=f"{vendor['name']} responded to {rfq.title}.",
        notification_type="rfq_response",
        action_url="/dashboard/procurement?tab=rfqs",
    )
    await db.commit()
    return {"success": True, "data": {"id": str(response_id), "total_amount": total_amount}, "message": "RFQ response submitted.", "meta": {}}


@router.get("/supplier/payment-requests")
async def list_supplier_payment_requests(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    rows = await db.execute(
        text("""
        SELECT * FROM finance.vendor_payment_requests
        WHERE organization_id = :org_id AND subcontractor_id = :id AND is_deleted = false
        ORDER BY submitted_at DESC
    """),
        {"org_id": user["org_id"], "id": vendor["subcontractor_id"]},
    )
    return {"success": True, "data": [dict(r._mapping) for r in rows], "message": "Payment requests loaded.", "meta": {}}


@router.post("/supplier/payment-requests", status_code=status.HTTP_201_CREATED)
async def create_supplier_payment_request(
    payload: VendorPaymentRequestCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    if vendor["verification_stage"] != "hr_verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your profile must be HR-verified before you can request payment.",
        )

    row = (
        await db.execute(
            text("""
            INSERT INTO finance.vendor_payment_requests (
                organization_id, subcontractor_id, supplier_id, project_id, rate_type,
                reference_description, amount, currency, submitted_by, created_by
            ) VALUES (
                :org_id, :subcontractor_id, :supplier_id, :project_id, :rate_type,
                :reference_description, :amount, :currency, :user_id, :user_id
            ) RETURNING *
        """),
            {
                "org_id": user["org_id"], "subcontractor_id": vendor["subcontractor_id"],
                "supplier_id": vendor["linked_supplier_id"],
                "project_id": str(payload.project_id) if payload.project_id else None,
                "rate_type": payload.rate_type, "reference_description": payload.reference_description,
                "amount": payload.amount, "currency": payload.currency, "user_id": user["user_id"],
            },
        )
    ).first()
    await emit_role_notification(
        db, org_id=user["org_id"], role_names=["Finance Manager"],
        title="New vendor payment request",
        message=f"{vendor['name']} requested payment of {payload.currency} {payload.amount:,.2f}.",
        notification_type="vendor_payment_request", action_url="/dashboard/finance/vendor-payments",
    )
    await db.commit()
    return {"success": True, "data": dict(row._mapping), "message": "Payment request submitted.", "meta": {}}


@router.post("/supplier/payment-requests/{request_id}/clear")
async def clear_supplier_payment_request(
    request_id: UUID,
    payload: VendorPaymentRequestClear,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    vendor = await _get_supplier_portal_context(user, db)
    req = (
        await db.execute(
            text("""
            SELECT id, amount, currency, status, reference_description, project_id
            FROM finance.vendor_payment_requests
            WHERE id = :id AND organization_id = :org_id AND subcontractor_id = :subcontractor_id AND is_deleted = false
        """),
            {"id": str(request_id), "org_id": user["org_id"], "subcontractor_id": vendor["subcontractor_id"]},
        )
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Payment request not found.")
    if req.status in ("cleared", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Payment request already '{req.status}'.")

    doc = (
        await db.execute(
            text("SELECT id FROM core.documents WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": str(payload.receipt_document_id), "org_id": user["org_id"]},
        )
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Receipt document not found.")

    cash_account_id = await _pick_cash_account(db, user["org_id"], req.currency)
    tx_number = f"VPR-{str(req.id)[:8].upper()}"
    cashbook_row = await db.execute(
        text("""
        INSERT INTO finance.cashbook_transactions (
            organization_id, cash_account_id, transaction_number, transaction_date,
            transaction_type, direction, source_type, source_id, project_id,
            counterparty_type, counterparty_name, payment_method, description,
            amount, currency, posted_by
        ) VALUES (
            :org_id, :cash_account_id, :tx_number, CURRENT_DATE,
            'payment', 'outflow', 'vendor_payment_request', :source_id, :project_id,
            :counterparty_type, :counterparty_name, 'bank_transfer', :description,
            :amount, :currency, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"], "cash_account_id": cash_account_id, "tx_number": tx_number,
            "source_id": str(req.id), "project_id": str(req.project_id) if req.project_id else None,
            "counterparty_type": "supplier" if vendor.get("account_type") == "supplier" else "subcontractor",
            "counterparty_name": vendor["name"], "description": f"Vendor payment: {req.reference_description}",
            "amount": float(req.amount), "currency": req.currency, "user_id": user["user_id"],
        },
    )
    cashbook_id = str(cashbook_row.scalar())

    await db.execute(
        text("""
        UPDATE finance.vendor_payment_requests
        SET status = 'cleared', cleared_by_party = 'vendor', cleared_by = :user_id, cleared_at = NOW(),
            cashbook_transaction_id = :cashbook_id, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {"user_id": user["user_id"], "cashbook_id": cashbook_id, "id": str(request_id), "org_id": user["org_id"]},
    )
    await db.execute(
        text("""
        INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
        VALUES (:org_id, :document_id, 'vendor_payment_request', :entity_id, 'receipt', :user_id)
        ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
    """),
        {
            "org_id": user["org_id"], "document_id": str(payload.receipt_document_id),
            "entity_id": str(request_id), "user_id": user["user_id"],
        },
    )
    await emit_role_notification(
        db, org_id=user["org_id"], role_names=["Finance Manager"],
        title="Vendor payment request cleared by vendor",
        message=f"{vendor['name']} marked payment request '{req.reference_description}' as cleared with a receipt. Please reconcile.",
        notification_type="vendor_payment_request", action_url="/dashboard/finance/vendor-payments",
    )
    await db.commit()
    return {"success": True, "data": {"id": str(request_id), "status": "cleared"}, "message": "Payment request cleared.", "meta": {}}


# =============================================================================
# Client portal - projects, issues, additional requests, variations, and
# payment requests. Extends the existing tickets/messages workspace above.
# =============================================================================

class ClientProjectRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: UUID
    subject: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=10)
    evidence_document_ids: list[UUID] = Field(default_factory=list)


class ClientVariationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    project_id: UUID
    title: str = Field(min_length=3, max_length=255)
    description: Optional[str] = None
    scope_impact: Optional[str] = None
    cost_impact: Optional[float] = None
    time_impact_days: Optional[int] = None
    evidence_document_ids: list[UUID] = Field(default_factory=list)


class ClientPaymentRequestClear(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    receipt_document_id: UUID
    notes: Optional[str] = Field(default=None, max_length=1000)


async def _link_documents(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: str,
    document_ids: list[UUID],
    entity_type: str,
    entity_id: str,
    link_role: str,
) -> None:
    if not document_ids:
        return
    unique_ids = [str(doc_id) for doc_id in dict.fromkeys(document_ids)]
    rows = (
        await db.execute(
            text("""
            SELECT id
            FROM core.documents
            WHERE organization_id = :org_id
              AND id = ANY(CAST(:document_ids AS uuid[]))
              AND is_deleted = false
        """),
            {"org_id": org_id, "document_ids": unique_ids},
        )
    ).scalars().all()
    found_ids = {str(row) for row in rows}
    missing = sorted(set(unique_ids) - found_ids)
    if missing:
        raise HTTPException(status_code=404, detail="One or more uploaded documents could not be found.")
    for document_id in unique_ids:
        await db.execute(
            text("""
            INSERT INTO core.document_links (
                organization_id, document_id, entity_type, entity_id, link_role, linked_by
            )
            VALUES (:org_id, :document_id, :entity_type, :entity_id, :link_role, :user_id)
            ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
        """),
            {
                "org_id": org_id,
                "document_id": document_id,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "link_role": link_role,
                "user_id": user_id,
            },
        )


async def _client_org_id(user: dict, client: dict, db: AsyncSession) -> Optional[str]:
    row = (
        await db.execute(
            text("SELECT client_org_id FROM crm.contacts WHERE id = :id AND organization_id = :org_id"),
            {"id": client["contact_id"], "org_id": user["org_id"]},
        )
    ).first()
    return str(row.client_org_id) if row and row.client_org_id else None


@router.get("/client/projects")
async def list_client_projects(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    if not client_org_id:
        return {"success": True, "data": [], "message": "No projects linked to this account yet.", "meta": {}}

    rows = await db.execute(
        text("""
        SELECT id, name, status, project_code, project_type,
               start_date, planned_completion_date, actual_completion_date
        FROM projects.projects
        WHERE client_org_id = :client_org_id AND organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
    """),
        {"client_org_id": client_org_id, "org_id": user["org_id"]},
    )
    return {"success": True, "data": [dict(r._mapping) for r in rows], "message": "Projects loaded.", "meta": {}}


@router.get("/client/projects/{project_id}")
async def get_client_project_detail(
    project_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    project = (
        await db.execute(
            text("""
            SELECT id, name, status, project_code, project_type,
                   start_date, planned_completion_date, actual_completion_date
            FROM projects.projects
            WHERE id = :id AND organization_id = :org_id AND client_org_id = :client_org_id AND is_deleted = false
        """),
            {"id": str(project_id), "org_id": user["org_id"], "client_org_id": client_org_id},
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    tickets = await db.execute(
        text("""
        SELECT id, subject, description, status, priority, category, created_at, updated_at
        FROM crm.support_tickets
        WHERE organization_id = :org_id AND project_id = :project_id AND contact_id = :contact_id AND is_deleted = false
        ORDER BY created_at DESC
    """),
        {"org_id": user["org_id"], "project_id": str(project_id), "contact_id": client["contact_id"]},
    )
    variations = await db.execute(
        text("""
        SELECT id, variation_number, title, description, scope_impact, cost_impact,
               time_impact_days, status, submitted_at, approved_at, rejection_reason
        FROM finance.variations
        WHERE organization_id = :org_id AND project_id = :project_id AND is_deleted = false
        ORDER BY created_at DESC
    """),
        {"org_id": user["org_id"], "project_id": str(project_id)},
    )
    payment_requests = await db.execute(
        text("""
        SELECT id, title, description, amount, currency, due_date, status, cleared_at
        FROM finance.client_payment_requests
        WHERE organization_id = :org_id AND project_id = :project_id AND is_deleted = false
        ORDER BY created_at DESC
    """),
        {"org_id": user["org_id"], "project_id": str(project_id)},
    )
    return {
        "success": True,
        "data": {
            "project": dict(project._mapping),
            "tickets": [dict(r._mapping) for r in tickets],
            "variations": [dict(r._mapping) for r in variations],
            "payment_requests": [dict(r._mapping) for r in payment_requests],
        },
        "message": "Project detail loaded.",
        "meta": {},
    }


async def _create_client_project_ticket(category: str, payload: ClientProjectRequestCreate, user: dict, db: AsyncSession):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    project = (
        await db.execute(
            text("""
            SELECT 1
            FROM projects.projects
            WHERE id = :project_id
              AND organization_id = :org_id
              AND client_org_id = :client_org_id
              AND is_deleted = false
        """),
            {"project_id": str(payload.project_id), "org_id": user["org_id"], "client_org_id": client_org_id},
        )
    ).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")
    result = await db.execute(
        text("""
        INSERT INTO crm.support_tickets (organization_id, created_by, contact_id, project_id, subject, description, category)
        VALUES (:org_id, :user_id, :contact_id, :project_id, :subject, :description, :category)
        RETURNING id, subject, description, status, priority, category, project_id, created_at, updated_at
    """),
        {
            "org_id": user["org_id"], "user_id": user["user_id"], "contact_id": client["contact_id"],
            "project_id": str(payload.project_id), "subject": payload.subject, "description": payload.description,
            "category": category,
        },
    )
    ticket = result.first()
    if ticket:
        await _link_documents(
            db,
            org_id=user["org_id"],
            user_id=user["user_id"],
            document_ids=payload.evidence_document_ids,
            entity_type="support_ticket",
            entity_id=str(ticket.id),
            link_role="evidence",
        )
    await emit_role_notification(
        db, org_id=user["org_id"], role_names=["Project Manager", "Executive (Admin)"],
        title=f"Client {category.replace('_', ' ')}",
        message=f"{client['contact_name']}: {payload.subject}",
        notification_type="client_portal", action_url="/dashboard/client-portal",
    )
    await db.commit()
    return ticket


@router.post("/client/issues", status_code=status.HTTP_201_CREATED)
async def create_client_issue(
    payload: ClientProjectRequestCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _create_client_project_ticket("issue", payload, user, db)
    return {"success": True, "data": dict(ticket._mapping) if ticket else None, "message": "Issue raised.", "meta": {}}


@router.post("/client/additional-requests", status_code=status.HTTP_201_CREATED)
async def create_client_additional_request(
    payload: ClientProjectRequestCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    ticket = await _create_client_project_ticket("additional_request", payload, user, db)
    return {"success": True, "data": dict(ticket._mapping) if ticket else None, "message": "Request submitted.", "meta": {}}


@router.get("/client/variations")
async def list_client_variations(
    project_id: Optional[UUID] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_client_portal_context(user, db)
    filters = ["v.organization_id = :org_id", "v.is_deleted = false"]
    params: dict = {"org_id": user["org_id"]}
    if project_id:
        filters.append("v.project_id = :project_id")
        params["project_id"] = str(project_id)
    rows = await db.execute(
        text(f"""
        SELECT v.id, v.variation_number, v.project_id, v.title, v.description, v.scope_impact,
               v.cost_impact, v.time_impact_days, v.status, v.submitted_at, v.approved_at, v.rejection_reason
        FROM finance.variations v
        WHERE {' AND '.join(filters)}
        ORDER BY v.created_at DESC
    """),
        params,
    )
    return {"success": True, "data": [dict(r._mapping) for r in rows], "message": "Variations loaded.", "meta": {}}


@router.post("/client/variations", status_code=status.HTTP_201_CREATED)
async def create_client_variation(
    payload: ClientVariationCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    project = (
        await db.execute(
            text("SELECT client_org_id FROM projects.projects WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": str(payload.project_id), "org_id": user["org_id"]},
        )
    ).first()
    if not project or not client_org_id or str(project.client_org_id) != client_org_id:
        raise HTTPException(status_code=404, detail="Project not found.")

    seq = (
        await db.execute(
            text("SELECT COUNT(*) + 1 FROM finance.variations WHERE organization_id = :org_id AND project_id = :project_id"),
            {"org_id": user["org_id"], "project_id": str(payload.project_id)},
        )
    ).scalar()
    variation_number = f"VAR-{str(payload.project_id)[:8].upper()}-{seq:03d}"

    row = (
        await db.execute(
            text("""
            INSERT INTO finance.variations (
                organization_id, variation_number, project_id, title, description,
                initiated_by, scope_impact, cost_impact, time_impact_days,
                status, submitted_by, submitted_at, created_by
            ) VALUES (
                :org_id, :variation_number, :project_id, :title, :description,
                'client', :scope_impact, :cost_impact, :time_impact_days,
                'pending', :user_id, NOW(), :user_id
            ) RETURNING id, variation_number, project_id, title, description, scope_impact, cost_impact, time_impact_days, status, submitted_at
        """),
            {
                "org_id": user["org_id"], "variation_number": variation_number, "project_id": str(payload.project_id),
                "title": payload.title, "description": payload.description, "scope_impact": payload.scope_impact,
                "cost_impact": payload.cost_impact, "time_impact_days": payload.time_impact_days, "user_id": user["user_id"],
            },
        )
    ).first()

    await emit_role_notification(
        db, org_id=user["org_id"], role_names=["Project Manager", "Finance Manager", "Executive (Admin)"],
        title="Client variation request",
        message=f"{client['contact_name']} submitted variation '{payload.title}'.",
        notification_type="variation", action_url="/dashboard/finance/variations",
    )
    await db.commit()
    return {"success": True, "data": dict(row._mapping), "message": "Variation submitted.", "meta": {}}


@router.get("/client/payment-requests")
async def list_client_payment_requests(
    project_id: Optional[UUID] = Query(default=None),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    if not client_org_id:
        return {"success": True, "data": [], "message": "No payment requests.", "meta": {}}

    filters = ["cpr.organization_id = :org_id", "cpr.is_deleted = false", "p.client_org_id = :client_org_id"]
    params: dict = {"org_id": user["org_id"], "client_org_id": client_org_id}
    if project_id:
        filters.append("cpr.project_id = :project_id")
        params["project_id"] = str(project_id)

    rows = await db.execute(
        text(f"""
        SELECT cpr.id, cpr.project_id, cpr.title, cpr.description, cpr.amount, cpr.currency,
               cpr.due_date, cpr.status, cpr.cleared_by_party, cpr.cleared_at, cpr.created_at
        FROM finance.client_payment_requests cpr
        JOIN projects.projects p ON p.id = cpr.project_id AND p.organization_id = cpr.organization_id
        WHERE {' AND '.join(filters)}
        ORDER BY cpr.created_at DESC
    """),
        params,
    )
    return {"success": True, "data": [dict(r._mapping) for r in rows], "message": "Payment requests loaded.", "meta": {}}


@router.post("/client/payment-requests/{request_id}/clear")
async def clear_client_payment_request(
    request_id: UUID,
    payload: ClientPaymentRequestClear,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    client = await _get_client_portal_context(user, db)
    client_org_id = await _client_org_id(user, client, db)
    req = (
        await db.execute(
            text("""
            SELECT cpr.id, cpr.amount, cpr.currency, cpr.status, cpr.project_id, cpr.progress_claim_id, cpr.title
            FROM finance.client_payment_requests cpr
            JOIN projects.projects p ON p.id = cpr.project_id AND p.organization_id = cpr.organization_id
            WHERE cpr.id = :id AND cpr.organization_id = :org_id AND p.client_org_id = :client_org_id AND cpr.is_deleted = false
        """),
            {"id": str(request_id), "org_id": user["org_id"], "client_org_id": client_org_id},
        )
    ).first()
    if not req:
        raise HTTPException(status_code=404, detail="Payment request not found.")
    if req.status in ("cleared", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Payment request already '{req.status}'.")

    doc = (
        await db.execute(
            text("SELECT id FROM core.documents WHERE id = :id AND organization_id = :org_id AND is_deleted = false"),
            {"id": str(payload.receipt_document_id), "org_id": user["org_id"]},
        )
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Receipt document not found.")

    cash_account_id = await _pick_cash_account(db, user["org_id"], req.currency)
    tx_number = f"CPR-{str(req.id)[:8].upper()}"
    cashbook_row = await db.execute(
        text("""
        INSERT INTO finance.cashbook_transactions (
            organization_id, cash_account_id, transaction_number, transaction_date,
            transaction_type, direction, source_type, source_id, project_id,
            counterparty_type, counterparty_name, payment_method, description,
            amount, currency, posted_by
        ) VALUES (
            :org_id, :cash_account_id, :tx_number, CURRENT_DATE,
            'receipt', 'inflow', 'client_payment_request', :source_id, :project_id,
            'client', :counterparty_name, 'bank_transfer', :description,
            :amount, :currency, :user_id
        ) RETURNING id
    """),
        {
            "org_id": user["org_id"], "cash_account_id": cash_account_id, "tx_number": tx_number,
            "source_id": str(req.id), "project_id": str(req.project_id),
            "counterparty_name": client.get("company_name") or client.get("contact_name"),
            "description": f"Client payment: {req.title}", "amount": float(req.amount), "currency": req.currency,
            "user_id": user["user_id"],
        },
    )
    cashbook_id = str(cashbook_row.scalar())

    await db.execute(
        text("""
        UPDATE finance.client_payment_requests
        SET status = 'cleared', cleared_by_party = 'client', cleared_by = :user_id, cleared_at = NOW(),
            cashbook_transaction_id = :cashbook_id, updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id
    """),
        {"user_id": user["user_id"], "cashbook_id": cashbook_id, "id": str(request_id), "org_id": user["org_id"]},
    )
    if req.progress_claim_id:
        await db.execute(
            text("""
            INSERT INTO finance.receipt_allocations (organization_id, cashbook_transaction_id, progress_claim_id, project_id, allocated_amount, allocated_by)
            VALUES (:org_id, :cashbook_id, :progress_claim_id, :project_id, :amount, :user_id)
        """),
            {
                "org_id": user["org_id"], "cashbook_id": cashbook_id, "progress_claim_id": str(req.progress_claim_id),
                "project_id": str(req.project_id), "amount": float(req.amount), "user_id": user["user_id"],
            },
        )
        await db.execute(
            text("UPDATE finance.progress_claims SET status = 'paid', updated_at = NOW() WHERE id = :id AND organization_id = :org_id"),
            {"id": str(req.progress_claim_id), "org_id": user["org_id"]},
        )
    await db.execute(
        text("""
        INSERT INTO core.document_links (organization_id, document_id, entity_type, entity_id, link_role, linked_by)
        VALUES (:org_id, :document_id, 'client_payment_request', :entity_id, 'receipt', :user_id)
        ON CONFLICT (organization_id, document_id, entity_type, entity_id, link_role) DO NOTHING
    """),
        {
            "org_id": user["org_id"], "document_id": str(payload.receipt_document_id),
            "entity_id": str(request_id), "user_id": user["user_id"],
        },
    )
    await emit_role_notification(
        db, org_id=user["org_id"], role_names=["Finance Manager"],
        title="Client payment request cleared by client",
        message=f"{client['contact_name']} marked payment request '{req.title}' as cleared with a receipt. Please reconcile.",
        notification_type="client_payment_request", action_url="/dashboard/finance/client-payments",
    )
    await db.commit()
    return {"success": True, "data": {"id": str(request_id), "status": "cleared"}, "message": "Payment request cleared.", "meta": {}}
