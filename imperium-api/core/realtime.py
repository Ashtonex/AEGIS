"""Live-push relay: a single dedicated Postgres connection LISTENs for
DB-triggered NOTIFY events and fans them out to the specific users' open
WebSocket connections. Authorization for what a user receives is decided in
Python here (reusing the same checks REST endpoints use), not in Postgres -
see migrations/074_notifications_realtime_trigger.sql for why.

Two independent signal types share this module:
- Per-user notifications (migration 074): delivered only to that user.
- System-wide table-change signals (migration 075): a lightweight
  "something changed" ping (table, op, id - never the row body, since
  pg_notify caps payloads at 8000 bytes and several tables carry
  jsonb/text columns that would blow past that on some rows) delivered to
  every connection whose organization matches and whose granted
  permissions include that table's mapped `<resource>.read`. The client
  refetches the affected resource itself over the normal REST path it
  already uses - this is an invalidation signal, not a data stream.

This is process-local: each server instance tracks only the WebSocket
connections it's holding and only relays events landing on its own listener
connection. If the app is ever scaled to multiple instances, cross-instance
fanout is handled at the outbound layer to a message bus, not here.
"""

import asyncio
import json
from collections import defaultdict
from typing import Any

import asyncpg
from fastapi import WebSocket

from core.config import settings
from core.logging import logger

NOTIFICATIONS_CHANNEL = "notifications_channel"
LIVE_CHANGES_CHANNEL = "live_changes"

# schema.table -> the permission resource prefix that gates read access to
# it (permission_key = f"{resource}.read", matching require_resource_permission
# exactly). Only tables listed here participate in the generic broadcast -
# every entry corresponds to a live_change_notify trigger from migration 075.
TABLE_PERMISSION_MAP: dict[str, str] = {
    "finance.quotations": "quotations",
    "crm.opportunities": "crm.opportunities",
    "crm.leads": "crm_leads",
    "crm.contacts": "crm_contacts",
    "crm.activities": "crm_activities",
    "crm.organizations": "crm_organizations",
    "core.internal_messages": "internal_messages",
    "core.documents": "documents",
    "core.compliance_items": "compliance_items",
    "projects.projects": "projects",
    "projects.hse_incidents": "hse_incidents",
    "projects.daily_site_reports": "site_operations.daily_report",
    "fleet.fleet": "fleet",
    "fleet.equipment_assets": "equipment_assets",
    "fleet.maintenance_schedules": "maintenance_schedules",
    "procurement.procurement_orders": "procurement_orders",
    "procurement.inventory_items": "inventory_items",
    "procurement.suppliers": "supplier_records",
    "finance.budgets": "budgets",
}


class ConnectionManager:
    """Tracks live WebSocket connections. Each connection is registered
    under its user_id (for direct per-user delivery) and carries its
    org_id + granted read-permission set (for the broadcast path)."""

    def __init__(self) -> None:
        self._by_user: dict[str, set[WebSocket]] = defaultdict(set)
        self._meta: dict[WebSocket, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def register(self, websocket: WebSocket, user_id: str, org_id: str, read_permissions: set[str]) -> None:
        async with self._lock:
            self._by_user[user_id].add(websocket)
            self._meta[websocket] = {
                "user_id": user_id,
                "org_id": org_id,
                "permissions": read_permissions,
            }

    async def unregister(self, websocket: WebSocket) -> None:
        async with self._lock:
            meta = self._meta.pop(websocket, None)
            if not meta:
                return
            sockets = self._by_user.get(meta["user_id"])
            if sockets:
                sockets.discard(websocket)
                if not sockets:
                    self._by_user.pop(meta["user_id"], None)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._by_user.get(user_id, ()))
        await _send_all(sockets, payload)

    async def broadcast_table_change(self, org_id: str, resource: str, payload: dict[str, Any]) -> None:
        permission_key = f"{resource}.read"
        async with self._lock:
            targets = [
                ws for ws, meta in self._meta.items()
                if meta["org_id"] == org_id and permission_key in meta["permissions"]
            ]
        await _send_all(targets, payload)

    def connection_count(self) -> int:
        return len(self._meta)


async def _send_all(sockets: list[WebSocket], payload: dict[str, Any]) -> None:
    if not sockets:
        return
    message = json.dumps(payload)
    for ws in sockets:
        try:
            await ws.send_text(message)
        except Exception:
            # A dead/broken socket here just means the client's own
            # disconnect handler will unregister it shortly; this send
            # attempt failing is not itself an error worth surfacing.
            logger.debug("Live-push send failed for a stale connection", exc_info=True)


manager = ConnectionManager()

_listener_connection: asyncpg.Connection | None = None
_listener_lock = asyncio.Lock()


def _raw_dsn() -> str:
    """asyncpg.connect() wants a plain postgresql:// DSN, not the
    +asyncpg driver-qualified URL SQLAlchemy uses."""
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


def _on_notification(connection, pid, channel, payload: str) -> None:
    try:
        data = json.loads(payload)
    except (TypeError, ValueError):
        logger.warning("Live-push received an unparseable payload", channel=channel)
        return

    if channel == NOTIFICATIONS_CHANNEL:
        user_id = data.get("user_id")
        if user_id:
            asyncio.ensure_future(manager.send_to_user(str(user_id), {"type": "notification", "data": data}))
        return

    if channel == LIVE_CHANGES_CHANNEL:
        table = data.get("table")
        org_id = data.get("organization_id")
        resource = TABLE_PERMISSION_MAP.get(table)
        if not (table and org_id and resource):
            return
        asyncio.ensure_future(
            manager.broadcast_table_change(
                str(org_id),
                resource,
                {"type": "table_change", "table": table, "op": data.get("op"), "id": data.get("id")},
            )
        )


async def start_listener() -> None:
    """Opens one dedicated, non-pooled connection for the lifetime of the
    process and registers both NOTIFY listeners on it. Must not go through
    the SQLAlchemy engine's pool - LISTEN state is per-connection and would
    be silently lost the moment a pooled connection is returned and reused
    for an unrelated request."""
    global _listener_connection
    async with _listener_lock:
        if _listener_connection is not None:
            return
        try:
            _listener_connection = await asyncpg.connect(_raw_dsn())
            await _listener_connection.add_listener(NOTIFICATIONS_CHANNEL, _on_notification)
            await _listener_connection.add_listener(LIVE_CHANGES_CHANNEL, _on_notification)
            logger.info(
                "Live-push listener connected",
                channels=f"{NOTIFICATIONS_CHANNEL},{LIVE_CHANGES_CHANNEL}",
            )
        except Exception:
            logger.exception("Live-push listener failed to start - nothing will be pushed live")
            _listener_connection = None


async def stop_listener() -> None:
    global _listener_connection
    async with _listener_lock:
        if _listener_connection is None:
            return
        try:
            await _listener_connection.close()
        except Exception:
            logger.debug("Live-push listener close raised", exc_info=True)
        _listener_connection = None
