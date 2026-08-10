"""Live-push relay: a single dedicated Postgres connection LISTENs for
DB-triggered NOTIFY events and fans them out to the specific users' open
WebSocket connections. Authorization for what a user receives is decided in
Python here (reusing the same checks REST endpoints use), not in Postgres -
see migrations/074_notifications_realtime_trigger.sql for why.

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


class ConnectionManager:
    """Tracks live WebSocket connections keyed by user_id (a user may have
    more than one open tab/device)."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def register(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections[user_id].add(websocket)

    async def unregister(self, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            sockets = self._connections.get(user_id)
            if not sockets:
                return
            sockets.discard(websocket)
            if not sockets:
                self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: str, payload: dict[str, Any]) -> None:
        async with self._lock:
            sockets = list(self._connections.get(user_id, ()))
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

    def connection_count(self) -> int:
        return sum(len(sockets) for sockets in self._connections.values())


manager = ConnectionManager()

_listener_connection: asyncpg.Connection | None = None
_listener_lock = asyncio.Lock()


def _raw_dsn() -> str:
    """asyncpg.connect() wants a plain postgresql:// DSN, not the
    +asyncpg driver-qualified URL SQLAlchemy uses."""
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


def _on_notification(connection, pid, channel, payload: str) -> None:
    if channel != NOTIFICATIONS_CHANNEL:
        return
    try:
        data = json.loads(payload)
    except (TypeError, ValueError):
        logger.warning("Live-push received an unparseable notification payload")
        return
    user_id = data.get("user_id")
    if not user_id:
        return
    asyncio.ensure_future(manager.send_to_user(str(user_id), {"type": "notification", "data": data}))


async def start_listener() -> None:
    """Opens one dedicated, non-pooled connection for the lifetime of the
    process and registers the NOTIFY listener on it. Must not go through the
    SQLAlchemy engine's pool - LISTEN state is per-connection and would be
    silently lost the moment a pooled connection is returned and reused for
    an unrelated request."""
    global _listener_connection
    async with _listener_lock:
        if _listener_connection is not None:
            return
        try:
            _listener_connection = await asyncpg.connect(_raw_dsn())
            await _listener_connection.add_listener(NOTIFICATIONS_CHANNEL, _on_notification)
            logger.info("Live-push listener connected", channel=NOTIFICATIONS_CHANNEL)
        except Exception:
            logger.exception("Live-push listener failed to start - notifications will not be pushed live")
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
