# Plant & Equipment Operating System (AEGIS) - Delivery Log

## 1. Operating Context & Architectural Baseline
- **Application**: Project AEGIS - Six Nine Construction (SNC) Enterprise Operations Platform.
- **Frontend Stack**: Next.js 15 App Router, React 19, Tailwind CSS, Lucide icons, SWR.
- **Backend Stack**: Python 3.13 FastAPI, SQLAlchemy, PostgreSQL (Supabase) multi-tenant schema with Row Level Security (RLS).
- **Current Asset Domain State**:
  - Previously split between `Fleet` (`/dashboard/fleet`) and `Equipment` (`/dashboard/equipment`), both having only `Overview` and `Performance` sub-links.
  - Backend models in schema `fleet` already implement core tables: `fleet.fleet`, `fleet.plant_requests`, `fleet.plant_request_items`, `fleet.plant_reservations`, `fleet.dispatch_notes`, `fleet.fuel_transactions`, `fleet.utilization_logs`, `fleet.maintenance_work_orders`, `fleet.fleet_defects`, `fleet.fleet_inspections`, `fleet.operator_profiles`, and `fleet.external_hire_agreements`.
  - Integration with `finance` schema includes `finance.cost_transactions` (project costing) and `finance.invoices` (billing), with internal revenue separated from external commercial invoicing.
- **Baseline Verification**:
  - Backend pytest contract suite: 22 passed (`test_plant_equipment_full_department_contract.py`, `test_plant_equipment_lifecycle_contract.py`, `test_equipment_finance_contract.py`).
  - Nav check (`scripts/check-nav-completeness.js`): 6 pre-existing unrelated routes unlinked in projects/finance.

---

## 2. Phased Implementation Roadmap

### Phase 1 — Navigation and Unified Asset Foundation
- Unify the Assets sidebar into **Assets / Plant & Equipment** with 9 dedicated functional operational tabs:
  1. Command Center (`/dashboard/fleet`)
  2. Asset Register (`/dashboard/equipment`)
  3. Plant Requests & Dispatch (`/dashboard/fleet/requests`)
  4. Commercial Hire & Revenue (`/dashboard/fleet/hire`)
  5. Daily Shift Logs (`/dashboard/fleet/shift-logs`)
  6. Fuel & Consumables (`/dashboard/fleet/fuel`)
  7. Maintenance & Workshop (`/dashboard/fleet/maintenance`)
  8. Operators & Safety (`/dashboard/fleet/operators`)
  9. Asset Financials & P&L (`/dashboard/fleet/performance`)
- Preserve legacy URLs with backward compatibility:
  - `/dashboard/fleet` retains full command overview and live metrics.
  - `/dashboard/equipment` retains detailed equipment asset registry, specs, and meter capture.
  - `/dashboard/fleet/performance` retains asset P&L and financial contribution metrics.
- Maintain RBAC permissions: `fleet.read`, `equipment_assets.read`, `fleet.profitability.view`, `fleet.operator_profiles.read`, `fleet.external_hire.read`.

### Phase 2 — Commercial Hire & Revenue Engine
- External hire agreement lifecycle (enquiry, quote, signed, dispatched, active, off-hire, billing instruction).
- Commercial terms: Wet Hire vs Dry Hire, hourly/daily/monthly/output rates, minimum guaranteed hours, standby/standing-time rates, overtime rates, mobilisation/demobilisation charges, security deposits.
- Rate-card snapshotting preventing historical fee recalculation.
- Traceable draft billing integration to Finance (`finance.invoices`) avoiding duplicate billing.
- Internal inter-project recovery rate allocation to project WBS distinct from external commercial sales.

### Phase 3 — Daily Plant Sheets & Dispatch Controls
- Mobile-friendly Daily Plant Sheet (DPS) logging:
  - Start/end engine hour readings, productive hours, idle/standing hours, weather downtime, breakdown downtime.
  - Client / Resident Engineer verification and digital sign-off.
  - Continuity validation, chronological validation, and lockout enforcement.
- Pre-start safety checklist gating and Lockout-Tagout (LOTO) state.
- Dispatch notes and mobilisation logistics (lowbed, escort, permit).

### Phase 4 — Fuel, Workshop & Operator Integration
- Fuel dispensing: Storage tanks, mobile bowsers, fuel slips, hour-meter cross-checks, consumption index ($L/\text{hr}$ & $L/\text{km}$), and anomaly / siphoning detection.
- Preventive maintenance schedules based on engine hours and calendar intervals.
- Work orders connected to parts requisition from Procurement/Inventory.
- Return-to-Service (RTS) compliance gate.
- Operator competency register: machine category permissions, medical expiries, license classes, incident history.

### Phase 5 — Asset Financials & Lifecycle Analytics
- Asset Profit & Loss ($P\&L$):
  - External billed revenue vs. internal cost recovery.
  - Attributable costs: Fuel, maintenance & spares, operator labor, transport & insurance.
  - Depreciation calculation and written-down book value.
  - True net asset contribution margin.
- Total Cost of Ownership (TCO) and replacement threshold analytics.

---

## 3. Verification & Execution Results
- **Migration 259**: Created in `imperium-api/migrations/259_plant_equipment_unified_operations.sql` with additive, non-destructive fields for daily shift sheets, commercial hire agreements, telematics, and preventive maintenance.
- **Backend Router**:
  - `imperium-api/routers/fleet.py` augmented with `GET /fuel`, `GET /utilization`, `PATCH /utilization/{log_id}/status`, `PATCH /external-hire-agreements/{agreement_id}`, and `POST /external-hire-agreements/{agreement_id}/invoice`.
  - Added strict decimal validations, chronological validations (`end_engine_hours >= start_engine_hours`), and idempotent invoice staging avoiding duplicate billing.
- **API Client Layer**:
  - `aegis-web/src/lib/api/fleet.ts` updated with `getFleetFuelTransactions`, `recordFleetFuel`, `getFleetUtilizationLogs`, `recordFleetUtilization`, `updateFleetUtilizationStatus`, `updateExternalPlantHireAgreement`, and `generateExternalPlantHireInvoice`.
- **Frontend Architecture**:
  - `aegis-web/src/lib/navigation.ts` updated to unify the Assets domain into a single `Plant & Equipment` group with all 9 dedicated sub-items.
  - `aegis-web/src/lib/navigation.ts` `getDomainForPathname` updated to map subItems so that `/dashboard/equipment` and other sub-routes correctly retain the orange Assets domain accent.
  - Created operational pages:
    - `/dashboard/fleet/requests/page.tsx` (Plant Requests & Dispatch)
    - `/dashboard/fleet/hire/page.tsx` (Commercial Hire & Revenue)
    - `/dashboard/fleet/shift-logs/page.tsx` (Daily Shift Logs / Daily Plant Sheets)
    - `/dashboard/fleet/fuel/page.tsx` (Fuel & Consumables)
    - `/dashboard/fleet/maintenance/page.tsx` (Maintenance & Workshop)
    - `/dashboard/fleet/operators/page.tsx` (Operators & Safety)
    - `/dashboard/assets/page.tsx` (Compatibility redirect stub -> `/dashboard/fleet`)
- **Automated Verification**:
  - `node scripts/check-nav-completeness.js`: Passed for all new and existing plant & equipment pages.
  - `imperium-api` full test suite execution:
    - `test_plant_equipment_unified_operations_contract.py`
    - `test_plant_equipment_full_department_contract.py`
    - `test_plant_equipment_lifecycle_contract.py`
    - `test_equipment_finance_contract.py`
    - `test_fleet_security_contract.py`
    - `test_fleet_work_order_approval.py`
    - **Result**: **39/39 passed (100%)** in 8.95s.
- **Stability & Security Hardening**:
  - All new fleet endpoints (`PATCH /external-hire-agreements/{id}`, `POST /external-hire-agreements/{id}/invoice`, `PATCH /utilization/{log_id}/status`) use strongly typed Pydantic models subclassing `Payload` with `model_config = ConfigDict(extra="forbid")` to eliminate raw dictionaries and prevent unexpected parameter injection.
  - Universal regex replacement `replace(/_/g, " ")` adopted across all fleet pages for universal JavaScript target compatibility.
  - Backward compatibility intact: Existing `/dashboard/fleet`, `/dashboard/equipment`, and `/dashboard/fleet/performance` routes continue functioning identically with zero data structure mutations.

