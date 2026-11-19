# Findings ledger (2026-11-19)

Severity scale: Critical (exploitable data loss/escalation, no preconditions) · High · Medium
(exploitable abuse with modest preconditions) · Low · Info.

---

## F-01 — Meta WhatsApp webhook processed unsigned posts when `WHATSAPP_APP_SECRET` was unset

- **Severity:** Medium. A public, unauthenticated endpoint wrote CRM data without any proof of origin.
  Precondition: the attacker needs a WhatsApp `phone_number_id` mapped to a tenant
  (`settings.integration_connections` or `WHATSAPP_PHONE_NUMBER_ID`). Not Critical because of that
  precondition, and because the local `.env` uses `WHATSAPP_PROVIDER=twilio`. The production droplet's
  env was **not** inspected.
- **Component:** `imperium-api/routers/crm_communications.py` `receive_whatsapp_webhook`
  (`POST /api/v1/crm-communications/webhooks/whatsapp`).
- **Expected:** fail closed, as the Twilio webhooks do (`_validate_twilio_signature` explicitly returns
  False without a token: "Fail closed … these webhooks are public").
- **Actual (before fix):** the signature check ran only `if settings.WHATSAPP_APP_SECRET:`. With no secret,
  any body was parsed and processed: forged inbound `crm.communication_events` rows were inserted, and the
  `status` and `raw_payload` of existing outbound messages could be overwritten by message id. A signed
  but malformed JSON body also raised an unhandled `JSONDecodeError`, which surfaced as a 500.
- **Trust boundary tested:** handler function (B: policy at the entry point), with a mocked DB that fails
  if it is touched before verification.
- **Reproduction:** `pytest tests/test_whatsapp_webhook_signature.py`. Before the fix: 3 failed, 3 passed
  (unsigned post reached the DB; empty secret accepted; malformed JSON gave a JSONDecodeError). After the
  fix: 6 passed, plus the neighbouring `test_crm_communications_contract.py` and `test_twilio_whatsapp.py`
  (30 passed in total).
- **Fix:** refuse with 403 when the secret is unset; return 400 for an undecodable body. **Status: FIXED (uncommitted).**
- **Remaining uncertainty:** if any deployment really receives Meta Cloud API webhooks without
  `WHATSAPP_APP_SECRET`, those deliveries will now get 403. Set the secret before switching the provider to `meta`.

## F-02 — Rate limits on anonymous endpoints could be bypassed with a rotating junk bearer header

- **Severity:** Medium. It removes the brute-force throttle on password login and the spam throttle on
  five public forms. No authentication is needed.
- **Component:** `core/rate_limit.py:rate_limit_key` (the default key) and its use by
  `routers/auth.py` (`/register`, `/login`, `/refresh`) and `routers/public_intake.py` (`/enquiry`,
  `/supplier`, `/application`, `/tender-interest/{id}`, `/newsletter`).
- **Expected:** these endpoints never verify a token, so their limits must be per client IP. This is
  already the pattern for every public *read* endpoint (`key_func=get_remote_address`).
- **Actual (before fix):** the default key uses `sha256(bearer)` whenever an `Authorization: Bearer …`
  header longer than 20 characters is present, and it never verifies that bearer. A new random header per
  request means a new bucket per request. The per-IP failed-auth throttle in `core/security.py` does not
  compensate, because it only runs inside `verify_token`, and these endpoints never call it.
- **Trust boundary tested:** real HTTP routes through `TestClient(main.app)` with in-memory limiter
  storage (C: the real middleware/decorator path).
- **Reproduction:** `pytest tests/test_public_rate_limit_keying.py`. Before the fix: 7 failed, 1 passed.
  The passing test is the control: the same IP with no bearer *was* throttled, which proves the limiter
  itself works. Login and registration with a rotating junk bearer never returned 429. After the fix:
  8 passed.
- **Fix:** `key_func=get_remote_address` on those 8 decorators. **Status: FIXED (uncommitted).**
- **Remaining uncertainty:** the per-IP key depends on uvicorn's `--proxy-headers --forwarded-allow-ips=*`
  resolving the true client IP. See F-04.

## F-03 — `test_email_redirects.py` reaches a real database (test-isolation defect)

- **Severity:** Low (test defect, not a product defect). On a developer machine `core/config.py` loads
  `imperium-api/.env`, so `send_email → _delivery_addresses` runs `SELECT teams_account FROM core.users`
  against **production**. In the sandbox the refused-port retries made one test take **1,267.8 s** inside
  the full suite, against 6.6 s on its own. That is order-dependent slowness.
- **Fix:** the test now patches `core.database.AsyncSessionLocal` to raise, which exercises the documented
  "lookup failed → original address" path. **Status: FIXED (uncommitted).** After the fix,
  `test_email_redirects.py` + `test_email_delivery_address.py` gave 18 passed, and the slow test now takes
  0.03 s (it was 6.6 s). The 1,268 s outlier did **not** recur in the final full run (4 min 24 s in total),
  so that slowness was intermittent. Its root cause is not isolated.

## F-04 — Client-IP trust depends on deployment topology (reviewed only)

- **Severity:** Info / unverified. The Dockerfile runs uvicorn with `--forwarded-allow-ips=*`, so any peer
  can set `X-Forwarded-For`. Per-IP limits and the failed-auth throttle are therefore sound only if port
  8000 is reachable solely through Caddy, and Caddy replaces any client-supplied `X-Forwarded-For`.
  This was not verifiable without touching the production host. **Status: OPEN, needs an infra check.**

## F-05 — Minor observations (Info)

- `core/security.py` `verify_jwt` / `require_role` are unused (no references outside the module).
  `verify_jwt` echoes the PyJWT error text in its 401 detail, and `require_role` trusts a role claim from
  the token. Neither is reachable today. Deleting them would stop someone wiring them up later.
- The notifications WebSocket calls `verify_token_str(token)` without `client_ip`, so failed WebSocket
  handshakes are not counted by the per-IP failed-auth throttle.
- `/health` and `/health/deep` are public and return `environment` and DB pool occupancy. This is
  low-sensitivity, but it is information disclosure.
- A forged or `alg=none` token is never accepted (no 2xx on 1,155 routes). It does cost one Supabase Auth
  fallback call. That is a deliberate design, bounded by the 8-slot semaphore and the per-IP throttle.
