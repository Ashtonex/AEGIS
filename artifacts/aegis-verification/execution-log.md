# Execution log (2026-11-19)

Everything ran from the sandbox copy (no `.env`) with `harness/sbxenv.sh` and `-p netguard`, unless noted.

| # | What | Command (abridged) | Exit | Duration | Outcome |
|---|---|---|---|---|---|
| 1 | Repo state | `git rev-parse HEAD; git status` | 0 | — | 972ab60, 9 modified + 4 untracked user files (left untouched) |
| 2 | Destination check | read `core/config.py` and the `.env` variable **names** only | — | — | `.env` = production DB + live keys, so the sandbox was used |
| 3 | Baseline backend | `pytest -q -p netguard -rfEs --durations=15` | 0 | 1,739 s | 1,726 passed / 30 skipped |
| 4 | Route audit | `python harness/route_audit.py routes.json` | 0 | ~60 s | 1,182 ops, 27 without auth dependency |
| 5 | Auth sweep | `python harness/auth_sweep.py routes.json auth_sweep.json` | 0 | 156 s | 3,465 requests: anon 1155×401, junk 1155×401, alg=none 1155×503; 0×2xx |
| 6 | Isolated slow test | `pytest tests/test_email_redirects.py` | 0 | 9 s | 2 passed (6.6 s for the slow one) |
| 7 | F-01 reproducer before fix | `pytest tests/test_whatsapp_webhook_signature.py` (old router) | 1 | 8.5 s | 3 failed / 3 passed |
| 8 | F-01 after fix | same + `test_crm_communications_contract.py test_twilio_whatsapp.py` | 0 | 8 s | 30 passed |
| 9 | F-02 reproducer before fix | `pytest tests/test_public_rate_limit_keying.py` | 1 | 36 s | 7 failed / 1 passed (the control passed) |
| 10 | F-02 after fix + neighbours | `+ test_public_intake_contract test_auth_verification test_portal_login_contract test_production_hardening_contract` | 1 | 177 s | 42 passed, 1 failed: a test defect (422 body); test corrected |
| 11 | Registration test, before / after | `-k registration` against the old / fixed `auth.py` | 1 / 0 | 40 s / 36 s | fails before, 8/8 pass after |
| 12 | Static check | `ruff check --select F` on the 3 changed routers + 2 new tests (repo venv, no execution) | 0 | — | clean |
| 13 | Frontend unit tests | `node --test …` (repo `aegis-web/`, read-only) | 0 | 1 s | 20 passed |
| 14 | Frontend typecheck | `npx tsc --noEmit` (repo `aegis-web/`) | 0 | 147 s | clean |
| 15 | Final backend regression | `pytest -q -p netguard -rf` on the fixed code | 0 | 276 s | **1,740 passed / 30 skipped / 0 failed** |
| 16 | F-03 after fix | `pytest tests/test_email_redirects.py tests/test_email_delivery_address.py` | 0 | 9 s | 18 passed, 0.03 s |

The netguard logs for runs 3-16: no file was created, so no blocked attempts were recorded.

Changes made (all uncommitted; nothing pushed):
- `imperium-api/routers/crm_communications.py`: Meta webhook fails closed; malformed JSON returns 400 (F-01).
- `imperium-api/routers/auth.py`, `imperium-api/routers/public_intake.py`: `key_func=get_remote_address`
  on 8 anonymous limits (F-02).
- `imperium-api/tests/test_whatsapp_webhook_signature.py` (new), `tests/test_public_rate_limit_keying.py`
  (new), `tests/test_email_redirects.py` (DB isolation, F-03).
- `artifacts/aegis-verification/**` (this report, harness scripts, evidence JSON).
