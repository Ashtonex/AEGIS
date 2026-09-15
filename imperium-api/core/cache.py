import json
import logging
from typing import Any

import redis as redis_sync
from redis import asyncio as redis_async

from core.config import settings

logger = logging.getLogger(__name__)

_async_client: redis_async.Redis | None = None
_sync_client: redis_sync.Redis | None = None


async def init_async_redis() -> None:
    """Called once from the app lifespan. Constructing the client never
    blocks or raises on its own - redis.asyncio connects lazily on first
    use - so a Redis outage at startup can't take the API down with it."""
    global _async_client
    _async_client = redis_async.from_url(settings.REDIS_URL, decode_responses=True)


async def close_async_redis() -> None:
    global _async_client
    if _async_client:
        await _async_client.aclose()
        _async_client = None


def _get_sync_client() -> redis_sync.Redis:
    """Lazily-created singleton for the handful of call sites (token
    verification) that run as sync functions dispatched to FastAPI's
    threadpool, alongside the existing blocking httpx call they already
    make - so a second blocking call here costs nothing new."""
    global _sync_client
    if _sync_client is None:
        _sync_client = redis_sync.from_url(settings.REDIS_URL, decode_responses=True)
    return _sync_client


async def cache_get_json(key: str) -> Any | None:
    """Fails open (returns None) on any Redis error or if the async client
    was never initialized - a cache outage must fall back to the DB, never
    block auth."""
    if _async_client is None:
        return None
    try:
        raw = await _async_client.get(key)
    except Exception as exc:
        logger.warning("Redis cache_get_json failed for key %s: %s", key, exc)
        return None
    return json.loads(raw) if raw else None


async def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    if _async_client is None or ttl_seconds <= 0:
        return
    try:
        await _async_client.set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception as exc:
        logger.warning("Redis cache_set_json failed for key %s: %s", key, exc)


def cache_get_json_sync(key: str) -> Any | None:
    try:
        raw = _get_sync_client().get(key)
    except Exception as exc:
        logger.warning("Redis cache_get_json_sync failed for key %s: %s", key, exc)
        return None
    return json.loads(raw) if raw else None


def cache_set_json_sync(key: str, value: Any, ttl_seconds: int) -> None:
    if ttl_seconds <= 0:
        return
    try:
        _get_sync_client().set(key, json.dumps(value, default=str), ex=ttl_seconds)
    except Exception as exc:
        logger.warning("Redis cache_set_json_sync failed for key %s: %s", key, exc)


def delete_sync(key: str) -> None:
    """Fails open (silently) - used for the handful of explicit-invalidation
    call sites (and test teardown) where a cache outage should never raise,
    it should just mean the value falls through to the DB/Supabase path."""
    try:
        _get_sync_client().delete(key)
    except Exception as exc:
        logger.warning("Redis delete_sync failed for key %s: %s", key, exc)
