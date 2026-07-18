"""Unified CRM communication ledger and WhatsApp integration endpoints."""

from datetime import datetime
import hashlib
import hmac
import json
from base64 import b64encode
from typing import Any, Literal, Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.database import get_db
from core.security import require_permission

router = APIRouter()

Channel = Literal[
    "whatsapp_message",
    "whatsapp_call",
    "phone_call",
    "email",
    "meeting",
    "site_visit",
    "portal_message",
    "manual_note",
]
Direction = Literal["inbound", "outbound", "internal"]


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class CommunicationPayload(Payload):
    channel: Channel
    direction: Direction = "outbound"
    recipient_user_id: Optional[UUID] = None
    contact_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    subject: Optional[str] = Field(default=None, max_length=255)
    body: Optional[str] = None
    status: str = Field(default="completed", max_length=32)
    outcome: Optional[str] = Field(default=None, max_length=80)
    response_summary: Optional[str] = None
    next_action: Optional[str] = None
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    from_address: Optional[str] = Field(default=None, max_length=255)
    to_address: Optional[str] = Field(default=None, max_length=255)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_time_window(self):
        if self.started_at and self.ended_at and self.ended_at < self.started_at:
            raise ValueError("ended_at cannot precede started_at")
        return self


class CommunicationUpdatePayload(Payload):
    status: Optional[str] = Field(default=None, max_length=32)
    outcome: Optional[str] = Field(default=None, max_length=80)
    response_summary: Optional[str] = None
    next_action: Optional[str] = None
    ended_at: Optional[datetime] = None
    duration_seconds: Optional[int] = Field(default=None, ge=0)
    metadata: Optional[dict[str, Any]] = None


class WhatsAppMessagePayload(Payload):
    body: str = Field(min_length=1, max_length=4096)
    to_phone: Optional[str] = Field(default=None, min_length=6, max_length=50)
    contact_id: Optional[UUID] = None
    lead_id: Optional[UUID] = None
    opportunity_id: Optional[UUID] = None
    subject: Optional[str] = Field(default=None, max_length=255)

    @model_validator(mode="after")
    def has_recipient(self):
        if not self.to_phone and not self.contact_id:
            raise ValueError("Either to_phone or contact_id is required.")
        return self


def _response(data: Any, message: str, total: Optional[int] = None) -> dict[str, Any]:
    return {
        "success": True,
        "data": data,
        "message": message,
        "meta": {} if total is None else {"total": total},
    }


def _clean_phone(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    digits = "".join(ch for ch in value if ch.isdigit())
    return digits or None


def _phone_matches(left: Optional[str], right: Optional[str]) -> bool:
    left_digits = _clean_phone(left)
    right_digits = _clean_phone(right)
    if not left_digits or not right_digits:
        return False
    return left_digits.endswith(right_digits) or right_digits.endswith(left_digits)


def _twilio_callback_url(request: Request) -> str:
    if settings.TWILIO_WEBHOOK_BASE_URL:
        return (
            f"{settings.TWILIO_WEBHOOK_BASE_URL.rstrip('/')}"
            f"{request.url.path}"
            f"{'?' + request.url.query if request.url.query else ''}"
        )
    return str(request.url)


def _validate_twilio_signature(url: str, params: dict[str, str], signature: str) -> bool:
    if not settings.TWILIO_AUTH_TOKEN:
        return True
    signed = url + "".join(f"{key}{params[key]}" for key in sorted(params))
    digest = hmac.new(
        settings.TWILIO_AUTH_TOKEN.encode("utf-8"),
        signed.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    expected = b64encode(digest).decode("utf-8")
    return hmac.compare_digest(signature, expected)


def _twilio_status_to_ledger(status_value: Optional[str]) -> str:
    status_map = {
        "queued": "queued",
        "initiated": "initiated",
        "ringing": "ringing",
        "in-progress": "in_progress",
        "completed": "completed",
        "busy": "busy",
        "failed": "failed",
        "no-answer": "no_answer",
        "canceled": "cancelled",
    }
    return status_map.get(str(status_value or "").lower(), "updated")


async def _contact_phone(
    db: AsyncSession, org_id: str, contact_id: UUID
) -> Optional[str]:
    phone = (
        await db.execute(
            text("""
        SELECT phone FROM crm.contacts
        WHERE id=:contact_id AND organization_id=:org_id AND is_deleted=false
    """),
            {"contact_id": contact_id, "org_id": org_id},
        )
    ).scalar()
    return _clean_phone(phone)


async def _insert_communication(
    db: AsyncSession,
    *,
    org_id: str,
    user_id: Optional[str],
    values: dict[str, Any],
) -> UUID:
    started_at = values.get("started_at") or datetime.utcnow()
    row = await db.execute(
        text("""
        INSERT INTO crm.communication_events (
            organization_id, created_by, actor_user_id, recipient_user_id, contact_id, lead_id, opportunity_id,
            channel, direction, subject, body, status, outcome, response_summary, next_action,
            started_at, ended_at, duration_seconds, external_provider, external_message_id,
            external_call_id, from_address, to_address, metadata, raw_payload
        )
        VALUES (
            :org_id, :created_by, :actor_user_id, :recipient_user_id, :contact_id, :lead_id, :opportunity_id,
            :channel, :direction, :subject, :body, :status, :outcome, :response_summary, :next_action,
            :started_at, :ended_at, :duration_seconds, :external_provider, :external_message_id,
            :external_call_id, :from_address, :to_address, CAST(:metadata AS jsonb), CAST(:raw_payload AS jsonb)
        )
        ON CONFLICT (organization_id, external_provider, external_message_id)
        WHERE external_message_id IS NOT NULL AND is_deleted = false
        DO UPDATE SET
            status=EXCLUDED.status,
            raw_payload=EXCLUDED.raw_payload,
            updated_at=NOW()
        RETURNING id
    """),
        {
            "org_id": org_id,
            "created_by": user_id,
            "actor_user_id": values.get("actor_user_id") or user_id,
            "recipient_user_id": values.get("recipient_user_id"),
            "contact_id": values.get("contact_id"),
            "lead_id": values.get("lead_id"),
            "opportunity_id": values.get("opportunity_id"),
            "channel": values["channel"],
            "direction": values.get("direction", "outbound"),
            "subject": values.get("subject"),
            "body": values.get("body"),
            "status": values.get("status", "completed"),
            "outcome": values.get("outcome"),
            "response_summary": values.get("response_summary"),
            "next_action": values.get("next_action"),
            "started_at": started_at,
            "ended_at": values.get("ended_at"),
            "duration_seconds": values.get("duration_seconds"),
            "external_provider": values.get("external_provider"),
            "external_message_id": values.get("external_message_id"),
            "external_call_id": values.get("external_call_id"),
            "from_address": values.get("from_address"),
            "to_address": values.get("to_address"),
            "metadata": json.dumps(values.get("metadata") or {}),
            "raw_payload": json.dumps(values.get("raw_payload") or {}),
        },
    )
    communication_id = row.scalar()
    await _mirror_activity(db, org_id=org_id, user_id=user_id, communication_id=communication_id)
    return communication_id


async def _mirror_activity(
    db: AsyncSession, *, org_id: str, user_id: Optional[str], communication_id: UUID
) -> None:
    await db.execute(
        text("""
        INSERT INTO crm.activities (
            organization_id, created_by, contact_id, lead_id, opportunity_id,
            type, subject, description, activity_date, status
        )
        SELECT
            organization_id, :user_id, contact_id, lead_id, opportunity_id,
            CASE channel
                WHEN 'whatsapp_message' THEN 'WhatsApp'
                WHEN 'whatsapp_call' THEN 'WhatsApp Call'
                WHEN 'phone_call' THEN 'Call'
                WHEN 'site_visit' THEN 'Site Visit'
                WHEN 'manual_note' THEN 'Note'
                ELSE initcap(replace(channel, '_', ' '))
            END,
            COALESCE(subject, outcome, 'CRM communication'),
            concat_ws(E'\n',
                body,
                CASE WHEN outcome IS NOT NULL THEN 'Outcome: ' || outcome ELSE NULL END,
                CASE WHEN response_summary IS NOT NULL THEN 'Response: ' || response_summary ELSE NULL END,
                CASE WHEN next_action IS NOT NULL THEN 'Next action: ' || next_action ELSE NULL END,
                CASE WHEN duration_seconds IS NOT NULL THEN 'Duration: ' || duration_seconds::text || ' seconds' ELSE NULL END
            ),
            started_at,
            CASE
                WHEN status IN ('planned', 'pending') THEN 'Pending'
                ELSE 'Completed'
            END
        FROM crm.communication_events
        WHERE id=:communication_id AND organization_id=:org_id
    """),
        {"communication_id": communication_id, "org_id": org_id, "user_id": user_id},
    )


@router.get("/")
async def list_communications(
    contact_id: Optional[UUID] = None,
    recipient_user_id: Optional[UUID] = None,
    lead_id: Optional[UUID] = None,
    opportunity_id: Optional[UUID] = None,
    channel: Optional[str] = None,
    limit: int = Query(default=100, ge=1, le=500),
    user: dict = Depends(require_permission("crm_communications.read")),
    db: AsyncSession = Depends(get_db),
):
    query = """
        SELECT ce.*,
               actor.full_name AS actor_name,
               actor.email AS actor_email,
               recipient.full_name AS recipient_name,
               recipient.email AS recipient_email,
               c.contact_name,
               l.company_name AS lead_company,
               o.name AS opportunity_name
        FROM crm.communication_events ce
        LEFT JOIN core.users actor ON actor.id=ce.actor_user_id
        LEFT JOIN core.users recipient ON recipient.id=ce.recipient_user_id
        LEFT JOIN crm.contacts c ON c.id=ce.contact_id AND c.organization_id=ce.organization_id
        LEFT JOIN crm.leads l ON l.id=ce.lead_id AND l.organization_id=ce.organization_id
        LEFT JOIN crm.opportunities o ON o.id=ce.opportunity_id AND o.organization_id=ce.organization_id
        WHERE ce.organization_id=:org_id AND ce.is_deleted=false
    """
    params: dict[str, Any] = {"org_id": user["org_id"], "limit": limit}
    if contact_id:
        query += " AND ce.contact_id=:contact_id"
        params["contact_id"] = contact_id
    if recipient_user_id:
        query += " AND ce.recipient_user_id=:recipient_user_id"
        params["recipient_user_id"] = recipient_user_id
    if lead_id:
        query += " AND ce.lead_id=:lead_id"
        params["lead_id"] = lead_id
    if opportunity_id:
        query += " AND ce.opportunity_id=:opportunity_id"
        params["opportunity_id"] = opportunity_id
    if channel:
        query += " AND ce.channel=:channel"
        params["channel"] = channel
    query += " ORDER BY ce.started_at DESC LIMIT :limit"
    rows = (await db.execute(text(query), params)).mappings().all()
    data = [dict(row) for row in rows]
    return _response(data, "CRM communications retrieved.", len(data))


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_communication(
    payload: CommunicationPayload,
    user: dict = Depends(require_permission("crm_communications.create")),
    db: AsyncSession = Depends(get_db),
):
    try:
        communication_id = await _insert_communication(
            db,
            org_id=user["org_id"],
            user_id=user["user_id"],
            values=payload.model_dump(exclude_none=True),
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Communication payload violates CRM database constraints.",
        ) from exc
    return _response({"id": str(communication_id)}, "CRM communication logged.")


@router.patch("/{communication_id}")
async def update_communication(
    communication_id: UUID,
    payload: CommunicationUpdatePayload,
    user: dict = Depends(require_permission("crm_communications.update")),
    db: AsyncSession = Depends(get_db),
):
    values = payload.model_dump(exclude_unset=True, exclude_none=False)
    if not values:
        return _response({"id": str(communication_id)}, "No fields to update.")
    result = await db.execute(
        text("""
        UPDATE crm.communication_events
        SET status=COALESCE(:status, status),
            outcome=COALESCE(:outcome, outcome),
            response_summary=COALESCE(:response_summary, response_summary),
            next_action=COALESCE(:next_action, next_action),
            ended_at=COALESCE(:ended_at, ended_at),
            duration_seconds=COALESCE(:duration_seconds, duration_seconds),
            metadata=COALESCE(CAST(:metadata AS jsonb), metadata),
            updated_at=NOW()
        WHERE id=:communication_id AND organization_id=:org_id AND is_deleted=false
        RETURNING id
    """),
        {
            "communication_id": communication_id,
            "org_id": user["org_id"],
            "status": values.get("status"),
            "outcome": values.get("outcome"),
            "response_summary": values.get("response_summary"),
            "next_action": values.get("next_action"),
            "ended_at": values.get("ended_at"),
            "duration_seconds": values.get("duration_seconds"),
            "metadata": json.dumps(values["metadata"]) if "metadata" in values and values["metadata"] is not None else None,
        },
    )
    if not result.scalar():
        raise HTTPException(status_code=404, detail="Communication was not found.")
    await db.commit()
    return _response({"id": str(communication_id)}, "CRM communication updated.")


@router.post("/whatsapp/messages", status_code=status.HTTP_201_CREATED)
async def send_whatsapp_message(
    payload: WhatsAppMessagePayload,
    user: dict = Depends(require_permission("crm_communications.create")),
    db: AsyncSession = Depends(get_db),
):
    if not settings.WHATSAPP_ACCESS_TOKEN or not settings.WHATSAPP_PHONE_NUMBER_ID:
        raise HTTPException(
            status_code=503,
            detail="WhatsApp Cloud API is not configured on the backend.",
        )
    to_phone = _clean_phone(payload.to_phone)
    if not to_phone and payload.contact_id:
        to_phone = await _contact_phone(db, user["org_id"], payload.contact_id)
    if not to_phone:
        raise HTTPException(status_code=422, detail="Recipient phone number is missing.")

    url = (
        f"https://graph.facebook.com/{settings.WHATSAPP_GRAPH_API_VERSION}/"
        f"{settings.WHATSAPP_PHONE_NUMBER_ID}/messages"
    )
    request_body = {
        "messaging_product": "whatsapp",
        "to": to_phone,
        "type": "text",
        "text": {"body": payload.body},
    }
    try:
        async with httpx.AsyncClient(timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                headers={"Authorization": f"Bearer {settings.WHATSAPP_ACCESS_TOKEN}"},
                json=request_body,
            )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail="WhatsApp Cloud API rejected the outbound message.",
        ) from exc

    result = response.json()
    message_id = None
    messages = result.get("messages") if isinstance(result, dict) else None
    if isinstance(messages, list) and messages:
        message_id = messages[0].get("id")

    communication_id = await _insert_communication(
        db,
        org_id=user["org_id"],
        user_id=user["user_id"],
        values={
            "channel": "whatsapp_message",
            "direction": "outbound",
            "contact_id": payload.contact_id,
            "lead_id": payload.lead_id,
            "opportunity_id": payload.opportunity_id,
            "subject": payload.subject or "WhatsApp message",
            "body": payload.body,
            "status": "sent",
            "external_provider": "whatsapp_cloud_api",
            "external_message_id": message_id,
            "from_address": settings.WHATSAPP_PHONE_NUMBER_ID,
            "to_address": to_phone,
            "raw_payload": result,
        },
    )
    await db.commit()
    return _response(
        {"id": str(communication_id), "external_message_id": message_id},
        "WhatsApp message sent and logged.",
    )


@router.get("/webhooks/whatsapp")
async def verify_whatsapp_webhook(
    hub_mode: Optional[str] = Query(default=None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(default=None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(default=None, alias="hub.challenge"),
):
    if (
        hub_mode == "subscribe"
        and settings.WHATSAPP_VERIFY_TOKEN
        and hub_verify_token == settings.WHATSAPP_VERIFY_TOKEN
        and hub_challenge
    ):
        return PlainTextResponse(hub_challenge)
    raise HTTPException(status_code=403, detail="WhatsApp webhook verification failed.")


async def _org_for_whatsapp_phone_id(
    db: AsyncSession, phone_number_id: Optional[str]
) -> Optional[str]:
    if not phone_number_id:
        return None
    row = (
        await db.execute(
            text("""
        SELECT organization_id
        FROM settings.integration_connections
        WHERE provider='whatsapp'
          AND external_reference=:phone_number_id
          AND is_deleted=false
        ORDER BY updated_at DESC
        LIMIT 1
    """),
            {"phone_number_id": phone_number_id},
        )
    ).first()
    if row:
        return str(row.organization_id)
    if settings.WHATSAPP_PHONE_NUMBER_ID == phone_number_id:
        org = (
            await db.execute(
                text("SELECT id FROM core.organizations WHERE is_deleted=false ORDER BY created_at LIMIT 1")
            )
        ).scalar()
        return str(org) if org else None
    return None


async def _org_for_twilio_number(db: AsyncSession, from_number: Optional[str]) -> Optional[str]:
    row = (
        await db.execute(
            text("""
        SELECT organization_id
        FROM settings.integration_connections
        WHERE provider='twilio'
          AND is_deleted=false
        ORDER BY updated_at DESC
        LIMIT 25
    """)
        )
    ).mappings().all()
    for item in row:
        return str(item["organization_id"])
    if settings.TWILIO_FROM_NUMBER and _phone_matches(settings.TWILIO_FROM_NUMBER, from_number):
        org = (
            await db.execute(
                text("SELECT id FROM core.organizations WHERE is_deleted=false ORDER BY created_at LIMIT 1")
            )
        ).scalar()
        return str(org) if org else None
    return None


async def _contact_for_phone(
    db: AsyncSession, org_id: str, phone: Optional[str]
) -> Optional[UUID]:
    digits = _clean_phone(phone)
    if not digits:
        return None
    contact_id = (
        await db.execute(
            text("""
        SELECT id
        FROM crm.contacts
        WHERE organization_id=:org_id
          AND is_deleted=false
          AND regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g')=:phone
        ORDER BY updated_at DESC
        LIMIT 1
    """),
            {"org_id": org_id, "phone": digits},
        )
    ).scalar()
    return contact_id


@router.post("/webhooks/twilio/voice/status")
async def receive_twilio_voice_status_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    form = await request.form()
    params = {key: str(value) for key, value in form.items()}
    signature = request.headers.get("x-twilio-signature", "")
    if not _validate_twilio_signature(_twilio_callback_url(request), params, signature):
        raise HTTPException(status_code=403, detail="Invalid Twilio webhook signature.")

    call_sid = params.get("CallSid")
    if not call_sid:
        raise HTTPException(status_code=422, detail="Twilio callback did not include CallSid.")

    from_number = params.get("From")
    to_number = params.get("To")
    org_id = await _org_for_twilio_number(db, from_number or to_number)
    if not org_id:
        return _response({"processed": 0}, "Twilio callback ignored for unknown tenant.")

    twilio_direction = str(params.get("Direction") or "").lower()
    direction: Direction = "inbound" if "inbound" in twilio_direction else "outbound"
    contact_phone = from_number if direction == "inbound" else to_number
    contact_id = await _contact_for_phone(db, org_id, contact_phone)
    status_value = _twilio_status_to_ledger(params.get("CallStatus"))
    duration = params.get("CallDuration") or params.get("Duration")
    duration_seconds = int(duration) if str(duration or "").isdigit() else None
    started_at = datetime.utcnow()
    ended_at = started_at if status_value in {"completed", "busy", "failed", "no_answer", "cancelled"} else None

    existing = (
        await db.execute(
            text("""
        SELECT id FROM crm.communication_events
        WHERE organization_id=:org_id
          AND external_provider='twilio_voice'
          AND external_call_id=:call_sid
          AND is_deleted=false
    """),
            {"org_id": org_id, "call_sid": call_sid},
        )
    ).scalar()

    if existing:
        await db.execute(
            text("""
        UPDATE crm.communication_events
        SET status=:status,
            contact_id=COALESCE(contact_id, :contact_id),
            ended_at=COALESCE(:ended_at, ended_at),
            duration_seconds=COALESCE(:duration_seconds, duration_seconds),
            raw_payload=CAST(:raw_payload AS jsonb),
            updated_at=NOW()
        WHERE id=:communication_id AND organization_id=:org_id
    """),
            {
                "communication_id": existing,
                "org_id": org_id,
                "status": status_value,
                "contact_id": contact_id,
                "ended_at": ended_at,
                "duration_seconds": duration_seconds,
                "raw_payload": json.dumps(params),
            },
        )
        communication_id = existing
    else:
        communication_id = await _insert_communication(
            db,
            org_id=org_id,
            user_id=None,
            values={
                "channel": "phone_call",
                "direction": direction,
                "contact_id": contact_id,
                "subject": "Twilio phone call",
                "status": status_value,
                "started_at": started_at,
                "ended_at": ended_at,
                "duration_seconds": duration_seconds,
                "external_provider": "twilio_voice",
                "external_call_id": call_sid,
                "from_address": from_number,
                "to_address": to_number,
                "metadata": {
                    "account_sid": params.get("AccountSid"),
                    "api_version": params.get("ApiVersion"),
                    "direction": params.get("Direction"),
                },
                "raw_payload": params,
            },
        )
    await db.commit()
    return _response({"processed": 1, "id": str(communication_id)}, "Twilio call status logged.")


@router.post("/webhooks/whatsapp")
async def receive_whatsapp_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    body = await request.body()
    if settings.WHATSAPP_APP_SECRET:
        signature = request.headers.get("x-hub-signature-256", "")
        expected = "sha256=" + hmac.new(
            settings.WHATSAPP_APP_SECRET.encode("utf-8"),
            body,
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise HTTPException(status_code=403, detail="Invalid WhatsApp webhook signature.")
    payload = json.loads(body.decode("utf-8") or "{}")
    processed = 0
    entries = payload.get("entry") if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return _response({"processed": processed}, "WhatsApp webhook ignored.")

    for entry in entries:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            metadata = value.get("metadata") or {}
            phone_number_id = metadata.get("phone_number_id")
            org_id = await _org_for_whatsapp_phone_id(db, phone_number_id)
            if not org_id:
                continue

            for status_event in value.get("statuses") or []:
                message_id = status_event.get("id")
                if not message_id:
                    continue
                await db.execute(
                    text("""
                    UPDATE crm.communication_events
                    SET status=:status,
                        raw_payload=CAST(:raw_payload AS jsonb),
                        updated_at=NOW()
                    WHERE organization_id=:org_id
                      AND external_provider='whatsapp_cloud_api'
                      AND external_message_id=:message_id
                      AND is_deleted=false
                """),
                    {
                        "org_id": org_id,
                        "message_id": message_id,
                        "status": status_event.get("status") or "updated",
                        "raw_payload": json.dumps(status_event),
                    },
                )
                processed += 1

            for message in value.get("messages") or []:
                from_phone = _clean_phone(message.get("from"))
                contact_id = await _contact_for_phone(db, org_id, from_phone)
                text_body = (message.get("text") or {}).get("body")
                timestamp = message.get("timestamp")
                started_at = (
                    datetime.fromtimestamp(int(timestamp))
                    if str(timestamp or "").isdigit()
                    else datetime.utcnow()
                )
                await _insert_communication(
                    db,
                    org_id=org_id,
                    user_id=None,
                    values={
                        "channel": "whatsapp_message",
                        "direction": "inbound",
                        "contact_id": contact_id,
                        "subject": "WhatsApp reply",
                        "body": text_body,
                        "status": "received",
                        "external_provider": "whatsapp_cloud_api",
                        "external_message_id": message.get("id"),
                        "from_address": from_phone,
                        "to_address": phone_number_id,
                        "started_at": started_at,
                        "raw_payload": message,
                    },
                )
                processed += 1
    await db.commit()
    return _response({"processed": processed}, "WhatsApp webhook processed.")
