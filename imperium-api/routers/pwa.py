"""Browser PWA support: push subscriptions, app version, and device alerts."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification
from app.shared.pwa import pwa_public_key, pwa_push_enabled
from core.database import get_db
from core.security import get_current_user

router = APIRouter()


class PushSubscriptionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    subscription: dict[str, Any]


class PushSubscriptionDeletePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    endpoint: str = Field(min_length=1, max_length=2048)


class TestNotificationPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    title: str = Field(default="AEGIS alerts enabled", max_length=255)
    message: str = Field(
        default="You will receive browser notifications and sync updates on this device.",
        max_length=4000,
    )
    action_url: Optional[str] = Field(default="/dashboard", max_length=800)


def _response(data: Any, message: str, total: Optional[int] = None) -> dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


@router.get("/config")
async def get_config():
    return _response(
        {
            "push_enabled": pwa_push_enabled(),
            "vapid_public_key": pwa_public_key() if pwa_push_enabled() else None,
            "app_name": "AEGIS",
        },
        "PWA configuration retrieved.",
    )


@router.get("/subscriptions")
async def list_push_subscriptions(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            text("""
            SELECT id, endpoint, created_at, updated_at, is_active, expiration_time
            FROM core.pwa_push_subscriptions
            WHERE organization_id = :org_id
              AND user_id = :user_id
              AND is_deleted = false
            ORDER BY created_at DESC
        """),
            {"org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).mappings().all()
    return _response([dict(row) for row in rows], "Push subscriptions retrieved.", len(rows))


@router.post("/subscriptions")
async def save_push_subscription(
    payload: PushSubscriptionPayload,
    request: Request,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    subscription = payload.subscription
    endpoint = str(subscription.get("endpoint") or "").strip()
    keys = subscription.get("keys") or {}
    p256dh = str(keys.get("p256dh") or "").strip()
    auth = str(keys.get("auth") or "").strip()
    if not endpoint or not p256dh or not auth:
        raise HTTPException(status_code=422, detail="The push subscription payload is incomplete.")

    expiration_time = subscription.get("expirationTime")
    await db.execute(
        text("""
        INSERT INTO core.pwa_push_subscriptions (
            organization_id, user_id, endpoint, p256dh, auth, expiration_time, user_agent, is_active, is_deleted
        ) VALUES (
            :org_id, :user_id, :endpoint, :p256dh, :auth,
            :expiration_time, :user_agent, true, false
        )
        ON CONFLICT (organization_id, user_id, endpoint) DO UPDATE SET
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth,
            expiration_time = EXCLUDED.expiration_time,
            user_agent = EXCLUDED.user_agent,
            is_active = true,
            is_deleted = false,
            updated_at = NOW()
        RETURNING id
    """),
        {
            "org_id": user["org_id"],
            "user_id": user["user_id"],
            "endpoint": endpoint,
            "p256dh": p256dh,
            "auth": auth,
            "expiration_time": None if expiration_time in (None, "") else expiration_time,
            "user_agent": request.headers.get("user-agent"),
        },
    )
    await db.commit()
    return _response({"endpoint": endpoint}, "Push subscription saved.")


@router.delete("/subscriptions")
async def delete_push_subscription(
    payload: PushSubscriptionDeletePayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.pwa_push_subscriptions
        SET is_active = false, is_deleted = true, updated_at = NOW()
        WHERE organization_id = :org_id
          AND user_id = :user_id
          AND endpoint = :endpoint
          AND is_deleted = false
        RETURNING id
    """),
        {"org_id": user["org_id"], "user_id": user["user_id"], "endpoint": payload.endpoint},
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Push subscription was not found.")
    await db.commit()
    return _response({"endpoint": payload.endpoint}, "Push subscription removed.")


@router.post("/subscriptions/test")
async def test_push_subscription(
    payload: Optional[TestNotificationPayload] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    notification = payload or TestNotificationPayload()
    await emit_notification(
        db,
        org_id=user["org_id"],
        user_id=str(user["user_id"]),
        title=notification.title,
        message=notification.message,
        notification_type="pwa",
        priority="normal",
        action_url=notification.action_url,
        metadata={"source": "pwa-test"},
    )
    await db.commit()
    return _response({"sent": True}, "Test notification sent.")
