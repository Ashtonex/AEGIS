"""Teams direct messages for task assignments, via a Teams Workflows webhook.

Graph won't let an app-only identity post chat messages (that API is
migration-only), so delivery goes through a Workflows flow the org creates
once in Teams: "When a Teams webhook request is received" -> "Post card in
a chat or channel" (Post as: Flow bot, Post in: Chat with Flow bot,
Recipient: the request's `recipient`, Adaptive Card: the request's `card`).
The URL of that flow is stored per org in crm.task_routing_settings.

The payload carries the card twice: as `card` (for the DM flow above) and as
the standard `attachments` envelope, so the stock "Post to a channel when a
webhook request is received" template also renders it if an org wires a
channel instead.

Delivery is best-effort and never raises: a Teams outage must not undo or
fail an assignment that already landed in AEGIS (in-app notification
included).
"""

from __future__ import annotations

import asyncio
from typing import Any, Iterable, Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.logging import logger

_TIMEOUT_SECONDS = 10.0
_MAX_TASKS_ON_CARD = 12
# Workflows webhook hosts (Power Automate / Logic Apps). Anything else is
# refused so the stored URL can't be pointed at an internal address.
_ALLOWED_HOST_SUFFIXES = (
    ".logic.azure.com",
    ".powerplatform.com",
    ".powerautomate.com",
    ".webhook.office.com",
)
_PRIORITY_LABEL = {"urgent": "URGENT", "high": "High", "normal": "Normal", "low": "Low"}


def validate_webhook_url(url: str) -> str:
    """Returns the cleaned URL or raises ValueError."""
    cleaned = (url or "").strip()
    parsed = urlparse(cleaned)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        raise ValueError("The Teams webhook must be an https:// URL.")
    if not any(host.endswith(suffix) for suffix in _ALLOWED_HOST_SUFFIXES):
        raise ValueError(
            "That doesn't look like a Teams Workflows webhook URL "
            "(expected a *.logic.azure.com or *.powerplatform.com address)."
        )
    return cleaned


def mask_webhook_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.hostname}/…"


TEAMS_TAB_ENTITY_ID = "aegis-my-tasks"  # deploy/teams-app/manifest.json staticTabs[0].entityId


def app_base_url() -> str:
    return settings.PUBLIC_APP_URL.strip().rstrip("/")


def teams_tab_link() -> Optional[str]:
    """Deep link that opens the AEGIS "My Tasks" tab inside Teams."""
    if not settings.TEAMS_APP_ID:
        return None
    return f"https://teams.microsoft.com/l/entity/{settings.TEAMS_APP_ID}/{TEAMS_TAB_ENTITY_ID}"


def _task_line(task: dict[str, Any]) -> dict[str, Any]:
    due = task.get("due_date")
    due_label = due.strftime("%a %d %b") if hasattr(due, "strftime") else (str(due) if due else "no deadline")
    priority = task.get("priority") or "normal"
    context = task.get("entity_name")
    subtitle = f"Due {due_label} · {_PRIORITY_LABEL.get(priority, priority)}"
    if context:
        subtitle += f" · {context}"
    return {
        "type": "Container",
        "spacing": "Small",
        "items": [
            {"type": "TextBlock", "text": task.get("title") or "Task", "weight": "Bolder", "wrap": True},
            {
                "type": "TextBlock",
                "text": subtitle,
                "isSubtle": True,
                "spacing": "None",
                "wrap": True,
                "color": "Attention" if priority == "urgent" else "Default",
            },
        ],
    }


def build_card(
    *,
    recipient_name: Optional[str],
    tasks: list[dict[str, Any]],
    assigned_by: Optional[str],
    link: str,
) -> dict[str, Any]:
    count = len(tasks)
    heading = "New task assigned to you" if count == 1 else f"{count} new tasks assigned to you"
    intro = f"Hi {recipient_name.split()[0]}," if recipient_name else "Hi,"
    by = f" by {assigned_by}" if assigned_by else " automatically by AEGIS"
    body: list[dict[str, Any]] = [
        {"type": "TextBlock", "text": heading, "size": "Large", "weight": "Bolder", "wrap": True},
        {"type": "TextBlock", "text": f"{intro} this was assigned{by}. Most urgent first:", "wrap": True, "spacing": "Small"},
    ]
    body.extend(_task_line(task) for task in tasks[:_MAX_TASKS_ON_CARD])
    if count > _MAX_TASKS_ON_CARD:
        body.append({
            "type": "TextBlock",
            "text": f"…and {count - _MAX_TASKS_ON_CARD} more in AEGIS.",
            "isSubtle": True,
            "wrap": True,
        })
    actions: list[dict[str, Any]] = []
    tab_link = teams_tab_link()
    if tab_link:
        actions.append({"type": "Action.OpenUrl", "title": "Open my tasks in Teams", "url": tab_link})
    actions.append({"type": "Action.OpenUrl", "title": "Open in AEGIS" if tab_link else "Open my tasks", "url": link})
    return {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": body,
        "actions": actions,
    }


def build_payload(
    *,
    recipient_email: str,
    recipient_name: Optional[str],
    tasks: list[dict[str, Any]],
    assigned_by: Optional[str],
) -> dict[str, Any]:
    link = f"{app_base_url()}/dashboard/crm/tasks"
    card = build_card(recipient_name=recipient_name, tasks=tasks, assigned_by=assigned_by, link=link)
    summary = (
        f"New task: {tasks[0].get('title')}" if len(tasks) == 1 else f"{len(tasks)} new tasks assigned to you"
    )
    return {
        "type": "message",
        "recipient": recipient_email,
        "recipientName": recipient_name,
        "summary": summary,
        "link": link,
        "card": card,
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}
        ],
    }


async def post_to_webhook(webhook_url: str, payload: dict[str, Any]) -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.post(webhook_url, json=payload)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        logger.warning("teams_notify.unreachable", error=str(exc))
        return False, f"Teams webhook unreachable: {exc}"
    if 200 <= response.status_code < 300:
        return True, f"Accepted ({response.status_code})"
    logger.warning("teams_notify.rejected", status_code=response.status_code)
    return False, f"Teams webhook returned {response.status_code}: {response.text[:300]}"


async def deliver(deliveries: list[tuple[str, dict[str, Any]]]) -> None:
    """Sends prepared (webhook_url, payload) pairs concurrently. Safe to run
    as a FastAPI BackgroundTask - it needs no DB session."""
    if not deliveries:
        return
    results = await asyncio.gather(
        *(post_to_webhook(url, payload) for url, payload in deliveries), return_exceptions=True
    )
    for (_, payload), result in zip(deliveries, results):
        ok = isinstance(result, tuple) and result[0]
        if not ok:
            logger.warning("teams_notify.delivery_failed", recipient=payload.get("recipient"), result=str(result))


async def prepare_deliveries(
    db: AsyncSession,
    org_id: str,
    assignments: dict[str, list[dict[str, Any]]],
    *,
    actor_id: Optional[str] = None,
) -> list[tuple[str, dict[str, Any]]]:
    """assignments: {user_id: [task dicts with title/due_date/priority/
    entity_name]}. Returns nothing (and does no work) when the org hasn't
    configured a webhook. Each person is addressed by their Teams account
    (core.users.teams_account - e.g. a guest's #EXT# UPN) when set, their
    AEGIS login email otherwise. The actor is skipped - nobody needs a DM about
    work they just gave themselves."""
    if not assignments:
        return []
    webhook_url = (
        await db.execute(
            text("SELECT teams_webhook_url FROM crm.task_routing_settings WHERE organization_id = :org_id"),
            {"org_id": org_id},
        )
    ).scalar()
    if not webhook_url:
        return []
    user_ids = [uid for uid in assignments if uid and uid != actor_id]
    if not user_ids:
        return []
    rows = await db.execute(
        text("""
            SELECT id::text AS id, COALESCE(NULLIF(TRIM(teams_account), ''), email) AS email, full_name
            FROM core.users
            WHERE id = ANY(CAST(:ids AS uuid[])) AND organization_id = :org_id
              AND is_active = true AND is_deleted = false
        """),
        {"ids": user_ids, "org_id": org_id},
    )
    people = {row.id: row for row in rows}
    assigned_by = None
    if actor_id:
        assigned_by = (
            await db.execute(text("SELECT full_name FROM core.users WHERE id = :id"), {"id": actor_id})
        ).scalar()

    deliveries: list[tuple[str, dict[str, Any]]] = []
    for user_id in user_ids:
        person = people.get(user_id)
        if not person or not person.email:
            continue
        deliveries.append((
            webhook_url,
            build_payload(
                recipient_email=person.email,
                recipient_name=person.full_name,
                tasks=assignments[user_id],
                assigned_by=assigned_by,
            ),
        ))
    return deliveries


def build_summary_payload(
    *,
    recipient_email: str,
    recipient_name: Optional[str],
    tasks: list[dict[str, Any]],
    counts: dict[str, int],
) -> dict[str, Any]:
    """A person's whole open workload (not a new assignment): totals, then
    their most urgent tasks. Same envelope as build_payload, so the same
    Workflows flow delivers it."""
    link = f"{app_base_url()}/dashboard/crm/tasks"
    first = recipient_name.split()[0] if recipient_name else "there"
    body: list[dict[str, Any]] = [
        {"type": "TextBlock", "text": f"Your AEGIS tasks: {counts['open']} open", "size": "Large", "weight": "Bolder", "wrap": True},
        {"type": "TextBlock", "text": f"Hi {first}, here's where your work stands. Most urgent first:", "wrap": True, "spacing": "Small"},
        {
            "type": "FactSet",
            "facts": [
                {"title": "Overdue", "value": str(counts["overdue"])},
                {"title": "Due in 7 days", "value": str(counts["this_week"])},
                {"title": "Urgent", "value": str(counts["urgent"])},
            ],
        },
    ]
    body.extend(_task_line(task) for task in tasks[:_MAX_TASKS_ON_CARD])
    if counts["open"] > _MAX_TASKS_ON_CARD:
        body.append({
            "type": "TextBlock",
            "text": f"…and {counts['open'] - _MAX_TASKS_ON_CARD} more in AEGIS.",
            "isSubtle": True,
            "wrap": True,
        })
    actions: list[dict[str, Any]] = []
    tab_link = teams_tab_link()
    if tab_link:
        actions.append({"type": "Action.OpenUrl", "title": "Open my tasks in Teams", "url": tab_link})
    actions.append({"type": "Action.OpenUrl", "title": "Open in AEGIS", "url": link})
    card = {
        "type": "AdaptiveCard",
        "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
        "version": "1.4",
        "body": body,
        "actions": actions,
    }
    return {
        "type": "message",
        "recipient": recipient_email,
        "recipientName": recipient_name,
        "summary": f"Your AEGIS tasks: {counts['open']} open",
        "link": link,
        "card": card,
        "attachments": [
            {"contentType": "application/vnd.microsoft.card.adaptive", "contentUrl": None, "content": card}
        ],
    }


def tasks_from_plan(items: Iterable[Any]) -> list[dict[str, Any]]:
    """PlannedTask -> the plain dicts the card needs, most urgent first."""
    rank = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
    rows = [
        {
            "title": item.title,
            "due_date": item.due_date,
            "priority": item.new_priority,
            "entity_name": item.entity_name,
        }
        for item in items
    ]
    rows.sort(key=lambda r: (rank.get(r["priority"], 2), str(r["due_date"] or "9999")))
    return rows
