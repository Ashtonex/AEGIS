# OPERATION IRONCLAD: DATA RECONCILIATION & INTEGRITY ASSURANCE

**Client**: Six Nine Construction (Private) Limited  
**System**: AEGIS / Imperium Enterprise Resource Planning Ecosystem  
**Governing Standard**: SYSTEM INTEGRITY FIRST. OPERATIONAL CONTINUITY ALWAYS.

---

## 1. Reconciliation Invariant Matrix

| Domain | Invariant Rule | Verification Method | Status |
| :--- | :--- | :--- | :--- |
| **Quotation ↔ Budget** | `Quote.Cost = Σ(Budget.LineItems)` | Budget extraction sums match quotation estimated costs (ex-markup). | **VERIFIED** |
| **Project ↔ Site Reports** | `Report.Project_ID ∈ Projects.ID` | Every site diary, plant log, and labour entry resolves to a valid project. | **VERIFIED** |
| **Project ↔ Finance Money** | `Money.Project_ID ∈ Projects.ID` | Every project advance, retention, valuation, and expense is attributed in `finance.project_entries`. | **VERIFIED** |
| **Double-Entry Balance** | `Σ(Debits) - Σ(Credits) = 0` | All project journal transactions post balanced counter-entries. | **VERIFIED** |

---

## 2. Invariant Analysis & Guarantees

### A. Quotations to Project Budget Invariant
When an estimate is converted or linked to a project:
1. `quote_amount` represents the contract commercial price inclusive of profit margin.
2. The operational execution budget (`finance.project_budgets`) is seeded from the *cost components*:
   $$\text{Budget Total} = \text{Materials} + \text{Labour} + \text{Equipment} + \text{Subcontract} + \text{Preliminaries} + \text{Overhead} + \text{Contingency}$$
3. The planned margin is segregated:
   $$\text{Contract Price} - \text{Budget Total} = \text{Planned Gross Profit}$$
4. If actual costs exceed the justified earned value during delivery, an automated alert (`margin_alert_raised`) triggers for executive review.

### B. Site Operations Invariant
1. Site reports (`site_reports` table) store date, shift, weather, delays, and work summaries tied to `project_id`.
2. Frontend queries must not fail due to unrelated permission checks:
   - `getDailySiteReports({ projectId })` is authorized for `site.read` / `projects.read`.
   - Decoupled from `getExecutiveProjectDetail` which requires `executive.view_dashboard`.
3. Bidirectional parameter binding (`?projectId=` and `?project=`) ensures URL deep links remain valid across browser refreshes and inter-module transitions.

### C. Financial Attribution Invariant
1. `ProjectMoneyModal` submits atomic entries via `createProjectMoneyEntry`.
2. Transactions enforce ledger validation:
   - Category (`client_inflow`, `supplier_outflow`, `subcontractor`, `labour`, `overhead`, `retention`, `advance`).
   - Method (`bank_transfer`, `cash`, `ecocash`, `rtgs`, `usd_nostro`).
   - Counterparty reference and decimal amounts.
3. Corporate cashflow curves (`/dashboard/finance/cash-curve`) immediately reflect project money movements.
