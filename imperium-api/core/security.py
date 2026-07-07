from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from core.config import settings
from core.database import get_db

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)) -> dict:
    """Verifies the Supabase JWT against the Supabase JWT Secret."""
    token = credentials.credentials
    try:
        # Supabase uses HS256 to sign JWTs with the project's JWT Secret
        payload = jwt.decode(
            token, 
            settings.SECRET_KEY, 
            algorithms=["HS256"], 
            audience="authenticated"
        )
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail=f"Invalid authentication credentials. {str(e)}"
        )

def get_current_user(payload: dict = Depends(verify_token)) -> dict:
    """Extracts user identity and organization from the verified token payload."""
    user_id = payload.get("sub")
    
    # In a multi-tenant Supabase setup, org_id is typically injected into app_metadata or user_metadata via a custom claim hook.
    org_id = payload.get("app_metadata", {}).get("org_id") or payload.get("user_metadata", {}).get("org_id")
    
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, 
            detail="User ID not found in token."
        )
        
    return {
        "user_id": user_id,
        "org_id": org_id,
        "email": payload.get("email"),
        "role": payload.get("role", "authenticated")
    }

def require_permission(permission_key: str):
    """
    Dependency factory to enforce granular RBAC permissions (e.g., 'projects.create').
    Queries the database to check if the current user's role has the requested permission.
    """
    async def permission_checker(
        user: dict = Depends(get_current_user),
        db: AsyncSession = Depends(get_db)
    ):
        # Allow SUPERADMIN role inherently
        if user.get("role") == "SUPERADMIN":
            return user
            
        # Ensure user belongs to an organization
        if not user.get("org_id"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User does not belong to an organization.")
            
        # Execute query to verify permission link: users -> user_roles -> roles -> role_permissions -> permissions
        query = text("""
            SELECT 1 
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            JOIN user_roles ur ON rp.role_id = ur.role_id
            WHERE ur.user_id = :user_id 
              AND ur.organization_id = :org_id 
              AND p.key = :permission_key
        """)
        
        result = await db.execute(query, {
            "user_id": user.get("user_id"),
            "org_id": user.get("org_id"),
            "permission_key": permission_key
        })
        
        if not result.scalar():
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, 
                detail=f"Missing required permission: {permission_key}"
            )
            
        return user
        
    return permission_checker
