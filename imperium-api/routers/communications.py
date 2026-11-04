"""Staff communications: one message to many people over in-app, email,
Teams and WhatsApp, and the record of how each copy got on.

Sending is app/services/communications/dispatch.py; this router only
validates, scopes to the caller's organisation and reads the log back."""

from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.communications.dispatch import send_communication
from core.database import get_db
from core.security import require_permission

router = APIRouter()

Channel = Literal["in_app", "email", "teams", "whatsapp"]


class SendPayload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    recipient_user_ids: list[UUID] = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    channels: list[Channel] = Field(min_length=1, max_length=4)
    # A path inside AEGIS (e.g. /dashboard/projects/...) or a full https URL.
    action_url: Optional[str] = Field(default=None, max_length=500, pattern=r"^(/|https://)")
    # Approved Twilio Content template, needed to reach someone on WhatsApp
    # who hasn't messaged the AEGIS number in the last 24 hours.
    whatsapp_content_sid: Optional[str] = Field(default=None, pattern=r"^HX[0-9a-fA-F]{32}$")
    whatsapp_content_variables: Optional[dict[str, str]] = None


def _response(data: Any, message: str) -> dict[str, Any]:
    return {"success": True, "data": data, "message": message, "meta": {}}


@router.post("/send", status_code=201)
async def send(
    payload: SendPayload,
    user: dict = Depends(require_permission("communications.send")),
    db: AsyncSession = Depends(get_db),
):
    if payload.whatsapp_content_variables and not payload.whatsapp_content_sid:
        raise HTTPException(status_code=422, detail="whatsapp_content_variables requires whatsapp_content_sid.")
    result = await send_communication(
        db,
        org_id=user["org_id"],
        sender_user_id=user["user_id"],
        recipient_user_ids=[str(uid) for uid in payload.recipient_user_ids],
        subject=payload.subject,
        body=payload.body,
        channels=payload.channels,
        action_url=payload.action_url,
        whatsapp_content_sid=payload.whatsapp_content_sid,
        whatsapp_content_variables=payload.whatsapp_content_variables,
    )
    if not result["recipients"]:
        await db.rollback()
        raise HTTPException(status_code=422, detail="None of the recipients are active people in this organisation.")
    await db.commit()
    return _response(result, "Message sent. Email, Teams and WhatsApp copies are going out now.")


@router.get("")
async def list_dispatches(
    limit: int = Query(default=50, ge=1, le=200),
    user: dict = Depends(require_permission("communications.send")),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        await db.execute(
            text("""
            SELECT d.id, d.subject, d.channels, d.source, d.created_at,
                   s.full_name AS sender_name,
                   COUNT(DISTINCT x.recipient_user_id) AS recipients,
                   COUNT(*) FILTER (WHERE x.status IN ('sent', 'queued', 'sending', 'delivered', 'read')) AS ok,
                   COUNT(*) FILTER (WHERE x.status IN ('failed', 'undelivered')) AS failed,
                   COUNT(*) FILTER (WHERE x.status = 'skipped') AS skipped,
                   COUNT(*) FILTER (WHERE x.status = 'pending') AS pending
            FROM core.communication_dispatches d
            LEFT JOIN core.users s ON s.id = d.sender_user_id
            LEFT JOIN core.communication_deliveries x ON x.dispatch_id = d.id
            WHERE d.organization_id = :org_id
            GROUP BY d.id, s.full_name
            ORDER BY d.created_at DESC
            LIMIT :limit
        """),
            {"org_id": user["org_id"], "limit": limit},
        )
    ).mappings().all()
    return _response([dict(row) for row in rows], "Messages fetched.")


@router.get("/{dispatch_id}")
async def get_dispatch(
    dispatch_id: UUID,
    user: dict = Depends(require_permission("communications.send")),
    db: AsyncSession = Depends(get_db),
):
    dispatch = (
        await db.execute(
            text("""
            SELECT d.id, d.subject, d.body, d.action_url, d.channels, d.source, d.source_id,
                   d.created_at, s.full_name AS sender_name
            FROM core.communication_dispatches d
            LEFT JOIN core.users s ON s.id = d.sender_user_id
            WHERE d.id = :id AND d.organization_id = :org_id
        """),
            {"id": dispatch_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    if not dispatch:
        raise HTTPException(status_code=404, detail="Message not found.")
    deliveries = (
        await db.execute(
            text("""
            SELECT x.recipient_user_id, u.full_name AS recipient_name, x.channel, x.status,
                   x.detail, x.updated_at
            FROM core.communication_deliveries x
            JOIN core.users u ON u.id = x.recipient_user_id
            WHERE x.dispatch_id = :id AND x.organization_id = :org_id
            ORDER BY u.full_name, x.channel
        """),
            {"id": dispatch_id, "org_id": user["org_id"]},
        )
    ).mappings().all()
    return _response({**dict(dispatch), "deliveries": [dict(row) for row in deliveries]}, "Message fetched.")
