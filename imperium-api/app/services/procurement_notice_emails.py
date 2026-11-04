"""Supplier emails for public procurement notices (migration 284).

  new_notice - a notice opens for quotations: each active supplier on the
               register with an email address is invited to quote.
  outcome    - the RFQ is awarded, cancelled or closed without an award:
               every supplier that quoted is told how it ended for them
               (selected / not selected / cancelled / closed). The winner is
               never named to the others, and no amounts are given.

Every email is written to procurement.notice_email_log before it is sent,
keyed (notice, kind, recipient), so the scheduled job can run as often as it
likes: each email goes out once, and a failed send is retried on the next run
up to MAX_ATTEMPTS. Replies go to procurement@.
"""

from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from typing import Any, Awaitable, Callable, Dict, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import procurement_notices as pn
from app.services.documents.branding import PROCUREMENT_EMAIL, WEBSITES_LINE
from core.config import settings

MAX_ATTEMPTS = 5

# Derived notice status -> how an RFQ ended, for the outcome email.
FINISHED = {"awarded": "awarded", "in_delivery": "awarded", "fulfilled": "awarded", "cancelled": "cancelled"}

Sender = Callable[..., Awaitable[Any]]


def notice_url(reference: str) -> str:
    return f"{settings.PUBLIC_APP_URL.strip().rstrip('/')}/tenders/{reference}"


def portal_url(reference: str) -> str:
    return f"{settings.PUBLIC_APP_URL.strip().rstrip('/')}/portal/supplier?notice={reference}"


def _date(value: Any) -> str:
    if not value:
        return "the closing date"
    if isinstance(value, datetime):
        from zoneinfo import ZoneInfo

        return value.astimezone(ZoneInfo("Africa/Harare")).strftime("%d %B %Y, %H:%M")
    return str(value)


def _wrap(body: str) -> str:
    return (
        "<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0F172A;max-width:620px'>"
        f"{body}"
        "<p style='color:#475569;font-size:12px;margin-top:24px'>Six Nine Construction (Pvt) Ltd · "
        f"Procurement · {escape(PROCUREMENT_EMAIL)}<br>{escape(WEBSITES_LINE)}</p></div>"
    )


def compose(kind: str, outcome: Optional[str], notice: Dict[str, Any], supplier_name: Optional[str]) -> tuple[str, str, str]:
    """(subject, html, text) for one email."""
    ref = notice["reference"]
    title = notice["title"]
    greeting = f"Dear {supplier_name}," if supplier_name else "Dear supplier,"
    link = notice_url(ref)
    if kind == "new_notice":
        closing = _date(notice.get("closing_date"))
        subject = f"Request for quotation {ref}: {title}"
        lines = [
            greeting,
            f"Six Nine Construction invites your quotation for {title}"
            + (f" ({notice['project']})" if notice.get("project") else "") + ".",
            f"Quotations close {closing}.",
            f"See what is required: {link}",
            f"Quote online in the supplier portal: {portal_url(ref)}",
            f"Or reply to this email ({PROCUREMENT_EMAIL}) with your quotation, quoting {ref}.",
        ]
        html = _wrap(
            f"<p>{escape(greeting)}</p>"
            f"<p>Six Nine Construction invites your quotation for <b>{escape(title)}</b>"
            + (f" ({escape(notice['project'])})" if notice.get("project") else "")
            + f".</p><p>Quotations close <b>{escape(closing)}</b>.</p>"
            f"<p><a href='{escape(link)}'>See what is required</a> · "
            f"<a href='{escape(portal_url(ref))}'>Quote online in the supplier portal</a></p>"
            f"<p>Or reply to this email with your quotation, quoting <b>{escape(ref)}</b>.</p>"
        )
        return subject, html, "\n\n".join(lines)

    messages = {
        "selected": "Your quotation has been selected. Our purchase order follows separately; please quote its number on every delivery note and invoice.",
        "not_selected": "Thank you for your quotation. On this occasion it was not selected. We value your response and will invite you to quote again.",
        "cancelled": "This request has been cancelled and will not be awarded. Thank you for your quotation.",
        "closed": "This request has closed without an award. Thank you for your quotation.",
    }
    message = messages[outcome or "closed"]
    subject = f"{ref}: {title} - {'selected' if outcome == 'selected' else 'outcome'}"
    html = _wrap(
        f"<p>{escape(greeting)}</p><p>Request for quotation <b>{escape(ref)}</b>, {escape(title)}.</p>"
        f"<p>{escape(message)}</p><p><a href='{escape(link)}'>Notice and its current status</a></p>"
    )
    text_body = "\n\n".join([greeting, f"Request for quotation {ref}, {title}.", message, f"Notice and status: {link}"])
    return subject, html, text_body


async def _queue(db: AsyncSession, org_id: Any, notice_id: Any, kind: str, supplier_id: Any, email: str,
                 outcome: Optional[str] = None) -> None:
    await db.execute(
        text("""
            INSERT INTO procurement.notice_email_log (organization_id, notice_id, kind, supplier_id, recipient_email, outcome)
            VALUES (:org_id, :notice_id, :kind, :supplier_id, :email, :outcome)
            ON CONFLICT (notice_id, kind, recipient_email) DO NOTHING
        """),
        {"org_id": org_id, "notice_id": notice_id, "kind": kind, "supplier_id": supplier_id,
         "email": email.strip().lower(), "outcome": outcome},
    )


async def queue_due(db: AsyncSession, now: Optional[datetime] = None) -> None:
    """Write a log row for every email that is now due. Idempotent."""
    now = now or datetime.now(timezone.utc)
    rows = (
        await db.execute(text(pn.notice_query(where="n.is_published = true AND n.rfq_id IS NOT NULL")))
    ).mappings().all()
    for row in rows:
        notice = pn.serialize(dict(row), now=now)
        org_id = row["organization_id"]
        if notice["status"] == "open" and row["announce"]:
            suppliers = await db.execute(
                text("""
                    SELECT id, primary_contact_email FROM procurement.suppliers
                    WHERE organization_id = :org_id AND is_deleted = false AND status = 'active'
                      AND coalesce(trim(primary_contact_email), '') <> ''
                """),
                {"org_id": org_id},
            )
            for supplier in suppliers.mappings():
                await _queue(db, org_id, row["id"], "new_notice", supplier["id"], supplier["primary_contact_email"])
            continue

        ended = FINISHED.get(notice["status"])
        if not ended and row["rfq_status"] == "closed":
            ended = "closed"
        if not ended:
            continue
        quoted = await db.execute(
            text("""
                SELECT s.id, s.primary_contact_email, rr.status,
                       EXISTS (
                         SELECT 1 FROM procurement.purchase_orders po
                         WHERE po.rfq_id = rr.rfq_id AND po.supplier_id = rr.supplier_id
                           AND po.is_deleted = false AND po.status NOT IN ('draft', 'approved', 'cancelled')
                       ) AS has_order
                FROM procurement.rfq_responses rr
                JOIN procurement.suppliers s ON s.id = rr.supplier_id AND s.organization_id = rr.organization_id
                WHERE rr.rfq_id = :rfq_id AND rr.organization_id = :org_id AND rr.is_deleted = false
                  AND s.is_deleted = false AND coalesce(trim(s.primary_contact_email), '') <> ''
            """),
            {"rfq_id": row["rfq_id"], "org_id": org_id},
        )
        for supplier in quoted.mappings():
            if ended == "awarded":
                outcome = "selected" if supplier["has_order"] or supplier["status"] == "selected" else "not_selected"
            else:
                outcome = ended
            await _queue(db, org_id, row["id"], "outcome", supplier["id"], supplier["primary_contact_email"], outcome)


async def send_pending(db: AsyncSession, sender: Optional[Sender] = None, now: Optional[datetime] = None) -> Dict[str, int]:
    """Send every logged email not yet sent (up to MAX_ATTEMPTS tries each)."""
    if sender is None:
        from core.email import send_email_exact as sender  # noqa: N806

    now = now or datetime.now(timezone.utc)
    pending = (
        await db.execute(
            text(pn.notice_query(
                select="log.id AS log_id, log.kind, log.outcome, log.recipient_email, sup.supplier_name, ",
                source="procurement.notice_email_log log JOIN procurement.public_notices n ON n.id = log.notice_id",
                joins="LEFT JOIN procurement.suppliers sup ON sup.id = log.supplier_id",
                where="log.status <> 'sent' AND log.attempts < :max_attempts",
            ) + " ORDER BY log.created_at"),
            {"max_attempts": MAX_ATTEMPTS},
        )
    ).mappings().all()
    counts = {"sent": 0, "failed": 0}
    for row in pending:
        notice = pn.serialize(dict(row), now=now)
        subject, html, body = compose(row["kind"], row["outcome"], notice, row["supplier_name"])
        result = await sender(row["recipient_email"], subject, html, body, reply_to=PROCUREMENT_EMAIL)
        ok = bool(getattr(result, "ok", result))
        error = None if ok else str(getattr(result, "error", "") or "send failed")[:500]
        await db.execute(
            text("""
                UPDATE procurement.notice_email_log
                SET status = CASE WHEN CAST(:ok AS boolean) THEN 'sent' ELSE 'failed' END,
                    attempts = attempts + 1,
                    last_error = CAST(:error AS text),
                    sent_at = CASE WHEN CAST(:ok AS boolean) THEN now() END,
                    updated_at = now()
                WHERE id = :id
            """),
            {"ok": ok, "error": error, "id": row["log_id"]},
        )
        await db.commit()
        counts["sent" if ok else "failed"] += 1
    return counts


async def run(db: AsyncSession, sender: Optional[Sender] = None, now: Optional[datetime] = None) -> Dict[str, int]:
    await queue_due(db, now=now)
    await db.commit()
    return await send_pending(db, sender=sender, now=now)


async def email_procurement_on_quote(*, supplier_name: str, rfq_number: str, rfq_title: str,
                                     notice_reference: Optional[str], total_amount: Any, currency: str = "USD") -> bool:
    """Tell procurement@ a supplier has quoted through the portal. Best effort:
    the quote is already saved and staff are notified in AEGIS too."""
    from core.email import send_email_exact

    ref = notice_reference or rfq_number
    subject = f"Quotation received: {supplier_name} for {rfq_number} {rfq_title}"
    amount = f"{currency} {float(total_amount or 0):,.2f}"
    link = f"{settings.PUBLIC_APP_URL.strip().rstrip('/')}/dashboard/procurement?tab=rfqs"
    html = _wrap(
        f"<p><b>{escape(supplier_name)}</b> submitted a quotation of <b>{escape(amount)}</b> through the supplier portal "
        f"for {escape(rfq_number)}, {escape(rfq_title)}" + (f" (notice {escape(ref)})" if notice_reference else "") + ".</p>"
        f"<p><a href='{escape(link)}'>Compare quotations in AEGIS</a></p>"
    )
    body = f"{supplier_name} submitted a quotation of {amount} for {rfq_number}, {rfq_title}.\n\nCompare quotations: {link}"
    try:
        result = await send_email_exact(PROCUREMENT_EMAIL, subject, html, body)
        return bool(result.ok)
    except Exception:
        return False
