"""Typed errors for Microsoft Graph calls.

Every failure mode a caller actually needs to branch on gets its own class -
routers/integrations_microsoft.py and the sync workers catch these instead of
inspecting HTTP status codes inline, so the "what do we do about it" decision
(retry, surface to the user, fail closed) lives in one place per error kind.
"""

from __future__ import annotations

from typing import Optional


class GraphError(Exception):
    """Base class for every Microsoft Graph failure."""

    def __init__(self, message: str, *, status_code: Optional[int] = None, graph_code: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.graph_code = graph_code


class GraphNotConfiguredError(GraphError):
    """No tenant/client credentials are set - fail closed, don't pretend."""


class GraphAuthError(GraphError):
    """Token acquisition failed (bad client secret, wrong tenant, expired cert)."""


class GraphPermissionError(GraphError):
    """403 - the app registration lacks a required Graph permission, or admin
    consent was never granted for it."""


class GraphNotFoundError(GraphError):
    """404 - site/drive/item/calendar/event no longer exists (renamed site,
    deleted library, cancelled event upstream)."""


class GraphConflictError(GraphError):
    """412/409 - an etag/If-Match precondition failed (concurrent edit)."""


class GraphRateLimitedError(GraphError):
    """429 - caller should back off. `retry_after_seconds` comes from
    Microsoft's own Retry-After header when present."""

    def __init__(self, message: str, *, retry_after_seconds: Optional[float] = None, **kwargs):
        super().__init__(message, **kwargs)
        self.retry_after_seconds = retry_after_seconds


class GraphTransientError(GraphError):
    """5xx or network-level failure - safe to retry with backoff."""
