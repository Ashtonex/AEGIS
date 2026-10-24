# OPERATION IRONCLAD: SYSTEM REQUIREMENTS

**Client**: Six Nine Construction (Private) Limited  
**System**: AEGIS / Imperium Enterprise Resource Planning Ecosystem  
**Governing Standard**: SYSTEM INTEGRITY FIRST. OPERATIONAL CONTINUITY ALWAYS.

---

## 1. Traceability Matrix

| Requirement ID | Domain | Business Owner | Status | Associated Defect / Verification |
| :--- | :--- | :--- | :--- | :--- |
| **IR-REQ-001** | Commercial Estimations & Projects | Head of Estimating / Commercial Director | **VERIFIED** | IR-DEF-001 / IR-TEST-001 |
| **IR-REQ-002** | Site Operations & Field Management | Contracts Director / Head of Operations | **VERIFIED** | IR-DEF-002 / IR-TEST-002 |
| **IR-REQ-003** | Financial Control & Cashflow Ledger | Chief Financial Officer / Financial Controller | **VERIFIED** | IR-DEF-003 / IR-TEST-003 |
| **IR-REQ-004** | Project Governance & Delivery Gateways | Quality & Compliance Lead | **VERIFIED** | IR-DEF-004 / IR-TEST-004 |

---

## 2. Requirement Specifications

### IR-REQ-001: Quotation-to-Project Lifecycle Synchronization & Budget Derivation
- **Statement**: An approved commercial estimate or tender quotation must possess the capability to transition directly into an operational project without manual re-entry or loss of rate build-up data.
- **Acceptance Criteria**:
  1. Winning an estimate (`status = "won"`) must either link to an existing active project or convert into a newly provisioned project.
  2. The system must extract the rate build-up components (materials, labour, plant/equipment, subcontractors, preliminaries, overhead, contingency) into `finance.project_budgets` and associated line items.
  3. Protected profit margins must be deliberately preserved and segregated from the operational cost baseline.
  4. The frontend Quotations interface must surface the project synchronization status on every estimate row, allowing instant conversion, linking, or deep-linking to the project workspace.

### IR-REQ-002: Field Operations Observability & Operational Role Decoupling
- **Statement**: Site logs, daily diaries, plant timesheets, and labour allocations must hydrate reliably for all operational site personnel without reliance on executive-level permissions.
- **Acceptance Criteria**:
  1. The project site-logs workspace must fetch site reports via direct, scoped endpoints (`getDailySiteReports`) rather than relying on executive aggregated endpoints (`getExecutiveProjectDetail`).
  2. Site personnel (Site Engineers, Foremen, Quantity Surveyors) must have zero-friction navigation between the Project Site Logs view and the detailed Site Operations workbench.
  3. URL query parameters (`projectId` and `project`) must be preserved across navigations to maintain active site context without manual project re-selection.

### IR-REQ-003: Bidirectional Financial Reconciliation & Cashbook Attribution
- **Statement**: Corporate finance ledgers and project financial workspaces must maintain two-way navigation, consistent project selection state, and atomic transaction entry.
- **Acceptance Criteria**:
  1. When navigating from `/dashboard/projects/[id]/financials` to `/dashboard/finance/project-financials`, the active project ID must be read from URL query parameters and bind both the commercial overview and the money book.
  2. Project managers and financial controllers must be able to record project financial transactions (advance payments, client valuations, supplier bills, retention deductions) directly within the Project Financials workspace.
  3. All posted financial records must maintain decimal precision, valid double-entry counter-accounts, and immutable audit timestamps.

### IR-REQ-004: Pre-Mobilization Gateway & Compliance Enforcement
- **Statement**: Projects must not advance to active construction delivery until all pre-mobilization gates (safety clearances, commercial contracts, environmental approvals) are formally signed off.
- **Acceptance Criteria**:
  1. API routers must enforce pre-mobilization status validation.
  2. Automated contract tests must verify that unauthorized progression to active status without required gate signoffs returns a 422/400 validation error.
