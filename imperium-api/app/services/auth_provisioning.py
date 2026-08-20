"""Shared Supabase Auth provisioning for portal accounts (client/supplier/
subcontractor) created directly from their registration page - CRM
Organizations, CRM Subcontractors, Procurement Suppliers - instead of only
through Settings > Managed Accounts. Mirrors the admin-set-password,
no-email-required mechanism Settings already uses (see
routers/settings.py's _create_internal_only_auth_user/_ensure_core_user), so
a login provisioned from any of these pages behaves identically: immediately
active, email_confirm=True, no email ever sent, temp password returned once
for the admin to hand over directly."""

import asyncio
import secrets
from typing import Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import supabase as supabase_admin
from core.logging import logger

PORTAL_ROLE_BY_ACCOUNT_TYPE = {
    "client": "CLIENT",
    "supplier": "SUPPLIER",
    "subcontractor": "SUPPLIER",
}


def generate_temporary_password() -> str:
    return f"SNC-{secrets.token_urlsafe(10)}!{secrets.randbelow(90) + 10}"


async def role_id_by_name(db: AsyncSession, org_id: str, role_name: str) -> Optional[UUID]:
    return (
        await db.execute(
            text("SELECT id FROM core.roles WHERE organization_id=:org_id AND name=:role_name AND is_deleted=false"),
            {"org_id": org_id, "role_name": role_name},
        )
    ).scalar()


async def provision_portal_user(
    db: AsyncSession,
    *,
    org_id: str,
    email: str,
    full_name: str,
    account_type: str,
) -> tuple[UUID, str]:
    """Creates (or, if the email already exists in core.users, resets the
    password on) a Supabase Auth user with an admin-set password and
    assigns the portal role matching account_type. Returns
    (user_id, temporary_password). Callers still need to insert their own
    entity-specific portal-access link row (crm.client_portal_access /
    crm.supplier_portal_access) afterward, since only the caller knows which
    organization/subcontractor id to link it to."""
    portal_role_name = PORTAL_ROLE_BY_ACCOUNT_TYPE.get(account_type)
    if not portal_role_name:
        raise HTTPException(status_code=422, detail=f"Unknown portal account type: {account_type}")
    portal_role_id = await role_id_by_name(db, org_id, portal_role_name)
    if not portal_role_id:
        raise HTTPException(
            status_code=503,
            detail=f"The {portal_role_name} portal role is not migrated yet. Run migration 014_portal_access_roles.sql.",
        )

    temp_password = generate_temporary_password()
    existing_user_id = (
        await db.execute(
            text("SELECT id FROM core.users WHERE organization_id=:org_id AND lower(email)=lower(:email) AND is_deleted=false"),
            {"org_id": org_id, "email": email},
        )
    ).scalar()

    if existing_user_id:
        await asyncio.to_thread(
            lambda: supabase_admin.auth.admin.update_user_by_id(
                str(existing_user_id),
                {
                    "password": temp_password,
                    "user_metadata": {"full_name": full_name, "organization_id": org_id, "account_type": account_type},
                    "app_metadata": {"must_change_password": True, "organization_id": org_id, "account_type": account_type},
                    "email_confirm": True,
                },
            )
        )
        user_id = existing_user_id
        await db.execute(
            text("""
                UPDATE core.users SET full_name=:full_name, must_change_password=true, is_active=true,
                    updated_at=NOW(), is_deleted=false WHERE id=:id
            """),
            {"id": user_id, "full_name": full_name},
        )
    else:
        payload = {
            "email": email,
            "password": temp_password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name, "organization_id": org_id, "account_type": account_type},
            "app_metadata": {"must_change_password": True, "organization_id": org_id, "account_type": account_type},
        }
        try:
            response = await asyncio.wait_for(
                asyncio.to_thread(lambda: supabase_admin.auth.admin.create_user(payload)),
                timeout=15,
            )
        except asyncio.TimeoutError as exc:
            raise HTTPException(
                status_code=503,
                detail="Authentication service temporarily unavailable. Please retry.",
            ) from exc
        except Exception as exc:
            logger.error("auth_provisioning.create_user_failed", email=email, error=str(exc))
            message = str(exc).lower()
            if "already" in message and ("registered" in message or "exists" in message):
                raise HTTPException(
                    status_code=409,
                    detail=f"An account with email {email} already exists.",
                ) from exc
            raise HTTPException(
                status_code=502,
                detail="Supabase Auth could not create the provisioned user.",
            ) from exc
        auth_user = getattr(response, "user", None)
        raw_user_id = getattr(auth_user, "id", None) if auth_user else None
        if not raw_user_id:
            raise HTTPException(status_code=502, detail="Supabase Auth did not return a provisioned user id.")
        user_id = UUID(str(raw_user_id))
        await db.execute(
            text("""
                INSERT INTO core.users (id, organization_id, email, full_name, is_active, must_change_password)
                VALUES (:id, :org_id, :email, :full_name, true, true)
                ON CONFLICT (id) DO UPDATE SET
                    organization_id=EXCLUDED.organization_id, email=EXCLUDED.email, full_name=EXCLUDED.full_name,
                    is_active=true, must_change_password=true, updated_at=NOW(), is_deleted=false
            """),
            {"id": user_id, "org_id": org_id, "email": email, "full_name": full_name},
        )

    await db.execute(
        text("""
            INSERT INTO core.user_roles (user_id, role_id, organization_id)
            VALUES (:user_id, :role_id, :org_id) ON CONFLICT (user_id, role_id) DO NOTHING
        """),
        {"user_id": user_id, "role_id": portal_role_id, "org_id": org_id},
    )
    return user_id, temp_password
