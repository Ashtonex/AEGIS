"""Shared helper for enqueueing an arq background job from a request handler.

No router in this codebase has needed to do this before now - every existing
job in app/workers/arq_worker.py is cron-scheduled, and arq's create_pool/
enqueue_job only otherwise appear in scripts/test_quotation_job.py. This is
the first router -> arq path, so it lives in one place rather than each call
site duplicating pool setup.

Deliberately no queue_name is passed anywhere here - neither
WorkerSettings in arq_worker.py nor the existing test script set one, so
both already agree on arq's own default queue; introducing WORKER_QUEUE_NAME
(defined in core/config.py but never actually wired up) here would silently
send jobs to a queue nothing listens on.
"""
from __future__ import annotations

from typing import Any

from arq import create_pool
from arq.connections import RedisSettings

from core.config import settings
from core.logging import logger


async def enqueue_background_job(job_name: str, *args: Any, **kwargs: Any) -> None:
    """Fire-and-forget enqueue. No-ops (logs and returns) when background
    jobs are disabled, mirroring the BACKGROUND_JOBS_ENABLED feature-flag
    pattern already used elsewhere - a request handler calling this must
    never fail or block just because the worker isn't running."""
    if not settings.BACKGROUND_JOBS_ENABLED:
        logger.debug(f"Background jobs disabled - skipping enqueue of {job_name}.")
        return

    try:
        redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
        redis_pool = await create_pool(redis_settings)
        try:
            await redis_pool.enqueue_job(job_name, *args, **kwargs)
        finally:
            await redis_pool.close()
    except Exception as exc:  # noqa: BLE001 - enqueue failures must never break the caller's request
        logger.warning(f"Failed to enqueue background job {job_name}: {exc}")
