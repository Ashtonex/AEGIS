# Repository validation — 8 September 2026

Release verdict: **BLOCKED**. Validation is not a claim that every route or production workflow works.

Scope: working-tree updates relative to `9a31613`, including untracked workforce foundation, financial data room, migrations and document-generation scripts. No repository-defined “scorched earth” procedure was found in the searched instructions/docs. Validation preserved user work and did not deploy or run production migrations.

## Repair made during validation

`aegis-web/src/app/dashboard/DashboardShell.tsx` consisted of 49,318 NUL bytes. This broke compilation and all sidebar source checks. The exact damaged file was preserved at `scratch/validation-20260908/DashboardShell.corrupt.bin`; the last committed source was restored, with links added for People Register and Financial Data Room. The lost uncommitted shell implementation cannot be reconstructed from zero bytes. A scan of tracked and untracked source/configuration files found no other NUL-containing files.

The local PostgreSQL tests also exposed an ambiguous bind-parameter type in `imperium-api/app/services/workforce_foundation.py:505`: engagement status was inferred as both text and varchar. Explicit varchar casts now make the UPDATE consistent; the failing engagement lifecycle test passes against PostgreSQL after the repair.

## Release blockers found

1. **Data-room migration is outside the API migration runner's corpus.** `imperium-api/tests/test_rbac_acceptance.py:275` fails because all five `finance.data_room.*` permission keys are absent from `imperium-api/migrations`. They exist only in `supabase/migrations/20260908000000_snc_financial_data_room.sql`. The new router is registered unconditionally. The documented API migration path will not provision these tables/permissions. Integrate the migration into the authoritative deployment sequence and verify an upgrade on an isolated database.

2. **Storage object ownership is not checked.** `imperium-api/routers/data_room.py:493` accepts arbitrary `storage_path` values, stores them, and `:641` signs that path using the service-key Storage client (`core/database.py`). An upload-authorized user who knows another object's path can register it under their own organization and request a signed URL. Row scoping on the metadata record does not establish ownership of its binary object. The frontend currently uses a shared `documents/data-room/` path. Bind uploads to authenticated tenant/owner records and validate this binding before registration, signing and export.

3. **New data-room tables omit database access controls.** The data-room migration creates `finance.data_room_folders`, `finance.data_room_documents` and `finance.bankability_checklists` without RLS or explicit grant/revoke review. Actual external exposure depends on deployed schema/default privileges, which were not inspected. Define tenant policies and intended Data API privileges before release.

4. **Export invents evidence when storage retrieval fails.** `imperium-api/routers/data_room.py:888` substitutes text headed “VERIFIED ASSET RECORD” and states that the missing binary was validated. It writes this text under the original filename, potentially a PDF/XLSX. Fail the export or explicitly record a missing attachment under a separate text filename; do not label unavailable evidence verified.

5. **Export paths and HTML contain untrusted text without validation/escaping.** `imperium-api/routers/data_room.py:875` constructs ZIP entry paths from supplied folder/filename values; `:929` embeds titles, paths and other fields directly in HTML. Reject traversal/absolute paths and escape HTML text, including the export scope. Otherwise hostile metadata can produce unsafe archive entries and active content when the offline index is opened. These were source-level findings, not attacks against production.

## Verification results

| Check | Result |
| --- | --- |
| Full backend `pytest tests -q` | 507 passed, 3 failed, 14 skipped; 15 subtests passed. Two failures loaded the corrupt shell before repair. |
| Role/RBAC rerun after repair | 35 passed, 1 failed. Only the data-room permission migration assertion remains. |
| Navigation `npm run check:nav` | Passed: all 57 static dashboard routes linked. |
| API migration preflight | Passed: 182 files, 0 errors, 0 warnings, 9 informational findings. Does not include the data-room migration. |
| Production dependencies `npm audit --omit=dev --audit-level=high` | 0 reported vulnerabilities. |
| First frontend build | Failed on NUL bytes in DashboardShell; repaired and rerun. |
| First opt-in PostgreSQL suite | 6 passed, 8 failed; failure exception was database startup/unavailability. Retried after readiness probe accepted connections. |

Additional results:

- Python AST parsing: all 268 tracked/untracked Python files parsed successfully.
- Full frontend lint rerun: `npm run lint` passed with exit 0 and no diagnostics.
- Direct static validation of the data-room migration: 9 warnings (RLS, policies, grant/revoke coverage across its three tables).
- PostgreSQL retry after server readiness: 13 passed, 1 failed on the engagement SQL parameter bug. After the cast repair, the failing test passed (1 passed, 13 deselected). All 14 tests therefore have passing evidence across these runs; this was not a single final full-suite run.
- Repaired frontend: the production wrapper passed TypeScript checking, but compilation exited without a diagnostic, including its built-in retry (wrapper exit -1). Alternate webpack build attempted for diagnosis; result below.
- `git diff --check`: passed after preserving generated quotation test outputs in scratch and restoring the previously clean tracked generated files. The build regenerated `public/version.json`.

Local command logs are under `scratch/validation-20260908/`.

## Limits

The working tree changed concurrently during validation: compliance foundation services/routes/schemas, migration 177 and its Supabase counterpart, compliance PostgreSQL tests, WorkforceEngagements.tsx and changes to workforce security tests appeared after the initial inventory. Earlier test totals do not cover these later additions. `scratch/validation-20260908/file-hashes.json` records a later file inventory for comparison, not an immutable tested commit.

No authenticated browser workflows, hosted Storage behavior, production runtime-role provisioning or complete production migration replay were verified. Data-room contract tests check source strings, not upload/download authorization or archive contents. Document-generator scripts were not executed as a batch because they write artifacts; syntax validation alone does not validate their generated documents. No claim is made that the broader planned workforce phases are implemented by this increment.
