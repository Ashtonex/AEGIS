# AEGIS Error Register

This document tracks all identified systemic and localized failure modes in AEGIS across the frontend (`aegis-web`), backend (`imperium-api`), proxy (`caddy`), and database (`Supabase PostgreSQL`).

---

### ERR-001: Generic Catch-All Masking Gateway & Server Failures
- **User-facing symptom**: *"The service is temporarily unavailable. Please try again."*
- **Actual error**: HTTP 500, 502, 503, or 504 responses that return non-JSON bodies (e.g., Caddy HTML gateway errors, unhandled Python exceptions returning plain text `Internal Server Error`, cloud load balancer timeouts).
- **Severity**: HIGH
- **Frequency**: INTERMITTENT (during deploys, pool saturation, or uncaught server exceptions)
- **Affected module/page**: System-wide (`fetchApi` in `aegis-web`)
- **Affected endpoint**: All `/api/v1/*` endpoints
- **Affected user roles**: All roles
- **HTTP status**: 500, 502, 503, 504
- **Frontend evidence**:
  - `aegis-web/src/lib/api/core.ts:508`:
    ```typescript
    } else if (response.status >= 500) {
      message = "The service is temporarily unavailable. Please try again.";
    }
    ```
- **Backend evidence**:
  - `imperium-api/main.py`: Missing global `app.add_exception_handler(Exception)` and `app.add_exception_handler(SQLAlchemyError)`. Uncaught exceptions default to Starlette's plain-text `Internal Server Error`, which fails JSON parsing on the frontend.
- **Database evidence**:
  - When connection pool waits exceed `DB_POOL_TIMEOUT_SECONDS` (5s), `SATimeoutError` is raised in `core/database.py:get_db()`, bubbling up as an uncaught 500.
- **Infrastructure evidence**:
  - DigitalOcean droplet Caddy proxy returns HTML 502 when backend container restarts exceed `lb_try_duration 45s`.
- **Root cause**:
  1. Frontend `buildApiError()` discards the HTTP status and raw text body if JSON parsing fails, replacing it with a single static string.
  2. Backend lacks structured JSON error formatting for unexpected 500 exceptions, returning plain text that triggers the frontend's blind fallback.
- **Failure classification**: FRONTEND ERROR HANDLING / BACKEND EXCEPTION / API GATEWAY
- **Business impact**: Users and operators cannot distinguish between a transient network blip, a permission failure, a database pool stall, or a code bug.
- **Proposed fix**:
  1. Update `aegis-web/src/lib/api/core.ts` `buildApiError()`:
     - Preserve status code and extract plain-text body snippets when JSON parsing fails.
     - Capture `X-Correlation-ID` header and display it in the error message for traceability.
     - Return actionable taxonomy: 500 (Internal Server Error with trace ID), 502 (Gateway / Deployment in progress), 503 (Service / Database busy), 504 (Gateway Timeout).
  2. Add global exception handlers in `imperium-api/main.py`:
     - Catch `SQLAlchemyError` / `SATimeoutError` and return structured JSON 503.
     - Catch `Exception` and return structured JSON 500 with correlation ID.
- **Files to change**:
  - `aegis-web/src/lib/api/core.ts`
  - `imperium-api/main.py`
- **Database changes**: None
- **Environment changes**: None
- **Tests required**: Verify 500, 502, 503 responses format correctly as JSON and surface accurate, traceable messages on the frontend.
- **Rollback plan**: Revert changes in `core.ts` and `main.py`.
- **Prevention measure**: Standardize error envelope across all endpoints; enforce structured JSON in FastAPI exception handlers.
- **Status**: APPROVED / IMPLEMENTING

---

### ERR-002: Supabase Auth Verification Timeout / Transient Lockout
- **User-facing symptom**: *"The backend service is waking up or temporarily unavailable. Please retry in a few seconds."* or *"Authentication service temporarily unavailable. Please retry."*
- **Actual error**: HTTP 503 from `imperium-api/core/security.py:510, 529, 541` when Supabase Auth takes >10s to verify a bearer token or when the circuit breaker trips.
- **Severity**: MEDIUM
- **Frequency**: INTERMITTENT (during Supabase auth service latency spikes)
- **Affected module/page**: All authenticated pages
- **Affected endpoint**: Any endpoint depending on `get_current_user` or `verify_token`
- **Affected user roles**: All roles
- **HTTP status**: 503
- **Frontend evidence**:
  - `aegis-web/src/lib/api/core.ts:506` maps 503 to waking-up string.
- **Backend evidence**:
  - `imperium-api/core/security.py:505, 522, 532`:
    ```python
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Authentication service temporarily unavailable. Please retry.",
    )
    ```
- **Root cause**: Local JWT verification fails because `JWT_SECRET_KEY` in production is set to an API key (`sb_secret_...`) instead of the Supabase project's legacy JWT secret, forcing every token to be verified over HTTPS against `auth/v1/user`.
- **Failure classification**: AUTH / EXTERNAL SERVICE
- **Business impact**: Increases request latency by 200–500ms and introduces external network fragility to internal authenticated queries.
- **Proposed fix**: Provide clear, distinct error detail indicating identity verification timeout, while preserving the circuit breaker cache fallback.
- **Status**: ANALYZED / MITIGATED
