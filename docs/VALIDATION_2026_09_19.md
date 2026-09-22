# Repository validation — 19 September 2026

**Release assessment: blocked.** This report consolidates the resumed validation; it does not certify every production workflow.

Current baseline: `24dccbf3836df2adeffa45d2faca1c421a2cdaca`. Earlier isolated evidence is retained under `scratch/validation-20260915/`, based on `9f696024ef38e9ebfbe7a8ebdccd4307ce01a3a7` plus the captured patch and untracked source. Other tasks were editing and committing during that earlier run, so it was moved into a detached checkout. The September 19 run checks the newer baseline directly; initial dirty files were local tool settings and generated frontend declarations/version metadata.

## Findings requiring action

### P1 — cached identities bypass account revocation

`imperium-api/core/security.py:408` reads `auth:identity:{user_id}` and skips both the authoritative account-status lookup and role lookup on a hit. A previously cached SUPERADMIN remains a SUPERADMIN after deactivation/deletion or role removal, until the 300-second cache expires. Permission grants have their own 300-second cache. Settings mutation routes do not invalidate these cache entries.

Local probe: a database mock returning `is_active=False` was rejected with HTTP 403 on a cache miss, but the same request returned cached SUPERADMIN on a hit without querying `core.users`. This confirms the control-flow regression; it is not a live-account exploitation test. The delay is explicitly noted in a source comment, but the account-disable/delete paths provide no immediate revocation mechanism. Use authoritative status checks or a coherent revocation/version mechanism across workers, and test deactivation, deletion, role removal and permission removal with warm caches.

### P1 — duplicate SharePoint uploads can change an already verified file before returning 409

`imperium-api/routers/data_room.py:819` uploads the content before inserting its metadata. Small uploads use the name-addressed content PUT in `app/services/microsoft/sharepoint.py`; the duplicate item constraint is checked only after the external write. If a filename already exists, its content can be replaced and the subsequent INSERT rejected. The caller receives 409, but rollback cannot restore SharePoint bytes, and the existing metadata can still say the old document is verified.

Local probe: a mocked upload replaced an existing remote payload, then the metadata INSERT raised `IntegrityError`; the endpoint returned 409 with the replacement still present. The replacement semantics follow the [Microsoft Graph upload/replace API](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0). Prevent overwrite atomically at the storage boundary, or implement an explicit revision workflow that invalidates old verification and records the new version. A pre-upload existence check alone does not close the race.

### P2 — malformed cache entries become request failures

`imperium-api/core/cache.py:54` and `:72` decode JSON outside the exception handler. Redis transport failures return a cache miss, but malformed cached JSON raises `JSONDecodeError` through authentication instead of falling back. Confirmed using a mocked Redis GET. Move decoding into the guarded path and validate the expected value shape at each cache consumer. This is a reliability finding; no attacker-controlled Redis write was established.

### P2 — new test workflow does not gate deployment

`.github/workflows/backend-tests.yml` and `.github/workflows/deploy-backend.yml` independently trigger on pushes to main. The deploy workflow has no test dependency or successful-workflow condition. A test failure does not prevent deployment by the workflow itself. Gate deployment on the successful tests for the exact commit being deployed. Remote branch protection was not inspected.

## Earlier findings and repairs

- The corrupted dashboard shell and the workforce engagement SQL parameter bug were repaired in the earlier run. The shell is now readable source.
- Data-room migration/permission registration has moved into the API migration corpus; the strict preflight now covers 225 migration files.
- The current export implementation sanitizes ZIP paths, escapes HTML, and emits a separate `.MISSING.txt` notice with `retrieval_status=missing` instead of claiming unavailable evidence was verified.
- The FinanceAssistantPanel JSX escaping failure from the September 15 snapshot is fixed in the current baseline.
- The earlier Node 24 build attempts were outside the declared `>=20 <23` engine range. A portable Node 22.23.2 archive was downloaded from nodejs.org and checked against its published SHA-256 digest for the current build attempt.

## Checks and evidence

Current command logs are in `scratch/validation-20260919/`. Local behavioral probes are in `probe-current.py` and `probes.log`; they mock database, Redis and Storage calls and do not change customer records or SharePoint files.

- Strict migration preflight: 225 files, zero errors, zero warnings, nine informational findings.
- The September 15 isolated suite completed: 926 passed, 3 failed, 29 skipped, 15 subtests passed. Failures were an obsolete migration-number assertion, an executive forecast test requiring live inventory records, and a test asserting a development environment while the isolated run used testing.
- September 15 navigation: 59 static dashboard routes passed. Production dependency audit: zero reported vulnerabilities at that time.
- The current backend rerun uses localhost-only database/Redis endpoints and development/CORS settings matching the existing settings assertion. It does not use a hosted database to make a data-dependent test pass.

Current backend result: **927 passed, 2 failed, 29 skipped, 15 subtests passed** (233.30 seconds). The remaining failures are:

1. `tests/test_cash_forecast_contract.py:35`: the phase-specific test rejects migration 198 even though that later migration adds the corporate credentials vault. It must check the intended cash-forecast schema contract rather than prohibit unrelated future migrations.
2. `tests/test_executive_extensions.py:37`: the test asserts a nonempty materials forecast without supplying an inventory fixture or overriding the database. With the intentionally unreachable local database, the endpoint reports a source failure and returns no rows. Make the test deterministic with a fixture, and separately assert the unavailable-source response.

CI parity caveat: this rerun explicitly supplied `ALLOWED_ORIGINS=http://localhost:3010` to satisfy `test_standardized_stack.py:17`. The backend workflow does not supply that variable, while `Settings` defaults to localhost:3000. That test remains environment-dependent and can produce an additional CI failure. Test settings parsing using an explicit `Settings` fixture instead of asserting developer-machine configuration.

The current npm production-dependency audit was **unavailable**: registry.npmjs.org returned HTTP 503 for maintenance. The earlier clean audit is historical evidence, not a current clean result.

Frontend lint passed with no diagnostics. The production wrapper's full TypeScript check and production build both passed under Node 22.23.2 (exit 0). Next.js compiled successfully, generated all 35 static pages, and completed page optimization. Build evidence is in `build-node22.log`; this confirms buildability, not authenticated runtime behavior.

Navigation validation initially read the old `DashboardShell.tsx` location after `MODULE_GROUPS` had moved into `src/lib/navigation.ts`, creating false failures across the dashboard. The checker was repaired to read the actual shared configuration. Its rerun now identifies six static routes without sidebar entries: `/dashboard/finance/cash-accounts` and `/dashboard/projects/{assign,controls,dashboard,documents,team}`. These are navigation-policy failures, not proof that the routes cannot be reached through in-page controls. Add appropriate sidebar links or document intentional contextual-only routes in the allowlist after reviewing their navigation paths; no blanket allowlist was added.

## Coverage limits

The structured security scan launcher returned “The selected scan target changed while the scan was starting.” No structured scan completion or SARIF report is claimed. The findings above come from local code review and the explicit probes.

No deployment, production migration, authenticated browser workflow, live SharePoint write, full PostgreSQL migration replay, or load test was performed in the resumed run. PostgreSQL opt-in tests remain distinct from mocked/contract tests. The earlier workforce integration suite had passing evidence for all 14 tests across its retry and targeted SQL-fix rerun; those historical results do not validate every later workforce/compliance phase.
