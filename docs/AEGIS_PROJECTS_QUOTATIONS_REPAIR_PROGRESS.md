# AEGIS Projects & Quotations Linkage Repair Progress

## Status: COMPLETED
**Started**: 2026-10-14 22:15 UTC  
**Completed**: 2026-10-14 22:45 UTC  
**Target**: Repair cascade of 'Not Found' errors in AEGIS internal project workspaces, broken approved BOQ/budget connection from Quotations & Estimations, quotation linkage, and category cost reconstruction.

---

## 1. Actual Failures & Root Causes (Verified)

### Failure A: Workspace Shell Hydration Crash ("Project could not be found or you do not have permission to access it")
- **File**: `aegis-web/src/hooks/useProjectWorkspace.ts` (L55)
- **Root Cause**: The hook called `getProject(projectId)`, which due to the barrel re-export in `aegis-web/src/lib/api.ts` resolved to `website.ts` (`/api/projects/${slug}` mapped to public marketing `/api/v1/public/intake/projects/${slug}`). This always returned 404 for internal ERP projects.
- **Cascading Failure**: The fallback was `getExecutiveProjectDetail(projectId)`, which requires `executive.view_dashboard`. For any non-executive role (Quantity Surveyor, Project Manager, Commercial Manager, Site Engineer), this returned 403 Forbidden. Because both lookups failed, the hook threw an error, rendering "Project could not be found" on every tab in `/dashboard/projects/[id]`.

### Failure B: Non-Existent Permission `projects.write` in Backend Endpoints
- **File**: `imperium-api/routers/projects.py` (L2301, L2412, L2461, L2549, L2615, L2643, L2831)
- **Root Cause**: `core.permissions` only defines CRUD keys: `projects.read`, `projects.create`, `projects.update`, `projects.delete`. Several critical project endpoints (including `import_budget_from_quotation`, role assignments, and project hire mutations) required `projects.write`, which does not exist in `core.permissions` or any role grants, resulting in 403 Forbidden for all non-superadmin users.

### Failure C: Rigid / Broken Quotation Lookup in "Sync from Quotation"
- **Files**: `imperium-api/routers/projects.py` (`get_budget_category_summary` L2738-2757, `import_budget_from_quotation` L2844-2865), `aegis-web/src/components/projects/budget/ProjectBudgetSpreadsheet.tsx` (L203-231, L460-466)
- **Root Cause**:
  1. If `linkedQuotation` is null, the "Sync from Quotation" button sent `quotation_id: null` / `undefined`.
  2. The backend fallback SQL query only matched `id = quotation_id`, `project_id = project_id`, or `client_name = client_name` (exact case-sensitive string equality).
  3. Real project records frequently have client discrepancies (e.g. Project client `"Troutbeck"` vs Quotation client `"Wild Horizons (Pvt) Ltd"` or `"Troutbeck - Timeshares 4 unites"`, or quotations originated from Opportunities/Tenders without explicit `project_id`).
  4. The query did not match by `opportunity_id`, `tender_id`, or `client_org_id`, and there was no manual Quotation Picker in the UI. Thus, the backend threw HTTP 404: `"No matching quotation found for this project or client to import."`

### Failure D: Missing Cost Calculation in Quotations Metadata Leading to $0 Budgets
- **Files**: `imperium-api/routers/projects.py` (L2761-2775), `imperium-api/app/services/finance/project_forecast.py`
- **Root Cause**: Quotations with approved BOQs (e.g. quote `fe46f2cf-b787-4fc5-bf15-428ff17c81e4`) often have `metadata.calculation` as `null` or missing `direct_costs_breakdown`. When `get_budget_category_summary` ran, it extracted `None` and defaulted all categories to `$0.00`. The spreadsheet loaded with all zeros, misleading users into believing nothing was posted or synced.

---

## 2. Action Plan & Phased Implementation

- [x] **Phase 1: Project API Client & Workspace Hydration**
  - Created dedicated `projects.ts` in `aegis-web/src/lib/api/projects.ts` with `getInternalProject(projectId)`.
  - Exported it explicitly in `aegis-web/src/lib/api.ts` without naming collision with `website.ts`'s `getProject`.
  - Updated `useProjectWorkspace.ts` to hydrate directly from `getInternalProject`. Made executive detail non-blocking and permission-gated.
- [x] **Phase 2: RBAC Permission Alignment & Project Scoping**
  - Aligned all `projects.write` dependencies in `imperium-api/routers/projects.py` to registered `projects.update`.
  - Updated `imperium-api/core/project_scope.py` so project creators (`p.created_by = :user_id`) retain access before team allocation.
- [x] **Phase 3: Quotation Linkage & Eligible Quotations Query**
  - Added `GET /api/v1/projects/{project_id}/budget/eligible-quotations` returning candidate matches (by `project_id`, `quotation_id`, `opportunity_id`, `client_org_id`, or `client_name`) and all approved/won quotations in the tenant.
  - Added `POST /api/v1/projects/{project_id}/budget/link-quotation` to explicitly link quotation without overwriting budgets.
  - Enhanced `POST /api/v1/projects/{project_id}/budget/import-quotation` to stamp two-way canonical links (`project.quotation_id` and `quotation.project_id`), seed `finance.project_budgets`, `finance.budget_lines`, and `finance.boq_line_items`.
- [x] **Phase 4: Cost Breakdown Reconstruction from BOQ Items**
  - Implemented `extract_quotation_cost_breakdown` in `routers/projects.py`: dynamically inspects `metadata.calculation.direct_costs_breakdown`, or aggregates item buildups / section amounts (`materials`, `labour`, `equipment`, `subcontract`, `other`) plus prelims/overheads and contingencies. Excludes profit markup from site cost baselines.
- [x] **Phase 5: UI Quotation Selector Modal in Project Budget Spreadsheet**
  - Updated `aegis-web/src/components/projects/budget/ProjectBudgetSpreadsheet.tsx`:
    - Replaced blind undefined sync with explicit Quotation Selector Modal.
    - Provides "Suggested Matches" tab and "All Approved Quotations" tab with real-time search.
    - Shows quotation reference, client, status, amount, and preview of reconstructed direct execution cost categories before importing.
    - Supports "Link Only" and "Link & Import Budget Baseline".
- [x] **Phase 6: Verification & Regression Testing**
  - `aegis-web`: `npm run build` executed and passed with exit code 0 across all 211 static and dynamic routes.
  - `imperium-api`: 22 pytest contract and unit tests passed in 7.80s (`test_projects_router_contract.py`, `test_project_budget_upload_contract.py`, `test_project_scope.py`).
  - Unit tests verify cost extraction for both calculation dictionaries and raw item arrays.
