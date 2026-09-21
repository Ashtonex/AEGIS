"""Microsoft Calendar (Exchange Online, via Graph) operations.

Calendar ownership model (Phase 13): every function here targets a specific
mailbox's calendar - either a shared mailbox or a Microsoft 365 Group, never
an individual employee's personal calendar. `calendar_owner_id` is that
mailbox's user/group ID (or its UPN, e.g. "operations@flectere.onmicrosoft.com"),
resolved once during setup and stored in core.organisation_integrations.

A SharePoint site's own calendar LIST is a different, older SharePoint-only
feature (not an Exchange calendar and not reachable the same way real
meetings and Outlook/Teams invites are) - deliberately not used here; see
docs/microsoft365-phase1/README.md for the reasoning.
"""

from __future__ import annotations

from typing import Any, Optional

from app.services.microsoft.graph_client import GraphClient
from app.services.microsoft.types import GraphCalendar, GraphEvent


async def list_calendars(client: GraphClient, owner_id: str, *, is_group: bool = False) -> list[GraphCalendar]:
    """Both /users/{id}/... and /groups/{id}/... expose /calendars the same
    way; group calendars additionally require the group to be
    calendar-enabled (a Microsoft 365 Group). Which prefix applies is decided
    by how the mailbox was resolved during setup (see the setup wizard's
    'Select Calendar' step), not guessed here."""
    kind = "groups" if is_group else "users"
    results = await client.get_all_pages(f"{kind}/{owner_id}/calendars")
    return [
        GraphCalendar(calendar_id=item["id"], name=item["name"], owner_address=(item.get("owner") or {}).get("address"))
        for item in results
    ]


def _to_event(body: dict) -> GraphEvent:
    return GraphEvent(
        event_id=body["id"],
        subject=body.get("subject", ""),
        web_link=body.get("webLink"),
        change_key=body.get("changeKey"),
        start_at=(body.get("start") or {}).get("dateTime"),
        end_at=(body.get("end") or {}).get("dateTime"),
    )


def _event_payload(
    *,
    subject: str,
    body_html: str,
    start_at_iso: str,
    end_at_iso: str,
    timezone: str,
    location: Optional[str],
    categories: Optional[list[str]],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "subject": subject,
        "body": {"contentType": "HTML", "content": body_html},
        "start": {"dateTime": start_at_iso, "timeZone": timezone},
        "end": {"dateTime": end_at_iso, "timeZone": timezone},
        # Explicit rather than relying on Graph's own implicit default, so
        # a reminder is a guaranteed part of the contract, not an assumption
        # about undocumented API behaviour.
        "isReminderOn": True,
        "reminderMinutesBeforeStart": 15,
        # AEGIS is the system of record for these events (Phase 17, phase
        # one: AEGIS -> Microsoft only) - attendees are deliberately not set
        # here, since inviting people is a distinct, explicit decision the
        # calling service layer should make per module, not a default.
    }
    if location:
        payload["location"] = {"displayName": location}
    if categories:
        payload["categories"] = categories
    return payload


async def create_event(
    client: GraphClient,
    *,
    owner_id: str,
    calendar_id: str,
    is_group: bool,
    subject: str,
    body_html: str,
    start_at_iso: str,
    end_at_iso: str,
    timezone: str,
    location: Optional[str] = None,
    categories: Optional[list[str]] = None,
) -> GraphEvent:
    kind = "groups" if is_group else "users"
    payload = _event_payload(
        subject=subject, body_html=body_html, start_at_iso=start_at_iso, end_at_iso=end_at_iso,
        timezone=timezone, location=location, categories=categories,
    )
    body = await client.post(f"{kind}/{owner_id}/calendars/{calendar_id}/events", json=payload)
    return _to_event(body)


async def update_event(
    client: GraphClient,
    *,
    owner_id: str,
    is_group: bool,
    event_id: str,
    subject: Optional[str] = None,
    body_html: Optional[str] = None,
    start_at_iso: Optional[str] = None,
    end_at_iso: Optional[str] = None,
    timezone: Optional[str] = None,
    location: Optional[str] = None,
) -> GraphEvent:
    kind = "groups" if is_group else "users"
    payload: dict[str, Any] = {}
    if subject is not None:
        payload["subject"] = subject
    if body_html is not None:
        payload["body"] = {"contentType": "HTML", "content": body_html}
    if start_at_iso is not None and timezone is not None:
        payload["start"] = {"dateTime": start_at_iso, "timeZone": timezone}
    if end_at_iso is not None and timezone is not None:
        payload["end"] = {"dateTime": end_at_iso, "timeZone": timezone}
    if location is not None:
        payload["location"] = {"displayName": location}

    result = await client.patch(f"{kind}/{owner_id}/events/{event_id}", json=payload)
    return _to_event(result)


async def cancel_event(client: GraphClient, *, owner_id: str, is_group: bool, event_id: str) -> None:
    """Uses Graph's /cancel action (sends a cancellation notice to any
    attendees) rather than a hard delete, so the calendar entry visibly shows
    as cancelled instead of silently disappearing."""
    kind = "groups" if is_group else "users"
    await client.post(f"{kind}/{owner_id}/events/{event_id}/cancel", json={})


async def delete_event(client: GraphClient, *, owner_id: str, is_group: bool, event_id: str) -> None:
    kind = "groups" if is_group else "users"
    await client.delete(f"{kind}/{owner_id}/events/{event_id}")
