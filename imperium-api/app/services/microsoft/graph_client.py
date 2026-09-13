"""Thin async Microsoft Graph HTTP client.

Every privileged Graph call in the codebase should go through this module
(or the sharepoint.py/calendar.py wrappers built on it) rather than calling
httpx directly - it is the one place that:
  - attaches the app-only bearer token (app/services/microsoft/auth.py);
  - maps Graph's error shape into the typed exceptions in errors.py so
    callers can branch on "permission missing" vs "rate limited" vs
    "transient" without re-parsing HTTP responses;
  - retries transient/5xx failures and respects Retry-After on 429, per
    Microsoft's Graph throttling guidance;
  - runs behind a circuit breaker so a Graph outage fails fast instead of
    hanging every request for its full timeout.

Runs server-side only (imported from routers/services, never referenced by
aegis-web) - the access token this attaches is a privileged application
token and must never reach the browser.
"""

from __future__ import annotations

import json as json_lib
from typing import Any, Optional

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from core.config import settings
from core.logging import logger
from core.resilience import CircuitBreaker, CircuitBreakerOpen
from app.services.microsoft.auth import get_access_token
from app.services.microsoft.errors import (
    GraphConflictError,
    GraphError,
    GraphNotFoundError,
    GraphPermissionError,
    GraphRateLimitedError,
    GraphTransientError,
)

_REQUEST_TIMEOUT_SECONDS = float(settings.EXTERNAL_API_TIMEOUT_SECONDS)
_breaker = CircuitBreaker("microsoft_graph_api", failure_threshold=8, reset_timeout_seconds=30.0)


def _raise_for_status(response: httpx.Response) -> None:
    if response.status_code < 400:
        return

    graph_code = None
    message = f"Microsoft Graph returned {response.status_code}"
    try:
        body = response.json()
        error = body.get("error", {})
        graph_code = error.get("code")
        message = error.get("message") or message
    except (json_lib.JSONDecodeError, ValueError):
        pass

    if response.status_code == 401:
        raise GraphPermissionError(message, status_code=401, graph_code=graph_code)
    if response.status_code == 403:
        raise GraphPermissionError(message, status_code=403, graph_code=graph_code)
    if response.status_code == 404:
        raise GraphNotFoundError(message, status_code=404, graph_code=graph_code)
    if response.status_code in (409, 412):
        raise GraphConflictError(message, status_code=response.status_code, graph_code=graph_code)
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        raise GraphRateLimitedError(
            message,
            status_code=429,
            graph_code=graph_code,
            retry_after_seconds=float(retry_after) if retry_after else None,
        )
    if response.status_code >= 500:
        raise GraphTransientError(message, status_code=response.status_code, graph_code=graph_code)

    raise GraphError(message, status_code=response.status_code, graph_code=graph_code)


@retry(
    retry=retry_if_exception_type((GraphTransientError, GraphRateLimitedError)),
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    reraise=True,
)
async def _send(
    method: str,
    url: str,
    *,
    tenant_id: Optional[str],
    params: Optional[dict[str, Any]] = None,
    json: Optional[dict[str, Any]] = None,
    content: Optional[bytes] = None,
    extra_headers: Optional[dict[str, str]] = None,
    authenticate: bool = True,
) -> httpx.Response:
    headers: dict[str, str] = {}
    if authenticate:
        # Upload-session chunk PUTs go to a pre-authenticated storage URL
        # (not graph.microsoft.com) - per Microsoft's documented contract for
        # createUploadSession, the Authorization header must NOT be attached
        # to those requests, so callers uploading to an uploadUrl pass
        # authenticate=False.
        token = await get_access_token(tenant_id)
        headers["Authorization"] = f"Bearer {token}"
    if extra_headers:
        headers.update(extra_headers)

    async def _do_request() -> httpx.Response:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_SECONDS) as client:
            try:
                response = await client.request(
                    method, url, params=params, json=json, content=content, headers=headers
                )
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                raise GraphTransientError(f"Microsoft Graph unreachable: {exc}") from exc
            _raise_for_status(response)
            return response

    try:
        return await _breaker.call_async(_do_request)
    except CircuitBreakerOpen as exc:
        raise GraphTransientError(str(exc)) from exc


class GraphClient:
    """Bound to one organisation's tenant (or the env-var fallback tenant if
    `tenant_id` is None) so every call it makes authenticates and scopes
    correctly for that organisation."""

    def __init__(self, tenant_id: Optional[str] = None):
        self.tenant_id = tenant_id
        self.base_url = settings.MICROSOFT_GRAPH_BASE_URL.rstrip("/")

    def _url(self, path: str) -> str:
        return path if path.startswith("http") else f"{self.base_url}/{path.lstrip('/')}"

    async def get(self, path: str, *, params: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        response = await _send("GET", self._url(path), tenant_id=self.tenant_id, params=params)
        return response.json() if response.content else {}

    async def get_all_pages(self, path: str, *, params: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        """Follows @odata.nextLink until exhausted - Graph paginates list
        endpoints (site search, drive children) past a default page size."""
        items: list[dict[str, Any]] = []
        next_url: Optional[str] = self._url(path)
        next_params = params
        while next_url:
            response = await _send("GET", next_url, tenant_id=self.tenant_id, params=next_params)
            body = response.json()
            items.extend(body.get("value", []))
            next_url = body.get("@odata.nextLink")
            next_params = None  # nextLink already carries its own query string
        return items

    async def post(self, path: str, *, json: Optional[dict[str, Any]] = None) -> dict[str, Any]:
        response = await _send("POST", self._url(path), tenant_id=self.tenant_id, json=json)
        return response.json() if response.content else {}

    async def patch(self, path: str, *, json: dict[str, Any]) -> dict[str, Any]:
        response = await _send("PATCH", self._url(path), tenant_id=self.tenant_id, json=json)
        return response.json() if response.content else {}

    async def put_content(
        self,
        path: str,
        *,
        content: bytes,
        content_type: str = "application/octet-stream",
        extra_headers: Optional[dict[str, str]] = None,
        authenticate: bool = True,
    ) -> dict[str, Any]:
        headers = {"Content-Type": content_type}
        if extra_headers:
            headers.update(extra_headers)
        response = await _send(
            "PUT",
            self._url(path),
            tenant_id=self.tenant_id,
            content=content,
            extra_headers=headers,
            authenticate=authenticate,
        )
        return response.json() if response.content else {}

    async def delete(self, path: str) -> None:
        await _send("DELETE", self._url(path), tenant_id=self.tenant_id)
