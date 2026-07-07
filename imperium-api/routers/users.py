from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import List
from uuid import UUID

from core.database import get_db
from core.security import get_current_user, require_permission
from schemas.users import UserUpdate, UserRoleAssign

router = APIRouter()

@router.get("/")
async def list_users(
    user: dict = Depends(require_permission("users.read_all")), 
    db: AsyncSession = Depends(get_db)
):
    """Admin only: List users within the organization."""
    query = text("SELECT id, email, full_name, is_active FROM core.users WHERE organization_id = :org_id AND is_deleted = false")
    result = await db.execute(query, {"org_id": user["org_id"]})
    users = [dict(row._mapping) for row in result]
    
    return {
        "success": True,
        "data": users,
        "message": "Users fetched.",
        "meta": {"total": len(users)}
    }

@router.get("/{id}")
async def get_user(
    id: UUID, 
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    query = text("SELECT id, email, full_name, is_active FROM core.users WHERE id = :id AND organization_id = :org_id AND is_deleted = false")
    result = await db.execute(query, {"id": id, "org_id": user["org_id"]})
    found_user = result.fetchone()
    
    if not found_user:
        raise HTTPException(status_code=404, detail="User not found.")
        
    return {
        "success": True,
        "data": dict(found_user._mapping),
        "message": "User fetched.",
        "meta": {}
    }

@router.put("/{id}")
async def update_user(
    id: UUID, 
    payload: UserUpdate,
    user: dict = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    # Only allow users to update themselves, or admins to update anyone.
    if str(id) != user["user_id"] and user["role"] != "ADMIN" and user["role"] != "SUPERADMIN":
        raise HTTPException(status_code=403, detail="Not authorized to update this user.")
        
    query = text("""
        UPDATE core.users 
        SET full_name = COALESCE(:full_name, full_name), 
            is_active = COALESCE(:is_active, is_active), 
            updated_at = NOW() 
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        RETURNING id, full_name, is_active
    """)
    result = await db.execute(query, {
        "id": id, 
        "org_id": user["org_id"],
        "full_name": payload.full_name,
        "is_active": payload.is_active
    })
    updated = result.fetchone()
    await db.commit()
    
    if not updated:
        raise HTTPException(status_code=404, detail="User not found.")
        
    return {
        "success": True,
        "data": dict(updated._mapping),
        "message": "User updated.",
        "meta": {}
    }

@router.delete("/{id}")
async def delete_user(
    id: UUID, 
    user: dict = Depends(require_permission("users.delete")), 
    db: AsyncSession = Depends(get_db)
):
    query = text("UPDATE core.users SET is_deleted = true, updated_at = NOW() WHERE id = :id AND organization_id = :org_id")
    await db.execute(query, {"id": id, "org_id": user["org_id"]})
    await db.commit()
    
    return {
        "success": True,
        "data": None,
        "message": "User soft deleted.",
        "meta": {}
    }

@router.post("/{id}/roles")
async def assign_role(
    id: UUID, 
    payload: UserRoleAssign,
    user: dict = Depends(require_permission("users.assign_role")), 
    db: AsyncSession = Depends(get_db)
):
    query = text("""
        INSERT INTO core.user_roles (user_id, role_id, organization_id) 
        VALUES (:user_id, :role_id, :org_id)
        ON CONFLICT (user_id, role_id) DO NOTHING
    """)
    await db.execute(query, {
        "user_id": id, 
        "role_id": payload.role_id, 
        "org_id": user["org_id"]
    })
    await db.commit()
    
    return {
        "success": True,
        "data": None,
        "message": "Role assigned successfully.",
        "meta": {}
    }
