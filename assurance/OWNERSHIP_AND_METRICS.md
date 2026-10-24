# AEGIS Ownership & Metrics Definition Register

This register sets the strict commercial accounting and operational field ownership definitions across AEGIS.

---

## 1. Commercial & Financial Invariants

| Concept | Construction Standard Definition | Authoritative Source | Permitted Writers | Accounting Post Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **Gross Certified Work ($V_{gross}$)** | Cumulative monetary valuation of work completed on site to date | `projects.subcontractor_certificates` | Commercial Manager / Lead QS | Incremental gross ($V_{gross} - V_{prev}$) is posted to `finance.cost_transactions` as project expenditure. |
| **Retention Held ($R$)** | Contractually stipulated security withholding (typically 5–10%) | `finance.retention_ledger` | Commercial Manager | Stored under `movement_type = 'held'`. Never deducted from incurred cost; represents a balance sheet deferred liability. |
| **Net Cash Payable ($N_{pay}$)** | Cash disbursement authorized to bank ($V_{gross} - R - \text{Deductions}$) | Accounts Payable / Cashier | Finance / Cashier | Disbursed against vendor AP; matched to bank reconciliation. |
| **Budget at Completion ($BAC$)** | Master internal cost allowance baseline | `finance.project_budgets` | Commercial Director | Read-only in execution. Revisions require formal baseline budget versioning. |
| **Actual Cost Incurred ($AC$)** | Total posted expenditures (materials, direct labour, equipment, subcontracts) | `finance.cost_transactions` | System GL / AP | Continuous ledger sum. |
| **Open Commitments ($PO$)** | Contractual legal exposure on approved purchase orders | `finance.commitments` | Procurement / Buyer | Decrements as invoices are posted (`committed_amount - invoiced_amount`). |
| **Net Available Headroom** | Uncommitted cost buffer remaining before budget breach | Calculated Invariance | Derived Metric | $\text{Headroom} = BAC - (AC + PO)$. Zero double-counting. |

---

## 2. Operational & Governance Invariants

| Concept | Operational Definition | Authoritative Source | Gating Rule |
| :--- | :--- | :--- | :--- |
| **Site Day Opening** | Commencement of physical site operations for shift | `projects.site_day_briefings` | Morning briefing with attendance required. |
| **Daily Site Report** | Contemporary factual site diary of labour, plant, and progress | `projects.daily_site_reports` | Cannot be created unless `labour_count_completed`, `toolbox_talk_completed`, and `ppe_check_completed` are verified true. |
| **Project Health Assessment** | Truthful executive health indicator | `projects.projects` / Dynamic Evaluator | Evaluated dynamically: flags `critical` if delays $\ge 3$ or spend variance $> \$10,000$; `at_risk` if delays $\ge 1$ or discipline score $< 70$. Never hardcoded to `on_track`. |
