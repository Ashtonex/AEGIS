# Phased delivery, acceptance and verification

## 1. Delivery control

Phase 1 produces the architecture/specification. On 5 September 2026 the owner authorised correcting Phase 1 issues and proceeding through Phases 2–11 sequentially to completion. Separate permission at each phase is no longer required. Each phase must still pass its technical release gate before the next begins; production business-policy choices remain explicit and no named role grants or personnel imports are inferred.

Within an approved phase: inspect current changes → define stories/guards/evidence → plan files → implement backend → fix backend test failures → implement UI → connect real workflow → review and attack → correct/regress → release gate → report. Approval for a phase does not permit overwriting unrelated work or bypassing any listed control.

## 2. File-level implementation backlog

Names in this table are proposed extension points, not files created in Phase 1. New migration numbers/timestamps are allocated only when implementation is approved, using the current ledger and CLI conventions; do not preassign numbers that may collide with other work.

| Phase / dependency | Database and backend file plan | Frontend, jobs and documentation plan | Acceptance exit |
|---|---|---|---|
| 2A Shared safeguards, first within foundation | Additive migration under `imperium-api/migrations/` with reviewed `supabase/migrations/` mirror; runtime tenant policies/composite FKs/explicit audit coverage. Extend `core/database.py`, `core/security.py`, `app/shared/events.py`; standardise `app/services/workflow_service.py` on existing Core approval tables. Add shared transaction/command receipt and approval-decision support. Do not activate new workflow writers before guards pass. | Permission catalogue and scoped denial behaviour in `lib/api.ts`, auth helpers and dashboard navigation. Wire shared dispatcher/receipt jobs in `app/workers/arq_worker.py` only after infrastructure tests. Document DB role rollout, event replay and audit grant procedure. | Direct DB tenant denial, HTTP action checks, immutable audit, SoD, atomic command/event tests pass |
| 2B Workforce foundation | Extend `routers/workforce.py` compatibility facade; introduce `routers/workforce_people.py`, `schemas/workforce_people.py`, `app/services/workforce/people.py`, `availability.py`, `organisation.py`. Reuse HR reporting/training/docs, add category/position/engagement references. HR-owned verification stays in HR services/routes. | `/dashboard/workforce/people`, `/organisation`, profile tabs/history; use existing table/form tokens. Add precise API types; update `WorkforceOperations.tsx` only where compatibility requires. Documentation/import mapping and foundation acceptance evidence. | Paginated register, scoped profiles, catalogues, reporting hierarchy, availability, documents and credential status work end to end; no private-field leak |
| 3 Planning/requisitions; depends on Phase 2 and Project programme contract | Extend `hr.workforce_plans`; add items/requisition state; validate Project activity and Finance budget references. `schemas/workforce_planning.py`, `app/services/workforce/planning.py`, `requisitions.py`, `routers/workforce_planning.py`. Add Project-owned package/activity foundation through Projects module, not HR duplication. | Plans/requisitions routes, internal-match evidence and shortage/overstaffing views; approval queue integration; scheduled forecast refresh only if needed. | Approved dated demand → internal search → independently checked requisition; shortages reconcile to qualified available supply |
| 4 Mobilisation/deployment; depends on 2–3, HSE policy | Evolve `hr.project_allocations`; add checklist/roster/site access; extend `core/compliance.py` with caller-owned transaction contract. `schemas/workforce_deployment.py`, services `mobilisation.py`, `deployment.py`, route `workforce_deployment.py`; same-tenant parent checks and exclusion/locking. | Mobilisation/deployment/shift pages; source evidence drilldown; effective-start and expiry recheck jobs; site access consumer adapter. | Two concurrent conflicting deployment attempts cannot both succeed; every active deployment has complete authority/readiness evidence |
| 5 Attendance; depends on 4 | Add attendance verification/correction/revisions and idempotent capture identity. `schemas/workforce_attendance.py`, service `attendance.py`, router `workforce_attendance.py`; compatibility handling for day-level legacy records. | Attendance/site board/disputes/history; narrow existing `public/sw.js`, `components/pwa/PwaRuntime.tsx`, `lib/api.ts` to controlled draft queue; add Workforce capture queue module. No offline approvals. | Capture → sync → independent verification → immutable record/correction works across refresh, network loss, user switch and invalid evidence |
| 6 Timesheets/overtime; depends on 5 plus cost/rate policy | Timesheet entries/OT/rate version and cost source references. `schemas/workforce_time.py`, services `timesheets.py`, `overtime.py`, `costing.py`, `routers/workforce_time.py`; integrate Finance rate/budget and Site Operations cost-source cutover. | Timesheets, entry allocation, OT requests and supervisor/QS/PM review; weekly reconciliation job; no payroll export labelled ready. | Verified minutes cannot be spent twice; unauthorised OT retained but excluded from eligibility; decimal cost reconciles to approved rate/budget |
| 7 Crews/productivity; depends on 6 and output owner | Extend shared team identity for non-login workers, crews/memberships/output assessment. Services `crews.py`, `productivity.py`; schemas/routes; connect `routers/site_reports.py` acceptance and existing corrective action/task service. | Crews/targets/accepted output/cause views; productivity and corrective-action events; unit-safe reports. | Accepted output and labour deduplicate; example calculation reconciles; zero denominators and rework explicitly handled |
| 8 Skills/movements; depends on 4–7 | Extend existing HR training/credential tables; services `competency.py`, `transfers.py`, `demobilisation.py`; route/schema files. Add custody/access/source/destination transactional controls. | Skills matrix/training/transfers/demobilisation/profile performance evidence. Extend alert script into registered Arq jobs; idempotent access revocation/HR/Finance notifications. | Qualification blocks controlled work; movement has both authorities and no overlap; closed deployment cannot retain access |
| 9 Payroll inputs; depends on 6/8 and Finance intake selection | Add input batches/lines/receipts and source uniqueness. Service `payroll_inputs.py`, adapter under `app/services/finance/`; route/schema files. Extend selected Finance payroll intake rather than create pay calculations. | Payroll-input/reconciliation/stage review; Finance receipt/return view; consumer retry/replay tests and documented correction runbook. | One entitlement cannot enter two accepted batches; generation/submit/accept retries do not duplicate; returned/adjusted evidence traceable |
| 10 Dashboards/reports; depends on source phases | Scoped query/report services `app/services/workforce/reporting.py`; route `workforce_reports.py`; indexes/materialised projections only with measured need and tenant-safe access. Reuse existing document renderers/libraries. | All navigation, approval/exception centres, PDF/Excel reports and Executive Command Centre integration; Arq report job, authorised downloads. | All 26 report definitions reconcile; full-scope totals, no page-count KPI, no mixed currency/unit totals; mobile/accessibility passes |
| 11 Release audit; depends on 2–10 | Review migration ledger, DB roles/policies/constraints/triggers, query plans and all API/worker paths; no unreviewed bypasses. | Production build, multi-role/mobile browser suite, restore/rollback rehearsal, signed operational acceptance pack. | No Critical/High issues; all required evidence available; owner-approved rollout/rollback plan |

Pydantic schemas and raw SQL domain services should match the mature repository convention. If SQLAlchemy models are introduced, map the actual schema and shared tables; do not produce unused duplicate ORM entities. Permission changes belong in versioned migrations plus grant tests. Domain events use the shared emitter; jobs use the existing Arq registry. Every new endpoint must be explicitly registered and inventoried.

## 3. Phase 2 user stories and detailed exit criteria

| Story | Acceptance criteria |
|---|---|
| Workforce Manager finds everyone eligible to work | Search/filters/pagination cover all authorised records, including workers without user accounts; stable worker numbers; no duplicates silently merged |
| HR maintains a worker's employment evidence | Dated engagement references verified document revision, source owner and expiry; API refuses unauthorised HR decisions from Workforce roles |
| Site supervisor sees operational readiness | Assigned-scope projection includes role/supervisor/site/readiness; identity, bank, salary, discipline and clinical fields are absent without dedicated grants |
| HR establishes reporting authority | Same-tenant workers only; effective dates; no self-report/cycle; one primary authority per scope; changes audited |
| Planner checks availability | Approved leave, training, suspension, contract validity and medical restrictions take precedence over manual availability; future query uses requested period |
| Worker sees own information | Own identity resolved by server; changing an ID cannot read peers; no broad Workforce read permission needed for permitted self-service |
| Auditor examines a change | Material action has actor, organisation, reason, before/after version and evidence; read is scoped; update/delete denied |
| Administrator grants multiple roles | Conflict report identifies prohibited combinations; runtime still blocks the conflicted action; role changes and delegations audited |
| Operator retries on weak connection | Foundation commands have durable idempotency semantics; mobile capture activation waits for Phase 5 controlled queue; no duplicate worker on exact retry |

Phase 2 does not deliver manpower approvals, live deployment activation, verified attendance, structured costed timesheets or payroll readiness. The earlier basic operational views remain labelled as such until their dedicated phases pass.

## 4. Traceability for all mandatory controls

| Control from brief | Design enforcement | Required proof / owning phase |
|---|---|---|
| C01 Every record belongs to organisation | Non-null org on aggregate/children/receipts; scoped generic links | Insert without org denied; orphan and consumer tests / 2 |
| C02 Project/site applicable | Composite project/site/tenant references | Site from different project rejected even in same tenant / 3–4 |
| C03 Database and server tenant isolation | Non-bypass role, transaction-local org, scoped SQL, composite FKs | Direct DB and authenticated HTTP two-tenant CRUD denial / 2 onward |
| C04 Valid activities/cost codes | Structured entry FKs and active project mappings | Invalid/closed/other-project code denied / 6 |
| C05 Approved records not silently edited | Terminal-state DB/service guard | Direct API and runtime SQL UPDATE fail / 2 shared, 5–9 integration |
| C06 Controlled corrections | Immutable original plus approved successor and reconciliation | Before/after lineage; stale approval rejected / 5–6 |
| C07 Every decision audited | Append-only decision and Core business audit in transaction | Approve/reject/override/correct actor/reason/evidence assertions / 2 onward |
| C08 Mobilisation mandatory | All blocking checks and effective-date revalidation | Each missing/expired requirement blocks activate / 4 |
| C09 No conflicting assignments | Worker interval lock and database constraint | Concurrent cross-site attempts, boundary and transfer tests / 4 |
| C10 Leave blocks/escalates attendance | HR-derived availability + preserved claim exception | Approved leave/cancellation races and capture outcome / 5 |
| C11 Contract expiry blocks attendance | Effective engagement guard | Exact expiry boundary and backdated claim; no verified attendance / 5 |
| C12 Flag unauthorised overtime | Separate worked and authorised minutes | OT request missing/denied/overrun cases / 6 |
| C13 Preserve actual reported hours | Raw evidence append-only, exception path | Invalid-authority capture remains retrievable and excluded from eligibility / 5–6 |
| C14 Qualified equipment operators only | Existing gate + typed current competence | Wrong class/revoked/expired/unverified licence blocked / 4, 8 |
| C15 Payroll evidence chain | Input source joins attendance/time/OT/rate versions | Unverified or mismatched source cannot generate eligible line / 9 |
| C16 Sensitive fields restricted | Separate projections/routes/storage/download policies | Field absence in list/detail/search/report/error/audit/offline / 2 onward |
| C17 Soft deletion/archive | Restrict operational delete; archive reason/version | Parent archive preserves evidence, approved rows still auditable / 2 onward |
| C18 Audit immutable | Runtime no UPDATE/DELETE on audit and decisions | DB grant and HTTP negative tests / 2 |
| C19 Server authorisation | Dedicated action dependencies plus scoped guards | Direct endpoint test without UI for every capability / 2 onward |
| C20 Hidden controls insufficient | Server remains authority | Forge request with hidden action; 403/no side effect / every phase |
| C21 Critical submissions idempotent | Durable command key + payload hash + receipt | Exact replay same result; changed replay 409; crash recovery / 2 onward |
| C22 Atomic operations | Caller-owned DB transactions and locks | Fault injected between writes rolls back target/decision/audit/event / 2 onward |
| C23 Weak connections tolerated | Pending queue and retry-safe commands | Connection drop before/after commit, resume without duplicate / 5 |
| C24 Offline remains pending | Capture-only queue, re-auth and server validation | No success/verified state before receipt; retained 4xx conflict; user switch isolation / 5 |
| C25 Tests and acceptance evidence | Per-phase evidence manifest and release gate | Commands/results/fixtures/screenshots/migration proofs reviewed / every phase |

## 5. Testing strategy

### Test infrastructure and fixtures

Reuse `imperium-api/tests`, pytest/unittest patterns, the current workforce contract tests, migration manifest tests and existing frontend lint/typecheck commands. Retain source-contract tests as fast checks, but do not treat them as permission or database proofs.

Add implementation-phase test fixtures in a dedicated disposable PostgreSQL environment seeded with synthetic data only: two tenants with overlapping human-readable worker/project codes, two sites per tenant, workers with and without logins, multi-role users, contractors, different currencies, an overnight shift, expired and expiring credentials, leave and active/closed work packages. Test both migration-owner setup and the non-bypass runtime role. Do not use production personnel for tests.

Layered evidence:

1. **Unit:** schema/interval arithmetic, availability precedence, state machines, SoD, money rounding, quantity units and policy versions. Freeze time; include expiry at local midnight and overnight shifts.
2. **Database:** migrations from clean and upgrade snapshots; RLS grants/denials using real runtime role; composite FKs; nullable uniqueness; exclusion constraints; terminal-row guards; immutable audit; rollback. SQLite cannot substitute for these tests.
3. **HTTP integration:** real ASGI routes and dependency chain; authenticated worker, supervisor, QS, HR, Finance, auditor and multi-role actors; inspect database side effects after deny responses. Direct function mocks do not test central router permissions.
4. **Concurrency:** two independent connections synchronised at race windows: competing deployment, double verify/approval, double minutes allocation, duplicate batch generation, competing transfer and leave approval. Exactly one permitted result or a consistent retry; no unexplained duplicate side effects.
5. **Events:** commit produces outbox event; rollback does not; duplicate/out-of-order delivery, worker crash after effect-before-ack, poisoned payload/dead letter/replay; no repeated site grant, notification, cost posting or payroll receipt.
6. **Browser:** authenticated multi-actor workflows on actual API/test DB; page loading/empty/error/denied; create → reload persistence → independent approval → history/report reconciliation. Browser screenshots supplement assertions, not replace them.
7. **Offline/mobile:** service-worker enabled, network throttling/drop, queue refresh and retry, expired session, user/tenant change, offline forbidden command, 4xx conflict retention, no sensitive cached payload; 360px/390px/768px widths and keyboard operation.
8. **Calculation/report:** golden data fixtures reconcile each measure to source IDs and versions; comparable budgets/currencies/units; corrected time and Finance adjustments; large reports use background jobs with download permission recheck.
9. **Performance:** proposed acceptance fixture 10,000 workers, 100 sites and 1,000,000 time entries; common paginated queries p95 ≤ 1s and capture p95 ≤ 2s on agreed staging resources under 50 concurrent site users. These are proposed targets, not measured results; owner confirms expected scale. Inspect EXPLAIN plans, tenant-leading indexes, payload sizes and queue latency.
10. **Accessibility:** labelled controls, visible focus, tab order, keyboard dialogs, status conveyed in words as well as colour, readable errors, screen-reader announcements and touch targets; target WCAG 2.2 AA, verified with automated tooling plus manual checks.

### Attack and regression cases

| ID | Attempt | Expected result / regression evidence |
|---|---|---|
| T01 | Read/edit another tenant's worker by UUID or export filter | Denied/no disclosure; DB also denies cross-tenant SQL; audit scoped |
| T02 | Use a same-tenant site belonging to another project or a contractor's peer employer | Denied relation/scope; no writes |
| T03 | Call approval with only create/update permission | Denied; central middleware does not accidentally grant or incorrectly require unrelated capability |
| T04 | Author approves own time or uses another assigned role to satisfy second stage | Denied by actor/subject history, not role label |
| T05 | Reuse command key with a different worker/hour payload | Conflict; original outcome returned only for exact payload |
| T06 | Race two approvals/deployments/time allocations/payroll generations | One consistent state; unique receipts/events; no double minutes or entitlement |
| T07 | Deploy with missing identity/contract/medical/induction/PPE/supervisor/rate/code | Each blocker independently prevents scheduling/activation |
| T08 | Credential valid at approval but expires before deployment starts | Start revalidation fails; no access grant |
| T09 | Attend on approved leave or after expiry | Official record blocked/escalated; raw claimed work retained |
| T10 | Attend without deployment or simultaneously at two sites | No normal verified state; exception and retained evidence |
| T11 | Missing clock-out, negative/overlong hours, overlapping breaks | Pending exception or validation error; no fabricated timestamp |
| T12 | Record OT without request, after rejection or beyond approved window | Actual claim retained; unauthorised portion flagged/excluded from eligible time |
| T13 | Split time across activities to spend same attendance twice | Transactional aggregate check rejects excess even under concurrency |
| T14 | Charge a closed work package or use stale approved budget/rate version | Submission/approval blocked; historical evidence untouched |
| T15 | Directly alter verified time, approved rate or accepted batch | DB/service denies; correction/adjustment workflow required |
| T16 | Omit rejection/correction/override reason | Validation fails, no decision event committed |
| T17 | Assign machinery to unverified/wrong-class/revoked operator | Existing gate plus typed requirement denies assignment |
| T18 | Publish duplicate/out-of-order access events or crash consumer | Receipts/versioning prevent duplicate or stale grant; revocation remains effective |
| T19 | Queue approval offline, change user or replay expired bearer header | Command disallowed; capture stays pending; fresh auth, no leaked draft/credential |
| T20 | Correct time already included in accepted payroll | Original stays locked; explicit Finance adjustment/replacement source link |
| T21 | Finish demobilisation with active site access or unaccounted custody | Closure denied or explicit reviewed exception; no silent active access |
| T22 | Show cost/productivity with missing rate/output or mixed currencies/units | Unavailable or separately grouped values, not zero/invalid aggregate |
| T23 | Download another tenant's report/document or leak sensitive fields through audit/export | Denied; minimum field projection and signed-link controls |
| T24 | Fail transaction after decision before event or after event before target | Atomic rollback; retry recovers one committed outcome |
| T25 | Archive worker/parent to erase time/audit, or edit audit directly | Denied or soft archive preserving references; audit mutation unavailable |

For every failing case: record root cause and severity, correct code, add regression assertion, rerun the failed test and affected suites, update acceptance evidence. Never weaken a guard to pass a fixture.

## 6. Implementation release gate and rollback

Each implementation phase must run its applicable migration validation, unit, integration, permission, tenant-isolation, workflow, typecheck, lint, production build and end-to-end checks. Missing required environment evidence is a failed gate, not a passing waiver. Classify findings Critical/High/Medium/Low and assign owner/phase.

Proposed production sequence: backup/restore verification → ledger/schema/grant snapshot → additive migration → guarded API deployment → frontend deployment → consumer enablement → synthetic acceptance → pilot organisation/sites → monitored expansion. Rollback switches feature flags/consumer subscriptions off and preserves all event and approval evidence; use forward repair for data-bearing schema changes. Exact deployment commands are selected from the actual release environment in the approved phase.

Acceptance states: ACCEPTED, ACCEPTED WITH MINOR CONDITIONS (no Critical/High), or REJECTED PENDING CORRECTION. Security/financial integrity conditions are never classified minor merely to permit release.

## 7. Phase 1 verification performed

| Check / command | Result | Limits |
|---|---|---|
| `git status --short`, `git rev-parse HEAD` | Existing dirty tree identified; baseline commit recorded | Prior Workforce, Projects, package/API changes and unrelated scripts remain uncommitted; not overwritten |
| `rg --files`, `rg -n`, targeted `Get-Content` | Reviewed router mounting, authentication/permissions, DB sessions, SQL migrations, approvals/events/workers, HR/Finance/site services, PWA and UI primitives | Static repository evidence, not deployed system discovery |
| Inline Python AST inventory | 148 observed routes documented across ten relevant routers | No API server startup or real HTTP calls |
| `.venv\Scripts\python.exe -m pytest tests/test_workforce_operations.py tests/test_workforce_security_contract.py tests/test_workforce_compliance_gate_contract.py tests/test_migration_ledger_alignment.py tests/test_hr_operating_layer_contract.py tests/test_notifications_contract.py -q` from `imperium-api` | **40 passed, 6 subtests passed**, 16.32 seconds | Existing unit/source-contract/manifest tests; not live DB, real permission middleware, concurrency or browser proof |
| `imperium-api\.venv\Scripts\python.exe imperium-api/scripts/validate_production_migrations.py` | **0 errors, 3 warnings, 9 info findings**; full output retained | Static heuristics only; no migration applied, no production credentials used |
| Documentation checks | Passed: local Markdown links resolve, code fences balance, all 148 handler line references resolve, 28 required event rows are present, C01–C25 and T01–T25 are complete | Mechanical checks supplement the source/design review; they do not validate business runtime behaviour |
| Supabase documentation review | Official RLS guide and changelog fetched; source linked in README | No Supabase implementation in this phase; no live project/advisor test |
| Typecheck/lint/build/E2E/migration apply for this phase | Not run as a Phase 1 implementation gate: only documentation changed | Earlier turn's typecheck/lint results do not constitute acceptance of the expanded module; mandatory on implementation phases |

### Independent specification review and corrections

- Initial inspection highlighted the generic workflow skeleton; deeper inspection found live Core approval instances/steps in Site Operations. Design corrected to reuse the latter.
- Initial gap assumptions could have duplicated reporting lines, training and workforce plans. Migration 162 confirmed existing structures; the model now extends them explicitly.
- Database service-role policies were not accepted as proof of tenant-level backend RLS. The design requires a non-bypass runtime role and direct SQL negative tests.
- Existing offline support was found to queue broad mutations and report success/pending together. The target design narrows it to capture-only pending evidence and retains conflicts instead of discarding them.
- Existing site labour costing and supplied-hour payroll intake were identified as integration boundaries. The design now requires canonical source IDs and once-only cost/payroll reconciliation.
- The distinction between recorded attendance, verified attendance, approved time and payroll eligibility is explicit throughout diagrams, states, APIs and reports.

## 8. Phase 1 release report

| Required report item | Result |
|---|---|
| 1 Phase completed | Architecture/specification work prepared; owner approval remains pending |
| 2 Requirements delivered | Current architecture, reuse map, gaps, ER/data model, permissions, workflows/states, events, API/screen/report inventories, file-level backlog, acceptance/tests and owner decisions |
| 3 Architecture decisions | Modular monolith, canonical worker ID, reuse Core approval/event/audit systems, non-bypass tenant boundary, immutable evidence, versioned policies and Finance-owned payments |
| 4 Database changes | None; proposed schema/constraints/migration strategy only |
| 5 Backend changes | None in this turn |
| 6 Frontend changes | None in this turn |
| 7 Permission changes | None installed; proposed capability/role/SoD matrices |
| 8 Workflow changes | None installed; proposed guarded state machines and actor chains |
| 9 Events added | None emitted or registered; 28 required target events plus inbound integration contracts catalogued |
| 10 Tests added | None; acceptance and attack cases specified, existing baseline suites executed |
| 11 Commands executed | Read-only repository inspection, baseline pytest, static migration preflight, AST documentation generation and documentation validation |
| 12 Test results | 40 tests + 6 subtests pass; migration preflight 0 errors / 3 warnings / 9 info; required runtime acceptance still unproven |
| 13 Files changed | Only new files under `docs/workforce-phase1/`: README, DATA_MODEL, CONTROLS, INTERFACES, API_OBSERVED, DELIVERY and migration-preflight output |
| 14 Issues found/corrected | Specification reuse/isolation/offline/costing assumptions corrected above; operational gaps recorded, not changed without approval |
| 15 Remaining limitations | No live schema/grant snapshot, real-tenant HTTP/DB attacks, browser/mobile acceptance, production build, event delivery or payroll reconciliation proof; business defaults require owner review |
| 16 Release decision | **REJECTED PENDING CORRECTION for operational release.** The specification is ready for owner review, not permission to call the full module complete. High-risk gaps in README remain implementation blockers. Phase 1 is not yet owner-approved. |
| 17 Recommended next phase | **Phase 2 — Workforce foundation**, beginning with shared tenant/action/audit/approval safeguards and canonical register; proceed only after explicit owner approval |

No software acceptance is claimed from generated documents or passing mocked/source tests. The Phase 1 deliverable is a concrete specification for review; its implementation remains gated exactly as requested.
