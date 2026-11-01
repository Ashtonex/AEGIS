"""Send one message to staff over in-app, email, Teams and WhatsApp.

send_communication() records the message and one delivery row per recipient
per channel inside the caller's transaction, and writes the in-app
notification there too. Email, Teams and WhatsApp go out only after that
transaction commits (same reasoning as app/shared/notification_delivery.py:
never tell people about something a later failure rolled back), on their own
session, and each delivery row is updated with what actually happened.

A channel someone can't be reached on is recorded as skipped with the reason
(no WhatsApp opt-in, Teams not set up for the org, ...) rather than silently
dropped, so the sender can see who did not get it where.
"""

from __future__ import annotations

import asyncio
import html
import json
from typing import Any, Iterable, Optional
from uuid import uuid4

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.services.communications.twilio_whatsapp import (
    TwilioWhatsAppError,
    digits,
    error_detail,
    fetch_twilio_message,
    send_twilio_whatsapp,
    statuses_that_supersede,
    twilio_whatsapp_configured,
)
from app.services.microsoft import teams_notify
from app.shared.events import emit_notification
from core.config import settings
from core.email import send_email
from core.logging import logger

CHANNELS = ("in_app", "email", "teams", "whatsapp")
# Twilio caps a WhatsApp body at 1600 characters.
_WHATSAPP_BODY_LIMIT = 1500

_PENDING_KEY = "aegis_pending_communication_sends"
_LISTENING_KEY = "aegis_communication_send_listening"
_inflight: set[asyncio.Task] = set()


def absolute_link(action_url: Optional[str]) -> Optional[str]:
    if not action_url:
        return None
    if action_url.startswith(("http://", "https://")):
        return action_url
    base = settings.PUBLIC_APP_URL.strip().rstrip("/")
    return f"{base}{action_url}" if base else None


def whatsapp_address(number: Optional[str]) -> tuple[Optional[str], Optional[str]]:
    """(digits, None) for a usable international number, else (None, reason)."""
    only = digits(number)
    if not only:
        return None, "No WhatsApp number on their profile"
    if only.startswith("0") or len(only) < 8:
        return None, "WhatsApp number needs the country code, e.g. +263 77 123 4567"
    return only, None


def _plan(
    channel: str,
    person: Any,
    *,
    teams_webhook_url: Optional[str],
    whatsapp_ready: bool,
) -> tuple[str, Optional[str], Optional[str]]:
    """(status, detail, address) for one recipient on one channel before
    anything is sent: 'pending' to send after commit, or 'skipped'."""
    if channel == "email":
        if not person.email:
            return "skipped", "No email address", None
        return "pending", None, person.email
    if channel == "teams":
        if not teams_webhook_url:
            return "skipped", "Teams delivery is not set up for this organisation", None
        address = person.teams_account or person.email
        if not address:
            return "skipped", "No Teams account or email", None
        return "pending", None, address
    if channel == "whatsapp":
        if not whatsapp_ready:
            return "skipped", "WhatsApp (Twilio) is not configured on the backend", None
        if not person.whatsapp_opt_in:
            return "skipped", "Has not opted in to WhatsApp on their profile", None
        number, reason = whatsapp_address(person.whatsapp_number)
        if not number:
            return "skipped", reason, None
        return "pending", None, number
    raise ValueError(f"Unknown channel {channel!r}")


async def send_communication(
    db: AsyncSession,
    *,
    org_id: str,
    sender_user_id: Optional[str],
    recipient_user_ids: Iterable[str],
    subject: str,
    body: str,
    channels: Iterable[str],
    action_url: Optional[str] = None,
    whatsapp_content_sid: Optional[str] = None,
    whatsapp_content_variables: Optional[dict[str, str]] = None,
    source: str = "manual",
    source_id: Optional[str] = None,
) -> dict[str, Any]:
    """Records and queues the message; the caller commits. Returns the
    dispatch id, per-status counts and any recipient ids that are not active
    people in the organisation (those are not sent to)."""
    wanted = set(channels)
    chosen = [channel for channel in CHANNELS if channel in wanted]
    if not chosen or wanted - set(CHANNELS):
        raise ValueError(f"channels must be a non-empty subset of {CHANNELS}")
    requested = list(dict.fromkeys(str(uid) for uid in recipient_user_ids))
    if not requested:
        raise ValueError("At least one recipient is required.")

    people = (
        await db.execute(
            text("""
            SELECT u.id::text AS id, u.email, u.full_name,
                   NULLIF(TRIM(u.teams_account), '') AS teams_account,
                   p.whatsapp_number, COALESCE(p.whatsapp_opt_in, false) AS whatsapp_opt_in
            FROM core.users u
            LEFT JOIN hr.employee_profiles p ON p.user_id = u.id AND p.organization_id = u.organization_id
            WHERE u.id = ANY(CAST(:ids AS uuid[])) AND u.organization_id = :org_id
              AND u.is_active = true AND u.is_deleted = false
        """),
            {"ids": requested, "org_id": org_id},
        )
    ).all()
    by_id = {person.id: person for person in people}
    missing = [uid for uid in requested if uid not in by_id]

    sender_name = None
    if sender_user_id:
        sender_name = (
            await db.execute(text("SELECT full_name FROM core.users WHERE id = :id"), {"id": sender_user_id})
        ).scalar()
    teams_webhook_url = None
    if "teams" in chosen:
        teams_webhook_url = (
            await db.execute(
                text("SELECT teams_webhook_url FROM crm.task_routing_settings WHERE organization_id = :org_id"),
                {"org_id": org_id},
            )
        ).scalar()
    whatsapp_ready = settings.WHATSAPP_PROVIDER == "twilio" and twilio_whatsapp_configured()

    dispatch_id = (
        await db.execute(
            text("""
            INSERT INTO core.communication_dispatches (
                organization_id, sender_user_id, subject, body, action_url, channels,
                source, source_id, whatsapp_content_sid, whatsapp_content_variables
            ) VALUES (
                :org_id, :sender_user_id, :subject, :body, :action_url, CAST(:channels AS text[]),
                :source, :source_id, :content_sid, CAST(:content_variables AS jsonb)
            )
            RETURNING id
        """),
            {
                "org_id": org_id,
                "sender_user_id": sender_user_id,
                "subject": subject,
                "body": body,
                "action_url": action_url,
                "channels": chosen,
                "source": source,
                "source_id": source_id,
                "content_sid": whatsapp_content_sid,
                "content_variables": json_or_none(whatsapp_content_variables),
            },
        )
    ).scalar()

    rows: list[dict[str, Any]] = []
    jobs: list[dict[str, Any]] = []
    for user_id in requested:
        person = by_id.get(user_id)
        if not person:
            continue
        for channel in chosen:
            delivery_id = str(uuid4())
            if channel == "in_app":
                await emit_notification(
                    db,
                    org_id=org_id,
                    user_id=user_id,
                    title=subject,
                    message=body,
                    notification_type="message",
                    action_url=action_url,
                    metadata={"communication_dispatch_id": str(dispatch_id), "sent_by": sender_name},
                )
                status, detail, address = "sent", None, None
            else:
                status, detail, address = _plan(
                    channel, person, teams_webhook_url=teams_webhook_url, whatsapp_ready=whatsapp_ready
                )
            rows.append({
                "id": delivery_id,
                "org_id": org_id,
                "dispatch_id": dispatch_id,
                "recipient_user_id": user_id,
                "channel": channel,
                "status": status,
                "detail": detail,
                "address": address,
            })
            if status == "pending":
                jobs.append({
                    "delivery_id": delivery_id,
                    "channel": channel,
                    "address": address,
                    "recipient_name": person.full_name,
                })

    if rows:
        await db.execute(
            text("""
            INSERT INTO core.communication_deliveries (
                id, organization_id, dispatch_id, recipient_user_id, channel, status, detail, address
            ) VALUES (
                :id, :org_id, :dispatch_id, :recipient_user_id, :channel, :status, :detail, :address
            )
        """),
            rows,
        )
    if jobs:
        _queue_after_commit(
            db,
            {
                "message": {
                    "subject": subject,
                    "body": body,
                    "link": absolute_link(action_url),
                    "sender_name": sender_name,
                    "whatsapp_content_sid": whatsapp_content_sid,
                    "whatsapp_content_variables": whatsapp_content_variables,
                },
                "teams_webhook_url": teams_webhook_url,
                "jobs": jobs,
            },
        )

    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {
        "dispatch_id": str(dispatch_id),
        "recipients": len(requested) - len(missing),
        "channels": chosen,
        "deliveries": counts,
        "missing_recipients": missing,
    }


def json_or_none(value: Optional[dict[str, Any]]) -> Optional[str]:
    return json.dumps(value) if value else None


def _queue_after_commit(db: AsyncSession, batch: dict[str, Any]) -> None:
    sync = getattr(db, "sync_session", None)
    if not isinstance(sync, Session):
        return
    sync.info.setdefault(_PENDING_KEY, []).append(batch)
    if not sync.info.get(_LISTENING_KEY):
        event.listen(sync, "after_commit", _on_commit)
        event.listen(sync, "after_rollback", _on_rollback)
        sync.info[_LISTENING_KEY] = True


def _on_commit(session: Session) -> None:
    batches = session.info.pop(_PENDING_KEY, None)
    if not batches:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        logger.warning("communication_send_no_event_loop", batches=len(batches))
        return
    for batch in batches:
        task = loop.create_task(deliver_batch(batch))
        _inflight.add(task)
        task.add_done_callback(_inflight.discard)


def _on_rollback(session: Session) -> None:
    session.info.pop(_PENDING_KEY, None)


def _email_bodies(message: dict[str, Any], recipient_name: Optional[str]) -> tuple[str, str]:
    greeting = f"Hi {recipient_name.split()[0]}," if recipient_name else "Hi,"
    link = message.get("link")
    by = message.get("sender_name")
    footer = f"Sent by {by} via AEGIS" if by else "Sent by AEGIS"
    body_html = html.escape(message["body"]).replace("\n", "<br>")
    link_html = f'<p><a href="{html.escape(link, quote=True)}">Open in AEGIS</a></p>' if link else ""
    html_body = (
        f"<p>{html.escape(greeting)}</p><p>{body_html}</p>{link_html}"
        f'<p style="color:#666;font-size:12px">{html.escape(footer)}</p>'
    )
    text_body = f"{greeting}\n\n{message['body']}\n\n" + (f"{link}\n\n" if link else "") + footer
    return html_body, text_body


def _whatsapp_body(message: dict[str, Any]) -> str:
    body = message["body"]
    link = message.get("link")
    room = _WHATSAPP_BODY_LIMIT - len(message["subject"]) - (len(link) + 2 if link else 0) - 6
    if len(body) > room:
        body = body[: max(room - 1, 0)] + "…"
    return f"*{message['subject']}*\n\n{body}" + (f"\n\n{link}" if link else "")


async def _send_one(batch: dict[str, Any], job: dict[str, Any]) -> tuple[str, Optional[str], Optional[str]]:
    """(status, detail, external_message_id) for one pending delivery."""
    message = batch["message"]
    channel = job["channel"]
    try:
        if channel == "email":
            html_body, text_body = _email_bodies(message, job["recipient_name"])
            ok = await send_email(
                to=job["address"], subject=f"[AEGIS] {message['subject']}", html=html_body, text=text_body
            )
            return ("sent", None, None) if ok else ("failed", "The email provider did not accept it", None)
        if channel == "teams":
            payload = teams_notify.build_message_payload(
                recipient_email=job["address"],
                recipient_name=job["recipient_name"],
                title=message["subject"],
                body=message["body"],
                sent_by=message.get("sender_name"),
                link=message.get("link") or teams_notify.app_base_url(),
            )
            ok, detail = await teams_notify.post_to_webhook(batch["teams_webhook_url"], payload)
            return ("sent" if ok else "failed", None if ok else detail, None)
        if channel == "whatsapp":
            result = await send_twilio_whatsapp(
                job["address"],
                body=None if message.get("whatsapp_content_sid") else _whatsapp_body(message),
                content_sid=message.get("whatsapp_content_sid"),
                content_variables=message.get("whatsapp_content_variables"),
            )
            return (result.get("status") or "queued", None, result.get("sid"))
    except TwilioWhatsAppError as exc:
        return "failed", str(exc), None
    except Exception as exc:  # one channel failing must never stop the others
        logger.exception("communication_send_failed", channel=channel, delivery_id=job["delivery_id"])
        return "failed", f"Unexpected error: {type(exc).__name__}", None
    return "failed", f"Unknown channel {channel}", None


async def deliver_batch(batch: dict[str, Any]) -> None:
    from core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        ids = [job["delivery_id"] for job in batch["jobs"]]
        still_pending = set(
            (
                await db.execute(
                    text("""
                    SELECT id::text FROM core.communication_deliveries
                    WHERE id = ANY(CAST(:ids AS uuid[])) AND status = 'pending'
                """),
                    {"ids": ids},
                )
            ).scalars().all()
        )
        jobs = [job for job in batch["jobs"] if job["delivery_id"] in still_pending]

        async def run(job: dict[str, Any]) -> tuple[dict[str, Any], tuple[str, Optional[str], Optional[str]]]:
            return job, await _send_one(batch, job)

        # Record each result as soon as its send returns, not when the slowest
        # one does: Twilio's status callbacks can only find a delivery once its
        # SID is committed.
        for finished in asyncio.as_completed([run(job) for job in jobs]):
            job, (status, detail, external_id) = await finished
            await db.execute(
                text("""
                UPDATE core.communication_deliveries
                SET status = :status, detail = :detail, external_message_id = :external_id, updated_at = NOW()
                WHERE id = :id AND status = 'pending'
            """),
                {"id": job["delivery_id"], "status": status, "detail": detail, "external_id": external_id},
            )
            await db.commit()
            if job["channel"] == "whatsapp" and external_id:
                await _reconcile_whatsapp(db, job["delivery_id"], external_id)


async def _reconcile_whatsapp(db: AsyncSession, delivery_id: str, sid: str) -> None:
    """A status callback that landed between Twilio accepting the message and
    the SID being committed matched nothing; read Twilio's current status
    once so it is not lost. Later callbacks match on the stored SID."""
    try:
        message = await fetch_twilio_message(sid)
    except TwilioWhatsAppError as exc:
        logger.warning("communication_whatsapp_reconcile_failed", delivery_id=delivery_id, error=str(exc))
        return
    status = str(message.get("status") or "").lower()
    if not status:
        return
    await db.execute(
        text("""
        UPDATE core.communication_deliveries
        SET status = :status, detail = COALESCE(:detail, detail), updated_at = NOW()
        WHERE id = :id AND external_message_id = :sid
          AND status <> :unchanged
          AND NOT (status = ANY(CAST(:later_statuses AS varchar[])))
    """),
        {
            "id": delivery_id,
            "sid": sid,
            "status": status,
            "unchanged": status,
            "detail": error_detail(message.get("error_code")),
            "later_statuses": statuses_that_supersede(status),
        },
    )
    await db.commit()
