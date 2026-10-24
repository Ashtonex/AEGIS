# AEGIS Error Playbook

This playbook provides standard operating procedures for diagnosing and troubleshooting errors across the AEGIS ecosystem.

---

## 1. HTTP Status Taxonomy in AEGIS

| Status | AEGIS Interpretation | Common Root Cause | Triage Command / Action |
| :--- | :--- | :--- | :--- |
| **401 Unauthorized** | Missing, invalid, or expired session token | Supabase session expired, user logged out in another tab | Re-authenticate via `/login`. Check browser `localStorage` for `sb-<project>-auth-token`. |
| **403 Forbidden** | Role / RBAC denial or multi-tenant mismatch | User missing required permission key, or account inactive/deleted | Inspect `core.user_roles`, `core.role_permissions`, and `core.users.is_active`. Verify `organization_id`. |
| **404 Not Found** | Resource missing or scoped to another tenant | Incorrect ID in URL, or row filtered out by tenant isolation | Check table row exists with matching `organization_id`. |
| **409 Conflict** | Business rule violation or deployment gate block | Compliance check failed, unique key collision, duplicate email | Inspect error `detail` for specific missing certifications or requirements. |
| **422 Unprocessable** | Request schema validation failure | Frontend sent missing/wrongly typed field in payload | Inspect FastAPI validation `detail` array for offending field path (`loc`). |
| **429 Rate Limited** | Request threshold exceeded | Rapid automated polling or brute-force mitigation | Inspect `Retry-After` header. Slow down client calls. |
| **500 Internal Error** | Unhandled backend server exception | Unhandled Python exception, bad query, unmigrated schema | Inspect backend logs with `X-Correlation-ID`. Check `systemd` / Docker logs on droplet. |
| **502 Bad Gateway** | Reverse proxy cannot reach upstream container | `imperium-api` container restarting, crashed, or OOM killed | SSH to droplet: `docker compose ps` and `docker compose logs -n 50 imperium-api`. |
| **503 Unavailable** | Database pool full or Auth circuit breaker open | High connection load, slow transactions, Supabase Auth timeout | Check `GET /health/deep`. Inspect `pool_status()` in backend logs. |
| **504 Gateway Timeout**| Request took longer than proxy timeout (>45s) | Long-running unindexed query, sequential N+1 network requests | Add indexes, use `gather_reads()`, or paginate query. |

---

## 2. Request Correlation & Tracing Guide

Every request in AEGIS carries a Correlation ID:
1. **Frontend**: When an error occurs, `ApiError` exposes the `correlationId` and HTTP status.
2. **Backend**: `StructuredLoggingMiddleware` extracts or generates `X-Correlation-ID`.
3. **Database**: `get_current_user` runs `set_config('request.jwt.claim.sub', ...)` to bind the actor to DB audit logs.

### Tracing a Specific Error:
```bash
# On the DigitalOcean VPS:
cd /opt/aegis
docker compose -f deploy/digitalocean/docker-compose.yml logs imperium-api | grep "<CORRELATION_ID>"
```

---

## 3. Database Pool Exhaustion Recovery

If `503 Service Unavailable` or `db_pool_checkout_timeout` is logged:
1. Run `GET /health/deep` to check pool occupancy.
2. Check for long-running idle transactions:
   ```sql
   SELECT pid, now() - xact_start AS duration, query, state
   FROM pg_stat_activity
   WHERE state != 'idle' AND now() - xact_start > interval '5 seconds';
   ```
3. Terminate runaway queries:
   ```sql
   SELECT pg_terminate_backend(pid);
   ```

---

## 4. Deployment Outage Verification

During a backend deploy:
- Caddy holds connections for 45s (`lb_try_duration 45s`).
- If an API deploy fails, check Caddy logs:
  ```bash
  docker compose -f deploy/digitalocean/docker-compose.yml logs caddy
  ```
