# APIs, screens, dashboards and report contracts

Observed capabilities are listed separately from target interfaces. None of the proposed endpoints or screens is implemented by this specification.

## 1. Observed Workforce API and consumer gaps

The [generated inventory](./API_OBSERVED.md) lists 148 observed routes across the relevant Workforce, HR, Projects, Site Operations, Compliance, Finance, Documents and Notifications routers. It is an AST/source inventory, not a live-route assertion.

| Current Workforce route (prefix `/api/v1/workforce`) | Observed behaviour | Required extension |
|---|---|---|
| `GET /`, `GET /{employee_id}` | Tenant-scoped register/detail; `e.*`; list capped at 250 | Explicit field projections, search/filter/cursor, own-worker and site scopes, restricted subresources |
| `POST /`, `PUT /{employee_id}` | Basic employee create/update and employment fields | Category/position/engagement/reporting validation; separate HR authority; controlled change history |
| `GET/POST /{employee_id}/skills` | Skills list/create | Catalogue, assessments and independent verification |
| `GET/POST /{employee_id}/certifications` | Credential list/create | Verification ownership, revocation, typed requirements and secured evidence |
| `POST /{employee_id}/availability` | Manual interval/capacity entry | Effective restriction precedence, leave/source revisions, read API and non-overlapping rule |
| `GET/POST /allocations` | Project capacity allocations; credential gate; list capped at 500 | Mobilisation/approval/site/shift/interval commands and concurrency controls |
| `GET /attendance` | Tenant/date/project attendance list | Site/shift/crew/search/pagination, verification/source status and history |
| `POST /attendance` | Manual record or clock event; duplicate day preservation; basic hour validation | Idempotent raw evidence, roster/contract/leave guards, dispute/correction flow |
| `GET /me/attendance` | Resolves own worker | Test inherited central permission gate; true self-service without peer listing |
| `GET /timesheets` | Selected date range up to 32 days | Pagination, site/worker/status filters and entry/revision detail |
| `POST /timesheets` | Draft worker/project/date/hour record | Verified attendance references and structured activity entries |
| `POST /timesheets/{id}/submit` | Draft → submitted | Command key, expected version and full submission validation |
| `POST /timesheets/{id}/decision` | Independent operational approval/rejection; recorded attendance support | Dedicated approval capability, mandatory reason, supervisor/QS/PM stages, audited immutable decisions |

Current HR interfaces expose reporting-line, document, medical, training and workforce-plan summaries through `/api/v1/hr/operations/summary`. That read aggregation is not proof of complete write/approval workflows. Leave endpoints are HR-owned and must remain so.

## 2. Target API conventions

- Retain the existing `{success, data, message, meta}` envelope. Add typed error codes (`WORKER_UNAVAILABLE`, `MOBILISATION_BLOCKED`, `VERSION_CONFLICT`, `SOD_CONFLICT`, `ATTENDANCE_MISMATCH`, `RATE_MISSING`) without leaking other-tenant existence or sensitive details.
- Request tenant/actor is derived server-side. Domain IDs are validated against organisation and project/site scope before returning data or changing state. Worker self-service resolves employee ID from the session.
- `POST` commands take `Idempotency-Key`; mutations of existing aggregates take `expected_version` or `If-Match`. Return the original result on exact replay; payload-key mismatch or stale version returns `409`. Duplicate real-world attendance is a separate business conflict from a network retry.
- Reads use stable keyset pagination, default 50/max 200, plus permitted search and sort fields. `meta` includes next cursor, applied scope, as-of time, source status and coverage. Aggregates are calculated server-side over the full authorised scope, not the displayed page.
- `401` unauthenticated; `403` forbidden action/scope where existence is already visible; `404` inaccessible cross-tenant target; `409` state/version/business conflict; `422` schema validation. `202` offline/async acknowledgement is **pending**, not persisted/approved business success.
- Data classification follows through detail, search, export, error, audit and document routes. Operational worker lists do not return salary, identity numbers, bank details or disciplinary narrative.
- Evidence uploads go through existing Documents routes; link only tenant-authorised document IDs/revisions. File replacement creates a revision and invalidates dependent pending checks when necessary.
- No generic PATCH may set approval actors, workflow states, rates, verified time or payroll eligibility. Named commands enforce guarded transitions.

## 3. Proposed endpoint inventory by phase

Paths below are under `/api/v1/workforce` unless another module is stated. Use existing routes as compatibility aliases where appropriate. File-level ownership is in [Delivery](./DELIVERY.md).

| Phase / aggregate | Read endpoints | Mutation commands | Authorisation / integration |
|---|---|---|---|
| 2 People | `/people`, `/people/{id}`, `/people/{id}/history`, `/me` | `/people`, `/people/{id}/profile`, `/people/{id}/archive` | `workforce.people.*`; existing `/` aliases; explicit operational projection |
| 2 Organisation | `/categories`, `/positions`, `/departments`, `/reporting-lines`, `/teams` | Catalogue create/update/archive; reporting assignment/revision | `workforce.organisation.*`; HR/Finance/Core ownership honoured |
| 2 Availability | `/availability?from&to&trade&project_id`, `/people/{id}/availability` | Manual availability propose/change | `workforce.availability.*`; HR approved leave overrides |
| 2 HR reference | HR `/engagements/{id}`, restricted `/people/{id}/identity`, existing document/credential reads | HR engagement/identity verification through owner routes | Additional HR-sensitive capabilities; not broad Workforce write |
| 3 Plans | `/plans`, `/plans/{id}`, `/plans/{id}/matching` | Create/update draft/items, submit, cost-check, approve, revise | Plan and Finance budget-check capabilities; Projects programme version |
| 3 Requisitions | `/requisitions`, `/{id}/candidates`, `/{id}/history` | Submit, recommend, budget-check, approve, reject, fulfil/cancel remainder | Internal matching evidence before recruitment integration |
| 4 Mobilisation | `/mobilisations`, `/{id}/checklist`, `/{id}/history` | Prepare, verify item, submit, approve; explicit waiver reference | Item-owner verification + PM approval; existing compliance gate |
| 4 Deployments | `/deployments`, `/{id}`, `/site-access` | Propose, approve, activate, suspend, resume, end | Deployment capability, project/site guard and no overlap |
| 4 Shifts | `/shifts`, `/rosters` | Create/version shift, assign/cancel roster | Workforce operational authority; worker interval lock |
| 5 Attendance | `/attendance`, `/{id}`, `/{id}/history`, `/me/attendance` | Capture, submit, verify, dispute, request correction, approve correction | Capture versus independent verify/correct permissions |
| 5 Offline intake | `/capture-commands/{id}` | `/attendance/captures:sync` with client ID and observed time | Only capture commands; individual accepted/pending/conflict results; no offline approval |
| 6 Timesheets | `/timesheets`, `/{id}/entries`, `/{id}/history` | Draft entries, submit, supervisor-review, cost-check, project-approve, reject/return, revise | Dedicated stage permissions; exact attendance-version reconciliation |
| 6 Overtime | `/overtime`, `/{id}`, `/{id}/history` | Request, recommend, budget-check, approve, reject, verify-actual | Named workers/windows, policy/version, actual OT preserved |
| 6 Cost evidence | `/labour-costs`, `/labour-costs/reconciliation` | No public arbitrary-cost posting command | `finance.labour_cost.read`; canonical source-driven Finance posting adapter |
| 7 Crews | `/crews`, `/{id}/memberships`, `/{id}/targets` | Create, assign, reassign, target, archive | Crew scope; membership obeys deployment/shift eligibility |
| 7 Productivity | `/productivity`, `/{id}/evidence` | Record output, accept/reject via Site Operations, explain variance, link corrective action | Engineer acceptance, QS costing; no recorder self-acceptance where disallowed |
| 8 Skills/training | Existing people skills/certification plus `/skills/matrix`, `/training` | Assess, verify, enrol, complete, validate evidence, revoke | HR/HSE authority; extend existing training/credential tables |
| 8 Movements | `/transfers`, `/demobilisations`, `/{id}/clearance` | Request, sending-recommend, receiving-accept, approve, effect, verify clearance, close | Separate site roles; transaction and access-revocation events |
| 9 Payroll inputs | `/payroll-inputs`, `/{id}/lines`, `/{id}/reconciliation` | Generate, project-verify, workforce-validate, HR-validate, submit | Versioned evidence snapshot; no payments |
| 9 Finance intake | Finance-owned `/payroll-input-receipts/{id}` | Accept/return with reason and external reference | `finance.payroll_input.*`; adapter to selected existing payroll route |
| 10 Cross-cutting | `/overview`, `/site-board`, `/approvals`, `/exceptions`, `/reports/{key}`, `/report-jobs/{id}` | Exception assign/resolve, scoped report job creation | Full-scope queries and permissions, export classification |
| 2–10 Settings/history | Existing settings and audit APIs; Workforce policy views | Version/activate policy, scoped delegation | Core settings administration plus accountable business approval |

Approval queues query shared Core approval instances/steps, not independent per-page arrays. Exception queues persist rules and resolution evidence; they cannot rely solely on browser-derived warnings.

## 4. Screen inventory

Base route `/dashboard/workforce`. Existing page and `WorkforceOperations.tsx` are compatibility entry points; expand into route segments after approval. Every page must implement: loading, honest empty, source error/retry, permission-denied, search, relevant filters, pagination where rows grow, mobile layout and authorised history access.

| Navigation / planned segment | Core user task | Filters / evidence / phase |
|---|---|---|
| Workforce Overview `/overview` | Portfolio, operations and selected project/site health | Period/project/site/category; source freshness and coverage; Phase 10 (progressive earlier summaries) |
| People `/people` | Register, create permitted worker, inspect operational profile | Name/number/category/trade/status; pagination; Phase 2 |
| Organisation `/organisation` | Department/position/team/reporting map | Department/project/effective date; hierarchy history; Phase 2 |
| Manpower Plans `/plans` | Weekly/activity demand and qualified supply | Programme/week/site/trade/approval; Phase 3 |
| Requisitions `/requisitions` | Request and approve labour, internal matching | Urgency/needed date/site/status; Phase 3 |
| Mobilisation `/mobilisation` | Blocking checklist, verifier and evidence | Required start/site/blocked requirement; Phase 4 |
| Deployments `/deployments` | Approved worker/site/supervisor/shift authority | Current/future/ended/project/site; readiness and access; Phase 4 |
| Attendance `/attendance` | Site register, pending clock evidence, independent verification | Work date/shift/site/crew/status; capture and corrections; Phase 5 |
| Timesheets `/timesheets` | Allocate verified minutes and review activity costing | Week/worker/project/activity/status; reconciliation; Phase 6 |
| Crews `/crews` | Members, foreman, activity targets and needs | Site/shift/trade/activity; movements; Phase 7 |
| Skills `/skills` | Capability matrix and qualified matching | Trade/licence/level/expiry/site; verification evidence; Phases 2/8 |
| Productivity `/productivity` | Accepted output/hour/cost and delay causes | Crew/activity/unit/period/baseline; Phase 7 |
| Training `/training` | Required, planned, due and completed learning | Person/provider/competence/expiry; Phase 8 |
| Transfers `/transfers` | Sending and receiving authority, dated movement | Source/destination/effective date/state; Phase 8 |
| Demobilisation `/demobilisation` | Final time, custody, access and clearance | Site/end date/blocker/status; Phase 8 |
| Payroll Inputs `/payroll-inputs` | Evidence completeness and approved Finance handoff | Period/currency/status/project; source reconciliation; Phase 9 |
| Approval Centre `/approvals` | Review assigned stages with evidence/reason | Due date/workflow/site/SoD conflict; shared approval reader; progressive phases |
| Exceptions `/exceptions` | Investigate, assign, resolve and audit | Severity/rule/site/person/age/status; progressive phases |
| Reports `/reports` | Permission-scoped PDF/Excel/source drilldown | Report period/scope/currency/unit; Phase 10 |
| Settings `/settings` | Review policy versions and permitted configuration | Effective date/policy type; approval history; progressive phases |

Overtime is a dedicated subpage under Timesheets (`/timesheets/overtime`) and an approval queue filter, preserving the requested primary navigation without hiding the workflow.

Worker profile tabs: Overview, Employment (restricted), Deployment, Attendance, Timesheets, Skills, Training, Performance, HSE readiness, Equipment issued, Documents, History. Overview shows photo, workforce number, role, operational status, supervisor, current site, contract validity and readiness. Clinical details, disciplinary narrative, identity and banking never leak through generic attributes.

Mobile: date/site/shift persist visibly; one worker per compact row/card; touch targets at least 44px; keyboard labels and focus management; status text plus colour; confirmation distinguishes local draft, synchronised capture, submitted, verified and approved. Pending drafts survive refresh and retain reasons on conflict. Switching user/organisation cannot reveal or replay a prior user's queue. Never show a successful approval toast for `meta.queued`.

## 5. Dashboard contracts

| Dashboard | Required measures and source contract |
|---|---|
| Executive | Effective active population/category mix; workers by project; verified present/absent versus pending; labour and OT cost by currency; comparable budget variance; crew/activity productivity by project; demand shortage/overstaffing; contract/credential expiry; open critical exceptions; payroll readiness; transparent health components |
| Site | Expected roster, present/absent/late/pending; crews/activities/targets; verified minutes and idle causes; missing exits/time entries; OT requests/actual authorisation; compliance blockers; assigned approval queue |
| Workforce Operations | Open requisitions, mobilisation blockers, scheduled deployments, qualified availability for dates, skills shortage, transfers/endings, contract/credential/training due, unresolved exceptions |
| Project | Demand → approved request → scheduled → deployed → verified present → activity time → accepted output → Finance accepted input, with counts and source drilldown |

All figures use server-side scoped aggregation and display `as_of`, selected period, timezone, coverage and missing-source condition. No rate means cost unavailable; no accepted output means productivity unavailable; no verification means pending presence. Headcount is unique people; demand is positions/FTE/minutes as labelled. These units are not interchangeable.

## 6. Report inventory and reconciliation

Common report controls: org/project/site permission check at generation **and download**; period/timezone/currency/unit/baseline versions in header; data-cutoff timestamp and filter summary; redacted sensitive fields; source-row IDs/revisions in authorised drilldown; no unbounded synchronous export. Large jobs use existing render libraries and Arq with private document storage and short-lived authorised download links.

| Report | Grain and authoritative sources | Reconciliation / additional permission |
|---|---|---|
| Workforce register | Worker/effective engagement/category | Unique worker IDs; operational fields; sensitive appendices separately authorised |
| Daily labour return | Site/shift/date/crew | Verified attendance totals equal source minutes; pending separate |
| Weekly manpower | Project/site/week/trade | Approved plan requirement versus qualified roster supply |
| Planned versus deployed | Activity/trade/date | Plan version → approved deployment/roster, unique position fulfilment |
| Attendance | Worker/shift/revision | Clock/manual evidence → verified total; disputed/corrected lineage |
| Timesheet | Worker/entry/activity/cost code | Entry minutes reconcile to exact verified attendance buckets |
| Overtime | Worker/request/window | Requested/approved/worked/verified/eligible each separate |
| Absence and lateness | Worker/shift/date | Scheduled start versus verified arrival; approved leave separately classified |
| Labour utilisation | Crew/site/period | Productive versus idle minutes; denominator excludes agreed unavailable time |
| Idle labour | Crew/activity/cause/date | Recorded idle minutes, missing inputs and accountable action |
| Labour cost | Project/activity/code/currency | Approved rate/entry cost matches canonical Finance source transaction; cost permission |
| Labour budget variance | Budget version/period/project/currency | Comparable approved baseline minus actual basis, explained differences |
| Crew productivity | Crew/activity/unit/period | Accepted output and deduplicated labour hours; no mixed-unit aggregation |
| Project productivity | Project/activity/unit | Crew source drilldown; weighted like-unit aggregation only |
| Skills matrix | Worker/skill/verification/expiry | Current assessed level; certification ownership and validity |
| Training | Worker/programme/requirement | Planned/completed/assessed/verified; costs restricted |
| Expiring contract | Worker/engagement/threshold | Authoritative verified contract dates, not display status alone |
| Expiring certification | Worker/credential/threshold | Latest verified relevant credential revision; revoked not current |
| Mobilisation readiness | Worker/deployment/checklist version | Required passed/failed/missing plus blocking items; score cannot override blocker |
| Transfer | Worker/movement/effective interval | Source ended/destination eligible, both approvals and access events |
| Demobilisation | Worker/deployment/clearance | Final time, custody, access revoked, Finance/HR receipt state |
| Payroll input | Batch/worker/source line/currency | Verified time + authorised OT + rate snapshot; Finance receipt; payroll-input permission |
| Subcontractor workforce | Employer/site/worker/period | Own-employer scope; excludes unauthorised SNC personal/financial fields |
| Workforce compliance | Worker/site/requirement/as-of | Readiness evidence, source owner, expiry and corrective actions |
| Ghost-worker and duplicate | Rule/source/worker/period | Missing evidence/duplicate signals with investigation status; never proof of fraud from one indicator |
| Executive portfolio summary | Project/period/currency | Totals drill into approved source reports; no hidden currency conversion |

## 7. Integration acceptance examples

1. Leave approved in HR updates dated availability and raises a replacement need for an affected roster. Normal attendance is blocked; an actual-work claim remains as an exception.
2. A certificate expires after deployment approval but before start: activation fails, readiness shows the source expiry, no access grant event occurs.
3. Replaying a valid attendance capture returns the original record ID. Replaying it with different minutes returns conflict and preserves both the original and disputed payload evidence.
4. A site report and timesheet reference the same labour: one canonical cost source posts once, and both screens display the same provenance.
5. Finance returns an input batch: original submission remains visible; correction generates a new version; no already-paid entitlement can be included a second time.
