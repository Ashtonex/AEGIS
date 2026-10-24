# OPERATION IRONCLAD: ENTERPRISE MODULE REGISTER

**Client**: Six Nine Construction (Private) Limited  
**System**: AEGIS / Imperium Enterprise Resource Planning Ecosystem  
**Governing Standard**: SYSTEM INTEGRITY FIRST. OPERATIONAL CONTINUITY ALWAYS.

---

## Registered ERP Modules & Health Status

| Module Key | Name & Route | Core Backend Routers | Primary Invariant / Responsibility | Health Status |
| :--- | :--- | :--- | :--- | :--- |
| **MOD-01** | **Quotations & Estimating**<br>`/dashboard/quotations` | `routers/quotations.py`<br>`services/quotations/` | Rate buildup, BOQ creation, markup analysis, and project conversion | **HEALTHY / VERIFIED** |
| **MOD-02** | **Project Portfolio & Delivery**<br>`/dashboard/projects` | `routers/projects.py`<br>`services/projects/` | Project baseline, pre-mobilization gates, milestone tracking, BOQ line tracking | **HEALTHY / VERIFIED** |
| **MOD-03** | **Site Operations & Field Logs**<br>`/dashboard/site-operations` | `routers/site_operations.py`<br>`services/site/` | Daily site diaries, shift tracking, plant timesheets, field labor verification | **HEALTHY / VERIFIED** |
| **MOD-04** | **Corporate Finance & Treasury**<br>`/dashboard/finance` | `routers/finance.py`<br>`services/finance/` | Double-entry ledger, bank books, project money accounts, cash curve, statutory taxes | **HEALTHY / VERIFIED** |
| **MOD-05** | **Procurement & Inventory**<br>`/dashboard/procurement` | `routers/procurement.py`<br>`services/inventory/` | Purchase orders, 3-way matching, store receipts, stock isolation | **HEALTHY / AUDITED** |
| **MOD-06** | **Workforce & HR Operations**<br>`/dashboard/workforce` | `routers/workforce.py`<br>`services/hr/` | Artisan compliance, biometric time tracking, payroll GL bridge | **HEALTHY / AUDITED** |
| **MOD-07** | **Plant, Fleet & Equipment**<br>`/dashboard/fleet` | `routers/fleet.py`<br>`services/plant/` | Machine telematics, fuel logs, maintenance work orders, cross-hire tracking | **HEALTHY / AUDITED** |

---

## Inter-Module Dependency & Data Exchange Graph

```
                      +---------------------------------------+
                      |         MOD-01: ESTIMATIONS           |
                      |   (Quotations, BOQs, Rate Buildup)    |
                      +-------------------+-------------------+
                                          |
                        Convert / Link    | Seeds execution budget
                        & Win Decision    v
                      +---------------------------------------+
                      |          MOD-02: PROJECTS             |
                      | (Milestones, Pre-Mob Gate, Budget BOQ)|
                      +-------+-----------------------+-------+
                              |                       |
           Site Reports &     |                       | Cash Attribution &
           Field Labour       v                       v Commercial Ledgers
    +---------------------------------+       +---------------------------------+
    |     MOD-03: SITE OPERATIONS     |       |    MOD-04: CORPORATE FINANCE    |
    |  (Daily Diaries, Plant Shifts,  |       |   (Project Money, Bank Books,   |
    |      Weather, Progress)         |       |      Double-Entry General)      |
    +---------------------------------+       +---------------------------------+
```

---

## Module Boundary Integrity Rules

1. **Estimations to Projects Boundary**:
   - Marking a quotation "WON" must result in a project linkage (`project_id`).
   - If no project existed prior to winning, the system invokes `/convert-to-project` to establish a new project entity.
   - Budget allocation categories (Materials, Labour, Plant, Subcontractors, Prelims, Contingency) are strictly non-negative.
2. **Projects to Site Operations Boundary**:
   - Field reports must always bear a valid `project_id`.
   - Access to site daily logs must not be restricted to executive roles.
   - Query filters must support both `projectId` and `project` parameters across internal page switches.
3. **Projects to Corporate Finance Boundary**:
   - Any financial outflow or inflow initiated within a project workspace must write directly to the project ledger via the double-entry accounting engine (`ProjectMoneyModal`).
   - URL context navigation must bind active project filters seamlessly.
