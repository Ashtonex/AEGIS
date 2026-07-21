"""Centralised rate-limiting configuration for PROJECT AEGIS.

All public-facing and auth endpoints must use the limiter instance
defined here to ensure consistent brute-force protection.
"""
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from fastapi import Request
from fastapi.responses import JSONResponse

limiter = Limiter(key_func=get_remote_address, default_limits=[])


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
