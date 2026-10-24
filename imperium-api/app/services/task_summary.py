"""Sends each person a summary of their open AEGIS tasks - one Teams card
and one email each - from Tasks -> Routing -> "Send everyone their task
summary". Unlike assignment notices this covers someone's whole workload,
most urgent first.

Teams goes to core.users.teams_account (falling back to the login email);
email goes through send_email, which delivers staff mail to the mailbox
behind their Teams account. Runs on its own session so it can be handed to
a background task; never raises.
"""

from __future__ import annotations

import asyncio
import html
from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import text

from core.email import send_email
from core.logging import logger
from app.services.microsoft import teams_notify

_EMAIL_TASK_LIMIT = 15
_PRIORITY_RANK = {"urgent": 0, "high": 1, "normal": 2, "low": 3}


def _sort_key(task: dict[str, Any]):
    due = task.get("due_date") or date.max
    return (due, _PRIORITY_RANK.get(task.get("priority") or "normal", 2))


def _counts(tasks: list[dict[str, Any]], today: date) -> dict[str, int]:
    return {
        "open": len(tasks),
        "overdue": sum(1 for t in tasks if t.get("due_date") and t["due_date"] < today),
        "this_week": sum(1 for t in tasks if t.get("due_date") and 0 <= (t["due_date"] - today).days <= 7),
        "urgent": sum(1 for t in tasks if t.get("priority") == "urgent"),
    }


def _email_html(name: str, tasks: list[dict[str, Any]], counts: dict[str, int], today: date) -> str:
    first = html.escape(name.split()[0]) if name else "there"
    rows = []
    for task in tasks[:_EMAIL_TASK_LIMIT]:
        due = task.get("due_date")
        overdue = bool(due and due < today)
        due_text = due.strftime("%a %d %b") if due else "No deadline"
        rows.append(
            "<tr>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;'>{html.escape(task['title'])}"
            f"<div style='color:#777;font-size:11px;'>{html.escape(task.get('entity_name') or '')}</div></td>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap;"
            f"color:{'#b42318' if overdue else '#333'};'>{due_text}</td>"
            f"<td style='padding:6px 8px;border-bottom:1px solid #eee;font-size:11px;text-transform:uppercase;'>"
            f"{html.escape(task.get('priority') or 'normal')}</td>"
            "</tr>"
        )
    more = (
        f"<p style='font-size:12px;color:#666;'>…and {counts['open'] - _EMAIL_TASK_LIMIT} more in AEGIS.</p>"
        if counts["open"] > _EMAIL_TASK_LIMIT else ""
    )
    link = f"{teams_notify.app_base_url()}/dashboard/crm/tasks"
    return f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;">
      <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b8860b;font-weight:700;margin-bottom:4px;">AEGIS</p>
      <h1 style="font-size:20px;margin:0 0 12px;">Your tasks: {counts['open']} open</h1>
      <p style="font-size:14px;">Hi {first}, here's where your work stands, most urgent first.</p>
      <p style="font-size:14px;">
        <strong>{counts['overdue']}</strong> overdue &nbsp;·&nbsp;
        <strong>{counts['this_week']}</strong> due in the next 7 days &nbsp;·&nbsp;
        <strong>{counts['urgent']}</strong> urgent
      </p>
      <table style="width:100%;border-collapse:collapse;margin:12px 0;">{''.join(rows)}</table>
      {more}
      <p style="margin:24px 0;"><a href="{link}" style="background:#b8860b;color:#111;text-decoration:none;padding:12px 24px;font-size:13px;font-weight:700;text-transform:uppercase;display:inline-block;">Open my tasks</a></p>
      <p style="font-size:12px;color:#666;">You can also open AEGIS → My Tasks in Microsoft Teams.</p>
    </div>
    """


async def send_task_summaries(org_id: str) -> dict[str, Any]:
    """Returns {"people": n, "teams_sent": n, "emails_sent": n, "failed": [...]}."""
    from core.database import AsyncSessionLocal

    today = date.today()
    result: dict[str, Any] = {"people": 0, "teams_sent": 0, "emails_sent": 0, "failed": []}
    try:
        async with AsyncSessionLocal() as db:
            rows = (
                await db.execute(
                    text("""
                        SELECT u.id::text AS user_id, u.full_name, u.email,
                               COALESCE(NULLIF(TRIM(u.teams_account), ''), u.email) AS teams_recipient,
                               t.title, t.due_date, t.priority,
                               COALESCE(tn.tender_name, opp.name, proj.name, cr.name, lead.company_name) AS entity_name
                        FROM crm.tasks t
                        JOIN core.users u ON u.id = t.assigned_to_user_id
                             AND u.is_active = true AND u.is_deleted = false
                        LEFT JOIN crm.tenders tn ON t.entity_type = 'tender' AND tn.id = t.entity_id
                        LEFT JOIN crm.opportunities opp ON t.entity_type = 'opportunity' AND opp.id = t.entity_id
                        LEFT JOIN projects.projects proj ON t.entity_type = 'project' AND proj.id = t.entity_id
                        LEFT JOIN projects.projects cr ON t.entity_type = 'commercial_readiness' AND cr.id = t.entity_id
                        LEFT JOIN crm.leads lead ON t.entity_type = 'lead' AND lead.id = t.entity_id
                        WHERE t.organization_id = :org_id AND t.is_deleted = false
                          AND t.status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable')
                    """),
                    {"org_id": org_id},
                )
            ).mappings().all()
            webhook_url = (
                await db.execute(
                    text("SELECT teams_webhook_url FROM crm.task_routing_settings WHERE organization_id = :org_id"),
                    {"org_id": org_id},
                )
            ).scalar()
    except Exception:
        logger.exception("task_summary.load_failed", org_id=org_id)
        result["failed"].append("could not load tasks")
        return result

    people: dict[str, dict[str, Any]] = {}
    tasks_by_person: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        people.setdefault(row["user_id"], dict(row))
        tasks_by_person[row["user_id"]].append({
            "title": row["title"],
            "due_date": row["due_date"],
            "priority": row["priority"],
            "entity_name": row["entity_name"],
        })

    async def _send_one(user_id: str, person: dict[str, Any]) -> None:
        tasks = sorted(tasks_by_person[user_id], key=_sort_key)
        counts = _counts(tasks, today)
        name = person["full_name"] or ""
        if webhook_url:
            ok, detail = await teams_notify.post_to_webhook(
                webhook_url,
                teams_notify.build_summary_payload(
                    recipient_email=person["teams_recipient"], recipient_name=name, tasks=tasks, counts=counts,
                ),
            )
            if ok:
                result["teams_sent"] += 1
            else:
                result["failed"].append(f"Teams: {name} ({detail})")
        if person["email"]:
            sent = await send_email(
                to=person["email"],
                subject=f"[AEGIS] Your tasks: {counts['open']} open, {counts['overdue']} overdue",
                html=_email_html(name, tasks, counts, today),
                text=f"You have {counts['open']} open AEGIS tasks ({counts['overdue']} overdue). "
                     f"Open them at {teams_notify.app_base_url()}/dashboard/crm/tasks",
            )
            if sent:
                result["emails_sent"] += 1
            else:
                result["failed"].append(f"Email: {name}")

    # Everyone at once: one person per Teams post + email, so the whole run
    # takes about as long as one send rather than ten.
    result["people"] = len(people)
    outcomes = await asyncio.gather(
        *(_send_one(uid, person) for uid, person in people.items()), return_exceptions=True
    )
    for outcome in outcomes:
        if isinstance(outcome, Exception):
            result["failed"].append(f"error: {outcome}")
    logger.info("task_summary.sent", org_id=org_id, **{k: v for k, v in result.items() if k != "failed"},
                failed=len(result["failed"]))
    return result
