"""Server-side portal admission. A session alone never selects a portal."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import get_current_user

router = APIRouter()

_PORTALS = {
    "executive": "/dashboard/executive",
    "employee": "/dashboard/executive",
    "client": "/portal/client",
    "supplier": "/portal/supplier",
}


@router.get("/resolve-access")
async def resolve_portal_access(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Resolve the user's role and automatically determine the destination portal.
    """
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

    # 2. Employee check
    if "EMPLOYEE" in role_names:
        return {
            "success": True,
            "data": {"portal": "employee", "destination": "/dashboard/executive"},
            "message": "Employee portal access confirmed.",
            "meta": {},
        }

    # 3. Client check
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

    # 4. Supplier check
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
