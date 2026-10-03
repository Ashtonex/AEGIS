"""Shared cache layer for PROJECT AEGIS.

Why this exists
---------------
Every authenticated request used to pay four sequential database round trips
before it touched any business data (identity lookup -> role resolution ->
`set_config` for the audit trigger -> permission check). Against Supabase in
eu-west-1 that is roughly 4 x ~220ms = ~0.9s of pure authorization latency on
*every* call, and a dashboard page fires 10-15 calls of its own. It also meant
each request held its pooled connection ~0.9s longer than necessary, which is
what actually exhausted the (20 connection) pool and produced the 8-45s tail
latencies documented in aegis-web/src/lib/api.ts.

This module provides a Redis-backed cache with an in-process fallback so the
authorization context can be resolved once per user per TTL window instead of
four times per request.

Design rules
------------
1. **Never fail the request.** Every operation swallows backend errors and
   degrades to the in-process tier, then to a plain miss. A cache outage must
   make AEGIS slower, never broken.
2. **Redis is shared, memory is not.** With multiple uvicorn workers the
   in-process tier is per-worker, so an invalidation only reliably reaches
   every worker via Redis. The local tier carries a deliberately short TTL
   (see `_LOCAL_TTL_CEILING_SECONDS`) to bound how long a worker can serve a
   stale entry after an invalidation it never saw.
3. **Security-sensitive entries get short TTLs.** A cached permission set
   means a revoked role stays live until the entry expires, so callers must
   invalidate explicitly on change (see `core.security.invalidate_user_auth`)
   and the default TTL is kept small.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any

from core.config import settings

logger = logging.getLogger(__name__)

# The local tier exists only to absorb the many calls a single page load makes
# within a second or two. Keeping its ceiling well below the Redis TTL bounds
# the staleness window a worker that missed an invalidation can introduce.
_LOCAL_TTL_CEILING_SECONDS = 10.0

_local_store: dict[str, tuple[float, Any]] = {}
_LOCAL_STORE_MAX_ENTRIES = 5000

_redis_client: Any = None
_redis_unavailable_until: float = 0.0
_REDIS_RETRY_COOLDOWN_SECONDS = 30.0


def _local_get(key: str) -> tuple[bool, Any]:
    """Returns (hit, value). A tuple is used rather than None-as-miss so a
    legitimately cached ``None`` is not mistaken for a miss."""
    entry = _local_store.get(key)
    if not entry:
        return False, None
    expires_at, value = entry
    if expires_at <= time.time():
        _local_store.pop(key, None)
        return False, None
    return True, value


def _local_set(key: str, value: Any, ttl_seconds: float) -> None:
    if len(_local_store) >= _LOCAL_STORE_MAX_ENTRIES:
        # Unbounded growth here would be a slow memory leak in a long-lived
        # worker. Drop the entries closest to expiry rather than clearing
        # everything, so a burst of new keys doesn't evict the hot set.
        for stale_key in sorted(_local_store, key=lambda k: _local_store[k][0])[:_LOCAL_STORE_MAX_ENTRIES // 10]:
            _local_store.pop(stale_key, None)
    _local_store[key] = (time.time() + min(ttl_seconds, _LOCAL_TTL_CEILING_SECONDS), value)


def _local_delete(key: str) -> None:
    _local_store.pop(key, None)


async def _get_redis() -> Any:
    """Lazily connect to Redis. After a failure, stop trying for a cooldown
    period so a Redis outage doesn't add a connection attempt to the latency
    of every single request."""
    global _redis_client, _redis_unavailable_until

    if _redis_client is not None:
        return _redis_client
    if time.time() < _redis_unavailable_until:
        return None

    try:
        from redis import asyncio as redis_async

        client = redis_async.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=2.0,
            socket_timeout=2.0,
            health_check_interval=30,
        )
        await client.ping()
        _redis_client = client
        logger.info("cache: connected to Redis for the shared cache tier")
        return _redis_client
    except Exception as exc:  # noqa: BLE001 - any failure means "no Redis"
        _redis_unavailable_until = time.time() + _REDIS_RETRY_COOLDOWN_SECONDS
        logger.warning(
            "cache: Redis unavailable (%s); falling back to per-process cache for %.0fs",
            exc,
            _REDIS_RETRY_COOLDOWN_SECONDS,
        )
        return None


async def close_cache() -> None:
    """Release the Redis connection. Called from the app's shutdown hook."""
    global _redis_client
    if _redis_client is not None:
        try:
            await _redis_client.aclose()
        except Exception:  # noqa: BLE001
            pass
        _redis_client = None
    _local_store.clear()


async def cache_get_json(key: str) -> tuple[bool, Any]:
    """Read a JSON value. Returns (hit, value) so a cached falsy value is not
    confused with a miss."""
    hit, value = _local_get(key)
    if hit:
        return True, value

    client = await _get_redis()
    if client is None:
        return False, None

    try:
        raw = await client.get(key)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache: read failed for %s (%s)", key, exc)
        return False, None

    if raw is None:
        return False, None

    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        # A corrupt entry is not worth failing a request over - drop it and
        # let the caller recompute.
        try:
            await client.delete(key)
        except Exception:  # noqa: BLE001
            pass
        return False, None

    _local_set(key, value, _LOCAL_TTL_CEILING_SECONDS)
    return True, value


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    _local_set(key, value, ttl_seconds)

    client = await _get_redis()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache: write failed for %s (%s)", key, exc)


async def cache_delete(*keys: str) -> None:
    for key in keys:
        _local_delete(key)
    if not keys:
        return

    client = await _get_redis()
    if client is None:
        return
    try:
        await client.delete(*keys)
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache: delete failed for %s (%s)", keys, exc)


async def cache_delete_prefix(prefix: str) -> None:
    """Delete every key under a prefix. Uses SCAN rather than KEYS so it never
    blocks the Redis event loop on a large keyspace."""
    for key in [k for k in _local_store if k.startswith(prefix)]:
        _local_delete(key)

    client = await _get_redis()
    if client is None:
        return
    try:
        cursor = 0
        while True:
            cursor, batch = await client.scan(cursor=cursor, match=f"{prefix}*", count=500)
            if batch:
                await client.delete(*batch)
            if cursor == 0:
                break
    except Exception as exc:  # noqa: BLE001
        logger.warning("cache: prefix delete failed for %s (%s)", prefix, exc)
