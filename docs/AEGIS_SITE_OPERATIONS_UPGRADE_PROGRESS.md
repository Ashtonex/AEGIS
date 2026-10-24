# AEGIS SITE OPERATIONS Domain Upgrade — Progress Log

**Module**: AEGIS Site Operations, Daily Reporting, Labour Automation & Material Sourcing  
**Lead Implementation Engineer**: Antigravity / Core Systems Architect  
**Initial Baseline Date**: 2026-10-13  
**Status**: VERIFIED & COMPLETE (All Slices 0-7 Implemented, Fully Tested)

---

## 1. Architectural Baseline & Repository Audit

### Environment & Test Baseline
- **Backend**: FastAPI / Python 3.14 / PostgreSQL + asyncpg / SQLAlchemy async engine.
- **Frontend**: Next.js 14+ (App Router), React 18, Tailwind CSS, Lucide icons, SWR + LiveData (`LiveDataProvider`).
- **Final Verification**:
  - `npm run typecheck` (`aegis-web`): **0 errors (CLEAN, 100% typechecked)**
  - Core Site Operations Contracts:
    - `tests/test_site_operations_unified_flow.py`: **5 passed**
    - `tests/test_daily_site_report_vertical_slice.py`: **11 passed**
    - `tests/test_site_variance_hardening_contract.py`: **5 passed**
    - `tests/test_foreman_portal_contract.py`: **3 passed**
    - **Total Site Operations tests passed: 24 passed** (0 failures).

---

## 2. Feature Parity & Writer Map

### Canonical Identity & Report Key
- **Report Key**: `(organization_id, project_id, report_date, shift)`.
  - Canonical timezone: `Africa/Harare` (`harare_today()` derived from `ZoneInfo("Africa/Harare")`).
  - Shift support: `'day'`, `'night'`, `'double'`.
  - Persistent unique constraint: `projects.daily_site_reports (organization_id, project_id, report_date, shift)`.

### Writers & Posting Ownership
| Aggregate / Entity | Table | Verified Writers | Ledger / Cost Posting Side Effect |
| :--- | :--- | :--- | :--- |
| **Site Day & Labour Register** | `projects.site_day_briefings`<br>`projects.site_day_attendance` | `routers/site_day.py` (`open_site_day`, `start_site_day`, `_insert_attendance`, `clock_out_attendance`, `close_site_day`) | Clocks in/out site workers and project hires. Live syncs attendance to daily site report draft without re-typing. |
| **Daily Site Report** | `projects.daily_site_reports`<br>`projects.daily_report_labour`<br>`projects.daily_report_equipment`<br>`projects.daily_report_materials` | `routers/site_reports.py` (`create_daily_report`, `add_daily_report_labour`, `add_daily_report_material`, `submit_daily_site_report`, `decide_daily_site_report`) | On approval: posts labour, equipment, and material cost categories to `finance.cost_transactions`. Consumes materials via `inventory_service.record_stock_movement`. |
| **Material Candidates & Requests** | `procurement.material_candidates`<br>`procurement.material_requests` | `routers/site_reports.py` (`request_site_material`, `promote_material_candidate`, `decide_site_material_request_engineer`) | Issues stock via `inventory_service.issue_stock` when store on-hand is available; auto-submits purchase requisition for shortfall. Supports free-text descriptions. |
| **Stock Ledger** | `procurement.stock_ledger` | `app/services/inventory_service.py` (`issue_stock`, `receive_stock`, `adjust_stock`, `transfer_stock`) | Posts inventory movements with unit cost and total cost. |
| **Financial Commitments** | `finance.commitments` | `routers/procurement.py` (`approve_purchase_order`) | Obligates purchase order totals against project cost codes. |
| **Project Budgets & Headroom** | `projects.weekly_budgets`<br>`projects.weekly_budget_items`<br>`finance.project_budgets` | `routers/site_reports.py` (`get_execution_budget`) | Exposes total budget, committed spend, recognized actual spend, material consumed spend, and forecast headroom. |

---

## 3. Migration 260 Additions (`260_site_operations_unified_flow.sql`)

1. **Daily Report <-> Briefing Bridge**:
   - Added `briefing_id`, `auto_created`, `source_freshness`, `revision` to `projects.daily_site_reports`.
   - Added `daily_report_id` to `projects.site_day_briefings`.
2. **Material Candidates**:
   - Created `procurement.material_candidates` with RLS (`service_role` only).
   - Enables tracking provisional unlisted descriptions across the sourcing lifecycle.
3. **Free-Text Material Requests**:
   - Altered `procurement.material_requests`: dropped `NOT NULL` from `item_id`.
   - Added `material_description`, `specifications`, `unit_of_measure`, `candidate_id`, `match_type`.
4. **Labour Register & Daily Report Labour Extension**:
   - Altered `projects.daily_report_labour`: dropped `NOT NULL` from `employee_id`.
   - Added `site_worker_id`, `attendance_id`, `worker_name`, `worker_kind` (`'employee' | 'project_hire'`).

---

## 4. Completed Vertical Slices

### Slice 1 & 2: Labour -> Daily Report Auto-Draft & Attendance Live-Sync
- **Backend (`routers/site_day.py`)**:
  - Implemented `ensure_daily_report_draft`: atomically gets-or-creates today's draft report when `open_site_day` or `start_site_day` is called.
  - Implemented `sync_attendance_to_daily_report`: live-syncs all attendance rows into `projects.daily_report_labour` whenever attendance is added or clocked out.
  - Linked `daily_report_id` in briefing payloads.
- **Frontend (`LabourRegisterTab.tsx`)**:
  - Surfaces active Daily Site Report Draft banner with quick navigation to report draft.

### Slice 3: Materials & Real Evidence in Daily Report
- **Backend (`routers/site_reports.py`)**:
  - `get_daily_report` automatically triggers attendance sync for draft reports.
  - Attaches `material_receipts` (real site GRNs delivered on report date).
  - Attaches `material_issues` (real store issues / stock ledger consumption for this site on report date).
  - Attaches `open_requests` (material requests on date).
  - Attaches `safety_briefing` (toolbox topic, conductor, PPE checks, hazards from briefing).
  - Attaches `completeness`: score percentage, readiness flags for labour, progress, safety, weather.
- **Frontend (`page.tsx`)**:
  - Enhanced `ReportDrawer` with Report Readiness progress meter, labour attendees table, site deliveries (GRNs), store issues, and safety summary.

### Slice 4 & 5: Free-Text Material Requests & Catalogue Lineage
- **Backend (`routers/site_reports.py`)**:
  - `request_site_material` supports `material_description` without requiring `item_id`.
  - Automatically matches catalogue if existing or registers provisional `procurement.material_candidates`.
  - `GET /materials/suggest`: bounded suggestions against `inventory_items` (with store stock balances) and existing `material_candidates`.
  - `POST /materials/candidates/{candidate_id}/promote`: promotes unlisted materials to official inventory catalogue items and backfills open requests.
  - `process_verified_material_request`: correctly issues stock if catalogue item or generates requisition lines with description and UOM for candidates.
- **Frontend (`page.tsx`)**:
  - Replaced strict dropdown with text-first material search input + auto-suggest dropdown.
  - Displays catalogue match badge or candidate indicator.
  - Added unit of measure and specification fields.

### Slice 6: Budget Visibility & Forecasting Headroom
- **Backend (`routers/site_reports.py`)**:
  - `get_execution_budget` computes commitments from `finance.commitments`, recognized actuals from `finance.cost_transactions`, material consumption, and remaining headroom without double charging.

---

## 5. Verification Results
- **Unit & Contract Tests**: 24/24 passing in 4.10s (`pytest`).
- **Frontend Typecheck**: `tsc --noEmit` passing with 0 errors.
- **Backward Compatibility**: All existing routes, permissions, and test suites preserved.
