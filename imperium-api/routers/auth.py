from fastapi import APIRouter, Depends, HTTPException, Request
from schemas.auth import UserRegister, UserLogin, TokenRefresh
from core.database import supabase
from core.security import get_current_user
from core.rate_limit import limiter

router = APIRouter()


@router.post("/register")
@limiter.limit("5/minute")
async def register_user(request: Request, payload: UserRegister):
    try:
        res = supabase.auth.sign_up(
            {
                "email": payload.email,
                "password": payload.password,
                "options": {
                    "data": {
                        "full_name": payload.full_name,
                        "org_id": payload.organization_id,
                    }
                },
            }
        )
        return {
            "success": True,
            "data": {"user_id": res.user.id if res.user else None},
            "message": "User registered successfully.",
            "meta": {},
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/login")
@limiter.limit("10/minute;3/second")
async def login_user(request: Request, payload: UserLogin):
    try:
        res = supabase.auth.sign_in_with_password(
            {"email": payload.email, "password": payload.password}
        )
        return {
            "success": True,
            "data": {
                "access_token": res.session.access_token,
                "refresh_token": res.session.refresh_token,
                "user": res.user.id,
            },
            "message": "Login successful.",
            "meta": {},
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid email or password.")


@router.post("/logout")
async def logout_user(user: dict = Depends(get_current_user)):
    try:
        return {
            "success": True,
            "data": None,
            "message": "Logged out successfully.",
            "meta": {},
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/me")
async def get_me(user: dict = Depends(get_current_user)):
    return {
        "success": True,
        "data": user,
        "message": "Current user retrieved.",
        "meta": {},
    }


@router.post("/refresh")
@limiter.limit("20/minute")
async def refresh_token(request: Request, payload: TokenRefresh):
    try:
        res = supabase.auth.refresh_session(payload.refresh_token)
        return {
            "success": True,
            "data": {
                "access_token": res.session.access_token,
                "refresh_token": res.session.refresh_token,
            },
            "message": "Token refreshed.",
            "meta": {},
        }
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token.")
