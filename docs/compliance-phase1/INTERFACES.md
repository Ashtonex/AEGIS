# API, events, screens and reports

## API contract

New routes use `/api/v1/compliance`; retain `/api/v1/compliance-items` as compatibility adapters to the same services. Existing gateway resource permissions must be mapped deliberately to granular route capabilities. FastAPI schemas forbid extra fields, use UUID/date types and bounded values. Tenant/actor come from verified context, never payload. Project/subject identifiers are tenant scoped. All lists use search, scope/status filters, bounded cursor pagination; all detail reads apply equivalent permissions.

Commands require `Idempotency-Key` and `expected_version` for existing aggregates. Receipt uniqueness is tenant/actor/route/key; canonical payload hash mismatch returns 409, exact replay returns stored result. Missing/stale version returns 409. Approval decisions bind actual locked target version, not merely a supplied version. Use shared `ok` response envelope; typed reason codes with field errors. 401 unauthenticated, 403 denied, 404 absent/cross-tenant, 409 conflict/blocked, 422 invalid input, 503 unavailable mandatory evaluation. Never expose raw SQL exceptions.

| Resource paths | Read interfaces | Commands and permissions | Phase |
|---|---|---|---|
| `/domains`, `/authorities`, `/sources` | GET list/detail/history | POST, PATCH draft, archive; resource create/update; source verify requires review | 2 |
| `/obligations`, `/{id}/versions` | GET list/detail/version/diff/history | POST draft/revise/submit/activate/archive; obligation capabilities and Core approval | 2 |
| `/applicability-assessments` | GET by rule/subject/project | POST assess/recommend/submit; decision via Core workflow; no AI approve | 2 |
| `/assignments`, `/items` | GET scope/current status and provenance | POST assign/reassign; scoped owner permission; no direct compliant mutation | 2 |
| `/calendar`, `/deadlines` | GET date range/overdue/upcoming | POST recurrence/change/reschedule with version/reason; deadline.manage | 3 |
| `/evidence-requirements`, `/evidence` | GET requirements/submissions/history | POST submit/start-verification/verify/return; submit and verify distinct | 3 |
| `/credentials` | GET kind/subject/expiry/history | POST draft/submit/activate/renew/suspend/revoke/replace; credential actions | 4 |
| `/project-templates`, `/project-plans` | GET versioned plans/readiness/blockers | POST instantiate/assess/submit/revise; project scope mandatory | 5 |
| `/gates/evaluate`, `/stop-work` | GET decisions/current blocks | POST evaluate/issue/request-release; operation commit uses internal transaction service | 5/10 |
| `/third-parties`, `/{id}/requirements` | GET profile/status/qualification | POST assess/request-approval/suspend; exception-bound conditional approval | 6 |
| `/inspection-programmes`, `/checklists`, `/inspections` | GET schedule/checklist/results | POST schedule/start/result/submit; inspection scoped permissions | 7 |
| `/findings`, `/root-causes`, `/corrective-actions` | GET open/overdue/repeat/history | POST assign/submit-plan/start-remediation/submit-evidence/review-effectiveness/close/reopen | 7 |
| `/policies`, `/attestations` | GET version/assignment/acknowledgements | POST revise/submit/distribute/assign/acknowledge; use Documents distribution | 8 |
| `/regulatory-changes`, `/impact-assessments` | GET scope/plan/progress | POST identify/verify-source/assess/submit-plan/implement/review-effectiveness/close | 8 |
| `/exceptions`, `/exemptions` | GET current/expiring/history | POST request/review/revoke/close; Core approval stages required | 5/8 |
| `/approvals` | GET compliance-filtered Core queue and history | POST decisions through Core workflow adapter with compliance guards; no duplicate queue store | 2+ |
| `/overview`, `/reports`, `/exports` | GET metrics/reconciled reports/export job status | POST export with report.export + source access; signed download rechecks scope | 9 |
| `/administration` | GET rule/config/SoD conflict history | POST versioned settings and approved rule templates; config capabilities | 2+ |

Every detail has history and relevant report export through shared endpoints. No destructive DELETE endpoint for compliance history. File upload/download is via Document Management; Compliance APIs accept a version reference, not arbitrary storage paths or remote fetch URLs.

## Event catalogue

Canonical names below match the requested contract. Wire names append `.v1` to match repository convention, with `schema_version=1`. Old deployment and corrective-action names map through a versioned adapter; consumers deduplicate on original event identity to avoid double action. Envelope: event_id, organization_id, project_id when scoped, aggregate_type/id/version, actor_id, occurred_at (server), correlation_id, causation_id, schema_version, payload. Payload contains IDs/reason codes, never file contents or privileged legal advice.

| Canonical event | Producer / condition | Consumers |
|---|---|---|
| compliance.obligation_created | Draft command commits | Audit projection, Compliance queue |
| compliance.obligation_activated | Approved version becomes effective | Applicability/materialisation, calendar, reporting |
| compliance.deadline_approaching | Configured threshold occurrence | Notifications and owner queue |
| compliance.deadline_missed | Unsatisfied due occurrence | Escalation, Risk, dashboard |
| compliance.evidence_submitted | Immutable submission commits | Verification queue, notifications |
| compliance.evidence_verified | Independent accepted decision | Status evaluator, gates invalidation, reporting |
| compliance.evidence_rejected | Reasoned rejection | Submitter, owner, evaluation |
| compliance.certificate_expiring | Credential threshold reached | Renewal queue, owners |
| compliance.certificate_expired | Validity ends | Gate invalidation, affected owner modules |
| compliance.project_gate_passed | Current operation evaluation passes | Projects audit/projection |
| compliance.project_gate_failed | Mandatory blocker recorded | Projects, Compliance escalation |
| compliance.finding_created | Finding recorded | Owner assignment, Risk for critical |
| compliance.finding_escalated | Severity/SLA escalation | Independent director/Risk/Compliance recipients |
| compliance.corrective_action_overdue | Incomplete action past due | Owner, Compliance, Risk |
| compliance.finding_closed | Successful effectiveness review | Reporting, Risk linkage update |
| compliance.exemption_requested | Request commits | Core approval workflow |
| compliance.exemption_approved | Final independent approval | Gate evaluator, exception register |
| compliance.exemption_expired | Expiry instant reached | Gate invalidation, owner, executive escalation |
| compliance.stop_work_issued | Stop decision commits | Projects/Site/Workforce/Plant, urgent independent notification |
| compliance.stop_work_released | Approved release commits | Affected owner modules; they still recheck other blockers |
| compliance.third_party_approved | Current requirements satisfied | Procurement eligibility projection |
| compliance.third_party_suspended | Mandatory breach/suspension | Procurement and Finance controls |
| compliance.regulatory_change_identified | Source candidate recorded | Legal/Compliance human review queue |
| compliance.regulatory_change_implemented | Approved actions evidenced | Effectiveness review, reporting |

Stable producer key: event_type/aggregate_id/aggregate_version/occurrence-or-transition ID. Reminder key also includes threshold and recipient; never wall-clock creation time. Write state, audit and Core outbox in one DB transaction. Dispatcher leases batches, publishes to existing Redis stream and records transport receipt; recover stale leases. Consumer validates schema/tenant, claims `(organization_id,event_id,consumer_key)` and writes business effect plus receipt atomically. ACK only after commit. Handle duplicate, out-of-order and replayed events; stale aggregate versions cannot restore prior compliant state. Delivery retry uses bounded exponential backoff and dead-letter records with authorised replay. Alert on oldest undelivered critical event and exhausted retries. External providers use stable idempotency identifiers; where unavailable document potential duplicate delivery, never duplicate business decisions.

Arq jobs: materialise recurring deadlines; sweep deadline thresholds/expiry; invalidate evidence/credential/exemption projections; escalate overdue CAPA/critical findings; dispatch and reclaim events; generate export packs. Execute tenant-scoped batches with leases and bounded runtimes. Catch-up uses persisted occurrence watermarks; restart cannot skip missed expiry. Calendar rules record timezone, business-day calendar, end-of-month and holiday policy; preview then approve revisions. Config changes do not rewrite historical deadlines.

## Owner integration contracts

| Owner | Synchronous control | Events / source evidence |
|---|---|---|
| Projects / Site Operations | Mobilisation and closeout command call gate in same transaction; stop-work blocks affected operations | Plan changes trigger reassessment; project passed/failed and stop-work events |
| Workforce / HR | Allocation/deployment validates subject and entire intended assignment period | Authoritative worker status/certification changes invalidate; do not duplicate personnel records |
| Plant | Asset/operator assignment checks mandatory credentials and stop-work | Existing fleet credential/inspection references; expiry invalidates |
| Procurement | Supplier approval and purchase-order issue recheck subject requirements | Party suspension changes eligibility; approved supplier still checked per PO |
| Finance | Payment authorisation and execution recheck payee compliance hold | Tax/payment receipts remain Finance evidence; event alone cannot stop a race at execution |
| Risk | Create/link risk escalation through owner service | Critical/overdue findings with immutable references; no duplicate enterprise risk register |
| Documents | Immutable version lookup, access checks and retention hold | Replacement/expiry/revocation/deletion attempts trigger invalidation or protection |
| Legal | Human decision and restricted reference | Approved interpretation supports rule; unavailable interpretation leaves unresolved |
| Executive | Read scoped, timestamped projection | Evidence-backed KPIs and critical escalation; no synthetic score |

Resolve owning schema/endpoint contracts again before each phase, especially uncommitted Workforce work. Missing integration is a release blocker for its dependent phase. Gate service failure never yields allow. A lawful exemption must name permitted operations; non-waivable safety/payment controls cannot be bypassed by a generic override.

## Screen inventory

All screens: skeleton/loading, meaningful empty state, recoverable error/retry, 403 state without leaked data, search and scoped filters, status text plus accessible icon/colour, keyboard controls, history drawer and permission-scoped relevant export. Mobile uses stacked cards, horizontal calendar agenda, labelled inputs and reachable actions; verify at 360px and desktop. Optimistic UI never displays approval before server confirmation. Show stale timestamp/offline state; disable decisions offline. No placeholder buttons.

| Navigation / route under `/dashboard/compliance` | Main content/actions | Phase |
|---|---|---|
| Compliance Overview / root | Current evidence coverage, critical blockers, owner workload, drilldown | 9 |
| Obligations / obligations | Version register, applicability matrix, draft/submit/revise | 2 |
| Compliance Calendar / calendar | Month/week/agenda, recurrence preview, overdue reminders | 3 |
| Registrations & Licences / credentials | Type register, renewal and version history | 4 |
| Project Compliance / projects | Plan, readiness, blockers, mobilisation/closeout proof | 5 |
| Third Parties / third-parties | Requirements matrix, conditional scope, suspension | 6 |
| Inspections / inspections | Programmes, approved checklist, schedule/results | 7 |
| Findings / findings | Severity, owner, escalation and root cause | 7 |
| Corrective Actions / corrective-actions | Plan, remediation evidence and effectiveness queue | 7 |
| Policies & Attestations / policies | Versions, distribution, assignments and acknowledgement | 8 |
| Regulatory Changes / regulatory-changes | Source, assessment, plan and approval timeline | 8 |
| Evidence / evidence | Requirement/submission linkage, provenance and independent review | 3 |
| Approvals / approvals | Scoped Core pending stages, reasoned decision and version diff | 2+ |
| Exceptions / exceptions | Requested/active/expiring, approvals and restricted override scope | 5+ |
| Reports / reports | Report parameters, export jobs and pack manifest | 9 |
| Administration / administration | Domains, authorities, sources, rule/settings versions, SoD conflicts | 2+ |

Preserve legacy employee/equipment/deployment links via adapters or redirects once replacement screens pass. HSE incident screen deep-links to HSE ownership. Expose each new navigation item only when the connected vertical slice is accepted.

## Report inventory and reconciliation

| Report | Grain and source | Reconciliation |
|---|---|---|
| Obligation/applicability register | Subject x obligation version x assessment | Include unresolved and approved N/A separately |
| Compliance coverage | Current mandatory item x requirement | Distinct eligible items; satisfied numerator requires valid evidence; independent and documentary counts separate |
| Calendar/overdue | Deadline occurrence | Occurrence IDs reconcile to register and reminder receipts |
| Credential expiry/renewal | Current credential version | Include missing expiry as unknown where expiry required |
| Project readiness | Mandatory project items at as_of time | Fulfilled/required percentage plus hard critical-blocker override; zero denominator is N/A/unknown |
| Third-party eligibility | Party x required item x operation | Suspensions/conditional scopes and expired evidence never counted as full approval |
| Findings/CAPA ageing | Finding/action x due date | Closed only from accepted effectiveness review; reopened separately |
| Policy attestations | Assignment x exact policy version | Required vs acknowledged; training reported independently |
| Regulatory implementation | Change x approved implementation action | Evidence and effectiveness completion separately |
| Exceptions/stop-work | Decision x scope x validity | Expired/revoked excluded from active authority, retained in history |
| Executive dashboard | Aggregated preceding sources | Same source query/filter/as_of as drilldown; disclose unknowns and stale projections |
| Audit/tender pack | Manifest of scoped records and exact evidence versions | Counts, IDs, digests, approvals and export snapshot; missing/restricted evidence visibly excluded |

PDF and spreadsheet exports share one authorised snapshot/query with on-screen totals; persist as_of, filters, rule versions, author and manifest hash. Async exports revalidate scope at download and expire access. Formula-escape spreadsheet text, constrain volumes and sanitise rendered text. Broad packs exclude legal privilege and personal data unless explicitly permitted. Use existing reporting/document renderers; no new file repository. Phase 9 tests reconcile source SQL, API and both export formats with the same fixture dataset.
