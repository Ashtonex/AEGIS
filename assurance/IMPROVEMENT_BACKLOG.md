# AEGIS Assurance & Continuous Improvement Backlog

This backlog prioritizes high-impact operational improvements, failure modes, and integrity guards across the AEGIS ecosystem.

---

## Completed Improvements

### Cycle 1
- [x] **IMP-001 (Commercial Accounting)**: Fixed Subcontract Payment Certificate GL Posting to record **Gross Certified Amount** in `finance.cost_transactions` while routing retention withholding to `finance.retention_ledger`, eliminating project cost understatement.
- [x] **IMP-002 (Truthful Governance)**: Removed silent `on_track` fallback in Project Leadership Dossier; replaced with dynamic health evaluator that analyzes active delays, budget variances, and site reporting discipline.

### Cycle 2
- [x] **IMP-003 (Commitment Consumption & Headroom Invariance)**: Resolved generated column `GeneratedAlwaysError` on `finance.commitments.outstanding_amount` during PO creation and invoice fulfillment in [routers/procurement.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/procurement.py). Proved that approving supplier invoices decrements outstanding commitments from $\$100\text{k} \rightarrow \$65\text{k} \rightarrow \$0\text{k}$, preserving total financial headroom invariance ($\text{Invoiced} + \text{Open} = \text{Total Exposure}$) without double-counting against budget.
- [x] **IMP-004 (Tenant Isolation Automated Security Probe)**: Verified robust tenant boundaries between Tenant A and Tenant B across project metadata, leadership dossiers, and subcontract packages. Proved that JWT token tampering (spoofing `org_id` in token claims) is rejected with HTTP 403 Forbidden.
- [x] **IMP-005 (Certificate Reposting Idempotency Guard)**: Implemented short-circuit idempotency guard in `post_certificate_to_finance` returning `already_posted: true` when a certificate has already been posted to finance, eliminating duplicate entries in `finance.retention_ledger`.
- [x] **IMP-008 (Discipline Score Precedence & Truthful Risk Escalation)**: Corrected operator precedence bug in `discipline_score` calculation in [routers/projects.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/projects.py) where zero pending variations erroneously yielded 100 bonus points. Verified projects with elapsed schedule days and zero daily site reports escalate to `critical` or `at_risk` rather than masking absence of supervision.

### Cycle 3
- [x] **IMP-011 (Subcontract Certificate Concurrency Row-Lock)**: Deployed PostgreSQL `FOR UPDATE` row lock on `projects.subcontractor_certificates` and pre-insert existence check on `finance.retention_ledger` in [routers/projects.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/projects.py). Proved that 5 simultaneous asynchronous threads attempting to post the same certificate serialize safely without creating duplicate cost or retention ledger records.
- [x] **IMP-012 (Invoice Payment Decision Idempotency Guard)**: Deployed short-circuit guard in [routers/procurement.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/procurement.py) returning `already_approved: True` when an invoice has already been approved, preventing duplicate clicks or network retries from repeatedly decrementing open commitments.
- [x] **IMP-013 (Full Route Matrix Isolation Probe)**: Built and verified automated penetration suite across 10 read endpoints and 5 write mutation endpoints under an isolated Tenant B auditor, proving zero data leakage and zero cross-tenant mutation capability.

### Cycle 5
- [x] **IMP-014 (Fail-Closed Test Harness Process Contract)**: Updated all 4 QA test suites (`qa_assurance_cycle3_suite.py`, `qa_assurance_cycle2_suite.py`, `qa_ecosystem_integration_suite.py`, `qa_projects_execution_suite.py`) to enforce strict fail-closed exit codes: `sys.exit(1)` on test failures/blockers and `sys.exit(2)` on unhandled exceptions. Authored and proved with `qa_harness_selftest.py`.
- [x] **IMP-015 (Invoice Approval PostgreSQL Row-Lock Concurrency)**: Deployed `FOR UPDATE` row locks on `procurement.supplier_invoices` and `finance.commitments` in [routers/procurement.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/procurement.py), eliminating concurrent race condition vulnerabilities during payment decisions.
- [x] **IMP-016 (Policy A1 Over-Invoice Gating & Variation Enforcement)**: Enforced User Policy A1: Invoices exceeding remaining open commitment are rejected with HTTP 409 Conflict requiring formal variation approval; release held pending formal sign-off.
- [x] **IMP-017 (Policy A2 Adverse Dynamic Health Status Precedence)**: Remediated [routers/projects.py](file:///g:/work/ATMCAPPROJECTS/Mudekwa/AEGIS/imperium-api/routers/projects.py) to ensure adverse dynamic operational signals (`critical` or `at_risk`) strictly override any manual stored status, with provenance metadata recorded in the leadership dossier.

---

## Active & Prioritized Backlog (Post-Release / Next Milestones)

### 1. High Priority (P0) — Immutability & Contract Enforcement
- [ ] **IMP-009 (Certificate Row-Level Immutability)**: Enforce database constraint/trigger preventing modification of certified amounts or dates in `projects.subcontractor_certificates` once `status = 'posted_to_finance'` (requiring formal cancellation or credit adjustment voucher).
- [ ] **IMP-010 (Subcontract Retention Release Gate)**: Enforce defects liability period (DLP) expiration and practical completion sign-off check before permitting release of retention funds in `finance.retention_ledger`.

### 2. Medium Priority (P1) — Operational Workflows
- [ ] **IMP-006 (Site Compliance Denominator Refinement)**: Clarify compliance denominator in site daily reports by distinguishing elapsed calendar days from approved working days per baseline calendar (excluding non-working Sundays and public holidays).
- [ ] **IMP-007 (EOT Claim Approval Workflow Linkage)**: Build direct automatic adjustment between approved Extension of Time claims and the project schedule planned completion date.
