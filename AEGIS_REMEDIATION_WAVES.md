# AEGIS Prioritized Remediation Waves

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Private) Limited (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  
**Operating Principle**: Small, traceable, tested, behavior-preserving repairs without routine phase-selection pauses.

---

## Remediation Wave Overview

| Wave | Domain Focus | Scope | Pre-Requisites |
|---|---|---|---|
| **WAVE 0** | **Safety Net & Observability** | Request IDs, structured error handling, global JSON exception handlers, CI regression baseline. | Baseline Reality Report (Complete) |
| **WAVE 1** | **UX & Navigation Persistence** | Persistent sidebar accordion state (`openGroups`), desktop mini-rail mode, mobile drawer stability. | Wave 0 |
| **WAVE 2** | **Security & Permission Guardrails** | CI permission registry validation guard, tenant scoping checks, storage bucket isolation. | Wave 0 |
| **WAVE 3** | **Performance & Request De-escalation** | Composite workspace bundle endpoints, 21-request executive fan-out reduction, connection pool tuning. | Wave 1, Wave 2 |
| **WAVE 4** | **Data Truth & Anti-Mock Sanitization** | Remove CMS mock fallbacks, label simulations, enforce explicit empty/pending states. | Wave 0, Wave 2 |
| **WAVE 5** | **Core Supply Chain & Finance Integration** | Projects ↔ Site Stores ↔ Procurement ↔ Inventory ↔ Finance 3-way match atomic reconciliation. | Wave 2, Wave 3 |
| **WAVE 6** | **Module Completion (Finite Slices)** | Finish Client Portal tickets, Supplier onboarding, Quotation signed links, HSE closure. | Waves 0–5 |
| **WAVE 7** | **Fat Router Domain Extraction** | Staged extraction of raw SQL from `projects.py`, `fleet.py`, `crm.py` into typed domain services. | Waves 0–6 |
| **WAVE 8** | **Migration Governance & Schema Baseline** | Authoritative migration ledger, forward/compensating change standards, schema squash plan. | Waves 0–7 |

---

## Detailed Plans: The First Three Recommended Waves

---

### WAVE 0: Safety Net, Observability & Structured Errors

**Goal**: Guarantee that every failure is visible, traceable, and returns structured JSON rather than blanking the screen with generic "service unavailable" text.

#### Implementation Slice 0.1: Backend Global JSON Exception Handlers
- **Problem**: Unhandled exceptions in `imperium-api` default to Starlette's plain text `Internal Server Error`, which causes frontend JSON parsing to fail and triggers the generic fallback.
- **File**: `imperium-api/main.py`
- **Action**: Add global exception handlers for `SQLAlchemyError`, `SATimeoutError`, and `Exception` returning `{ success: false, error: { code, message, request_id } }` with correlation ID.
- **Verification**: Pytest verification of structured JSON response on simulated 500/503 errors.

#### Implementation Slice 0.2: Frontend Error Taxonomy & Correlation ID Display
- **Problem**: `aegis-web/src/lib/api/core.ts` discards HTTP status codes and correlation IDs on 500+ errors.
- **File**: `aegis-web/src/lib/api/core.ts`
- **Action**: Preserve status codes, extract plain-text snippets, and display `X-Correlation-ID` for diagnostic tracing.
- **Verification**: `npm run typecheck` + simulated failed API fetch.

---

### WAVE 1: UX Reliability, Navigation Persistence & Layout

**Goal**: Fix the non-persistent, collapsing sidebar, introduce desktop mini-rail mode for data-dense tables, and stabilize mobile drawer behavior.

#### Implementation Slice 1.1: Persistent Sidebar Accordion State (`openGroups`)
- **Problem**: `openGroups` in `DashboardShell.tsx:51` is ephemeral `useState`, resetting all expanded groups on refresh or route transition.
- **File**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Action**:
  - Initialize `openGroups` from `localStorage.getItem("aegis:nav:open-groups")`.
  - Update `localStorage` whenever a group is toggled.
  - Automatically keep the active route's parent domain expanded without wiping user toggles.
- **Verification**: Manual browser verification: expand "Supply Chain" -> refresh page -> verify "Supply Chain" remains open.

#### Implementation Slice 1.2: Desktop Mini-Rail Mode (Collapsible Sidebar)
- **Problem**: Sidebar is permanently locked at `w-56` (224px), squeezing wide spreadsheets (BOQs, project budgets, cash curves).
- **File**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Action**:
  - Add a collapse toggle button (`ChevronLeft` / `ChevronRight` or `PanelLeftClose`).
  - Collapse `aside` from `w-56` to `w-16` with icon-only tooltips.
  - Persist sidebar collapsed preference (`aegis:nav:sidebar-collapsed`) in `localStorage`.
- **Verification**: Responsive rendering check across desktop and wide displays.

#### Implementation Slice 1.3: Mobile Drawer Sub-Branch Navigation
- **Problem**: `DashboardShell.tsx:178` closes the drawer on every URL change, disrupting nested module browsing.
- **File**: `aegis-web/src/app/dashboard/DashboardShell.tsx`
- **Action**: Close drawer only on final leaf link click, not on accordion expansion.
- **Verification**: Mobile viewport testing.

---

### WAVE 2: Security & Permission Guardrails

**Goal**: Prevent permission drift and guarantee that every route-declared permission key exists in the database.

#### Implementation Slice 2.1: Automated Permission Catalog CI Guard
- **Problem**: Over 30 migrations were required in the past to patch 403 Forbidden errors caused by route permission keys not being seeded in `core.permissions`.
- **File**: `imperium-api/tests/test_permission_registry_contract.py`
- **Action**:
  - Create a test that extracts every `require_permission("...")` string across all 80+ router files.
  - Assert that every key is present in migration seed files or `core.permissions` fixture.
- **Verification**: Execute `pytest tests/test_permission_registry_contract.py`.

#### Implementation Slice 2.2: Automated Tenant Scoping Static Linter
- **Problem**: Multi-tenancy in 1,316 raw SQL queries relies on developer discipline.
- **File**: `imperium-api/tests/test_tenant_scoping_contract.py`
- **Action**:
  - Scan all router SQL execution calls to verify that queries touching tenant-scoped tables include `:org_id` or join through a tenant-scoped parent.
- **Verification**: Pytest verification of tenant query contracts.
