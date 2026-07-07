import jwt
from fastapi import HTTPException, Security, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings
import logging

security = HTTPBearer()

def verify_jwt(credentials: HTTPAuthorizationCredentials = Security(security)):
    token = credentials.credentials
    try:
        # Note: In production with Supabase, verify with JWKS or the JWT secret
        payload = jwt.decode(
            token, 
            settings.JWT_SECRET_KEY, 
            algorithms=[settings.JWT_ALGORITHM], 
            audience="authenticated"
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as e:
        logging.error(f"Invalid JWT Token: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

# Example role checker
def require_role(required_role: str):
    def role_checker(payload: dict = Security(verify_jwt)):
        user_role = payload.get("app_metadata", {}).get("role", "anon")
        if user_role != required_role and user_role != "admin": # Admin can do anything
            raise HTTPException(status_code=403, detail="Not enough permissions")
        return payload
    return role_checker
