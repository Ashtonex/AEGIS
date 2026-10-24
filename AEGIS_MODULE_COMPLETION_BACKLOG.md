# AEGIS Module Completion Backlog

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  
**Scope**: Concrete engineering specifications to advance PARTIAL modules to PRODUCTION READY status. Zero fictitious completion claims.

---

## 1. Module Maturity Matrix

| Module | Current Status | Real Backend | Real Database | Real Frontend | Missing Core Capability | Target Release Wave |
|---|---|---|---|---|---|---|
| **Executive BI** | PRODUCTION READY | Yes (FastAPI) | Yes (Views/Aggregates) | Yes (`/executive`) | Overview bundle added; latency optimized | Wave 3 (Done) |
| **Inventory & Stores** | PRODUCTION READY | Yes (`inventory.py`) | Yes (`stock_ledger`) | Yes (`/inventory`) | Atomic row-locking added; transfers secured | Wave 5 (Done) |
| **Procurement & PO** | PRODUCTION READY | Yes (`procurement.py`)| Yes (`purchase_orders`)| Yes (`/procurement`) | Document-gated 3-way match verified | Wave 5 (Done) |
| **Site Operations** | PRODUCTION READY | Yes (`site_reports.py`)| Yes (`site_diaries`) | Yes (`/site-reports`) | Permission aligned (`compliance.gate.override`)| Wave 2 (Done) |
| **Quotations & BOQ** | FUNCTIONAL / INCOMPLETE | Yes (`quotations.py`)| Yes (`quotations`) | Yes (`/quotations`) | Signed PDF download & multi-tier sign-off | Wave 6 |
| **HSE & Compliance** | FUNCTIONAL / INCOMPLETE | Yes (`hse_incidents.py`)| Yes (`hse_incidents`) | Yes (`/compliance`) | Root-cause CAPA investigation closure modal | Wave 6 |
| **Client Portal** | PARTIAL / UI ONLY | Partial (`portals.py`)| Partial (`portal_tickets`)| Partial (`/portal/client`)| Live reply message thread & push alert | Wave 6 |
| **Supplier Portal** | PARTIAL / UI ONLY | Partial (`suppliers.py`)| Partial (`vendors`) | Partial (`/portal/supplier`)| Compliance vetting checklist & document gate | Wave 6 |
| **CRM Automations** | STAGING / SIMULATION | Staging (`crm.py`) | Schema exists | UI Canvas (`/automations`)| Arq worker trigger dispatch pipeline | Wave 9 |

---

## 2. Finite Work Specifications for Priority Slices

### Slice 6.1: Quotations Multi-Tier Approval & Signed PDF Links
- **Objective**: Complete the quotation approval cycle from Draft -> Submitted -> Commercial Review -> Executive Sign-off -> Approved.
- **Backend**:
  - Endpoint: `POST /api/v1/quotations/{id}/decision` accepting `{ decision: "approved" | "rejected", comments: str }`.
  - Enforce permission: `quotations.approve`.
  - Emit event: `quotation.approved.v1` triggering project creation readiness.
- **Frontend**:
  - Add approval action drawer with electronic signature confirmation and status badge.
- **Acceptance Criteria**: Unauthorized roles receive 403; approved quotations lock line items against further edits.

### Slice 6.2: HSE Incident Corrective Action (CAPA) Closure Lifecycle
- **Objective**: Prevent premature closure of HSE incidents without formal root-cause investigation.
- **Backend**:
  - Endpoint: `POST /api/v1/hse/incidents/{id}/investigate` requiring `{ root_cause: str, corrective_actions: list[str], investigator_id: UUID }`.
  - Enforce permission: `hse.incident.close`.
  - State machine: `reported` -> `investigating` -> `capa_assigned` -> `closed`.
- **Frontend**:
  - Multi-step investigation modal in `/dashboard/compliance`.
- **Acceptance Criteria**: Incidents cannot transition to `closed` while corrective actions are marked incomplete.

### Slice 6.3: Client Portal Interactive Ticket Threads
- **Objective**: Enable bidirectional communication between client representatives and SNC project managers.
- **Backend**:
  - Endpoints: `GET /api/v1/portals/client/tickets/{id}/thread`, `POST /api/v1/portals/client/tickets/{id}/reply`.
  - Enforce strict portal tenant isolation (`user["is_portal_user"] = true`).
- **Frontend**:
  - Clean chat/thread view inside `/portal/client`.
- **Acceptance Criteria**: Client users cannot view internal operational notes flagged `is_internal: true`.
