# Operational Runbooks

Date: 2026-08-03

Project: `AEGIS_SNC` (imperium-api backend + aegis-web frontend)
Supabase ref: `mzwwkwokpakdweyyscef`

Recovery steps for the failure modes most likely to actually happen on this
stack, plus the environment-specific gotchas already hit at least once on
the primary Windows dev machine. If a step below turns out to be wrong or a
file/line has moved, fix this doc in the same change - a runbook that lies
is worse than no runbook.

---

## 1. Backend won't start

Symptoms: `uvicorn main:app` exits immediately, or hangs with no
`Application startup complete.` line.

1. Read the actual traceback - `main.py`'s startup path imports every
   router; an import error anywhere in `routers/` or `app/services/`
   surfaces here, not at request time. Fix the import, don't work around it.
2. If it's a config error (`core/config.py` raising on a missing/invalid
   env var), check `imperium-api/.env` has all of: `DATABASE_URL`,
   `SECRET_KEY`, `JWT_SECRET_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_KEY`, `ALLOWED_ORIGINS`, `ALLOWED_HOSTS`.
3. If it starts but then immediately fails on the first DB-touching
   request, go to [DB connection/pool issues](#2-db-connectionpool-issues)
   below - startup itself doesn't open a DB connection, so a bad
   `DATABASE_URL` often looks like a clean start followed by every request
   hanging or 500ing.
4. Port already in use (`[Errno 10048] ... only one usage of each socket
   address`) means a previous backend process is still bound to 8000:
   ```bash
   netstat -ano | grep :8000
   taskkill //F //PID <pid>
   ```
   Then start fresh. See also
   [uvicorn --reload unreliable](#5-uvicorn---reload-unreliable-on-windows) -
   the old process is very often a stuck reloader from an earlier edit, not
   a genuinely running server.

## 2. DB connection/pool issues

Symptoms: requests hang until timeout with no clear error, or
`asyncpg`/`sqlalchemy` connection errors, or every DB-backed endpoint 500s
while `/docs` still loads fine (proves the app itself started).

1. Check first whether this is the known IPv6 pooler issue on this machine -
   see [Supabase IPv4 pooler required](#6-supabase-database-host-must-be-the-ipv4-pooler)
   below. This has burned an entire debugging session before; rule it out
   before anything else.
2. Confirm Supabase itself is reachable and not paused (free-tier projects
   pause after inactivity): open the Supabase dashboard for
   `mzwwkwokpakdweyyscef` and check project status.
3. Confirm the password in `DATABASE_URL` is current - if it was rotated
   (see `docs/SECRET_ROTATION_RUNBOOK.md`), a stale local `.env` will fail
   auth silently as a connection timeout in some drivers, or an explicit
   auth error in others.
4. If using the transaction-mode pooler port (6543), confirm
   `connect_args={"statement_cache_size": 0, "prepared_statement_cache_size": 0}`
   is set wherever the engine is created (`core/database.py`,
   `migrations/run_aegis_migrations.py`) - pgbouncer transaction mode
   breaks asyncpg's prepared statement cache otherwise. The session-mode
   port (5432, what this environment currently uses) doesn't need this,
   but don't remove it defensively without checking every engine creation
   site actually agrees on the port.
5. Restart the backend after any `.env` change - it's read once at process
   start, not live-reloaded.

## 3. Migration failure

Symptoms: `python migrations/run_aegis_migrations.py` exits non-zero.

1. Read the actual error first - `migrations/migration_ledger.py` wraps the
   whole batch in one connection/transaction
   (`run_aegis_migrations.py::run`), so a failure partway through rolls
   back the entire run, including any earlier migration files that
   executed successfully in that same invocation. It is generally safe to
   fix the failing `.sql` file and re-run the whole command - nothing was
   left half-applied.
2. Common causes, in order of likelihood:
   - A migration references a table/column from an earlier migration that
     hasn't actually been applied yet (check
     `SELECT filename FROM core.aegis_migration_log ORDER BY filename;`
     against what's in `migrations/`).
   - `ON CONFLICT` target doesn't match an existing unique constraint - the
     migration author assumed a constraint name/shape that changed.
   - An already-applied migration file was edited after the fact -
     `_raise_if_checksum_changed` in `migration_ledger.py` deliberately
     blocks this with a clear error naming the file; the fix is a NEW
     migration, never editing history.
3. To see the plan without applying anything:
   ```bash
   python migrations/run_aegis_migrations.py --plan
   ```
4. After fixing the SQL, just re-run
   `python migrations/run_aegis_migrations.py` - already-applied files are
   skipped (checksum-matched), only new/pending files execute.
5. If a migration truly needs to be reverted after it succeeded, write a
   new migration that undoes it (`DROP ...`, reverse data changes) - this
   ledger has no down-migration mechanism by design.

## 4. Auth/JWT breakage

Symptoms: every request 401s, or 503 "Authentication service temporarily
unavailable", or login works but every subsequent authenticated call fails.

1. `core/security.py::verify_token` tries local JWT verification first
   (`_decode_locally`, checked against `JWT_SECRET_KEY`/`SECRET_KEY`), then
   falls back to calling the Supabase Auth API directly
   (`_call_supabase_auth_api`) if local verification doesn't match. A
   circuit breaker (`core/resilience.py`, name `supabase_auth`) sits in
   front of that fallback - if Supabase Auth itself is down or unreachable
   for 5 consecutive failures, subsequent calls fail fast with 503 for 30
   seconds instead of hanging. A burst of 503s across all endpoints, not
   just some, points here.
2. If it's 401 specifically (not 503), the token itself is being rejected,
   which is more often a real problem than infrastructure:
   - Confirm `JWT_SECRET_KEY` in `.env` matches what Supabase actually
     signs with (Supabase dashboard - Project Settings - API - JWT
     Settings). A rotated Supabase JWT secret with a stale local `.env`
     value looks exactly like this.
   - Confirm the token hasn't simply expired - `aegis-web/src/lib/api.ts`
     is responsible for refreshing via Supabase before a stale token ever
     reaches the backend; if that refresh path is broken, the frontend
     will keep sending an expired token.
3. Never "fix" this by re-adding a bypass, backdoor, or unverified-claims
   shortcut - two of those existed in this codebase before (a hardcoded
   superadmin email, an auto-provisioning default role bug) and were
   deliberately removed as security incidents, not stylistic cleanups.
4. To confirm the backend's own verification path in isolation without a
   real browser session, mint a real Supabase session token for a known
   test user and call an authenticated endpoint directly:
   ```bash
   python - <<'EOF'
   from supabase import create_client
   from core.config import settings
   svc = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
   anon = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
   email = "<a real seeded user's email>"
   link = svc.auth.admin.generate_link(params={"type": "magiclink", "email": email})
   res = anon.auth.verify_otp({"email": email, "token": link.properties.email_otp, "type": "email"})
   print(res.session.access_token)
   EOF
   ```
   This mints a real, backend-verifiable token without needing an
   interactive password login - useful for isolating "is it the backend or
   the frontend" during an incident.

---

## Environment gotchas (this Windows dev machine specifically)

These three have each independently eaten significant debugging time by
presenting as something else entirely. Check these BEFORE assuming a code
change is the root cause of a newly-broken local dev environment.

## 5. `uvicorn --reload` unreliable on Windows

`uvicorn main:app --reload` logs `WatchFiles detected changes ... Reloading...`
on a `.py` edit, but the worker process frequently does not actually
restart - no `Application startup complete.` line follows, and the OLD
code keeps serving every request with no error or warning. This was caught
live: a bug fix kept producing the exact pre-fix traceback for over two
minutes after the "Reloading..." message, same PID the whole time.

**Fix:** never trust `--reload` on this machine. After any `imperium-api`
`.py` change, explicitly kill and restart:
```bash
netstat -ano | grep :8000
taskkill //F //PID <pid>
python -m uvicorn main:app --host 127.0.0.1 --port 8000
```
`.claude/launch.json`'s backend config has `--reload` removed for this
reason.

## 6. Supabase database host must be the IPv4 pooler

`db.mzwwkwokpakdweyyscef.supabase.co` (the direct Postgres host) resolves
IPv6-only, and this machine/network has no working IPv6 route - a
`DATABASE_URL` pointed at that host hangs or times out with no useful
error.

**Fix:** `DATABASE_URL` must use the Supavisor IPv4 pooler:
```text
postgresql+asyncpg://postgres.mzwwkwokpakdweyyscef:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```
Session-mode port 5432 (current setting) avoids the transaction-mode
prepared-statement-cache gotcha (port 6543 needs
`statement_cache_size=0`/`prepared_statement_cache_size=0` set explicitly
wherever the engine is created).

## 7. `ALLOWED_ORIGINS` must match the frontend's actual port

`imperium-api/.env`'s `ALLOWED_ORIGINS` was once stuck on
`http://localhost:3000` while the dev frontend actually serves from
**3010** (see `.claude/launch.json`). Almost every frontend call goes
through Next.js's own `/api/v1/...` server-side rewrite (same-origin, no
CORS involved), so a mismatch here stays invisible until a feature that
`fetch()`s `http://localhost:8000` directly from the browser is used (at
the time this was found: the Quotations Builder's PDF/Excel export
buttons) - those fail with a CORS preflight error
(`OPTIONS ... 400` / `net::ERR_FAILED`).

**Fix:** if a frontend feature fails with a network error but only when it
calls the backend directly rather than via `/api/v1/...`, check
`ALLOWED_ORIGINS` against whatever port the frontend is actually running
on before assuming it's a backend logic bug. Current value:
`http://localhost:3010`.

---

## Idempotency key cleanup

`core.idempotency_keys` (migration 065) rows normally transition
`in_progress` -> `completed` within one request. A row stuck on
`in_progress` means the process handling that request died mid-flight
(crash, forced restart) before it could release the key via
`core/idempotency.py::fail_idempotent_request`. This does not block
anything except a retry using that exact same key, and a legitimate retry
after a crash is exactly the case idempotency keys exist to make safe - so
no action is required. If cleanup is ever wanted (e.g. before a storage
audit), stale rows are safe to delete:
```sql
DELETE FROM core.idempotency_keys
WHERE status = 'in_progress' AND created_at < NOW() - INTERVAL '1 hour';
```
