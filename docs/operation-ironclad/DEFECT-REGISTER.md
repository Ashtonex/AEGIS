# OPERATION IRONCLAD: DEFECT REGISTER

**Client**: Six Nine Construction (Private) Limited  
**System**: AEGIS / Imperium Enterprise Resource Planning Ecosystem  
**Governing Standard**: SYSTEM INTEGRITY FIRST. OPERATIONAL CONTINUITY ALWAYS.

---

## Defect Inventory

| Defect ID | Severity | Module / Domain | Summary Description | Status |
| :--- | :--- | :--- | :--- | :--- |
| **IR-DEF-001** | P1 - CRITICAL | Quotations ↔ Projects | Quotation winning / project sync returns Not Found or cannot convert unlinked estimate into project budget | **VERIFIED** |
| **IR-DEF-002** | P1 - HIGH | Site Operations ↔ Projects | Site logs on project workspace blocked by executive permission wall; no bidirectional navigation with Site Operations | **VERIFIED** |
| **IR-DEF-003** | P1 - HIGH | Project Financials ↔ Finance | Project Financials disconnected from Corporate Finance; query param `projectId` ignored; no direct ledger posting | **VERIFIED** |
| **IR-DEF-004** | P2 - MEDIUM | Projects Router Contract | SQL update mock mismatch in `test_pre_mobilisation_gate_blocks_active_delivery_until_approved` | **VERIFIED** |
| **IR-DEF-005** | P2 - HIGH | Security & RBAC Registry | Unseeded permission keys in `projects.py` causing contract failure and potential runtime 403 Forbidden | **VERIFIED** |
| **IR-DEF-006** | P2 - HIGH | Procurement & Inventory | Inventory stock issue endpoint permission contract mismatch breaking supply chain contract assertion | **VERIFIED** |

---

## Detailed Defect Records

### IR-DEF-001: Quotation to Project Sync & Conversion Failure
- **Severity**: P1 - CRITICAL
- **Component**: `imperium-api/routers/quotations.py`, `aegis-web/src/app/dashboard/quotations/page.tsx`, `aegis-web/src/app/dashboard/quotations/ConvertProjectModal.tsx`, `aegis-web/src/lib/api/quotations.ts`
- **Discovered**: During cross-module workflow testing. Approved BOQs created via manual calculators, tender takeoff, or opportunity pipelines maintained `project_id = NULL`. Marking the quote "WON" silently skipped budget generation (`if quotation.get("project_id"):`), leaving no path to convert or seed `finance.project_budgets`.
- **Diagnosis**:
  1. The backend lacked an authorized endpoint to convert a quotation into a new project or explicitly link an existing project.
  2. The frontend quotations table lacked project identification badges, project links, or conversion modals.
  3. The decision endpoint `decide_quotation` did not attempt fallback project matching when `project_id` was unlinked.
- **Repair**:
  1. Added `POST /api/v1/quotations/{id}/convert-to-project` in `routers/quotations.py` with transactional project creation and automatic line-item budget derivation.
  2. Added `POST /api/v1/quotations/{id}/link-project` to bind an existing project to a quotation and seed `finance.project_budgets`.
  3. Enhanced `decide_quotation` ("won") to look up matching candidate projects by client name or quotation title if unlinked.
  4. Added API client methods `convertQuotationToProject` and `linkQuotationToProject` in `lib/api/quotations.ts`.
  5. Implemented `ConvertProjectModal.tsx` in `src/app/dashboard/quotations/` and mounted it in the quotations table, with auto-prompting upon winning an unlinked estimate.
- **Verification Evidence**:
  - `npm run typecheck` passed cleanly (exit code 0).
  - Pytest suites `test_projects_router_contract.py` and `test_quotation_module_hardening.py` passed cleanly (exit code 0).
- **Status**: **VERIFIED**

---

### IR-DEF-002: Site Operations ↔ Projects Field Logs Permission Wall & Disconnect
- **Severity**: P1 - HIGH
- **Component**: `aegis-web/src/hooks/useProjectWorkspace.ts`, `aegis-web/src/app/dashboard/projects/[id]/site-logs/page.tsx`, `aegis-web/src/app/dashboard/site-operations/page.tsx`
- **Discovered**: Field site reports (`/dashboard/projects/[id]/site-logs`) were returning empty/blank for non-executive users (Site Engineers, Foremen, QS), and no bidirectional deep-linking existed between project workspaces and daily site operations.
- **Diagnosis**:
  1. In `useProjectWorkspace.ts`, site reports were sourced exclusively from `getExecutiveProjectDetail(projectId)`, which requires `executive.view_dashboard` permission. When non-executives accessed project site logs, the 403 Forbidden caused the hook to fall back to an empty array.
  2. Site logs in project workspaces did not link to specific site days or activities in Site Operations.
  3. `/dashboard/site-operations` only checked `?project=` and ignored standard `?projectId=`, and provided no quick return navigation to the Project Workspace.
- **Repair**:
  1. Updated `useProjectWorkspace.ts` to fetch `getDailySiteReports({ projectId })` independently in parallel with `Promise.allSettled`.
  2. Updated `ProjectSiteLogsPage` (`projects/[id]/site-logs/page.tsx`) to render deep links to `/dashboard/site-operations?projectId=${projectId}&date=${date}` on each report card.
  3. Updated `SiteOperationsPage` (`site-operations/page.tsx`) to support both `?projectId=` and `?project=`, rendered an active project indicator badge, and provided direct navigation back to `/dashboard/projects/${activeProjectId}` and `/dashboard/projects/${activeProjectId}/site-logs`.
- **Verification Evidence**:
  - `npm run typecheck` passed cleanly (exit code 0).
  - Pytest suite `test_site_operations_unified_flow.py` passed cleanly (exit code 0).
- **Status**: **VERIFIED**

---

### IR-DEF-003: Project Financials ↔ Corporate Finance Module Disconnect
- **Severity**: P1 - HIGH
- **Component**: `aegis-web/src/app/dashboard/finance/page.tsx`, `aegis-web/src/app/dashboard/finance/ProjectCommercialWorkspace.tsx`, `aegis-web/src/app/dashboard/projects/[id]/financials/page.tsx`
- **Discovered**: Navigating from Project Financials to Corporate Finance did not retain project context; project managers and QS could not record project cash inflows, outflows, retention, or mobilization advances without navigating through corporate finance settings.
- **Diagnosis**:
  1. `/dashboard/finance` was a `"use client"` component that did not call `useSearchParams()`. When navigated to with `?projectId=...`, the query was discarded and `selectedProjectId` remained unassigned.
  2. `ProjectCommercialWorkspace` had no return path to the active project workspace.
  3. `ProjectFinancialsPage` (`projects/[id]/financials/page.tsx`) had no deep link to `/dashboard/finance/project-financials` and lacked direct ledger posting capabilities.
- **Repair**:
  1. Integrated `useSearchParams()` into `FinancePage`, automatically binding `selectedProjectId` and `moneyProjectId` from URL query parameters (`projectId` or `project`).
  2. Added direct navigation button in `ProjectCommercialWorkspace` linking directly to `/dashboard/projects/${selectedId}`.
  3. Updated `ProjectFinancialsPage` with:
     - Direct button to Corporate Finance Command (`/dashboard/finance/project-financials?projectId=${projectId}`).
     - Direct integration of `ProjectMoneyModal` allowing immediate posting of double-entry ledger entries (advances, valuations, supplier bills, retention) directly attributed to the project cashbook.
- **Verification Evidence**:
  - `npm run typecheck` passed cleanly (exit code 0).
  - Pytest suites `test_project_money_entries.py` and `test_project_cash_curve.py` passed cleanly (exit code 0).
- **Status**: **VERIFIED**

---

### IR-DEF-004: Pre-mobilization Gate Router Contract Mismatch
- **Severity**: P2 - MEDIUM
- **Component**: `imperium-api/tests/test_projects_router_contract.py`
- **Discovered**: `test_pre_mobilisation_gate_blocks_active_delivery_until_approved` failed during suite execution.
- **Diagnosis**: The mock query interceptor matched on SQL `'pre_mobilisation'` but the actual router used a parameterized query `SET status = :new_status`.
- **Repair**: Updated the mock query interceptor in `test_projects_router_contract.py` to match `SET status = :new_status` with parameter `:new_status` matching `"pre_mobilisation"`.
- **Verification Evidence**:
  - Pytest suite `test_projects_router_contract.py` passed (14 of 14 passed).
- **Status**: **VERIFIED**

---

### IR-DEF-005: Unseeded Permission Keys in Router Contract
- **Severity**: P2 - HIGH
- **Component**: `imperium-api/routers/projects.py`, `imperium-api/tests/test_permission_registry_contract.py`
- **Discovered**: `test_permission_registry_contract.py` identified unseeded permission keys: `['executive.read', 'finance.report.read', 'inventory.manage', 'projects.project.read']`.
- **Diagnosis**: `get_project_leadership_dossier` in `routers/projects.py` referenced ad-hoc permission strings not present in the database migration catalog, causing contract test failure and risking runtime 403 Forbidden for authorized users.
- **Repair**: Aligned router permissions with the authoritative catalog:
  - `"projects.project.read"` -> `"projects.read"`
  - `"executive.read"` -> `"executive.view_dashboard"`
  - `"finance.report.read"` -> `"financial_performance.read"`
- **Verification Evidence**:
  - `test_permission_registry_contract.py` passed cleanly (exit code 0).
- **Status**: **VERIFIED**

---

### IR-DEF-006: Inventory Router Stock Issue Contract Regression
- **Severity**: P2 - HIGH
- **Component**: `imperium-api/routers/inventory.py`, `imperium-api/tests/test_procurement_inventory_contract.py`
- **Discovered**: `test_procurement_inventory_contract.py` failed assertion `require_permission("inventory.issue.create")`.
- **Diagnosis**: The `/issue` endpoint was modified to an unseeded `inventory.manage` composite requirement rather than the established `require_permission("inventory.issue.create")` contract.
- **Repair**: Restored `require_permission("inventory.issue.create")` on `issue_stock` in `routers/inventory.py`.
- **Verification Evidence**:
  - `test_procurement_inventory_contract.py` passed (19 of 19 passed).
- **Status**: **VERIFIED**

---

### IR-DEF-007: Distributed JWT Clock Skew False Authentication Invalidation
- **Severity**: P1 - CRITICAL
- **Component**: `imperium-api/core/security.py`
- **Discovered**: End-to-end verification for Ashton (`ashton@admin.com`) failed with `401 Unauthorized: Invalid or expired authentication credentials` immediately upon logging in via Supabase Auth.
- **Diagnosis**: Cloud Supabase auth server clock drifted ~12s ahead of local server clock. PyJWT `jwt.decode` called with default `leeway=0` raised `ImmatureSignatureError: The token is not yet valid (iat)`. This was caught by generic `jwt.PyJWTError`, triggering `_reject(token)` and blacklisting valid tokens for 60 seconds.
- **Repair**: Added `leeway=60` across `_decode_with_jwks`, `_decode_locally`, and `verify_jwt` in `imperium-api/core/security.py`.
- **Verification Evidence**:
  - Ashton live auth session verified against 23 core API endpoints returning HTTP 200 OK.
  - `pytest tests/test_auth_verification.py` passed 11 of 11 tests.
- **Status**: **VERIFIED**

---

### IR-DEF-008: NotificationBell Dropdown Mobile Viewport Clipping
- **Severity**: P2 - HIGH
- **Component**: `aegis-web/src/components/layout/dashboard/NotificationBell.tsx`
- **Discovered**: On mobile viewports (360px-390px), the notification dropdown overflowed past the left edge of the screen by 50-80px.
- **Diagnosis**: Dropdown was fixed to `absolute right-0 top-10 w-96` anchored to the bell icon button 70-90px from the screen right edge, forcing the left side of the panel off-screen.
- **Repair**: Converted `NotificationBell` to render a responsive bottom sheet with dark backdrop on mobile screens (`< md`), maintaining desktop popover behavior on `>= md`.
- **Verification Evidence**:
  - `npm --prefix aegis-web run typecheck` passed (0 errors).
  - DOM contract verified for mobile bottom sheet modal and backdrop.
- **Status**: **VERIFIED**

---

### IR-DEF-009: Mobile Bottom Dock Query String Desynchronization & Tab Lock
- **Severity**: P2 - HIGH
- **Component**: `aegis-web/src/app/dashboard/DashboardShell.tsx`, `aegis-web/src/app/dashboard/site-operations/page.tsx`
- **Discovered**: Tapping "Report" in the mobile bottom dock did not switch to the daily report view and left the interface locked on "Labour Register".
- **Diagnosis**: `DashboardShell.tsx` inspected `pathname.includes("tab=report")` on `usePathname()`, but Next.js App Router's `usePathname()` never includes query strings (`?tab=...`). Furthermore, `site-operations/page.tsx` had an empty `useEffect` dependency array, ignoring URL param changes.
- **Repair**: Wrapped `MobileBottomDock` in Suspense reading `useSearchParams()`. Bound dynamic routing (Overview vs Projects based on user roles). Added two-way state and URL synchronization in `site-operations/page.tsx`.
- **Verification Evidence**:
  - `npm --prefix aegis-web run check:nav` passed (142 static routes reachable).
  - `npm --prefix aegis-web run typecheck` passed.
- **Status**: **VERIFIED**

---

### IR-DEF-010: Mobile Topbar Overcrowding & Public Header Background Transparency
- **Severity**: P3 - MEDIUM
- **Component**: `aegis-web/src/app/dashboard/DashboardShell.tsx`, `aegis-web/src/components/layout/ExecutiveNav.tsx`
- **Discovered**: Header action buttons exceeded 360px width on mobile phones, causing overlap, squishing, and layout distortion. Public nav drawer also suffered from background transparency overlap.
- **Diagnosis**: Push alert toggle, search button, calendar, notification bell, and avatar all competed for horizontal space in a 360px container.
- **Repair**: Made PwaPushButton `hidden sm:block` in top bar and integrated device push controls directly into the slide-out mobile drawer navigation. Added body scroll lock when mobile menus are open. Ensured solid background on ExecutiveNav when mobile menu is open.
- **Verification Evidence**:
  - `npm --prefix aegis-web run typecheck` passed.
  - Public and dashboard navigation shells verified.
- **Status**: **VERIFIED**
