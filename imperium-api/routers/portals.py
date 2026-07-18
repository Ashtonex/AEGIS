"""Server-side portal admission. A session alone never selects a portal."""

import json

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user

router = APIRouter()

_PORTALS = {
    "executive": "/dashboard/executive",
    "employee": "/dashboard/executive",
    "foreman": "/portal/foreman",
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
                c.contact_name,
                c.email,
                c.phone,
                c.job_title,
                co.name AS company_name
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

    # 2. Foreman / site-team check
    if {"FOREMAN", "SITE AGENT", "SITE CLERK", "STOREKEEPER"} & role_names:
        return {
            "success": True,
            "data": {"portal": "foreman", "destination": "/portal/foreman"},
            "message": "Foreman portal access confirmed.",
            "meta": {},
        }

    # 3. Employee check
    if "EMPLOYEE" in role_names:
        return {
            "success": True,
            "data": {"portal": "employee", "destination": "/dashboard/executive"},
            "message": "Employee portal access confirmed.",
            "meta": {},
        }

    # 4. Client check
    if "CLIENT" in role_names:
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

    # 5. Supplier check
    if "SUPPLIER" in role_names:
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
        SELECT id, issue_description, created_at, updated_at
        FROM crm.tickets
        WHERE organization_id = :org_id
          AND client_id = :contact_id
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
        INSERT INTO crm.tickets (
            organization_id,
            created_by,
            client_id,
            issue_description
        )
        VALUES (:org_id, :user_id, :contact_id, :issue_description)
        RETURNING id, issue_description, created_at, updated_at
    """),
        {
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "contact_id": client["contact_id"],
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
