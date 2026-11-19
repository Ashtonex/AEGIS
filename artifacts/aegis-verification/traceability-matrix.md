# Requirements → tests traceability (rules exercised this run)

Confidence: H = written in code comments or docs and enforced by an existing test; M = inferred from code
and comments; L = inferred only.

| ID | Rule | Source | Conf. | Entry points | Positive | Negative / adversarial | Tests | Result | Gaps |
|---|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Every non-public route requires a verified bearer token | `core/security.py` `get_current_user`/`verify_token`; README | H | 1,155 HTTP operations carrying an auth dependency | n/a (needs DB) | no header, `Bearer not-a-jwt`, `alg=none` SUPERADMIN token | `harness/auth_sweep.py` | 1155×401, 1155×401, 1155×503 (never 2xx) | Valid-token path not exercised over HTTP (no DB) |
| AUTH-02 | Only 27 operations are intentionally public | route audit | M | `/`, `/health*`, `/auth/{register,login,refresh}`, 5 webhooks, 12 public intake, document verify, stationery scan, `/pwa/config`, WS (auth inside handler) | — | each reviewed for verification + rate limit | `harness/route_audit.py`, review | 2 defects (F-01, F-02) | WS handler auth reviewed, not executed |
| AUTH-03 | ES256 tokens verified against JWKS; unknown kid / bad signature final; HS256 only with known keys | `core/security.py` | H | `verify_token_str` | yes | forged sig, unknown kid, junk | `test_auth_verification.py` (existing) | pass | — |
| AUTH-04 | Token org claim must match DB org; inactive/deleted users 403 | `get_current_user` | H | all authed routes | — | tenant mismatch, revoked | `test_rbac_acceptance.py`, `test_auth_verification.py`, `test_crm_tenant_isolation_*` (existing, mocked DB) | pass | Not run against real SQL |
| AUTH-05 | Public self-registration disabled | `routers/auth.py` | H | `POST /auth/register` | — | any body → 403 | `test_auth_verification.py::test_public_registration_endpoint_is_disabled` | pass | — |
| RL-01 | Anonymous endpoints rate limited per client IP | `core/rate_limit.py` docstring, public read pattern | M | 8 anonymous write endpoints | same IP is throttled | rotating junk bearer | `tests/test_public_rate_limit_keying.py` (new) | FAIL before fix → PASS after | Depends on F-04 |
| WH-01 | Public webhooks fail closed without verifiable signature | `_validate_twilio_signature` comment | H | 4 Twilio + 1 Meta webhook | correctly signed processed | unsigned, empty secret, wrong/missing signature, malformed JSON | `tests/test_whatsapp_webhook_signature.py` (new), `test_twilio_whatsapp.py` | FAIL before fix → PASS after | Twilio URL reconstruction behind proxy not tested |
| WH-02 | Meta GET verification only with configured token | `verify_whatsapp_webhook` | M | `GET …/webhooks/whatsapp` | — | reviewed: requires a configured token and exact equality | review | ok | not executed |
| ISO-01 | Unit tests must not touch real databases or services | `.github/workflows/backend-tests.yml` comments | M | test suite | — | socket guard on every run | `harness/netguard.py` | 0 blocked attempts; F-03 found by timing | — |
| SOD-01..n | Maker-checker, segregation of duties, idempotency, money guards, etc. | many routers | H | — | — | — | ~190 existing contract/unit test files | 1,726 pass | Logic-level with mocked DB only; real SQL not exercised |
