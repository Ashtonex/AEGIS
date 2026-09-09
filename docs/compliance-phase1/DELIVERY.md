# Phase 1 delivery, backlog and assurance plan

## Current phase definition

Phase 1 is repository discovery and architecture only. In scope: all fourteen architecture deliverables, explicit control contracts and sequenced implementation. Out of scope: runtime changes, deployed migrations, new UI, actual legal applicability decisions and production certification. The user's architecture review and end-of-phase approval are prerequisites for Phase 2.

User stories and acceptance criteria:

| ID | Story | Acceptance / planned executable evidence |
|---|---|---|
| U01 | Compliance Officer identifies obligations for every subject | Versioned source/rule/assessment links; unknown scope remains unresolved; tests T01–T04 |
| U02 | Owner supplies proof; another actor verifies | Exact retained document version, criteria and independent decision; T05–T08 |
| U03 | Project Manager sees whether work may start | Mandatory current requirements plus hard blockers; no percentage override; T12–T15 |
| U04 | Director can approve a lawful, bounded exception | Authority, evidence, independent stages and expiry; T09–T10 |
| U05 | Auditor traces a reported status back to proof | Immutable decisions and exports reconcile to source; T16–T18 |
| U06 | Procurement/Finance prevent ineligible transactions | Supplier, PO and payment execution gates; T13 |
| U07 | Control officer confirms remediation works | Independent effectiveness review precedes closure; T11 |
| U08 | Legal reviewer evaluates a regulatory change | Human source, applicability, impact and plan decisions; T19 |
| U09 | Tenant administrator delegates safe access | Configurable capabilities, scope, conflict detection, server and DB denial; T01–T03 |

Entities are specified in DATA_MODEL.md; permissions, transitions and approvals in CONTROLS.md; events, interfaces and reports in INTERFACES.md. Phase 1 acceptance means the proposed design has traceable coverage and a reproducible assessment. It does not mean those runtime controls pass.

## File-level implementation plan

Paths are repository-relative, proposed unless marked existing. Do not reserve migration numbers now. Re-read local AGENTS.md and affected skill instructions before implementation.

| Layer | Files / actions | Acceptance dependency |
|---|---|---|
| Migration | `imperium-api/migrations/<allocated>_compliance_foundation.sql`; matching CLI-generated `supabase/migrations/<allocated>_compliance_foundation.sql` | Reconcile ledger and duplicates; composite tenant FKs, restricted runtime role, checks, append-only triggers, permissions; disposable DB upgrade passes |
| Database access | Existing `imperium-api/core/database.py`; extract shared context from `app/shared/workforce_transactions.py` into `app/shared/tenant_transactions.py` only after workforce regression | Separate privileged auth lookup from restricted domain sessions; bind context on every transaction |
| Model/repository | `imperium-api/app/services/compliance/repository.py`, `types.py` | Parameterised SQL and typed result records follow current SQL conventions; no duplicate ORM/master entities |
| Validation | `imperium-api/schemas/compliance.py` | Strict dates/UUIDs, bounded declarative rules, immutable fields rejected |
| Domain service | `imperium-api/app/services/compliance/foundation.py`, `transitions.py`, `applicability.py` | Atomic commands, version locks, source and subject validation |
| API | `imperium-api/routers/compliance.py`; existing `routers/compliance_items.py`, `main.py` | New routes and legacy adapters share guards; gateway permission mapping tested |
| Permissions | Migration inserts into `core.permissions`; existing `core/security.py`; `app/services/compliance/permissions.py` | Capability + subject/project/classification scope; administrator SoD cannot bypass |
| Approvals | Existing `app/services/workflow_service.py`; `app/services/compliance/approvals.py` | Exact target version/hash, independent ordered decisions, atomic domain update |
| Events | Existing `app/shared/events.py`, `app/services/workforce_events.py`; generalised `app/services/domain_event_delivery.py` if needed | One Core outbox and receipt system; stable replay and crash recovery |
| Jobs | `imperium-api/app/workers/compliance_jobs.py`; existing `app/workers/arq_worker.py` | Tenant scoped dispatch in Phase 2, recurrence/expiry in Phase 3; no inline external side effects |
| UI | Existing `aegis-web/src/app/dashboard/compliance/page.tsx`, `[tab]/page.tsx`; new `components/compliance/ObligationRegister.tsx`, `ObligationDetail.tsx`, `ApplicabilityAssessment.tsx`, `ComplianceAdmin.tsx` | Real connected Phase 2 forms, transitions, history, mobile/error states |
| API client/navigation | Existing `aegis-web/src/lib/api.ts`, `dashboard/DashboardShell.tsx` | Preserve unrelated edits; typed clients and capability-driven navigation |
| Tests | `imperium-api/tests/test_compliance_foundation.py`, `test_compliance_foundation_postgres.py`, `test_compliance_legacy_guards.py`; `aegis-web/tests/compliance-foundation.spec.ts` | Positive and adversarial API/DB/browser cases, no string-only proof of security |
| Documentation | `docs/compliance-phase1/*`; future `docs/compliance-phase2/DELIVERY.md` | Exact commands, results, migrations and limitations per phase |

Later-phase service files under `app/services/compliance/`: Phase 3 `evidence.py`, `calendar.py`; Phase 4 `credentials.py`; Phase 5 `projects.py`, `gates.py`, `exceptions.py`; Phase 6 `third_parties.py`; Phase 7 `inspections.py`, `findings.py`; Phase 8 `policies.py`, `regulatory_changes.py`; Phase 9 `reporting.py`; Phase 10 adapters in existing owning routers/services. Each phase adds corresponding strict schemas, focused API routes, connected frontend components and API/Postgres/browser tests. New files are created only in the approved phase.

## Ordered implementation backlog

| Phase | Backlog and exit criteria | Dependencies / excluded work |
|---|---|---|
| 2 Foundation | Reconcile schema, fix C01/C03/C04 on affected paths; source/domain/authority register; versioned obligations/rules; assessment/assignment; Core approval, permissions, tenant isolation and audit; connected register/admin/history | Requires architecture approval and stable workforce shared services. No calendar, evidence acceptance or operational gate claims yet |
| 3 Calendar/evidence | Recurrence, reminders, escalation, immutable document version contract, independent verification, stale-proof invalidation, evidence history | Resolve C02/C07 for evidence paths; no certificate lifecycle completion claim |
| 4 Credentials | All five credential types, renewal, verification, expiry/restriction and retained versions | Existing equipment/employee references; no user-supplied verified state through legacy routes |
| 5 Projects | Versioned templates/plans, applicability, mandatory readiness, blockers, lawful override subset, stop-work and closeout | Resolve C05/C06 for project path; exception approval infrastructure must precede overrides; later Phase 8 extends policy/legal workflows |
| 6 Third parties | Profiles, required matrix, tax/insurance/qualifications, conditional approval/suspension/blacklisting decisions and control events | Party ownership remains Procurement/CRM; blacklisting requires reason, authority, scope, review/appeal record; Finance executes payment controls |
| 7 Inspections/findings | Programmes/checklists/results, severity/escalation, root cause, action plan, remediation, independent effectiveness, repeat detection | Extend existing CAPA; read HSE inspections without taking ownership |
| 8 Policies/changes | Controlled versions, approval/distribution, employee assignment, acknowledgement/training, policy exceptions, regulatory source/impact/plan/human decisions | Documents and HR authoritative; no AI decision authority |
| 9 Reports | All dashboards, scoped approval/exception centres, reconciled reports/PDF/spreadsheets and audit/tender packs | Resolve C08; all source status projections implemented; use common snapshot query |
| 10 Final assurance | All seven operational gates, Risk/Document/Executive events, cross-module reports, crash/concurrency and browser tests | End-to-end operation enforcement, not merely emitted events; no High/Critical defects allowed |

Each phase follows inspect -> define -> file plan -> backend -> backend tests -> connected UI -> workflow verification -> adversarial tests -> corrections/regressions -> release gate -> report -> stop for approval. Re-inspection is mandatory because the working tree has active changes. Do not run all phases together.

## Test strategy and adversarial cases

Use disposable PostgreSQL seeded with at least two tenants, overlapping human role combinations, separate originator/subject/verifier/director, restricted personal/legal records, two projects per tenant, and controlled time. Execute RLS checks under the actual restricted runtime role, not database owner. API fixtures override infrastructure only where the test is a unit test; DB/concurrency tests use real transactions and constraints. Redis/Arq tests include real transport for delivery acceptance. Browser tests use persisted fixture records and real APIs in a disposable environment.

| ID | Cases and expected result |
|---|---|
| T01 | Cross-tenant GET/list/search/export/download/POST FK injection denied; same-tenant project-scope violation denied; direct SQL with missing/other tenant context returns no rows/rejects writes |
| T02 | Direct API without capability, revoked capability and administrator self-approval denied; no role-name-only access; user-supplied tenant ignored/rejected |
| T03 | Pool reused across tenants, rollback and worker tenant switch do not leak context; runtime role cannot update/delete audit; parent FK tenant mismatch fails |
| T04 | Invalid date range, overlapping approved rule versions, unknown applicability, N/A without reason/approval, AI approval attempt and stale approval target rejected |
| T05 | Self-verification by submitter/subject/delegate rejected, including combined-role and legacy API attempts; independent valid verification succeeds |
| T06 | Accepted evidence replacement/deletion denied; successor preserves original file version/digest and previous decision; changed content requires fresh approval |
| T07 | Expired, revoked, unscanned, wrong issuer, wrong subject and missing mandatory evidence cannot produce compliance; date/timezone boundary and null validity cases tested |
| T08 | Same idempotency key/payload returns same result; different payload conflicts; concurrent submit/approve creates one decision, no duplicate alert/event |
| T09 | Exemption missing authority/justification/evidence/expiry denied; non-waivable requirement cannot be exempted; each required legal/risk/director stage uses independent actor |
| T10 | Backdated approval rejected; expired/revoked/out-of-scope exception cannot clear gate; expiry racing with approval remains blocked |
| T11 | Closure without remediation or successful independent effectiveness denied; failed review reopens; critical finding cannot be suppressed by downgrade/delete; escalation reaches independent recipient |
| T12 | Project mobilisation without clearance, with unknown applicability or active stop-work denied; approved release does not bypass remaining blockers |
| T13 | Supplier approval with expired requirements, PO to ineligible party and payment execution to suspended party denied; stale prior approval does not allow execution |
| T14 | Plant assignment with expired asset/operator proof and worker deployment with missing compliance denied; planned interval extends beyond expiry -> blocked |
| T15 | Concurrent operation and evidence revocation serialized/rechecked; no partial operational write committed by gate failure; denial audit persists independently |
| T16 | Audit update/delete and cascaded history removal denied through SQL/API; signed downloads enforce classification; ordinary exports contain no restricted legal/personal content |
| T17 | Duplicate/out-of-order events, crash before/after commit/publish/ACK, Redis outage and retry exhaustion preserve exactly one business effect; stale event cannot restore compliance |
| T18 | Dashboard -> detail -> PDF/spreadsheet counts reconcile under same snapshot; zero denominator never fabricated 100%; packs preserve versions and disclose exclusions |
| T19 | Regulatory source/interpretation/plan requires human approval; implementation without evidence rejected; policy acknowledgement pins version and cannot impersonate employee |
| T20 | Every screen at 360px/desktop supports loading/empty/error/denied/search/filter/history/export; submit persists across reload; stale optimistic update handled; keyboard workflow works |
| T21 | Migration upgrade from representative existing schema preserves tenant counts/history; unresolved owners quarantined; rollback/forward repair rehearsed without deleting proof |

For every failure record severity, root cause, correction, regression test and rerun output. Do not weaken a control to pass tests. Existing source-string contract tests are a baseline only and do not establish runtime authorisation, database isolation or operational gate enforcement.

## Release verification commands

Run commands appropriate to changed code in each implementation phase from its directory; exact supported options must be checked locally. Planned backend commands: `.venv/Scripts/python.exe -m pytest tests/test_compliance_<phase>.py` plus relevant Postgres/legacy/owner tests, `python -m ruff check <changed paths>`, and `python -m mypy <changed paths>`. Run the existing migration preflight after checking its CLI help, then apply/reapply as supported to a disposable restored DB and inspect constraints/roles. Planned frontend commands: `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm run check:nav`, and configured browser suite against the disposable API. Verify Playwright runner setup rather than assuming an npm test script exists.

Full release matrix: migration validation, units, integration, permissions, tenant isolation, state machines, workflows, event delivery, type checking, lint, production build and E2E. For Phase 1, application build/migration/runtime tests are not acceptance of an unimplemented module; document them as not run rather than passing. Run existing relevant baseline tests and package link/coverage checks. No release with unresolved High/Critical implementation issues. Medium/Low conditions need owner and resolution criteria.

## Phase 1 release report

1. **Phase completed:** discovery and architecture authored; formal user review remains pending.
2. **Requirements delivered:** all fourteen requested architecture deliverables across five Markdown documents, including 24 event contracts, 19 role templates and all six status machines.
3. **Architecture decisions:** reuse platform ownership and infrastructure; tenant-scoped subject references; immutable versions; independent approval; evidence-derived status; transactional gates/outbox.
4. **Database changes:** none; proposed schema and migration approach only.
5. **Backend changes:** none.
6. **Frontend changes:** none.
7. **Permission changes:** none applied; proposed capability and SoD matrices.
8. **Workflow changes:** none applied; version-bound approval and transition contracts specified.
9. **Events added:** none implemented; all required events catalogued with producers/consumers and delivery contract.
10. **Tests added:** no application tests, because Phase 1 prohibits implementation; planned cases T01–T21 cover future acceptance.
11. **Commands executed:** repository `git status --short`, `rg --files`/`rg -n`, PowerShell file reads and dependency discovery; focused pytest baseline and documentation integrity verification (results below).
12. **Test results:** see verification evidence below; these do not certify runtime compliance controls.
13. **Files changed:** only new `docs/compliance-phase1/README.md`, `DATA_MODEL.md`, `CONTROLS.md`, `INTERFACES.md`, `DELIVERY.md` in this task.
14. **Issues identified:** C01–C07 High existing-control gaps; C08–C10 Medium source/integration gaps. Runtime deployment state unverified.
15. **Corrections completed:** architecture specifies remedies and phase dependencies; no production defect claimed corrected. Resume reinspection found new Finance data-room work and preserved it along with Workforce changes.
16. **Remaining limitations:** architecture not approved; no new module capability running; live schema/role identity, document immutable-version contract and shared-service baseline require implementation-phase verification.
17. **Release decision:** REJECTED PENDING CORRECTION for functional module release because High gaps remain. Architecture package is submitted for review; document checks do not authorise release or waive the human gate.
18. **Recommended next phase:** approve this architecture, then Phase 2 Compliance foundation, one phase at a time.

## Verification evidence

Verified 2026-09-08:

- From `imperium-api`: `.\.venv\Scripts\python.exe -m pytest tests/test_workforce_compliance_gate_contract.py tests/test_supplier_compliance_documents_contract.py tests/test_documents_contract.py -q` — **23 passed in 9.10s**, exit 0. These are existing source contract tests, not runtime tenant/permission or E2E validation.
- An inline Python package check parsed the five Markdown files, resolved relative Markdown links, checked balanced fenced blocks and asserted 24 unique required event rows, 19 role rows and six state-machine rows — **PASS**.
- `git diff --check` checked tracked working-tree diffs; new package files were checked separately for links/fences. Existing unrelated files generated LF/CRLF warnings; they were not rewritten by this task.
- Application migration execution, DB permission tests, concurrency tests, type checking, lint, production build and E2E were **not run for this documentation-only phase**. No claim of functional-module acceptance is made.
- Review confirmed all fourteen Phase 1 deliverables: repository/boundaries in README; ER/database in DATA_MODEL; permission/SoD/status/approval matrices in CONTROLS; event/API/screen/report inventories in INTERFACES; test strategy and file-level backlog here.
