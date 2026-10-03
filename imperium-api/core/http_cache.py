"""HTTP caching and authorization-cache invalidation middleware.

Two concerns, both of which used to be missing entirely:

1. **Cache-Control on responses.** There were zero `Cache-Control` or `ETag`
   headers anywhere in the API, so a browser re-fetched and the server
   re-computed even slow, rarely-changing reference data (permission
   catalogues, cost codes, rate libraries, org structure) on every single
   navigation. `ReferenceCacheHeadersMiddleware` adds a short
   `private, max-age=..., stale-while-revalidate=...` to safe reads on a
   conservative allowlist of reference routes, and an explicit `no-store` to
   everything else so nothing sensitive becomes cacheable by accident.

   `stale-while-revalidate` is what makes navigation feel instant: the browser
   paints from cache immediately and refreshes behind it. Salesforce ships an
   up-to-30-second staleness window on its list views for the same reason, so
   bounded staleness with an explicit refresh affordance is a normal posture,
   not a compromise.

2. **Authorization-cache invalidation.** `core.security` caches each user's
   resolved org, role and permission set (see the block comment there). That
   is only safe if every change to roles, permissions or account status
   invalidates it. Routers call `invalidate_user_auth()` where the affected
   user is known, but relying on that alone means one forgotten call becomes a
   silent privilege-retention bug. `AuthCacheInvalidationMiddleware` is the
   backstop: after any *successful state-changing* request to an
   identity-administration route, it clears the whole authorization-cache
   prefix. Coarse on purpose - it cannot under-invalidate, and these are rare
   admin actions whose cost is one extra resolution query per active user.
"""

from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from core.config import settings

logger = logging.getLogger(__name__)

# Safe reads whose payload is reference/configuration data rather than live
# operational rows. Deliberately conservative: anything that could carry
# per-user or fast-moving financial/operational data is excluded, because the
# failure mode of caching too much here is a user acting on stale data.
REFERENCE_CACHE_PREFIXES: tuple[str, ...] = (
    "/api/v1/tenders/requirements-library",
    "/api/v1/compliance/corporate-credentials",
    "/api/v1/finance/departments",
    "/api/v1/kpi-metrics/definitions",
    "/api/v1/settings/permissions",
    "/api/v1/settings/roles",
)

# Mutating requests to these prefixes can change identity, role or permission
# state, so they clear the authorization cache.
IDENTITY_ADMIN_PREFIXES: tuple[str, ...] = (
    "/api/v1/settings",
    "/api/v1/users",
    "/api/v1/auth",
    "/api/v1/portals",
    "/api/v1/teams",
    "/api/v1/profile",
)

_SAFE_METHODS = frozenset({"GET", "HEAD"})
_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class ReferenceCacheHeadersMiddleware(BaseHTTPMiddleware):
    """Adds Cache-Control to safe reads on reference routes, and no-store to
    everything else."""

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        # Never override a handler that set its own policy deliberately.
        if "cache-control" in (k.lower() for k in response.headers.keys()):
            return response

        path = request.url.path
        max_age = settings.HTTP_CACHE_REFERENCE_MAX_AGE

        if (
            request.method in _SAFE_METHODS
            and 200 <= response.status_code < 300
            and max_age > 0
            and any(path.startswith(prefix) for prefix in REFERENCE_CACHE_PREFIXES)
        ):
            swr = settings.HTTP_CACHE_REFERENCE_SWR
            # `private` because these responses are scoped to the caller's
            # organization and must never be held in a shared/CDN cache.
            directives = ["private", f"max-age={max_age}"]
            if swr > 0:
                directives.append(f"stale-while-revalidate={swr}")
            response.headers["Cache-Control"] = ", ".join(directives)
            response.headers["Vary"] = "Authorization"
            return response

        # Default deny. Without this, an intermediary is free to apply its own
        # heuristic freshness to authenticated API responses.
        response.headers["Cache-Control"] = "no-store"
        return response


class AuthCacheInvalidationMiddleware(BaseHTTPMiddleware):
    """Clears the authorization cache after a successful identity-admin write.

    See the module docstring for why this exists in addition to the targeted
    `invalidate_user_auth()` calls in the routers.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        response = await call_next(request)

        if (
            request.method in _MUTATING_METHODS
            and 200 <= response.status_code < 300
            and any(request.url.path.startswith(p) for p in IDENTITY_ADMIN_PREFIXES)
        ):
            try:
                from core.security import invalidate_all_auth

                await invalidate_all_auth()
                logger.info(
                    "auth cache cleared after %s %s", request.method, request.url.path
                )
            except Exception as exc:  # noqa: BLE001
                # A failed invalidation must not fail the write that already
                # succeeded, but it does mean permissions could be stale for
                # up to AUTH_CACHE_TTL_SECONDS - worth logging loudly.
                logger.error(
                    "auth cache invalidation FAILED after %s %s (%s); "
                    "permission changes may take up to %ss to apply",
                    request.method,
                    request.url.path,
                    exc,
                    settings.AUTH_CACHE_TTL_SECONDS,
                )

        return response
