"""Application-only (client-credentials) Microsoft Graph authentication.

This is a daemon/service identity, not a signed-in user: AEGIS's backend
authenticates as itself against the Microsoft identity platform's v2.0 token
endpoint, using the tenant ID + client ID + client secret configured in
core/config.py (MICROSOFT_GRAPH_*). No browser redirect, no user consent
screen at request time - the app registration's application permissions were
already admin-consented once during setup (see
docs/microsoft365-phase1/SETUP_GUIDE.md).

Implemented as a direct HTTPS POST rather than pulling in the MSAL SDK: the
client-credentials flow is a single well-documented endpoint, this keeps the
dependency footprint unchanged (httpx is already a project dependency - see
core/security.py), and it keeps the exact request/response fully visible
here instead of behind a library abstraction.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from core.config import settings
from core.logging import logger
from core.resilience import CircuitBreaker, CircuitBreakerOpen
from app.services.microsoft.errors import GraphAuthError, GraphNotConfiguredError, GraphTransientError

# The one scope that matters for client-credentials: Graph resolves the
# actual permissions from the app registration's admin-consented application
# permissions, not from anything requested here.
_GRAPH_SCOPE = "https://graph.microsoft.com/.default"
_TOKEN_TIMEOUT_SECONDS = 15.0
# Refresh a little before actual expiry so an in-flight request never races
# a token that dies mid-call.
_EXPIRY_SAFETY_MARGIN_SECONDS = 60

_token_breaker = CircuitBreaker("microsoft_graph_token", failure_threshold=5, reset_timeout_seconds=30.0)


@dataclass
class _CachedToken:
    access_token: str
    expires_at: float


# Per-tenant cache (keyed by tenant_id) - in-process only, matching
# core/resilience.py's own "per-worker-process, not distributed" tradeoff.
# Worst case on a multi-worker deployment is a few extra token requests
# across processes, which Microsoft's token endpoint comfortably tolerates.
_token_cache: dict[str, _CachedToken] = {}


def is_configured(tenant_id: Optional[str] = None) -> bool:
    """Whether enough app-only credentials exist to attempt authentication.

    `tenant_id` lets a caller check readiness for a specific organisation's
    configured tenant; omitted, checks the process-wide env var fallback.
    """
    resolved_tenant = tenant_id or settings.MICROSOFT_GRAPH_TENANT_ID
    return bool(resolved_tenant and settings.MICROSOFT_GRAPH_CLIENT_ID and settings.MICROSOFT_GRAPH_CLIENT_SECRET)


@retry(
    retry=retry_if_exception_type(GraphTransientError),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    reraise=True,
)
async def _request_token(tenant_id: str) -> _CachedToken:
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    data = {
        "grant_type": "client_credentials",
        "client_id": settings.MICROSOFT_GRAPH_CLIENT_ID,
        "client_secret": settings.MICROSOFT_GRAPH_CLIENT_SECRET,
        "scope": _GRAPH_SCOPE,
    }
    try:
        async with httpx.AsyncClient(timeout=_TOKEN_TIMEOUT_SECONDS) as client:
            response = await client.post(token_url, data=data)
    except (httpx.TimeoutException, httpx.TransportError) as exc:
        raise GraphTransientError(f"Microsoft token endpoint unreachable: {exc}") from exc

    if response.status_code >= 500:
        raise GraphTransientError(f"Microsoft token endpoint returned {response.status_code}")

    if response.status_code != 200:
        detail = response.json().get("error_description", response.text) if response.content else response.text
        logger.warning("microsoft_graph.token_request_failed", extra={"status_code": response.status_code})
        raise GraphAuthError(
            f"Microsoft Graph authentication failed: {detail}",
            status_code=response.status_code,
        )

    body = response.json()
    return _CachedToken(
        access_token=body["access_token"],
        expires_at=time.monotonic() + int(body.get("expires_in", 3600)) - _EXPIRY_SAFETY_MARGIN_SECONDS,
    )


async def get_access_token(tenant_id: Optional[str] = None) -> str:
    """Return a valid app-only Graph access token, refreshing if needed.

    Raises GraphNotConfiguredError if no credentials are set at all, so
    callers can surface "Microsoft 365 is not connected" instead of a
    confusing auth failure.
    """
    resolved_tenant = tenant_id or settings.MICROSOFT_GRAPH_TENANT_ID
    if not is_configured(resolved_tenant):
        raise GraphNotConfiguredError(
            "Microsoft Graph is not configured - set MICROSOFT_GRAPH_TENANT_ID, "
            "MICROSOFT_GRAPH_CLIENT_ID and MICROSOFT_GRAPH_CLIENT_SECRET."
        )

    cached = _token_cache.get(resolved_tenant)
    if cached and cached.expires_at > time.monotonic():
        return cached.access_token

    try:
        token = await _token_breaker.call_async(lambda: _request_token(resolved_tenant))
    except CircuitBreakerOpen as exc:
        raise GraphTransientError(str(exc)) from exc

    _token_cache[resolved_tenant] = token
    return token.access_token


def invalidate_cached_token(tenant_id: Optional[str] = None) -> None:
    """Force the next call to re-authenticate - used by the setup wizard's
    'Test Connection' action so a just-rotated secret is picked up immediately
    rather than waiting out the old token's remaining lifetime."""
    resolved_tenant = tenant_id or settings.MICROSOFT_GRAPH_TENANT_ID
    _token_cache.pop(resolved_tenant, None)
