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

---

## Active & Prioritized Backlog (Cycle 3 & Beyond)

### 1. High Priority (P0) — Immutability & Contract Enforcement
- [ ] **IMP-009 (Certificate Row-Level Immutability)**: Enforce database constraint/trigger preventing modification of certified amounts or dates in `projects.subcontractor_certificates` once `status = 'posted_to_finance'` (requiring formal cancellation or credit adjustment voucher).
- [ ] **IMP-010 (Subcontract Retention Release Gate)**: Enforce defects liability period (DLP) expiration and practical completion sign-off check before permitting release of retention funds in `finance.retention_ledger`.

### 2. Medium Priority (P1) — Operational Workflows
- [ ] **IMP-006 (Site Compliance Denominator Refinement)**: Clarify compliance denominator in site daily reports by distinguishing elapsed calendar days from approved working days per baseline calendar (excluding non-working Sundays and public holidays).
- [ ] **IMP-007 (EOT Claim Approval Workflow Linkage)**: Build direct automatic adjustment between approved Extension of Time claims and the project schedule planned completion date.
