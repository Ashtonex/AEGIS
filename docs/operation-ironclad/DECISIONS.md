# OPERATION IRONCLAD: ARCHITECTURAL DECISION RECORDS (ADR)

**Client**: Six Nine Construction (Private) Limited  
**System**: AEGIS / Imperium Enterprise Resource Planning Ecosystem  
**Governing Standard**: SYSTEM INTEGRITY FIRST. OPERATIONAL CONTINUITY ALWAYS.

---

## Decision Log

| Decision ID | Title | Date | Status |
| :--- | :--- | :--- | :--- |
| **IR-ADR-001** | Dual-Path Quotation-to-Project Conversion & Budget Seeding | 2026-10-17 | **APPROVED & IMPLEMENTED** |
| **IR-ADR-002** | Decoupling Site Operations Hydration from Executive Role Gating | 2026-10-17 | **APPROVED & IMPLEMENTED** |
| **IR-ADR-003** | Bidirectional URL Parameter Navigation for Project Cross-Cutting Workspaces | 2026-10-17 | **APPROVED & IMPLEMENTED** |

---

### IR-ADR-001: Dual-Path Quotation-to-Project Conversion & Budget Seeding

- **Context**:
  Quotations could be created from tender intake, drawing takeoff, opportunity boards, or manual cost calculators. Consequently, `project_id` was frequently null at quotation approval time. When a quotation was marked as "won", the backend check `if quotation.get("project_id"):` skipped budget creation, leaving approved commercial rate buildups orphaned from execution.
- **Decision**:
  1. Provide dual pathways:
     - **Automatic Matching**: In `decide_quotation` ("won"), if `project_id` is null, look up existing candidate projects matching the client name or estimate title. If an exact candidate exists, link and seed automatically.
     - **Explicit UI Flow**: Provide dedicated endpoints `POST /convert-to-project` and `POST /link-project`. If an unlinked quote is marked won, automatically surface `ConvertProjectModal`, enabling the estimator/PM to either create a new operational project or bind an existing project and trigger budget generation.
  2. Protect profit margin by strictly excluding it from the operational cost budget, seeding only pure execution cost categories (materials, labour, plant, prelims, overhead, contingency).
- **Consequences**:
  - Eliminates orphaned winning bids.
  - Guarantees downstream projects always possess baseline execution budgets for cost-control tracking.

---

### IR-ADR-002: Decoupling Site Operations Hydration from Executive Role Gating

- **Context**:
  `useProjectWorkspace.ts` consolidated project hydration through `getExecutiveProjectDetail(projectId)`. This endpoint requires `executive.view_dashboard` permission. As a result, field engineers, foremen, and quantity surveyors navigating to `/dashboard/projects/[id]/site-logs` hit a 403 Forbidden wall, causing their site reports to render blank.
- **Decision**:
  1. Decouple site reports fetching in `useProjectWorkspace.ts` by invoking `getDailySiteReports({ projectId })` independently in parallel with `Promise.allSettled`.
  2. Treat site reports as an operational resource with permissions aligned to `site.read` and `projects.read`.
  3. Ensure that an authorization failure on executive summaries never suppresses operational field logs.
- **Consequences**:
  - Operational site personnel can immediately view, log, and audit daily site reports without elevated executive credentials.
  - Adheres to the principle of least privilege.

---

### IR-ADR-003: Bidirectional URL Parameter Navigation for Project Cross-Cutting Workspaces

- **Context**:
  Cross-cutting modules like Corporate Finance (`/dashboard/finance`) and Site Operations (`/dashboard/site-operations`) were originally designed as standalone department views. When users navigated from a specific project workspace (`/dashboard/projects/[id]/...`), the query parameters were either ignored or mismatched (`projectId` vs `project`), forcing users to re-select their project from dropdown lists.
- **Decision**:
  1. Standardize query parameter acceptance across all cross-cutting modules: support both `?projectId=` and `?project=`.
  2. In `FinancePage`, read `useSearchParams()` on initial mount and automatically bind `selectedProjectId` and `moneyProjectId`.
  3. Provide prominent contextual banners indicating active project filtering and single-click return links back to `/dashboard/projects/[id]`.
  4. Embed `ProjectMoneyModal` directly into the Project Financials workspace so project managers do not have to leave their project context to record cash transactions.
- **Consequences**:
  - Streamlines navigation between macro corporate ledgers and micro project accounting.
  - Ensures seamless two-way workflow continuity for PMs and financial controllers.
