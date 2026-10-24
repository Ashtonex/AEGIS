# AEGIS Regression Test Plan & Definition of Done

This document outlines the test suite and validation criteria required before marking any reliability or integration fix complete.

---

## 1. Automated Acceptance Test Matrix

| Test ID | Scenario | Expected Status | Expected Payload / Response Structure |
| :--- | :--- | :--- | :--- |
| **TEST-REL-01** | Uncaught Python Exception | 500 Internal Server Error | `{ "success": false, "error": { "code": "INTERNAL_SERVER_ERROR", "correlation_id": "..." } }` |
| **TEST-REL-02** | Database Connection Pool Wait Timeout (`SATimeoutError`) | 503 Service Unavailable | `{ "success": false, "error": { "code": "DATABASE_BUSY", "message": "Database connection pool is busy..." } }` |
| **TEST-REL-03** | Expired / Invalid JWT Token | 401 Unauthorized | `{ "detail": "Token has expired" }` |
| **TEST-REL-04** | Unauthorized RBAC Access | 403 Forbidden | `{ "detail": "You do not have permission..." }` |
| **TEST-REL-05** | Non-Existent Entity ID | 404 Not Found | `{ "detail": "Requested resource was not found." }` |
| **TEST-REL-06** | Invalid Schema Payload | 422 Unprocessable Entity | `{ "detail": [ { "loc": [...], "msg": "..." } ] }` |
| **TEST-REL-07** | Proxy Gateway 502 / Container Restart | 502 Bad Gateway | Frontend surfaces: *"Backend gateway unavailable (HTTP 502). The service may be restarting."* with Ref code |

---

## 2. Feature Definition of Done (DoD)

For every future endpoint or UI module:
1. **Happy Path Validated**: End-to-end data flow verified with real PostgreSQL tables.
2. **Auth & RBAC Enforced**: `require_permission` verified; missing token returns 401; missing permission returns 403.
3. **Multi-Tenancy Preserved**: All queries strictly filtered by `organization_id`.
4. **Structured JSON Errors**: No unhandled exceptions return raw HTML or plain text; all errors carry `X-Correlation-ID`.
5. **Frontend State Coverage**:
   - Loading skeleton / spinner present.
   - Genuine empty state rendered when 0 rows exist.
   - Actionable error banner rendered with trace reference (no generic catch-all strings).
6. **No Regressions**: `python -m py_compile` and `npx tsc --noEmit` exit with code 0.
