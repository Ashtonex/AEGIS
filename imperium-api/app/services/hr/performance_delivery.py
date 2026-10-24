"""Loading stored scorecards and sending them (app/services/hr/performance.py
computes them). Live weeks: each employee gets their own scorecard, each line
manager a team summary, and the digest recipients the whole organisation.
Shadow weeks: only the digest goes out."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any, Awaitable, Callable, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.hr import performance as perf
from app.services.hr import performance_email as pe
from core.config import settings as app_settings
from core.email import send_email
from core.logging import logger

CARD_SELECT = """
    SELECT s.*, e.employee_name, e.job_title, e.department, u.email,
           m.employee_name AS manager_name, m.linked_user_id AS manager_user_id, mu.email AS manager_email
    FROM hr.weekly_scorecards s
    JOIN hr.employees e ON e.id = s.employee_id
    LEFT JOIN core.users u ON u.id = s.user_id
    LEFT JOIN hr.employees m ON m.id = s.line_manager_employee_id
    LEFT JOIN core.users mu ON mu.id = m.linked_user_id AND mu.is_deleted = false AND mu.is_active = true
"""


async def load_cards(db: AsyncSession, org_id: str, *, week_end: Optional[date] = None,
                     card_id: Optional[str] = None, employee_id: Optional[str] = None) -> list[dict[str, Any]]:
    where = ["s.organization_id = :org"]
    params: dict[str, Any] = {"org": org_id}
    if week_end:
        where.append("s.week_end = :we")
        params["we"] = week_end
    if card_id:
        where.append("s.id = :id")
        params["id"] = card_id
    if employee_id:
        where.append("s.employee_id = :emp")
        params["emp"] = employee_id
    rows = await db.execute(text(CARD_SELECT + " WHERE " + " AND ".join(where) + " ORDER BY s.week_end DESC, e.employee_name"), params)
    return [dict(r) for r in rows.mappings()]


async def trends(db: AsyncSession, org_id: str, employee_ids: list[str], week_end: date, weeks: int = 4) -> dict[str, list[Optional[float]]]:
    out: dict[str, list[Optional[float]]] = defaultdict(list)
    rows = await db.execute(text("""
        SELECT employee_id, week_end, score, override_score FROM hr.weekly_scorecards
        WHERE organization_id = :org AND employee_id = ANY(CAST(:ids AS uuid[]))
          AND week_end > :from AND week_end <= :we
        ORDER BY week_end
    """), {"org": org_id, "ids": employee_ids, "from": week_end - timedelta(days=7 * weeks), "we": week_end})
    for r in rows.mappings():
        out[str(r["employee_id"])].append(perf.final_score(dict(r)))
    return out


async def previous_card(db: AsyncSession, org_id: str, card: dict[str, Any]) -> Optional[dict[str, Any]]:
    rows = await load_cards(db, org_id, week_end=card["week_end"] - timedelta(days=7), employee_id=str(card["employee_id"]))
    return rows[0] if rows else None


async def period_for(db: AsyncSession, card: dict[str, Any]) -> Optional[dict[str, Any]]:
    if not card.get("assisted_period_id"):
        return None
    row = (await db.execute(text("SELECT * FROM hr.assisted_working_periods WHERE id = :id"),
                            {"id": card["assisted_period_id"]})).mappings().first()
    return dict(row) if row else None


def app_url() -> Optional[str]:
    return app_settings.cors_origins[0] if app_settings.cors_origins else None


async def employee_email(db: AsyncSession, org_id: str, card: dict[str, Any], par: float) -> tuple[str, str, str]:
    """(subject, html, text) for one scorecard."""
    trend = (await trends(db, org_id, [str(card["employee_id"])], card["week_end"])).get(str(card["employee_id"]), [])
    previous = await previous_card(db, org_id, card)
    period = await period_for(db, card)
    name = card.get("employee_name") or ""
    html = pe.render_employee_email(card, name=name, par=par, app_url=app_url(), previous=previous, trend=trend, period=period)
    return pe.employee_subject(card), html, pe.render_employee_text(card, name=name, par=par, period=period)


def digest_recipients(settings: dict[str, Any]) -> list[str]:
    raw = settings["digest_recipients"] or app_settings.HR_WEEKLY_REPORT_RECIPIENTS
    return sorted({e.strip().lower() for e in raw.split(",") if e.strip()})


async def send_digest(db: AsyncSession, org_id: str, week_end: date, *, recipients: Optional[list[str]] = None) -> dict[str, list[str]]:
    settings = await perf.get_settings(db, org_id)
    cards = await load_cards(db, org_id, week_end=week_end)
    result: dict[str, list[str]] = {"sent": [], "failed": []}
    if not cards:
        return result
    shadow = cards[0]["mode"] == "shadow"
    week_start = week_end - timedelta(days=6)
    html = pe.render_team_email(cards, manager_name="Whole organisation", par=settings["par_score"], week_start=week_start,
                                week_end=week_end, app_url=app_url(), shadow=shadow, title="Weekly performance digest")
    prefix = "[Shadow] " if shadow else ""
    subject = f"{prefix}Weekly performance digest - week ending {week_end:%a %d %b}"
    for email in recipients or digest_recipients(settings):
        (result["sent"] if await send_email(to=email, subject=subject, html=html) else result["failed"]).append(email)
    return result


async def deliver_week(db: AsyncSession, org_id: str, week_end: date, *,
                       sent_before: Callable[[str], Awaitable[bool]],
                       mark_sent: Callable[[str], Awaitable[None]]) -> dict[str, Any]:
    """Sends whatever hasn't gone out yet for the week. Employee emails are
    tracked on the scorecard row; team summaries and the digest use the
    sent_before/mark_sent keys. Commits after each employee email."""
    settings = await perf.get_settings(db, org_id)
    par = settings["par_score"]
    cards = await load_cards(db, org_id, week_end=week_end)
    result: dict[str, Any] = {"employees": 0, "managers": 0, "digest": [], "failed": []}
    if not cards:
        return result
    live = cards[0]["mode"] == "live"

    if live:
        for card in cards:
            if card["emailed_at"] or not card.get("email"):
                continue
            subject, html, body = await employee_email(db, org_id, card, par)
            ok = await send_email(to=card["email"], subject=subject, html=html, text=body)
            await db.execute(text("""UPDATE hr.weekly_scorecards SET emailed_at = CASE WHEN :ok THEN NOW() ELSE emailed_at END,
                email_status = :status WHERE id = :id"""), {"ok": ok, "status": "sent" if ok else "failed", "id": card["id"]})
            await db.commit()
            if ok:
                result["employees"] += 1
            else:
                result["failed"].append(card["email"])

        teams: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for card in cards:
            if card.get("manager_email"):
                teams[card["manager_email"]].append(card)
        for email, team in teams.items():
            key = f"team:{email}"
            if await sent_before(key):
                continue
            html = pe.render_team_email(team, manager_name=team[0]["manager_name"] or "", par=par,
                                        week_start=week_end - timedelta(days=6), week_end=week_end, app_url=app_url())
            if await send_email(to=email, subject=f"Your team's weekly performance - week ending {week_end:%a %d %b}", html=html):
                await mark_sent(key)
                result["managers"] += 1
            else:
                result["failed"].append(email)

    for email in digest_recipients(settings):
        key = f"digest:{email}"
        if await sent_before(key):
            continue
        sent = await send_digest(db, org_id, week_end, recipients=[email])
        if sent["sent"]:
            await mark_sent(key)
            result["digest"].append(email)
        else:
            result["failed"].append(email)
    if result["failed"]:
        logger.warning(f"Weekly performance week ending {week_end}: failed for {result['failed']}")
    return result
