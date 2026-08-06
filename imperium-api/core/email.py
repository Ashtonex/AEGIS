from typing import Optional

import httpx

from core.config import settings
from core.logging import logger

RESEND_API_URL = "https://api.resend.com/emails"


async def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
) -> bool:
    """Send a transactional email via Resend. Returns True on a 2xx from
    Resend, False otherwise - callers decide whether that's fatal (fail
    closed, don't pretend the email went out)."""
    if not settings.RESEND_API_KEY or not settings.EMAIL_FROM_ADDRESS:
        logger.warning(
            "Email not sent: RESEND_API_KEY/EMAIL_FROM_ADDRESS not configured",
            to=to,
            subject=subject,
        )
        return False

    payload = {
        "from": settings.EMAIL_FROM_ADDRESS,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        payload["text"] = text

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}"},
                json=payload,
            )
        if response.status_code >= 400:
            logger.warning(
                "Resend email send failed",
                to=to,
                subject=subject,
                status_code=response.status_code,
                body=response.text[:500],
            )
            return False
        return True
    except Exception as exc:
        logger.warning("Resend email send raised", to=to, subject=subject, error=str(exc))
        return False
