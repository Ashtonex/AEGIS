"""Tenant-scoped settings, RBAC administration, website content, and audit evidence.

Secrets are intentionally not accepted or persisted here. Store connection secrets in
the deployment secret manager or Supabase Vault, not in the application database.
"""

import asyncio
from datetime import datetime
import json
import secrets
from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
import httpx
from pydantic import BaseModel, ConfigDict, EmailStr, Field, HttpUrl, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, ProgrammingError
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db, supabase as supabase_admin
from core.config import settings
from core.security import require_permission
from app.shared.sql import safe_payload_columns, tenant_upsert_sql

router = APIRouter()


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class OrganizationSettingsPayload(Payload):
    trading_name: Optional[str] = Field(default=None, max_length=255)
    legal_name: Optional[str] = Field(default=None, max_length=255)
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    currency_code: Optional[str] = Field(default=None, pattern=r"^[A-Z]{3}$")
    fiscal_year_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    country_code: Optional[str] = Field(default=None, pattern=r"^[A-Z]{2}$")
    primary_contact_email: Optional[EmailStr] = None
    primary_contact_phone: Optional[str] = Field(default=None, max_length=40)
    address: Optional[dict[str, str]] = None


class NotificationPreferencesPayload(Payload):
    email_enabled: Optional[bool] = None
    in_app_enabled: Optional[bool] = None
    daily_digest_enabled: Optional[bool] = None
    incident_alerts_enabled: Optional[bool] = None
    approval_alerts_enabled: Optional[bool] = None


class IntegrationMetadataPayload(Payload):
    provider: str = Field(min_length=1, max_length=80)
    display_name: str = Field(min_length=1, max_length=160)
    status: Literal["not_configured", "pending", "connected", "disabled", "error"] = (
        "not_configured"
    )
    account_label: Optional[str] = Field(default=None, max_length=255)
    endpoint_url: Optional[HttpUrl] = None
    external_reference: Optional[str] = Field(default=None, max_length=255)
    scopes: list[str] = Field(default_factory=list, max_length=32)
    sync_status: Literal["not_started", "healthy", "delayed", "failed"] = "not_started"
    last_synced_at: Optional[datetime] = None

    @field_validator("scopes")
    @classmethod
    def validate_scopes(cls, values: list[str]) -> list[str]:
        if any(not value or len(value) > 100 for value in values):
            raise ValueError("Each scope must be between 1 and 100 characters.")
        return sorted(set(values))


class UserRolePayload(Payload):
    role_id: UUID


class RolePermissionPayload(Payload):
    permission_key: str = Field(min_length=1, max_length=100)
    enabled: bool


class WebsiteContentPayload(Payload):
    page_key: str = Field(min_length=1, max_length=120)
    section_key: str = Field(min_length=1, max_length=120)
    title: Optional[str] = Field(default=None, max_length=255)
    subtitle: Optional[str] = Field(default=None, max_length=500)
    body: Optional[str] = None
    status: Literal["draft", "published", "archived"] = "draft"
    metadata: dict[str, Any] = Field(default_factory=dict)


AccountKind = Literal["client", "supplier", "subcontractor"]
AccessLevel = Literal["viewer", "contributor", "manager", "admin"]


class ManagedAccountEmployeePayload(Payload):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    job_title: Optional[str] = Field(default=None, max_length=100)
    phone: Optional[str] = Field(default=None, max_length=50)
    role_ids: list[UUID] = Field(default_factory=list, max_length=8)
    module_permissions: list[str] = Field(default_factory=list, max_length=32)
    access_level: AccessLevel = "viewer"
    portal_access: bool = True

    @field_validator("module_permissions")
    @classmethod
    def normalize_permissions(cls, values: list[str]) -> list[str]:
        normalized = sorted({".".join(value.strip().split()) for value in values if value.strip()})
        if any(len(value) > 100 for value in normalized):
            raise ValueError("Permission keys must be 100 characters or fewer.")
        return normalized


class ManagedAccountPayload(Payload):
    account_type: AccountKind
    company_name: str = Field(min_length=1, max_length=255)
    trading_name: Optional[str] = Field(default=None, max_length=255)
    registration_number: Optional[str] = Field(default=None, max_length=100)
    tax_number: Optional[str] = Field(default=None, max_length=100)
    praz_number: Optional[str] = Field(default=None, max_length=100)
    nssa_number: Optional[str] = Field(default=None, max_length=100)
    industry: Optional[str] = Field(default=None, max_length=100)
    website: Optional[str] = Field(default=None, max_length=255)
    phone: Optional[str] = Field(default=None, max_length=80)
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    capability_tags: list[str] = Field(default_factory=list, max_length=24)
    compliance_status: Literal["compliant", "non_compliant", "pending", "exempt"] = "pending"
    authorization_tier: int = Field(default=1, ge=1, le=5)
    employees: list[ManagedAccountEmployeePayload] = Field(default_factory=list, min_length=1, max_length=25)

    @field_validator("capability_tags")
    @classmethod
    def normalize_tags(cls, values: list[str]) -> list[str]:
        normalized = sorted({value.strip() for value in values if value.strip()})
        if any(len(value) > 80 for value in normalized):
            raise ValueError("Capability tags must be 80 characters or fewer.")
        return normalized


PAGE_ACCESS = [
    {
        "page": "Executive dashboard",
        "route": "/dashboard/executive",
        "permission": "executive.view_dashboard",
        "module": "Executive",
    },
    {
        "page": "Projects",
        "route": "/dashboard/projects",
        "permission": "projects.read",
        "module": "Delivery",
    },
    {
        "page": "Workforce",
        "route": "/dashboard/workforce",
        "permission": "workforce.read",
        "module": "People",
    },
    {
        "page": "Fleet",
        "route": "/dashboard/fleet",
        "permission": "fleet.read",
        "module": "Operations",
    },
    {
        "page": "CRM",
        "route": "/dashboard/crm",
        "permission": "crm.read",
        "module": "Commercial",
    },
    {
        "page": "CRM leads",
        "route": "/dashboard/crm/leads",
        "permission": "crm_leads.read",
        "module": "Commercial",
    },
    {
        "page": "CRM contacts",
        "route": "/dashboard/crm/contacts",
        "permission": "crm_contacts.read",
        "module": "Commercial",
    },
    {
        "page": "CRM organizations",
        "route": "/dashboard/crm/organizations",
        "permission": "crm_organizations.read",
        "module": "Commercial",
    },
    {
        "page": "Documents",
        "route": "/dashboard/crm/documents",
        "permission": "documents.read",
        "module": "Controls",
    },
    {
        "page": "Settings",
        "route": "/dashboard/settings",
        "permission": "settings.read",
        "module": "Administration",
    },
    {
        "page": "Website enquiries",
        "route": "/dashboard/crm/inbox",
        "permission": "website_enquiries.read",
        "module": "Public website",
    },
    {
        "page": "Website content",
        "route": "/dashboard/settings?tab=website",
        "permission": "website_content.update",
        "module": "Public website",
    },
]

DEFAULT_WEBSITE_CONTENT = [
    {
        "id": "home-hero",
        "page_key": "home",
        "section_key": "hero",
        "title": "Institutional Construction Intelligence",
        "subtitle": "Six Nine Construction",
        "body": "Public homepage hero copy.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "about-story",
        "page_key": "about",
        "section_key": "story",
        "title": "Company story",
        "subtitle": "Since 2019",
        "body": "About-page narrative content.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "projects-featured",
        "page_key": "projects",
        "section_key": "featured",
        "title": "Featured projects",
        "subtitle": "Public portfolio",
        "body": "Controls highlighted project messaging on the website.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "about-safety-hero",
        "page_key": "about-safety",
        "section_key": "hero",
        "title": "Zero Harm. No Compromise.",
        "subtitle": "SNC operates under a strict Zero Harm framework. We prioritize the health and safety of our people and protection of the environment above all else.",
        "body": "Health, Safety & Environment hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "about-sustainability-hero",
        "page_key": "about-sustainability",
        "section_key": "hero",
        "title": "Building for Tomorrow.",
        "subtitle": "Sustainable construction is not a checkbox; it is the core of our business strategy.",
        "body": "Sustainability and ESG hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "capabilities-civil-hero",
        "page_key": "capabilities-civil",
        "section_key": "hero",
        "title": "Civil & Highways Infrastructure.",
        "subtitle": "We deliver complex engineering solutions that form the backbone of transportation.",
        "body": "Civil Infrastructure capability hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "capabilities-mining-hero",
        "page_key": "capabilities-mining",
        "section_key": "hero",
        "title": "Heavy Mining Civil Support.",
        "subtitle": "We deliver robust, load-bearing concrete foundations.",
        "body": "Mining Support capability hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "capabilities-commercial-hero",
        "page_key": "capabilities-commercial",
        "section_key": "hero",
        "title": "Commercial & Industrial Building.",
        "subtitle": "We construct large-scale warehouses, logistics depots, and retail hubs.",
        "body": "Commercial & Industrial capability hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "suppliers-guidelines-hero",
        "page_key": "suppliers-guidelines",
        "section_key": "hero",
        "title": "Supplier Compliance Guidelines.",
        "subtitle": "Six Nine Construction operates a transparent, fair, and compliant supply chain.",
        "body": "Supplier Guidelines hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "tenders-faq-hero",
        "page_key": "tenders-faq",
        "section_key": "hero",
        "title": "Tendering & Bidding FAQs.",
        "subtitle": "Review frequently asked questions regarding bid submissions.",
        "body": "Tenders FAQ hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
    {
        "id": "media-kit-hero",
        "page_key": "media-kit",
        "section_key": "hero",
        "title": "Official Media Kit.",
        "subtitle": "Access official brand assets, corporate bios, and guidelines.",
        "body": "Media kit hero section.",
        "status": "draft",
        "metadata": {},
        "updated_at": None,
    },
]

SOLE_SUPERADMIN_EMAIL = "ashton@admin.com"
PORTAL_ROLE_BY_ACCOUNT_TYPE = {
    "client": "CLIENT",
    "supplier": "SUPPLIER",
    "subcontractor": "SUPPLIER",
}


def _response(data, message: str, *, total: Optional[int] = None):
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


async def _write_audit(
    db: AsyncSession,
    user: dict,
    event_type: str,
    resource_type: str,
    resource_id: Optional[UUID],
    details: dict,
) -> None:
    await db.execute(
        text("""
        INSERT INTO settings.audit_events (organization_id, actor_id, event_type, resource_type, resource_id, details)
        VALUES (:org_id, :actor_id, :event_type, :resource_type, :resource_id, CAST(:details AS jsonb))
    """),
        {
            "org_id": user["org_id"],
            "actor_id": user["user_id"],
            "event_type": event_type,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": json.dumps(details),
        },
    )


async def _website_content(db: AsyncSession, org_id: str) -> list[dict[str, Any]]:
    try:
        rows = (
            (
                await db.execute(
                    text("""
            SELECT id, page_key, section_key, title, subtitle, body, status, metadata, updated_at
            FROM settings.website_content
            WHERE organization_id=:org_id AND is_deleted=false
            ORDER BY page_key, section_key
        """),
                    {"org_id": org_id},
                )
            )
            .mappings()
            .all()
        )
        return [dict(row) for row in rows]
    except ProgrammingError as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail="Website content storage is not migrated yet. Run migration 020_settings_website_content.sql.") from exc  # fmt: skip


async def _target_user_and_role(
    db: AsyncSession, org_id: str, target_user_id: UUID, role_id: UUID
):
    row = (
        (
            await db.execute(
                text("""
        SELECT u.id AS user_id, u.email AS user_email, r.id AS role_id, r.name AS role_name
        FROM core.users u
        CROSS JOIN core.roles r
        WHERE u.id=:target_user_id
          AND u.organization_id=:org_id
          AND u.is_deleted=false
          AND r.id=:role_id
          AND r.organization_id=:org_id
          AND r.is_deleted=false
    """),
                {
                    "target_user_id": target_user_id,
                    "role_id": role_id,
                    "org_id": org_id,
                },
            )
        )
        .mappings()
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="User or role was not found.")
    return row


def _enforce_sole_superadmin(target: Any, *, removing: bool = False) -> None:
    role_name = str(target["role_name"] or "").upper()
    user_email = str(target["user_email"] or "").lower()
    if role_name != "SUPERADMIN":
        return
    if user_email != SOLE_SUPERADMIN_EMAIL:
        raise HTTPException(
            status_code=403,
            detail=f"SUPERADMIN access is restricted to {SOLE_SUPERADMIN_EMAIL}.",
        )
    if removing:
        raise HTTPException(
            status_code=400,
            detail=f"The configured SUPERADMIN role cannot be removed from {SOLE_SUPERADMIN_EMAIL}.",
        )


async def _permission_ids(
    db: AsyncSession, permission_keys: list[str]
) -> dict[str, UUID]:
    if not permission_keys:
        return {}
    rows = (
        (
            await db.execute(
                text("""
        SELECT key, id FROM core.permissions WHERE key = ANY(:permission_keys)
    """),
                {"permission_keys": permission_keys},
            )
        )
        .mappings()
        .all()
    )
    found = {str(row["key"]): row["id"] for row in rows}
    missing = sorted(set(permission_keys) - set(found))
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown module permission(s): {', '.join(missing)}",
        )
    return found


async def _role_id_by_name(db: AsyncSession, org_id: str, role_name: str) -> Optional[UUID]:
    role_id = (
        await db.execute(
            text("""
        SELECT id FROM core.roles
        WHERE organization_id=:org_id AND name=:role_name AND is_deleted=false
    """),
            {"org_id": org_id, "role_name": role_name},
        )
    ).scalar()
    return role_id


async def _create_invited_auth_user(
    employee: ManagedAccountEmployeePayload,
    org_id: str,
    account_type: AccountKind,
) -> tuple[UUID, str]:
    """Create a Supabase Auth user and return the Auth user id."""
    temp_password = _generate_temporary_password()
    payload = {
        "email": str(employee.email),
        "password": temp_password,
        "email_confirm": True,
        "user_metadata": {
            "full_name": employee.full_name,
            "organization_id": org_id,
            "account_type": account_type,
            "access_level": employee.access_level,
        },
        "app_metadata": {
            "must_change_password": True,
            "organization_id": org_id,
            "account_type": account_type,
            "access_level": employee.access_level,
        },
    }
    try:
        response = await asyncio.to_thread(
            lambda: supabase_admin.auth.admin.create_user(payload)
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Supabase Auth could not create the provisioned user.",
        ) from exc
    auth_user = getattr(response, "user", None)
    if not auth_user:
        raise HTTPException(
            status_code=502,
            detail="Supabase Auth rejected the user provisioning request.",
        )
    user_id = getattr(auth_user, "id", None)
    if not user_id:
        raise HTTPException(
            status_code=502,
            detail="Supabase Auth did not return a provisioned user id.",
        )
    return UUID(str(user_id)), temp_password


def _generate_temporary_password() -> str:
    return f"SNC-{secrets.token_urlsafe(10)}!{secrets.randbelow(90) + 10}"


async def _ensure_core_user(
    db: AsyncSession,
    org_id: str,
    employee: ManagedAccountEmployeePayload,
    account_type: AccountKind,
) -> tuple[UUID, str]:
    temp_password = _generate_temporary_password()
    existing = (
        await db.execute(
            text("""
        SELECT id FROM core.users
        WHERE organization_id=:org_id AND lower(email)=lower(:email) AND is_deleted=false
    """),
            {"org_id": org_id, "email": str(employee.email)},
        )
    ).scalar()
    if existing:
        await asyncio.to_thread(
            lambda: supabase_admin.auth.admin.update_user_by_id(
                str(existing),
                {
                    "password": temp_password,
                    "user_metadata": {
                        "full_name": employee.full_name,
                        "organization_id": org_id,
                        "account_type": account_type,
                        "access_level": employee.access_level,
                    },
                    "app_metadata": {
                        "must_change_password": True,
                        "organization_id": org_id,
                        "account_type": account_type,
                        "access_level": employee.access_level,
                    },
                    "email_confirm": True,
                },
            )
        )
        await db.execute(
            text("""
        UPDATE core.users
        SET full_name = :full_name,
            must_change_password = true,
            is_active = true,
            updated_at = NOW(),
            is_deleted = false
        WHERE id = :user_id AND organization_id = :org_id
    """),
            {
                "user_id": existing,
                "org_id": org_id,
                "full_name": employee.full_name,
            },
        )
        return existing, temp_password

    user_id, temp_password = await _create_invited_auth_user(employee, org_id, account_type)
    try:
        await db.execute(
            text("""
        INSERT INTO core.users (id, organization_id, email, full_name, is_active, must_change_password)
        VALUES (:user_id, :org_id, :email, :full_name, true, true)
        ON CONFLICT (id) DO UPDATE SET
            organization_id=EXCLUDED.organization_id,
            email=EXCLUDED.email,
            full_name=EXCLUDED.full_name,
            is_active=true,
            must_change_password=true,
            updated_at=NOW(),
            is_deleted=false
    """),
            {
                "user_id": user_id,
                "org_id": org_id,
                "email": str(employee.email),
                "full_name": employee.full_name,
            },
        )
    except IntegrityError as exc:
        raise HTTPException(
            status_code=409,
            detail="A user with this email already exists in another organization.",
        ) from exc
    return user_id, temp_password


async def _remove_unapproved_superadmin(
    db: AsyncSession, org_id: str, user_id: UUID, email: str
) -> None:
    if email.lower() == SOLE_SUPERADMIN_EMAIL:
        return
    await db.execute(
        text("""
        DELETE FROM core.user_roles ur
        USING core.roles r
        WHERE ur.role_id=r.id
          AND ur.user_id=:user_id
          AND ur.organization_id=:org_id
          AND r.organization_id=:org_id
          AND r.name='SUPERADMIN'
    """),
        {"user_id": user_id, "org_id": org_id},
    )


async def _assign_roles(
    db: AsyncSession,
    org_id: str,
    user_id: UUID,
    role_ids: list[UUID],
) -> None:
    for role_id in role_ids:
        role_exists = (
            await db.execute(
                text("""
            SELECT 1 FROM core.roles
            WHERE id=:role_id AND organization_id=:org_id AND is_deleted=false
        """),
                {"role_id": role_id, "org_id": org_id},
            )
        ).scalar()
        if not role_exists:
            raise HTTPException(status_code=404, detail="Selected role was not found.")
        await db.execute(
            text("""
            INSERT INTO core.user_roles (user_id, role_id, organization_id)
            VALUES (:user_id, :role_id, :org_id)
            ON CONFLICT (user_id, role_id) DO NOTHING
        """),
            {"user_id": user_id, "role_id": role_id, "org_id": org_id},
        )


async def _create_employee_access_role(
    db: AsyncSession,
    org_id: str,
    employee: ManagedAccountEmployeePayload,
) -> Optional[UUID]:
    if not employee.module_permissions:
        return None
    permission_ids = await _permission_ids(db, employee.module_permissions)
    role_name = f"ACCESS:{str(employee.email).lower()[:42]}"
    role_id = await _role_id_by_name(db, org_id, role_name)
    if not role_id:
        role_id = (
            await db.execute(
                text("""
            INSERT INTO core.roles (organization_id, name, description)
            VALUES (:org_id, :role_name, :description)
            RETURNING id
        """),
                {
                    "org_id": org_id,
                    "role_name": role_name,
                    "description": f"{employee.access_level.title()} module access for {employee.full_name}",
                },
            )
        ).scalar()
    if not role_id:
        raise HTTPException(status_code=409, detail="Access role could not be created.")
    for permission_id in permission_ids.values():
        await db.execute(
            text("""
            INSERT INTO core.role_permissions (role_id, permission_id)
            VALUES (:role_id, :permission_id)
            ON CONFLICT DO NOTHING
        """),
            {"role_id": role_id, "permission_id": permission_id},
        )
    return role_id


async def _create_client_account(
    db: AsyncSession, payload: ManagedAccountPayload, user: dict
) -> UUID:
    row = await db.execute(
        text("""
        INSERT INTO crm.organizations (organization_id, name, industry, website, phone, email, address, created_by)
        VALUES (:org_id, :name, :industry, :website, :phone, :email, :address, :user_id)
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "name": payload.company_name,
            "industry": payload.industry,
            "website": payload.website,
            "phone": payload.phone,
            "email": str(payload.email) if payload.email else None,
            "address": payload.address,
            "user_id": user["user_id"],
        },
    )
    return row.scalar()


async def _create_supplier_account(
    db: AsyncSession, payload: ManagedAccountPayload, user: dict
) -> UUID:
    row = await db.execute(
        text("""
        INSERT INTO procurement.suppliers (
            organization_id, created_by, supplier_name, trading_name, registration_number, tax_number,
            praz_number, nssa_number, primary_contact_name, primary_contact_email, primary_contact_phone,
            currency, status, compliance_status
        )
        VALUES (
            :org_id, :user_id, :supplier_name, :trading_name, :registration_number, :tax_number,
            :praz_number, :nssa_number, :primary_contact_name, :primary_contact_email, :primary_contact_phone,
            'USD', 'pending_approval', :compliance_status
        )
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "supplier_name": payload.company_name,
            "trading_name": payload.trading_name,
            "registration_number": payload.registration_number,
            "tax_number": payload.tax_number,
            "praz_number": payload.praz_number,
            "nssa_number": payload.nssa_number,
            "primary_contact_name": payload.employees[0].full_name,
            "primary_contact_email": str(payload.employees[0].email),
            "primary_contact_phone": payload.employees[0].phone or payload.phone,
            "compliance_status": payload.compliance_status,
        },
    )
    return row.scalar()


async def _create_subcontractor_profile(
    db: AsyncSession, payload: ManagedAccountPayload, user: dict
) -> UUID:
    row = await db.execute(
        text("""
        INSERT INTO crm.subcontractors (
            organization_id, name, capability_tags, compliance_status, nssa_number, praz_number,
            reliability_score, authorization_tier, contact_name, contact_email, contact_phone,
            address, submission_data, created_by
        )
        VALUES (
            :org_id, :name, CAST(:capability_tags AS text[]), :compliance_status, :nssa_number, :praz_number,
            0, :authorization_tier, :contact_name, :contact_email, :contact_phone,
            :address, CAST(:submission_data AS jsonb), :user_id
        )
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "name": payload.company_name,
            "capability_tags": payload.capability_tags,
            "compliance_status": payload.compliance_status,
            "nssa_number": payload.nssa_number,
            "praz_number": payload.praz_number,
            "authorization_tier": payload.authorization_tier,
            "contact_name": payload.employees[0].full_name,
            "contact_email": str(payload.employees[0].email),
            "contact_phone": payload.employees[0].phone or payload.phone,
            "address": payload.address,
            "submission_data": json.dumps(
                {
                    "account_type": payload.account_type,
                    "trading_name": payload.trading_name,
                    "registration_number": payload.registration_number,
                    "tax_number": payload.tax_number,
                    "email": str(payload.email) if payload.email else None,
                    "website": payload.website,
                }
            ),
            "user_id": user["user_id"],
        },
    )
    return row.scalar()


async def _create_client_contact(
    db: AsyncSession,
    org_id: str,
    created_by: str,
    client_org_id: UUID,
    employee: ManagedAccountEmployeePayload,
) -> UUID:
    row = await db.execute(
        text("""
        INSERT INTO crm.contacts (organization_id, created_by, client_org_id, contact_name, email, phone, job_title)
        VALUES (:org_id, :user_id, :client_org_id, :contact_name, :email, :phone, :job_title)
        RETURNING id
    """),
        {
            "org_id": org_id,
            "user_id": created_by,
            "client_org_id": client_org_id,
            "contact_name": employee.full_name,
            "email": str(employee.email),
            "phone": employee.phone,
            "job_title": employee.job_title,
        },
    )
    return row.scalar()


async def _create_employee_record(
    db: AsyncSession,
    org_id: str,
    created_by: str,
    employee: ManagedAccountEmployeePayload,
    user_id: UUID,
) -> UUID:
    row = await db.execute(
        text("""
        INSERT INTO hr.employees (organization_id, created_by, employee_name, job_title, linked_user_id, employment_status)
        VALUES (:org_id, :user_id, :employee_name, :job_title, :linked_user_id, 'active')
        ON CONFLICT DO NOTHING
        RETURNING id
    """),
        {
            "org_id": org_id,
            "user_id": created_by,
            "employee_name": employee.full_name,
            "job_title": employee.job_title,
            "linked_user_id": user_id,
        },
    )
    employee_id = row.scalar()
    if employee_id:
        return employee_id
    existing = (
        await db.execute(
            text("""
        SELECT id FROM hr.employees
        WHERE organization_id=:org_id AND linked_user_id=:linked_user_id AND is_deleted=false
    """),
            {"org_id": org_id, "linked_user_id": user_id},
        )
    ).scalar()
    if not existing:
        raise HTTPException(status_code=409, detail="Employee profile could not be linked.")
    return existing


async def _audit_events(
    db: AsyncSession, org_id: str, limit: int = 50
) -> list[dict[str, Any]]:
    """Return settings audit events plus canonical ERP audit trigger records."""
    rows = (
        (
            await db.execute(
                text("""
        SELECT id, event_type, resource_type, resource_id, details, occurred_at, actor_name, actor_email, source
        FROM (
            SELECT e.id, e.event_type, e.resource_type, e.resource_id, e.details, e.occurred_at,
                   u.full_name AS actor_name, u.email AS actor_email, 'settings.audit_events' AS source
            FROM settings.audit_events e
            LEFT JOIN core.users u ON u.id=e.actor_id AND u.organization_id=e.organization_id
            WHERE e.organization_id=:org_id
            UNION ALL
            SELECT a.id, lower(a.table_name || '.' || a.action) AS event_type, a.table_name AS resource_type,
                   a.record_id AS resource_id,
                   jsonb_build_object('action', a.action, 'old_data', a.old_data, 'new_data', a.new_data) AS details,
                   a.created_at AS occurred_at,
                   u.full_name AS actor_name, u.email AS actor_email, 'core.audit_log' AS source
            FROM core.audit_log a
            LEFT JOIN core.users u ON u.id=a.created_by
            WHERE COALESCE(a.new_data->>'organization_id', a.old_data->>'organization_id')=:org_id
        ) audit_events
        ORDER BY occurred_at DESC
        LIMIT :limit
    """),
                {"org_id": org_id, "limit": limit},
            )
        )
        .mappings()
        .all()
    )
    return [dict(row) for row in rows]


@router.get("/overview")
async def overview(
    user: dict = Depends(require_permission("settings.read")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    org = (
        (
            await db.execute(
                text("""
        SELECT name, registration_number, updated_at FROM core.organizations
        WHERE id=:org_id AND is_deleted=false
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    organization = (
        (
            await db.execute(
                text("""
        SELECT trading_name, legal_name, timezone, currency_code, fiscal_year_start_month,
               country_code, primary_contact_email, primary_contact_phone, address, updated_at
        FROM settings.organization_settings WHERE organization_id=:org_id
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    notifications = (
        (
            await db.execute(
                text("""
        SELECT email_enabled, in_app_enabled, daily_digest_enabled, incident_alerts_enabled,
               approval_alerts_enabled, updated_at
        FROM settings.notification_preferences WHERE organization_id=:org_id
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .first()
    )
    integrations = (
        (
            await db.execute(
                text("""
        SELECT id, provider, display_name, status, account_label, endpoint_url, external_reference,
               scopes, sync_status, last_synced_at, updated_at
        FROM settings.integration_connections
        WHERE organization_id=:org_id AND is_deleted=false ORDER BY provider
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .all()
    )
    users = (
        (
            await db.execute(
                text("""
        SELECT u.id, u.email, u.full_name, u.is_active, u.updated_at,
               COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name) ORDER BY r.name) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) AS roles
        FROM core.users u
        LEFT JOIN core.user_roles ur ON ur.user_id=u.id AND ur.organization_id=u.organization_id
        LEFT JOIN core.roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.is_deleted=false
        WHERE u.organization_id=:org_id AND u.is_deleted=false
        GROUP BY u.id ORDER BY u.full_name, u.email
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .all()
    )
    roles = (
        (
            await db.execute(
                text("""
        SELECT r.id, r.name, r.description,
               COALESCE(jsonb_agg(p.key ORDER BY p.key) FILTER (WHERE p.key IS NOT NULL), '[]'::jsonb) AS permissions
        FROM core.roles r
        LEFT JOIN core.role_permissions rp ON rp.role_id=r.id
        LEFT JOIN core.permissions p ON p.id=rp.permission_id
        WHERE r.organization_id=:org_id AND r.is_deleted=false
        GROUP BY r.id ORDER BY r.name
    """),
                {"org_id": org_id},
            )
        )
        .mappings()
        .all()
    )
    permissions = (
        (
            await db.execute(
                text("SELECT key, description FROM core.permissions ORDER BY key")
            )
        )
        .mappings()
        .all()
    )
    audits = await _audit_events(db, org_id, 50)

    org_defaults = {
        "trading_name": org["name"] if org else "AEGIS",
        "legal_name": org["name"] if org else "AEGIS",
        "timezone": "Africa/Harare",
        "currency_code": "USD",
        "fiscal_year_start_month": 1,
        "country_code": "ZW",
        "primary_contact_email": None,
        "primary_contact_phone": None,
        "address": {},
        "updated_at": org["updated_at"] if org else None,
    }
    notification_defaults = {
        "email_enabled": True,
        "in_app_enabled": True,
        "daily_digest_enabled": False,
        "incident_alerts_enabled": True,
        "approval_alerts_enabled": True,
        "updated_at": None,
    }
    return _response(
        {
            "organization": dict(organization) if organization else org_defaults,
            "notifications": dict(notifications)
            if notifications
            else notification_defaults,
            "integrations": [dict(item) for item in integrations],
            "users": [dict(item) for item in users],
            "roles": [dict(item) for item in roles],
            "permissions": [dict(item) for item in permissions],
            "page_access": PAGE_ACCESS,
            "website_content": await _website_content(db, org_id),
            "audit_events": audits,
        },
        "Settings overview retrieved.",
    )


@router.patch("/organization")
async def update_organization(
    payload: OrganizationSettingsPayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(
            status_code=400, detail="No organization settings were supplied."
        )
    values["primary_contact_email"] = (
        str(values["primary_contact_email"])
        if values.get("primary_contact_email")
        else values.get("primary_contact_email")
    )
    if "address" in values:
        values["address"] = json.dumps(values["address"])
    safe_keys = safe_payload_columns(values.keys())
    upsert_columns = [*safe_keys, "updated_by"]
    await db.execute(
        tenant_upsert_sql(
            "settings.organization_settings",
            upsert_columns,
            {*OrganizationSettingsPayload.model_fields, "updated_by"},
            base_columns=("organization_id", "created_by"),
            conflict_target="organization_id",
            casts={"address": "jsonb"},
        ),
        {
            **{key: values[key] for key in safe_keys},
            "organization_id": user["org_id"],
            "created_by": user["user_id"],
            "updated_by": user["user_id"],
        },
    )
    await _write_audit(
        db,
        user,
        "settings.organization.updated",
        "organization_settings",
        None,
        {"fields": sorted(values)},
    )
    await db.commit()
    return _response(None, "Organization settings updated.")


@router.patch("/notifications")
async def update_notifications(
    payload: NotificationPreferencesPayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True)
    if not values:
        raise HTTPException(
            status_code=400, detail="No notification preferences were supplied."
        )
    safe_keys = safe_payload_columns(values.keys())
    upsert_columns = [*safe_keys, "updated_by"]
    await db.execute(
        tenant_upsert_sql(
            "settings.notification_preferences",
            upsert_columns,
            {*NotificationPreferencesPayload.model_fields, "updated_by"},
            base_columns=("organization_id",),
            conflict_target="organization_id",
        ),
        {
            **{key: values[key] for key in safe_keys},
            "organization_id": user["org_id"],
            "updated_by": user["user_id"],
        },
    )
    await _write_audit(
        db,
        user,
        "settings.notifications.updated",
        "notification_preferences",
        None,
        {"fields": sorted(values)},
    )
    await db.commit()
    return _response(None, "Notification preferences updated.")


@router.patch("/integrations")
async def upsert_integration(
    payload: IntegrationMetadataPayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump()
    values["endpoint_url"] = (
        str(values["endpoint_url"]) if values["endpoint_url"] else None
    )
    try:
        record = (
            await db.execute(
                text("""
            INSERT INTO settings.integration_connections (
                organization_id, provider, display_name, status, account_label, endpoint_url,
                external_reference, scopes, sync_status, last_synced_at, created_by, updated_by
            ) VALUES (
                :org_id, :provider, :display_name, :status, :account_label, :endpoint_url,
                :external_reference, CAST(:scopes AS jsonb), :sync_status, :last_synced_at, :user_id, :user_id
            ) ON CONFLICT (organization_id, provider) DO UPDATE SET
                display_name=EXCLUDED.display_name, status=EXCLUDED.status, account_label=EXCLUDED.account_label,
                endpoint_url=EXCLUDED.endpoint_url, external_reference=EXCLUDED.external_reference,
                scopes=EXCLUDED.scopes, sync_status=EXCLUDED.sync_status, last_synced_at=EXCLUDED.last_synced_at,
                updated_by=EXCLUDED.updated_by, updated_at=NOW(), is_deleted=false
            RETURNING id
        """),
                {
                    **values,
                    "scopes": json.dumps(values["scopes"]),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).first()
        await _write_audit(
            db,
            user,
            "settings.integration.updated",
            "integration_connection",
            record.id,
            {
                "provider": values["provider"],
                "status": values["status"],
                "sync_status": values["sync_status"],
            },
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409, detail="The integration metadata could not be saved."
        ) from exc
    return _response({"id": str(record.id)}, "Integration metadata updated.")


@router.post("/users/{target_user_id}/roles")
async def assign_user_role(
    target_user_id: UUID,
    payload: UserRolePayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    target = await _target_user_and_role(
        db, user["org_id"], target_user_id, payload.role_id
    )
    _enforce_sole_superadmin(target)
    inserted = (
        await db.execute(
            text("""
        INSERT INTO core.user_roles (user_id, role_id, organization_id)
        VALUES (:target_user_id, :role_id, :org_id)
        ON CONFLICT (user_id, role_id) DO NOTHING RETURNING user_id
    """),
            {
                "target_user_id": target_user_id,
                "role_id": payload.role_id,
                "org_id": user["org_id"],
            },
        )
    ).scalar()
    if not inserted:
        raise HTTPException(
            status_code=409, detail="The role assignment already exists."
        )
    await _write_audit(
        db,
        user,
        "settings.access.role_assigned",
        "user_roles",
        None,
        {"target_user_id": str(target_user_id), "role_id": str(payload.role_id)},
    )
    await db.commit()
    return _response(None, "Role assigned.")


@router.delete("/users/{target_user_id}/roles/{role_id}")
async def remove_user_role(
    target_user_id: UUID,
    role_id: UUID,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    target = await _target_user_and_role(db, user["org_id"], target_user_id, role_id)
    _enforce_sole_superadmin(target, removing=True)
    result = await db.execute(
        text(
            "DELETE FROM core.user_roles WHERE user_id=:target_user_id AND role_id=:role_id AND organization_id=:org_id"
        ),
        {
            "target_user_id": target_user_id,
            "role_id": role_id,
            "org_id": user["org_id"],
        },
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Role assignment was not found.")
    await _write_audit(
        db,
        user,
        "settings.access.role_removed",
        "user_roles",
        None,
        {"target_user_id": str(target_user_id), "role_id": str(role_id)},
    )
    await db.commit()
    return _response(None, "Role removed.")


@router.patch("/roles/{role_id}/permissions")
async def set_role_permission(
    role_id: UUID,
    payload: RolePermissionPayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    permission = (
        await db.execute(
            text("SELECT id FROM core.permissions WHERE key=:key"),
            {"key": payload.permission_key},
        )
    ).first()
    if not permission:
        raise HTTPException(status_code=404, detail="Permission not found.")
    role_exists = (
        await db.execute(
            text(
                "SELECT 1 FROM core.roles WHERE id=:role_id AND organization_id=:org_id AND is_deleted=false"
            ),
            {"role_id": role_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not role_exists:
        raise HTTPException(status_code=404, detail="Role not found.")
    if payload.enabled:
        await db.execute(
            text(
                "INSERT INTO core.role_permissions (role_id, permission_id) VALUES (:role_id, :permission_id) ON CONFLICT DO NOTHING"
            ),
            {"role_id": role_id, "permission_id": permission.id},
        )
    else:
        await db.execute(
            text(
                "DELETE FROM core.role_permissions WHERE role_id=:role_id AND permission_id=:permission_id"
            ),
            {"role_id": role_id, "permission_id": permission.id},
        )
    await _write_audit(
        db,
        user,
        "settings.access.permission_changed",
        "role_permissions",
        None,
        {
            "role_id": str(role_id),
            "permission": payload.permission_key,
            "enabled": payload.enabled,
        },
    )
    await db.commit()
    return _response(None, "Role permission updated.")


@router.post("/managed-accounts")
async def create_managed_account(
    payload: ManagedAccountPayload,
    user: dict = Depends(require_permission("settings.update")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    account_id: Optional[UUID] = None
    supplier_id: Optional[UUID] = None
    subcontractor_id: Optional[UUID] = None
    created_users: list[dict[str, Any]] = []
    try:
        if payload.account_type == "client":
            account_id = await _create_client_account(db, payload, user)
        elif payload.account_type == "supplier":
            supplier_id = await _create_supplier_account(db, payload, user)
            subcontractor_id = await _create_subcontractor_profile(db, payload, user)
            account_id = supplier_id
        else:
            subcontractor_id = await _create_subcontractor_profile(db, payload, user)
            account_id = subcontractor_id

        portal_role_name = PORTAL_ROLE_BY_ACCOUNT_TYPE[payload.account_type]
        portal_role_id = await _role_id_by_name(db, org_id, portal_role_name)
        if not portal_role_id:
            raise HTTPException(
                status_code=503,
                detail=f"The {portal_role_name} portal role is not migrated yet. Run migration 014_portal_access_roles.sql.",
            )

        for employee in payload.employees:
            invited_user_id, temp_password = await _ensure_core_user(
                db, org_id, employee, payload.account_type
            )
            await _remove_unapproved_superadmin(
                db, org_id, invited_user_id, str(employee.email)
            )
            assigned_role_ids = list(dict.fromkeys([*employee.role_ids, portal_role_id]))
            custom_role_id = await _create_employee_access_role(db, org_id, employee)
            if custom_role_id:
                assigned_role_ids.append(custom_role_id)
            await _assign_roles(db, org_id, invited_user_id, assigned_role_ids)

            contact_id = None
            employee_id = None
            if payload.account_type == "client" and account_id:
                contact_id = await _create_client_contact(
                    db, org_id, user["user_id"], account_id, employee
                )
                if employee.portal_access:
                    await db.execute(
                        text("""
                    INSERT INTO crm.client_portal_access (user_id, organization_id, contact_id, is_active)
                    VALUES (:user_id, :org_id, :contact_id, true)
                    ON CONFLICT (user_id, organization_id) DO UPDATE SET
                        contact_id=EXCLUDED.contact_id, is_active=true, updated_at=NOW()
                """),
                        {
                            "user_id": invited_user_id,
                            "org_id": org_id,
                            "contact_id": contact_id,
                        },
                    )
            else:
                employee_id = await _create_employee_record(
                    db, org_id, user["user_id"], employee, invited_user_id
                )
                if employee.portal_access and subcontractor_id:
                    await db.execute(
                        text("""
                    INSERT INTO crm.supplier_portal_access (user_id, organization_id, subcontractor_id, is_active)
                    VALUES (:user_id, :org_id, :subcontractor_id, true)
                    ON CONFLICT (user_id, organization_id) DO UPDATE SET
                        subcontractor_id=EXCLUDED.subcontractor_id, is_active=true, updated_at=NOW()
                """),
                        {
                            "user_id": invited_user_id,
                            "org_id": org_id,
                            "subcontractor_id": subcontractor_id,
                        },
                    )

            created_users.append(
                {
                    "user_id": str(invited_user_id),
                    "email": str(employee.email),
                    "temporary_password": temp_password,
                    "contact_id": str(contact_id) if contact_id else None,
                    "employee_id": str(employee_id) if employee_id else None,
                    "custom_role_id": str(custom_role_id) if custom_role_id else None,
                    "access_level": employee.access_level,
                }
            )

        await _write_audit(
            db,
            user,
            "settings.managed_account.created",
            "managed_account",
            account_id,
            {
                "account_type": payload.account_type,
                "company_name": payload.company_name,
                "employee_count": len(payload.employees),
                "supplier_id": str(supplier_id) if supplier_id else None,
                "subcontractor_id": str(subcontractor_id) if subcontractor_id else None,
            },
        )
        await db.commit()
    except HTTPException:
        await db.rollback()
        raise
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="The managed account could not be created because one of the records already exists.",
        ) from exc

    return _response(
        {
            "id": str(account_id),
            "account_type": payload.account_type,
            "supplier_id": str(supplier_id) if supplier_id else None,
            "subcontractor_id": str(subcontractor_id) if subcontractor_id else None,
            "users": created_users,
        },
        "Managed account created and credential cards were issued.",
    )


@router.patch("/website-content")
async def upsert_website_content(
    payload: WebsiteContentPayload,
    user: dict = Depends(require_permission("website_content.update")),
    db: AsyncSession = Depends(get_db),
):
    try:
        row = (
            await db.execute(
                text("""
            INSERT INTO settings.website_content (organization_id, page_key, section_key, title, subtitle, body, status, metadata, updated_by)
            VALUES (:org_id, :page_key, :section_key, :title, :subtitle, :body, :status, CAST(:metadata AS jsonb), :user_id)
            ON CONFLICT (organization_id, page_key, section_key) DO UPDATE SET
              title=EXCLUDED.title, subtitle=EXCLUDED.subtitle, body=EXCLUDED.body, status=EXCLUDED.status,
              metadata=EXCLUDED.metadata, updated_by=EXCLUDED.updated_by, updated_at=NOW(), is_deleted=false
            RETURNING id
        """),
                {
                    **payload.model_dump(exclude={"metadata"}),
                    "metadata": json.dumps(payload.metadata),
                    "org_id": user["org_id"],
                    "user_id": user["user_id"],
                },
            )
        ).first()
    except ProgrammingError as exc:
        await db.rollback()
        raise HTTPException(status_code=503, detail="Website content storage is not migrated yet. Run migration 020_settings_website_content.sql.") from exc  # fmt: skip
    await _write_audit(
        db,
        user,
        "settings.website_content.updated",
        "website_content",
        row.id,
        {
            "page_key": payload.page_key,
            "section_key": payload.section_key,
            "status": payload.status,
        },
    )
    await db.commit()
    return _response({"id": str(row.id)}, "Website content updated.")


@router.get("/audit-events")
async def list_audit_events(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("settings.audit.read")),
    db: AsyncSession = Depends(get_db),
):
    rows = await _audit_events(db, user["org_id"], limit)
    return _response(rows, "Settings audit events retrieved.", total=len(rows))


class BroadcastFeedPayload(Payload):
    title: str = Field(min_length=2, max_length=255)
    description: Optional[str] = None
    image_url: str = Field(min_length=10, max_length=2048)


@router.get("/broadcast-feeds")
async def list_broadcast_feeds(
    user: dict = Depends(require_permission("website_content.update")),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        SELECT id, organization_id, title, description, image_url, created_by, created_at
        FROM settings.broadcast_feeds
        WHERE organization_id = :org_id AND is_deleted = false
        ORDER BY created_at DESC
    """),
        {"org_id": user["org_id"]},
    )
    rows = [dict(row._mapping) for row in result]
    for row in rows:
        row["id"] = str(row["id"])
        row["organization_id"] = str(row["organization_id"])
        row["created_by"] = str(row["created_by"])
        row["created_at"] = row["created_at"].isoformat()
    return _response(rows, "Broadcast feeds retrieved.")


@router.post("/broadcast-feeds")
async def create_broadcast_feed(
    payload: BroadcastFeedPayload,
    user: dict = Depends(require_permission("website_content.update")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
        INSERT INTO settings.broadcast_feeds (organization_id, title, description, image_url, created_by)
        VALUES (:org_id, :title, :description, :image_url, :user_id)
        RETURNING id, created_at
    """),
            {
                "org_id": user["org_id"],
                "title": payload.title,
                "description": payload.description,
                "image_url": payload.image_url,
                "user_id": user["user_id"],
            },
        )
    ).first()
    await _write_audit(
        db,
        user,
        "settings.broadcast_feed.created",
        "broadcast_feeds",
        row.id,
        {"title": payload.title},
    )
    await db.commit()
    return _response(
        {"id": str(row.id), "created_at": row.created_at.isoformat()},
        "Broadcast feed created successfully.",
    )
