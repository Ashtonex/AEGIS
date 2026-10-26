"""Push and urgent-email delivery for in-app notifications, after commit.

emit_notification() writes the core.notifications row inside the caller's
transaction. Delivering the push (and, for urgent ones, the email) at that
moment told people about records that a later failure in the same request
rolled back, and an expired push subscription made dispatch_user_pushes
commit the caller's half-finished transaction. Delivery is therefore queued
on the session and only starts once that session commits; it runs on its own
session and skips any notification whose row did not survive (e.g. it was
written inside a savepoint that was rolled back).
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.shared.pwa import dispatch_user_pushes
from core.config import settings
from core.email import send_email
from core.logging import logger

_PENDING_KEY = "aegis_pending_notification_deliveries"
_LISTENING_KEY = "aegis_notification_delivery_listening"
# Keeps scheduled delivery tasks referenced until they finish.
_inflight: set[asyncio.Task] = set()


def queue_notification_delivery(
    db: AsyncSession,
    *,
    notification_id: str,
    org_id: str,
    user_id: str,
    payload: dict[str, Any],
    email_urgent: bool,
) -> bool:
    """Deliver after the session's next commit. Returns False (and delivers
    nothing) when db is not a real session, e.g. a test double."""
    sync = getattr(db, "sync_session", None)
    if not isinstance(sync, Session):
        return False
    sync.info.setdefault(_PENDING_KEY, []).append(
        {
            "notification_id": notification_id,
            "org_id": org_id,
            "user_id": user_id,
            "payload": payload,
            "email_urgent": email_urgent,
        }
    )
    if not sync.info.get(_LISTENING_KEY):
        event.listen(sync, "after_commit", _on_commit)
        event.listen(sync, "after_rollback", _on_rollback)
        sync.info[_LISTENING_KEY] = True
    return True


def _on_commit(session: Session) -> None:
    items = session.info.pop(_PENDING_KEY, None)
    if not items:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("notification_delivery_no_event_loop", count=len(items))
        return
    task = loop.create_task(deliver_notifications(items))
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)


def _on_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)


async def deliver_notifications(items: list[dict[str, Any]]) -> None:
    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        for item in items:
            try:
                committed = (
                    await db.execute(
                        text("SELECT 1 FROM core.notifications WHERE id = CAST(:id AS uuid)"),
                        {"id": item["notification_id"]},
                    )
                ).scalar()
                if not committed:
                    continue
                await dispatch_user_pushes(
                    db, org_id=item["org_id"], user_id=item["user_id"], payload=item["payload"],
                )
                if item["email_urgent"]:
                    payload = item["payload"]
                    await email_escalate(
                        db,
                        user_id=item["user_id"],
                        title=payload.get("title") or "",
                        message=payload.get("message") or "",
                        action_url=payload.get("action_url"),
                    )
            except Exception:
                logger.exception("notification_delivery_failed", notification_id=item["notification_id"])


async def email_escalate(
    db: AsyncSession,
    *,
    user_id: str,
    title: str,
    message: str,
    action_url: Optional[str],
) -> None:
    """Best-effort email for urgent notifications. A failed or unconfigured
    email send never affects the in-app notification that already landed."""
    recipient = (
        await db.execute(
            text("SELECT email, full_name FROM core.users WHERE id = :user_id"),
            {"user_id": user_id},
        )
    ).first()
    if not recipient or not recipient.email:
        return
    base = settings.PUBLIC_APP_URL.strip().rstrip("/")
    full_url = f"{base}{action_url}" if action_url and base else None
    link_html = f'<p><a href="{full_url}">View details</a></p>' if full_url else ""
    await send_email(
        to=recipient.email,
        subject=f"[AEGIS] {title}",
        html=f"<p>Hi {recipient.full_name or ''},</p><p>{message}</p>{link_html}",
        text=message,
    )
