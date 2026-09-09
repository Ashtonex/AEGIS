# Permissions, segregation and controlled workflows

## Permission matrix

Capabilities extend `core.permissions`; existing role membership and `require_permission` remain authoritative. Role labels below are configurable templates, not hard-coded approval rules. Map existing labels (such as Executive (Admin), Internal Auditor and HSE / Safety Officer) explicitly; do not silently grant new capabilities. Scope every capability by organisation, assigned project/department/subject and classification. Deny by default, including exports and signed document links.

Codes: R scoped read; W draft/create/edit; S submit evidence; V independent evidence verification; A applicability/obligation approval; L legal review; K risk review; D director approval; F independent effectiveness review; G issue stop-work; U approve release; C configuration/role administration; X authorised export. Each expands to `compliance.<resource>.<action>`; there is no blanket write permission. Examples: `compliance.obligation.create`, `.submit`, `.approve`, `.revise`; `compliance.applicability.approve`; `compliance.evidence.submit`, `.verify`; `compliance.finding.effectiveness_review`; `compliance.stop_work.issue`, `.release`; `compliance.exemption.director_approve`; `compliance.restricted.read`; `compliance.report.export`.

| Requested role | Default capabilities | Scope / exclusions |
|---|---|---|
| System Administrator | C technical | No business approval or unrestricted tenant-content access by default |
| Organisation Administrator | R,C | Tenant configuration; no automatic verification/approval |
| Managing Director | R,D,U,X | Organisation; independent from request and prior review |
| Director | R,D,U,X | Assigned portfolio; independent stages |
| Compliance Officer | R,W,A,G,X | Obligation, applicability, inspections, findings and change coordination; no approval of own drafts |
| Legal Reviewer | R,L | Assigned legal basis and restricted references; no universal export |
| Risk/Internal Control Officer | R,K,F,X | Independent reviews and escalations; no remediation self-review |
| Project Manager | R,W,S,G | Assigned projects, plans, actions and emergency stop-work |
| Site Agent | R,S,G | Assigned sites/projects; emergency stop-work allowed with recorded grounds |
| HSE Officer | R,S,G | Safety-derived evidence; operational inspection remains HSE |
| HR Officer | R,S | Workforce requirements; restricted personal scope |
| Finance Officer | R,S | Statutory payment evidence and hold visibility; no compliance override |
| Procurement Officer | R,S | Assigned suppliers/subcontractors; no final approval of own submissions |
| Plant Manager | R,S,G | Assigned assets and credential evidence |
| Department Owner | R,W,S | Assigned obligations/actions; no own closure approval |
| Evidence Submitter | R,S | Assigned requirements only |
| Evidence Verifier | R,V | Authorised evidence class, excludes own/subject evidence |
| External Auditor | R,X | Explicit engagement scope and expiry; restricted material excluded unless granted |
| Regulator/Client Read-Only Reviewer | R | Approved project pack scope, expiry and redactions; X only explicitly granted |

Policy assignment and acknowledgement use separate `policy.assign` and `policy.acknowledge` capabilities. The latter is subject-only and cannot acknowledge on someone else's behalf. Inspection, CAPA and regulatory-change actions use resource-specific permissions from W; W never includes final decision. Confidential personal/investigation/legal categories require explicit restricted grants; role names alone do not unlock them. Administrator permission bypass, if present in existing RBAC, must never bypass SoD, evidence or workflow guards.

## Segregation-of-duties matrix

| Incompatible combination | Configuration-time detection | Command-time rule |
|---|---|---|
| Evidence submit + verify | Report combined grants; require independent reviewer allocation | Submitter, subject and delegated originator cannot verify same submission |
| Obligation author + approve | Warn/block assignment of same actor as sole approver | Author cannot approve own version or applicability decision |
| Exemption request + director approve | Reject same workflow allocation | Requester/beneficiary cannot approve; each required stage uses distinct actor |
| Remediation owner + effectiveness review | Flag ownership conflict | Owner/action implementer cannot confirm effectiveness or close |
| Regulatory-change proposer + final approve | Require alternate reviewer | Human source verification and independent final approval |
| Role administration + business approval | Flag toxic grant combinations and audit grant changes | No self-grant route to approving one's own pending record |
| Stop-work release requester + release approver | Require independent authorised approver | Issuer/requester cannot independently release without required clearance approval |

Holding multiple permissions may be operationally necessary; record-level hard denials always apply. Role editing runs the conflict detector and shows affected pending workflows; incompatible assignment to all review stages is rejected. Re-evaluate current memberships at decision time. No emergency self-verification. If staffing cannot satisfy independence, remain blocked and escalate to a separately authorised reviewer.

## Approval matrix

All approvals use Core workflow instances, exact target version/hash, server timestamps, reason, tenant and actor; stages are configurable versioned templates with mandatory floors below. Subject/initiator exclusions apply even to executives. Reject and return require reasons. Rejection makes no positive compliance determination.

| Decision | Minimum sequence | Required proof |
|---|---|---|
| Activate obligation | Independent Compliance approval; Legal review when interpretation required | Verified source, jurisdiction, effective/review dates, applicability and accountable owner |
| Not applicable | Independent Compliance approval; Legal review for legal ambiguity | Specific subject/scope, evidence-backed reason, review date; AI recommendation insufficient |
| Accept evidence | Independent qualified verifier | Exact document version, required criteria, identity/issuer checks, current validity |
| Activate credential | Evidence verification then guarded activation | Accepted evidence, valid dates and issuer/number; no direct status submission |
| Approve project plan | Project submission then Compliance approval | Approved applicable requirements, critical flags and mobilisation/closeout criteria |
| Exemption / material exception | Compliance review -> Legal and/or Risk when required -> independent Director | Authority/source permitting exemption, justification, current evidence, scope, expiry, controls; non-waivable obligations cannot be overridden |
| Finding action plan | Accountable owner submits -> independent Compliance approver | Root cause, action owners, deadlines, success measures |
| Finding closure | Independent effectiveness reviewer | Remediation evidence, elapsed observation period, effective result and no unresolved critical actions |
| Policy version | Owner submits -> designated independent approver; Legal where required | Controlled document version, distribution/assignment and training plan |
| Regulatory change | Source verification -> applicability -> impact/plan reviews -> human final approval | Verified source, affected rules/projects, implementation owners, due dates |
| Stop-work issue | Authorised actor or configured critical-rule trigger immediately | Grounds, affected operations and durable critical escalation; no delay waiting for director |
| Stop-work release | Compliance clearance + independent director approval | Current remediation/effectiveness proof, all non-waivable blockers resolved |
| Third-party conditional approval | Compliance review + exception approval as required | Specific permitted operations, expiry and compensating controls; no blanket payment permission |

## Status machines

Display labels correspond to snake_case values. Every edge checks current state, expected lock version, permission, SoD and prerequisites inside one transaction. No generic PATCH of status. Self-loops are only idempotent replay of the same command. Actions not listed are denied.

| Aggregate | Allowed progression | Branches / guards |
|---|---|---|
| Obligation | Draft -> Under Review -> Applicable -> Active -> Superseded or Archived | Under Review -> Not Applicable only approved scoped decision. Under Review -> Draft on reasoned return/rejection. Applicable denotes approved rule; Active requires effective date and owner. N/A is a subject assessment outcome; a global obligation is marked N/A only if every in-scope subject has approved N/A. New scope creates unresolved assessments. Superseded/Archived immutable; revise creates new Draft version |
| Compliance item | Action Required -> Evidence Submitted -> Under Verification -> Compliant / Partially Compliant / Non-Compliant / Returned | Returned -> Evidence Submitted via new submission. Partial/Non-Compliant -> Evidence Submitted on remediation. Compliant -> Action Required when evidence expires/revokes or requirements change; retain prior decision. Final outcome requires all mandatory criteria; documentary-only has explicit assurance label |
| Certificate (all credentials) | Draft -> Submitted -> Verified -> Active -> Expiring -> Expired / Suspended / Revoked / Replaced | Submitted -> Draft only by reasoned return creating revision. Active may directly expire, suspend, revoke or replace. Expiring threshold is configured; expiry also derived synchronously. Replaced requires verified successor. Suspended -> Under review via new Submitted revision before reactivation. Expired/revoked versions cannot be edited active |
| Finding | Open -> Assigned -> Root Cause Required -> Action Plan Approved -> Remediation in Progress -> Evidence Submitted -> Effectiveness Review -> Closed / Reopened | Effectiveness failure -> Reopened -> Assigned. Returned remediation -> Remediation in Progress with reason. Closed -> Reopened on ineffective/invalidated proof. Critical severity cannot be downgraded without independent review and preserved escalation |
| Exemption | Requested -> Compliance Review -> Legal/Risk Review where required -> Director Approval -> Active -> Expiring -> Expired / Revoked / Closed | Review -> rejected/returned outcome captured by Core decision; returned request is revised and restarts Requested. Active may expire/revoke/close directly. Expiry always wins over stale cache; extension is a new approved revision |
| Regulatory change | Identified -> Source Verified -> Applicability Assessment -> Impact Assessment -> Implementation Plan -> Approved -> Implemented -> Effectiveness Verified -> Closed | Failed review returns to relevant assessment/plan stage with reason and new revision. Implementation requires proof from owning modules; failed effectiveness returns to Implementation Plan. Approved plan changes require fresh approval |

Registrations, licences, permits and insurance use the certificate lifecycle with type-specific required fields. Finding closure and corrective-action completion remain separate. A policy acknowledgement records receipt of one version, never general agreement or training completion.

## Evidence, gates and audit invariants

Gate request includes operation type, subject, project, intended effective time and source transaction. Evaluate all current applicable mandatory requirements and active stop-work/suspension. Unknown applicability, stale evidence, unavailable authority data or evaluator errors fail closed for mandatory gates. Return reason codes, evidence/version IDs, checked_at, valid_until, rule-set hash and exception limits. Lock the affected subject/requirements in a consistent order and recheck within the owning operation transaction; no time gap between clearance and commit. For scheduled operations validate the intended interval, not merely today.

Record blocked attempts after the operation rolls back, using a separate explicit audit transaction; do not commit the caller's partial writes. Gate pass events do not authorise future operations. Expiry or regulatory invalidation triggers reassessment, alerts and controls for ongoing operations, not just new requests.

Every mutation records Core audit with actor, tenant, reason, before/after version, approval, request/correlation ID and source references. App/runtime roles cannot update/delete audit or accepted proof. Database administrative access remains an infrastructure trust boundary: protected backups and tamper-evident export/retention are required; do not claim protection against unrestricted database administrators from RLS alone. Sensitive audit payloads use IDs/digests and redaction rather than copied legal/personnel content.
