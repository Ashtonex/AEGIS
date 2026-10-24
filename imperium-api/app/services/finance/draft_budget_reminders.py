"""Reminders for project budgets still sitting in draft.

A draft budget (an execution budget uploaded for review) changes nothing
until someone approves it, so it is easy to forget. Every weekday morning
app.workers.arq_worker.draft_budget_reminder_job emails one digest per
person listing the drafts they are responsible for:

* the project's QS and Project Manager - read from the project's site role
  assignments, its assignee and its delivery manager. A project with no
  named QS (or PM) falls back to every user holding the Quantity Surveyor
  (or Project Manager) role, so a draft never goes unowned.
* the MD and Finance oversight - settings.DRAFT_BUDGET_REMINDER_ALWAYS,
  copied on every draft.

Finance can also send the same reminders on demand from the Budgets page.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from html import escape
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.email import send_email
from core.logging import logger

HARARE = timezone(timedelta(hours=2), "CAT")
SEND_HOUR = 7  # 07:00 Harare time, weekdays


def is_send_time(now: datetime) -> bool:
    local = now.astimezone(HARARE)
    return local.weekday() < 5 and local.hour >= SEND_HOUR


def always_recipients() -> list[str]:
    return sorted({
        email.strip().lower()
        for email in settings.DRAFT_BUDGET_REMINDER_ALWAYS.split(",")
        if email.strip()
    })


async def list_draft_budgets(db: AsyncSession, org_id: Optional[str] = None) -> list[dict[str, Any]]:
    rows = await db.execute(
        text("""
            SELECT pb.id, pb.organization_id, pb.project_id, pb.budget_version, pb.label,
                   pb.total_amount, pb.created_at, p.name AS project_name, p.project_code
            FROM finance.project_budgets pb
            JOIN projects.projects p ON p.id = pb.project_id AND p.organization_id = pb.organization_id
            WHERE pb.status = 'draft' AND pb.is_deleted = false AND p.is_deleted = false
              AND (CAST(:org_id AS uuid) IS NULL OR pb.organization_id = CAST(:org_id AS uuid))
            ORDER BY pb.created_at
        """),
        {"org_id": org_id},
    )
    return [dict(r._mapping) for r in rows]


async def _role_users(db: AsyncSession, org_id: str, role_name: str) -> list[dict[str, Any]]:
    rows = await db.execute(
        text("""
            SELECT DISTINCT u.id, lower(u.email) AS email, u.full_name
            FROM core.users u
            JOIN core.user_roles ur ON ur.user_id = u.id
            JOIN core.roles r ON r.id = ur.role_id
            WHERE u.organization_id = :org_id AND u.is_deleted = false
              AND u.email IS NOT NULL AND r.name = :role_name
        """),
        {"org_id": org_id, "role_name": role_name},
    )
    return [dict(r._mapping) for r in rows]


async def project_team(db: AsyncSession, org_id: str, project_id: str) -> dict[str, list[dict[str, Any]]]:
    """{'qs': [...], 'pm': [...]} users named on the project."""
    rows = await db.execute(
        text("""
            SELECT 'qs' AS slot, u.id, lower(u.email) AS email, u.full_name
            FROM projects.site_role_assignments sra
            JOIN core.users u ON u.id = sra.user_id AND u.is_deleted = false
            WHERE sra.project_id = :project_id AND sra.organization_id = :org_id
              AND sra.is_deleted = false AND COALESCE(sra.is_active, true)
              AND (sra.role_name ILIKE '%surveyor%' OR sra.role_name ILIKE 'qs%')
            UNION
            SELECT 'pm', u.id, lower(u.email), u.full_name
            FROM projects.site_role_assignments sra
            JOIN core.users u ON u.id = sra.user_id AND u.is_deleted = false
            WHERE sra.project_id = :project_id AND sra.organization_id = :org_id
              AND sra.is_deleted = false AND COALESCE(sra.is_active, true)
              AND sra.role_name ILIKE '%project manager%'
            UNION
            SELECT 'pm', u.id, lower(u.email), u.full_name
            FROM projects.projects p
            JOIN core.users u ON u.id = p.assigned_to_user_id AND u.is_deleted = false
            WHERE p.id = :project_id AND p.organization_id = :org_id
            UNION
            SELECT 'pm', u.id, lower(u.email), u.full_name
            FROM projects.project_profiles pp
            JOIN core.users u ON u.id = pp.delivery_manager_id AND u.is_deleted = false
            WHERE pp.project_id = :project_id
        """),
        {"org_id": org_id, "project_id": project_id},
    )
    team: dict[str, list[dict[str, Any]]] = {"qs": [], "pm": []}
    for r in rows.mappings():
        if r["email"]:
            team[r["slot"]].append({"id": str(r["id"]), "email": r["email"], "full_name": r["full_name"]})
    return team


async def recipients_for_draft(db: AsyncSession, draft: dict[str, Any], *, role_cache: Optional[dict] = None) -> list[dict[str, str]]:
    """Everyone a draft's reminder goes to, each tagged with why."""
    org_id = str(draft["organization_id"])
    role_cache = role_cache if role_cache is not None else {}
    team = await project_team(db, org_id, str(draft["project_id"]))
    out: dict[str, dict[str, str]] = {}

    async def add(users: list[dict[str, Any]], reason: str) -> None:
        for u in users:
            out.setdefault(u["email"], {"email": u["email"], "name": u.get("full_name") or u["email"], "reason": reason})

    for slot, role_name, label in (("qs", "Quantity Surveyor", "QS"), ("pm", "Project Manager", "Project Manager")):
        if team[slot]:
            await add(team[slot], f"{label} on project")
        else:
            key = (org_id, role_name)
            if key not in role_cache:
                role_cache[key] = await _role_users(db, org_id, role_name)
            await add(role_cache[key], f"{label} (no {label} named on project)")
    for email in always_recipients():
        out.setdefault(email, {"email": email, "name": email, "reason": "MD / Finance oversight"})
    return list(out.values())


def _money(value: Any) -> str:
    return f"US${float(value or 0):,.2f}"


def build_digest(name: str, drafts: list[dict[str, Any]], today: date, app_url: str) -> tuple[str, str, str]:
    count = len(drafts)
    subject = f"{count} project budget{'s' if count != 1 else ''} still in draft - approval needed"
    rows_html = "".join(
        f"<tr><td style='padding:6px 10px;border-bottom:1px solid #ddd'>{escape(d['project_name'] or '')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #ddd'>v{d['budget_version']} {escape(d.get('label') or '')}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:right'>{_money(d['total_amount'])}</td>"
        f"<td style='padding:6px 10px;border-bottom:1px solid #ddd;text-align:right'>{(today - d['created_at'].date()).days} days</td></tr>"
        for d in drafts
    )
    link = f"{app_url.rstrip('/')}/dashboard/finance/budgets" if app_url else ""
    html = (
        f"<p>Hello {escape(name)},</p>"
        f"<p>The following project budget{'s are' if count != 1 else ' is'} still in <b>draft</b>. "
        "A draft budget is not the project's working ceiling until it is reviewed and approved, "
        "so spend is still being measured against the old figure.</p>"
        "<table style='border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px'>"
        "<tr><th style='text-align:left;padding:6px 10px'>Project</th><th style='text-align:left;padding:6px 10px'>Version</th>"
        "<th style='text-align:right;padding:6px 10px'>Amount</th><th style='text-align:right;padding:6px 10px'>Waiting</th></tr>"
        f"{rows_html}</table>"
        + (f"<p><a href='{escape(link)}'>Review budgets in AEGIS</a></p>" if link else "")
        + "<p style='color:#666;font-size:12px'>You get this reminder each weekday until the drafts are approved or cancelled.</p>"
    )
    text_body = f"{count} project budget(s) still in draft:\n" + "\n".join(
        f"- {d['project_name']} v{d['budget_version']}: {_money(d['total_amount'])}" for d in drafts
    ) + (f"\n\nReview: {link}" if link else "")
    return subject, html, text_body


async def plan_reminders(db: AsyncSession, org_id: Optional[str] = None, budget_id: Optional[str] = None) -> dict[str, dict[str, Any]]:
    """{email: {'name': ..., 'drafts': [...]}} for every draft (or one)."""
    drafts = await list_draft_budgets(db, org_id)
    if budget_id:
        drafts = [d for d in drafts if str(d["id"]) == str(budget_id)]
    role_cache: dict = {}
    plan: dict[str, dict[str, Any]] = defaultdict(lambda: {"name": "", "drafts": []})
    for d in drafts:
        for r in await recipients_for_draft(db, d, role_cache=role_cache):
            entry = plan[r["email"]]
            entry["name"] = entry["name"] or r["name"]
            entry["drafts"].append(d)
    return dict(plan)


def default_app_url() -> str:
    return settings.cors_origins[0] if settings.cors_origins else ""


async def send_digest(email: str, entry: dict[str, Any], app_url: Optional[str] = None) -> bool:
    today = datetime.now(HARARE).date()
    subject, html, text_body = build_digest(entry["name"], entry["drafts"], today, app_url or default_app_url())
    return await send_email(email, subject, html, text_body)


async def send_reminders(db: AsyncSession, org_id: Optional[str] = None, budget_id: Optional[str] = None) -> dict[str, Any]:
    """Send now, to everyone, without any once-a-day check (the on-demand
    button). The cron job uses plan_reminders + send_digest itself so it can
    skip people already reminded today."""
    plan = await plan_reminders(db, org_id, budget_id)
    sent: list[str] = []
    failed: list[str] = []
    for email, entry in sorted(plan.items()):
        (sent if await send_digest(email, entry) else failed).append(email)
    if failed:
        logger.warning("Draft budget reminders not delivered", failed=failed)
    return {"sent": sent, "failed": failed, "draft_count": len({str(d["id"]) for e in plan.values() for d in e["drafts"]})}
