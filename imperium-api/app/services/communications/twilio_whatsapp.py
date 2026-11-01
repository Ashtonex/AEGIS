"""Send one WhatsApp message through Twilio's Messages API.

Shared by the CRM WhatsApp endpoint and staff communications. Delivery
receipts come back on /crm-communications/webhooks/twilio/whatsapp/status
when TWILIO_WEBHOOK_BASE_URL is set."""

from __future__ import annotations

import json
from typing import Any, Optional

import httpx

from core.config import settings

STATUS_CALLBACK_PATH = "/api/v1/crm-communications/webhooks/twilio/whatsapp/status"


class TwilioWhatsAppError(Exception):
    """Twilio refused or could not be reached. str(exc) is safe to show."""


def twilio_whatsapp_sender() -> Optional[str]:
    return settings.TWILIO_WHATSAPP_FROM or settings.TWILIO_FROM_NUMBER


def digits(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    only = "".join(ch for ch in value if ch.isdigit())
    return only or None


def twilio_whatsapp_configured() -> bool:
    return bool(settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and digits(twilio_whatsapp_sender()))


async def send_twilio_whatsapp(
    to_digits: str,
    *,
    body: Optional[str] = None,
    content_sid: Optional[str] = None,
    content_variables: Optional[dict[str, str]] = None,
) -> dict[str, Any]:
    """Returns Twilio's message resource (sid, status, ...). Raises
    TwilioWhatsAppError with Twilio's own reason on a rejection."""
    sender = digits(twilio_whatsapp_sender())
    if not settings.TWILIO_ACCOUNT_SID or not settings.TWILIO_AUTH_TOKEN or not sender:
        raise TwilioWhatsAppError("Twilio WhatsApp is not configured on the backend.")

    form: dict[str, str] = {"From": f"whatsapp:+{sender}", "To": f"whatsapp:+{to_digits}"}
    if content_sid:
        form["ContentSid"] = content_sid
        if content_variables:
            form["ContentVariables"] = json.dumps(content_variables)
    else:
        form["Body"] = body or ""
    if settings.TWILIO_WEBHOOK_BASE_URL:
        form["StatusCallback"] = f"{settings.TWILIO_WEBHOOK_BASE_URL.rstrip('/')}{STATUS_CALLBACK_PATH}"

    url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
    try:
        async with httpx.AsyncClient(timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS) as client:
            response = await client.post(
                url,
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                data=form,
            )
    except httpx.HTTPError as exc:
        raise TwilioWhatsAppError("Could not reach Twilio.") from exc
    try:
        result = response.json()
    except ValueError:
        result = {}
    if not isinstance(result, dict):
        result = {}
    if response.status_code >= 400:
        # Twilio's message names the actual problem (unverified sender,
        # invalid number, unapproved template), so pass it through.
        reason = result.get("message") or f"HTTP {response.status_code}"
        raise TwilioWhatsAppError(f"Twilio rejected the WhatsApp message: {reason}")
    return result
