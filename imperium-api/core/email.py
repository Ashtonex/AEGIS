from typing import Optional

import httpx

from core.config import settings
from core.logging import logger

RESEND_API_URL = "https://api.resend.com/emails"


def real_address_from_teams_account(teams_account: Optional[str]) -> Optional[str]:
    """The mailbox behind a Microsoft identity.

    A guest's user principal name encodes their real address with the "@"
    replaced by "_" (ekowimbeah5@gmail.com -> ekowimbeah5_gmail.com#EXT#@
    tenant.onmicrosoft.com). Domains can't contain "_", so the last "_" in
    the part before #EXT# is the "@". A member identity is already an
    address. Returns None for anything that doesn't decode cleanly.
    """
    value = (teams_account or "").strip()
    if not value:
        return None
    if "#EXT#" in value.upper():
        local = value[: value.upper().index("#EXT#")]
        cut = local.rfind("_")
        if cut <= 0 or cut == len(local) - 1:
            return None
        address = f"{local[:cut]}@{local[cut + 1:]}"
    else:
        address = value
    name, _, domain = address.partition("@")
    if not name or "." not in domain or " " in address:
        return None
    return address


async def _delivery_addresses(to: str) -> list[str]:
    """The one mailbox an email addressed to `to` should go to.

    SNC staff log in as name@sixnineconstruction.com but sign into Teams as
    Microsoft guests on personal addresses, and only some logins are real
    mailboxes (settings.WORK_MAILBOXES). So:
      - a login that is a real work mailbox gets the email there;
      - any other AEGIS login with a Teams account (core.users.teams_account)
        gets it at the mailbox behind that account instead, since its work
        address would only land in the domain's catch-all;
      - anyone else - clients, suppliers, staff without a Teams account - is
        untouched.
    Never raises: any lookup problem sends to the original address.
    """
    if to.strip().lower() in settings.work_mailboxes:
        return [to]
    try:
        from core.database import AsyncSessionLocal
        from sqlalchemy import text

        async with AsyncSessionLocal() as db:
            teams_account = (
                await db.execute(
                    text("""
                        SELECT teams_account FROM core.users
                        WHERE lower(email) = lower(:to) AND is_deleted = false
                          AND teams_account IS NOT NULL
                        LIMIT 1
                    """),
                    {"to": to.strip()},
                )
            ).scalar()
    except Exception as exc:
        logger.warning("Email recipient lookup failed; sending to original address", error=str(exc))
        return [to]
    personal = real_address_from_teams_account(teams_account)
    return [personal] if personal else [to]


async def send_email(
    to: str,
    subject: str,
    html: str,
    text: Optional[str] = None,
) -> bool:
    """Send a transactional email via Resend. Returns True when Resend
    accepted it for at least one mailbox, False otherwise - callers decide
    whether that's fatal (fail closed, don't pretend the email went out). A
    login-only address is swapped for its real mailbox
    (settings.EMAIL_REDIRECTS), and a staff login goes to that person's one
    working mailbox - see _delivery_addresses."""
    to = settings.email_redirects.get(to.strip().lower(), to)
    if not settings.RESEND_API_KEY or not settings.EMAIL_FROM_ADDRESS:
        logger.warning(
            "Email not sent: RESEND_API_KEY/EMAIL_FROM_ADDRESS not configured",
            to=to,
            subject=subject,
        )
        return False

    results = [
        await _send_one(address, subject, html, text)
        for address in await _delivery_addresses(to)
    ]
    return any(results)


async def _send_one(to: str, subject: str, html: str, text: Optional[str]) -> bool:
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
