"""Expiry warnings for employee contracts, credentials and assets due back.

Run hourly by app.workers.arq_worker.hr_expiry_alerts_job (it only acts from
07:00 Harare time) and on demand from the Contracts & Docs page.

Each item is warned once per tier: 60, 30, 14 and 7 days before it ends, and
on or after the day it ends. When an item is first seen inside the window,
only the tightest tier that applies is sent, so a contract found 10 days out
gets one "14 days" warning and not four at once. hr.expiry_alerts records
what went out. Changing the end date starts the tiers again, because the
key includes expires_on.

Who hears about it:
  * HR oversight, always: settings.HR_EXPIRY_ALERT_ALWAYS (nyasha@ by default)
  * the employee, at their AEGIS login address
  * in-app: HR Manager, HR Officer and Executive (Admin), plus the employee

A contract also gets a review meeting between management and the employee on
the SNC calendar the first time it enters the window: 14 days before it
ends, or the next working day if that has already passed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from html import escape
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.events import emit_notification, emit_role_notification
from core.config import settings
from core.email import send_email
from core.logging import logger

HARARE = timezone(timedelta(hours=2), "CAT")
SEND_HOUR = 7
TIERS = (60, 30, 14, 7, 0)
HR_ROLES = ["HR Manager", "HR Officer", "Executive (Admin)"]
APP_URL = "https://sixnineconstruction.com"

KIND_LABELS = {
    "contract": "Employment contract",
    "credential": "Credential",
    "asset": "Asset due back",
}


def always_recipients() -> list[str]:
    raw = settings.HR_EXPIRY_ALERT_ALWAYS or "nyasha@sixnineconstruction.com"
    return sorted({e.strip().lower() for e in raw.split(",") if e.strip()})


def is_send_time(now: datetime) -> bool:
    return now.astimezone(HARARE).hour >= SEND_HOUR


def tier_for(days_left: int) -> Optional[int]:
    """Tightest tier that applies, or None when it is still more than 60 days away."""
    if days_left > TIERS[0]:
        return None
    return min(t for t in TIERS if days_left <= t)


def review_meeting_start(ends_on: date, today: date) -> datetime:
    """10:00 Harare, 14 days before the end, or the next working day if that is too soon."""
    day = ends_on - timedelta(days=14)
    if day <= today:
        day = today + timedelta(days=1)
    while day.weekday() >= 5:
        day += timedelta(days=1)
    return datetime.combine(day, time(10, 0), tzinfo=HARARE)


@dataclass
class ExpiryItem:
    kind: str
    id: UUID
    organization_id: UUID
    employee_id: UUID
    employee_name: str
    employee_number: Optional[str]
    login_email: Optional[str]
    login_user_id: Optional[UUID]
    title: str
    reference: Optional[str]
    expires_on: date
    review_meeting_at: Optional[datetime] = None
    extra: dict[str, Any] = field(default_factory=dict)

    def days_left(self, today: date) -> int:
        return (self.expires_on - today).days


async def collect(db: AsyncSession, today: date, org_id: Optional[str] = None) -> list[ExpiryItem]:
    horizon = today + timedelta(days=TIERS[0])
    params = {"org": org_id, "horizon": horizon}
    staff = """
        JOIN hr.employees e ON e.id = x.employee_id AND e.organization_id = x.organization_id
             AND e.is_deleted = false AND e.employment_status <> 'terminated'
        LEFT JOIN core.users u ON u.id = e.linked_user_id AND u.is_active = true AND u.is_deleted = false
    """
    org_filter = "AND (CAST(:org AS uuid) IS NULL OR x.organization_id = CAST(:org AS uuid))"
    items: list[ExpiryItem] = []

    contracts = await db.execute(text(f"""
        SELECT x.id, x.organization_id, x.employee_id, e.employee_name, e.employee_number, u.email AS login_email,
               u.id AS login_user_id, x.contract_number, x.contract_type, x.ends_on, x.review_meeting_at
        FROM hr.employee_contracts x {staff}
        WHERE x.is_deleted = false AND x.status = 'active' AND x.ends_on IS NOT NULL AND x.ends_on <= :horizon {org_filter}
    """), params)
    for r in contracts.mappings():
        items.append(ExpiryItem(
            kind="contract", id=r["id"], organization_id=r["organization_id"], employee_id=r["employee_id"],
            employee_name=r["employee_name"], employee_number=r["employee_number"], login_email=r["login_email"],
            login_user_id=r["login_user_id"], title=f"{r['contract_type'].replace('_', ' ').title()} contract",
            reference=r["contract_number"], expires_on=r["ends_on"], review_meeting_at=r["review_meeting_at"],
        ))

    credentials = await db.execute(text(f"""
        SELECT x.id, x.organization_id, x.employee_id, e.employee_name, e.employee_number, u.email AS login_email,
               u.id AS login_user_id, x.certification_name, x.credential_type, x.certificate_number, x.expires_on
        FROM hr.employee_certifications x {staff}
        WHERE x.is_deleted = false AND x.expires_on IS NOT NULL AND x.expires_on <= :horizon
          AND x.verification_status <> 'rejected' {org_filter}
    """), params)
    for r in credentials.mappings():
        items.append(ExpiryItem(
            kind="credential", id=r["id"], organization_id=r["organization_id"], employee_id=r["employee_id"],
            employee_name=r["employee_name"], employee_number=r["employee_number"], login_email=r["login_email"],
            login_user_id=r["login_user_id"], title=r["certification_name"], reference=r["certificate_number"],
            expires_on=r["expires_on"], extra={"credential_type": r["credential_type"]},
        ))

    assets = await db.execute(text(f"""
        SELECT x.id, x.organization_id, x.employee_id, e.employee_name, e.employee_number, u.email AS login_email,
               u.id AS login_user_id, x.asset_label, x.asset_reference, x.due_back_on
        FROM hr.employee_asset_assignments x {staff}
        WHERE x.is_deleted = false AND x.status = 'issued' AND x.returned_on IS NULL
          AND x.due_back_on IS NOT NULL AND x.due_back_on <= :horizon {org_filter}
    """), params)
    for r in assets.mappings():
        items.append(ExpiryItem(
            kind="asset", id=r["id"], organization_id=r["organization_id"], employee_id=r["employee_id"],
            employee_name=r["employee_name"], employee_number=r["employee_number"], login_email=r["login_email"],
            login_user_id=r["login_user_id"], title=r["asset_label"], reference=r["asset_reference"],
            expires_on=r["due_back_on"],
        ))
    return items


async def _already_sent(db: AsyncSession, item: ExpiryItem, tier: int) -> bool:
    return bool((await db.execute(text("""
        SELECT 1 FROM hr.expiry_alerts WHERE organization_id=:org AND source_type=:kind AND source_id=:id
          AND threshold_days=:tier AND expires_on=:expires
    """), {"org": item.organization_id, "kind": item.kind, "id": item.id, "tier": tier, "expires": item.expires_on})).scalar())


def _headline(item: ExpiryItem, days_left: int) -> str:
    what = f"{item.employee_name}'s {item.title.lower() if item.kind == 'contract' else item.title}"
    if item.kind == "asset":
        what = f"{item.title} issued to {item.employee_name}"
        return f"{what} was due back {abs(days_left)} day(s) ago" if days_left < 0 else (
            f"{what} is due back today" if days_left == 0 else f"{what} is due back in {days_left} day(s)")
    if days_left < 0:
        return f"{what} expired {abs(days_left)} day(s) ago"
    if days_left == 0:
        return f"{what} expires today"
    return f"{what} expires in {days_left} day(s)"


def _email_html(item: ExpiryItem, days_left: int, meeting: Optional[datetime], to_employee: bool) -> str:
    rows = [
        ("Employee", f"{item.employee_name} ({item.employee_number or 'no number'})"),
        (KIND_LABELS[item.kind], item.title),
        ("Reference", item.reference or "—"),
        ("Due back on" if item.kind == "asset" else "Ends / expires on", item.expires_on.strftime("%d %b %Y")),
    ]
    if meeting:
        rows.append(("Review meeting", meeting.astimezone(HARARE).strftime("%a %d %b %Y, %H:%M (Harare)")))
    table = "".join(f"<tr><td style='padding:4px 12px 4px 0;color:#666'>{escape(k)}</td><td><b>{escape(v)}</b></td></tr>" for k, v in rows)
    if to_employee:
        intro = ("Your employment contract with Six Nine Construction is coming to an end. "
                 "Management will meet with you to discuss next steps.") if item.kind == "contract" else (
                 "Please return this item to the stores or HR." if item.kind == "asset" else
                 "Please renew it and send the new copy to HR so your record stays current.")
    else:
        intro = "Action needed: renew, extend or close this out in AEGIS."
    link = f"{APP_URL}/dashboard/hr/{'documents' if item.kind == 'contract' else 'credentials' if item.kind == 'credential' else 'assets'}"
    return (
        f"<div style='font-family:Segoe UI,Arial,sans-serif;font-size:14px'>"
        f"<p><b>{escape(_headline(item, days_left))}.</b></p><p>{escape(intro)}</p>"
        f"<table>{table}</table>"
        + ("" if to_employee else f"<p><a href='{link}'>Open in AEGIS</a></p>")
        + "<p style='color:#888;font-size:12px'>Sent by AEGIS, Six Nine Construction.</p></div>"
    )


async def _schedule_review_meeting(db: AsyncSession, item: ExpiryItem, today: date) -> Optional[datetime]:
    """Create the management/employee contract review on the SNC calendar. A
    calendar failure must not stop the warning emails, so it is caught."""
    if item.kind != "contract" or item.review_meeting_at:
        return item.review_meeting_at
    start = review_meeting_start(item.expires_on, today)
    try:
        from app.services.microsoft.calendar_service import upsert_event

        await upsert_event(
            db,
            organization_id=item.organization_id,
            source_module="hr",
            source_entity_type="contract_review",
            source_entity_id=item.id,
            subject=f"Contract review: {item.employee_name} ({item.reference})",
            start_at=start.astimezone(timezone.utc),
            end_at=(start + timedelta(minutes=30)).astimezone(timezone.utc),
            location="Six Nine Construction office",
            owner_user_id=item.login_user_id,
            calendar_category="HR",
            aegis_reference=item.reference or str(item.id),
            organisation_name="Six Nine Construction",
            extra_fields={
                "Employee": f"{item.employee_name} ({item.employee_number or 'no number'})",
                "Contract ends": item.expires_on.strftime("%d %b %Y"),
                "Attendees": "Managing Director, HR, the employee and their line manager",
                "Purpose": "Renew, extend, convert or close the contract",
            },
            deep_link=f"{APP_URL}/dashboard/hr/documents",
        )
    except Exception as exc:  # noqa: BLE001 - calendar is best-effort; emails still go
        logger.warning("hr.contract_review_meeting_failed", contract_id=str(item.id), error=str(exc))
    await db.execute(
        text("UPDATE hr.employee_contracts SET review_meeting_at=:at, updated_at=now() WHERE id=:id"),
        {"at": start, "id": item.id},
    )
    return start


async def run(db: AsyncSession, *, today: Optional[date] = None, org_id: Optional[str] = None,
              dry_run: bool = False) -> dict[str, Any]:
    """Send every warning that is due. Returns what was (or would be) sent."""
    today = today or datetime.now(HARARE).date()
    sent: list[dict[str, Any]] = []
    for item in await collect(db, today, org_id):
        days_left = item.days_left(today)
        tier = tier_for(days_left)
        if tier is None or await _already_sent(db, item, tier):
            continue
        summary = {"kind": item.kind, "employee": item.employee_name, "title": item.title,
                   "expires_on": item.expires_on.isoformat(), "days_left": days_left, "tier": tier}
        if dry_run:
            sent.append(summary)
            continue
        meeting = await _schedule_review_meeting(db, item, today)
        subject = f"AEGIS: {_headline(item, days_left)}"
        channels: dict[str, Any] = {"email": [], "in_app": 0}
        for address in always_recipients():
            if await send_email(address, subject, _email_html(item, days_left, meeting, to_employee=False)):
                channels["email"].append(address)
        if item.login_email and item.login_email.lower() not in always_recipients():
            if await send_email(item.login_email, subject, _email_html(item, days_left, meeting, to_employee=True)):
                channels["email"].append(item.login_email)
        link = "/dashboard/hr/documents" if item.kind == "contract" else "/dashboard/hr/credentials" if item.kind == "credential" else "/dashboard/hr/assets"
        channels["in_app"] = await emit_role_notification(
            db, org_id=str(item.organization_id), role_names=HR_ROLES, title=_headline(item, days_left),
            message=f"{KIND_LABELS[item.kind]} {item.reference or ''} for {item.employee_name}".strip(),
            notification_type="hr_expiry", priority="high" if days_left <= 7 else "normal", action_url=link,
            metadata={"source_type": item.kind, "source_id": str(item.id), "tier": tier},
        )
        if item.login_user_id:
            await emit_notification(
                db, org_id=str(item.organization_id), user_id=str(item.login_user_id), title=_headline(item, days_left),
                message="HR has been notified." + (f" Review meeting {meeting.astimezone(HARARE):%d %b %H:%M}." if meeting else ""),
                notification_type="hr_expiry", priority="normal", action_url="/dashboard/workforce/me",
            )
            channels["in_app"] += 1
        if meeting:
            channels["meeting_at"] = meeting.isoformat()
        await db.execute(text("""
            INSERT INTO hr.expiry_alerts (organization_id, source_type, source_id, threshold_days, expires_on, channels)
            VALUES (:org, :kind, :id, :tier, :expires, CAST(:channels AS jsonb))
            ON CONFLICT DO NOTHING
        """), {"org": item.organization_id, "kind": item.kind, "id": item.id, "tier": tier,
               "expires": item.expires_on, "channels": json.dumps(channels)})
        await db.commit()
        sent.append({**summary, "channels": channels})
    return {"today": today.isoformat(), "sent": sent, "dry_run": dry_run}
