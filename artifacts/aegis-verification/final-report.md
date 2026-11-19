# AEGIS verification — final report (2026-11-19)

## 1. Overall status: **PASS_WITHIN_TESTED_SCOPE**

Every executed check passes after the fixes. Two confirmed product defects (F-01, F-02) and one test
defect (F-03) were fixed, each with a regression test that fails before the fix and passes after it.
F-04 is unverified (it needs an infra check) and is not counted as a confirmed defect. The tested scope is
narrow: **no real-SQL execution, no valid-identity RBAC/tenant matrix over HTTP, no frontend build or
browser tests.** See §8.

## 2. Revision and working tree

`972ab608` on `feat/ui-dialog`. The user's pre-existing uncommitted changes were not modified:
`.claude/launch.json`, `aegis-web/src/components/site-operations/{ActiveDailyReport,SiteEvidenceCapture}.tsx`,
`aegis-web/src/lib/api/procurement.ts`, `aegis-web/src/lib/offline/{db,types}.ts`,
`imperium-api/routers/{documents,site_reconciliation,site_reports}.py`, plus the untracked `.codex/`,
`hero-assets/` and two scripts. The backend suite ran on a copy that **includes** those edits.
This run's own edits are listed in `execution-log.md`. Nothing was committed or pushed.

## 3. Environment and commands

Windows 11; Python 3.14.6; Node 24.18. The production `.env` was excluded. Dummy settings, dead loopback
ports, and a socket guard refusing all non-loopback traffic were used throughout (zero attempts logged).
Every command is in `execution-log.md`.

## 4. Test counts

| Suite | Passed | Failed | Skipped | Blocked |
|---|---|---|---|---|
| Backend pytest, final | 1,740 | 0 | 30 | 30 Postgres-opt-in tests (no isolated DB) |
| Backend pytest, baseline | 1,726 | 0 | 30 | same |
| HTTP auth sweep (3,465 requests over 1,155 routes) | 3,465 refused (no 2xx) | 0 | — | the valid-token path |
| Frontend unit | 20 | 0 | 0 | — |
| Frontend typecheck | clean | — | — | — |

## 5. Coverage measured

No statement or branch coverage tool was run (`pytest-cov` is absent). What was measured: 100% of mounted
authenticated HTTP operations were exercised for anonymous, junk-token and `alg=none` rejection, and 27/27
public operations were reviewed. Everything else is indirect coverage via the existing suite and is not
quantified.

## 6. Critical / high findings

None found **in the tested scope**. Two Medium findings:
- **F-01**: the Meta WhatsApp webhook accepted unsigned posts when no app secret was set.
- **F-02**: the login, registration, refresh and public-form rate limits were bypassable with a rotating
  junk bearer header.

## 7. Verified fixes

F-01, F-02 and F-03, with before and after evidence (`findings.md`, `execution-log.md` rows 7-11 and 15-16).

## 8. Untested or partially tested

Real SQL and RLS, the RBAC and tenant matrix with valid identities, concurrency and idempotency on
Postgres, migrations, workers and queues, the frontend build, lint and browser flows, live external
adapters, performance, dependency advisories. See `coverage-gaps.md`.

## 9. Auth boundaries actually exercised

- **A** (core with injected identity): existing contract tests, mocked DB.
- **B** (policy at the boundary): webhook handler (F-01); existing RBAC tests.
- **C** (real middleware and credential validation over HTTP): missing, malformed and `alg=none` tokens
  on every authenticated route; rate-limit middleware on anonymous routes.
- **D** (end-to-end login): **not tested**. It needs Supabase Auth and was blocked.

## 10. Remaining risks and next commands

1. Deploy note for F-01: set `WHATSAPP_APP_SECRET` before ever switching `WHATSAPP_PROVIDER` to `meta`.
2. F-04: confirm the droplet exposes port 8000 only through Caddy, and that Caddy overwrites `X-Forwarded-For`.
3. Next run: build an isolated PG17 replica, then run the Postgres opt-in tests, then a valid-identity
   RBAC/tenant HTTP matrix (`resume-prompt.md`).
4. Re-run the targeted reproducers from the sandbox:

```bash
python -m pytest -q -p netguard tests/test_whatsapp_webhook_signature.py tests/test_public_rate_limit_keying.py tests/test_email_redirects.py
```
