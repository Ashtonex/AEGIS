"""Centralised rate-limiting configuration for PROJECT AEGIS.

All public-facing and auth endpoints must use the limiter instance
defined here to ensure consistent brute-force protection.
"""
import hashlib
import inspect

import slowapi.extension as slowapi_extension
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request

from core.config import settings
from fastapi.responses import JSONResponse

slowapi_extension.asyncio.iscoroutinefunction = inspect.iscoroutinefunction



def rate_limit_key(request: Request) -> str:
    """Signed-in callers are limited per session token, not per IP: SNC
    staff in one office share a public address, and per-IP limits would
    throttle the whole office as one user. Anonymous callers fall back to
    their IP. (Junk tokens are each their own key here, which is why the
    per-IP failed-authentication throttle in core/security.py exists too.)"""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer ") and len(auth) > 20:
        return "tok:" + hashlib.sha256(auth[7:].encode("utf-8")).hexdigest()[:32]
    return "ip:" + get_remote_address(request)


# Counters live in Redis so the limit is shared by every worker process and
# survives restarts (in-process memory made each limit 4x looser with 4
# workers and reset on every deploy). If Redis is unreachable the limiter
# falls back to per-process memory instead of failing requests.
DEFAULT_LIMIT = "600/minute"
PUBLIC_READ_LIMIT = "120/minute"

limiter = Limiter(
    key_func=rate_limit_key,
    default_limits=[DEFAULT_LIMIT],
    storage_uri=settings.REDIS_URL,
    in_memory_fallback_enabled=True,
    swallow_errors=True,
    enabled=settings.RATE_LIMIT_ENABLED,
)


async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Return a structured 429 response matching the AEGIS API envelope."""
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "data": None,
            "message": f"Rate limit exceeded: {exc.detail}. Please wait before retrying.",
            "meta": {"retry_after": getattr(exc, 'retry_after', None)},
        },
        headers={"Retry-After": str(getattr(exc, 'retry_after', 60))},
    )
