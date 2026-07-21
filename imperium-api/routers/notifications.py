"""Authenticated notification center endpoints."""

from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification, emit_role_notification
from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user

router = APIRouter()


class NotificationCreatePayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    user_id: Optional[UUID] = None
    role_names: list[str] = Field(default_factory=list, max_length=8)
    title: str = Field(min_length=1, max_length=255)
    message: str = Field(default="", max_length=4000)
    notification_type: str = Field(default="system", max_length=80)
    priority: str = Field(default="normal", max_length=24)
    action_url: Optional[str] = Field(default=None, max_length=800)
    metadata: dict[str, Any] = Field(default_factory=dict)


def _response(data: Any, message: str, total: Optional[int] = None) -> dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


@router.get("/")
async def list_notifications(
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = """
        SELECT
            id, title, message, notification_type, priority, action_url,
            metadata, is_read, read_at, created_at, updated_at
        FROM core.notifications
        WHERE organization_id = :org_id
          AND user_id = :user_id
          AND is_deleted = false
    """
    params = {"org_id": user["org_id"], "user_id": user["user_id"], "limit": limit}
    if unread_only:
        query += " AND is_read = false"
    query += " ORDER BY created_at DESC LIMIT :limit"
    rows = (await db.execute(text(query), params)).mappings().all()
    data = [dict(row) for row in rows]
    return _response(data, "Notifications retrieved.", len(data))


@router.get("/summary")
async def notification_summary(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
            SELECT
                COUNT(*) FILTER (WHERE is_read = false) AS unread_count,
                COUNT(*) AS total_count,
                MAX(created_at) AS latest_at
            FROM core.notifications
            WHERE organization_id = :org_id
              AND user_id = :user_id
              AND is_deleted = false
        """),
            {"org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).first()
    return _response(dict(row._mapping) if row else {}, "Notification summary retrieved.")


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_notification(
    payload: NotificationCreatePayload,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if user.get("role") != SUPERADMIN_ROLE:
        raise HTTPException(status_code=403, detail="Only SUPERADMIN can create system notifications.")

    if payload.user_id:
        exists = (
            await db.execute(
                text("""
                SELECT 1 FROM core.users
                WHERE id = :user_id
                  AND organization_id = :org_id
                  AND is_active = true
                  AND is_deleted = false
            """),
                {"user_id": payload.user_id, "org_id": user["org_id"]},
            )
        ).scalar()
        if not exists:
            raise HTTPException(status_code=404, detail="Notification recipient was not found.")
        await emit_notification(
            db,
            org_id=user["org_id"],
            user_id=str(payload.user_id),
            title=payload.title,
            message=payload.message,
            notification_type=payload.notification_type,
            priority=payload.priority,
            action_url=payload.action_url,
            metadata=payload.metadata,
        )
        await db.commit()
        return _response({"count": 1}, "Notification created.")

    role_names = payload.role_names or [SUPERADMIN_ROLE]
    count = await emit_role_notification(
        db,
        org_id=user["org_id"],
        role_names=role_names,
        title=payload.title,
        message=payload.message,
        notification_type=payload.notification_type,
        priority=payload.priority,
        action_url=payload.action_url,
        metadata=payload.metadata,
    )
    await db.commit()
    return _response({"count": count}, "Notifications created.")


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.notifications
        SET is_read = true, read_at = COALESCE(read_at, NOW()), updated_at = NOW()
        WHERE id = :notification_id
          AND organization_id = :org_id
          AND user_id = :user_id
          AND is_deleted = false
        RETURNING id
    """),
        {
            "notification_id": notification_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
        },
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Notification was not found.")
    await db.commit()
    return _response({"id": str(notification_id)}, "Notification marked as read.")


@router.patch("/read-all")
async def mark_all_notifications_read(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.notifications
        SET is_read = true, read_at = COALESCE(read_at, NOW()), updated_at = NOW()
        WHERE organization_id = :org_id
          AND user_id = :user_id
          AND is_deleted = false
          AND is_read = false
        RETURNING id
    """),
        {"org_id": user["org_id"], "user_id": user["user_id"]},
    )
    rows = result.fetchall()
    await db.commit()
    return _response({"count": len(rows)}, "Notifications marked as read.")


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: UUID,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text("""
        UPDATE core.notifications
        SET is_deleted = true, updated_at = NOW()
        WHERE id = :notification_id
          AND organization_id = :org_id
          AND user_id = :user_id
          AND is_deleted = false
        RETURNING id
    """),
        {
            "notification_id": notification_id,
            "org_id": user["org_id"],
            "user_id": user["user_id"],
        },
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Notification was not found.")
    await db.commit()
    return _response(None, "Notification deleted.")
