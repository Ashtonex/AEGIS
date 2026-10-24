# AEGIS Projects Module: Architecture Decisions

## ADR 001: Scheduling Model & Critical Path Calculation
- **Context**: The existing scheduling system in `projects.project_milestones` only contained independent dates (`baseline_date`, `forecast_date`, `actual_date`), completion `weight`, and `status`. It lacked dependency sequencing and critical path determination.
- **Decision**: Extend `projects.project_milestones` with `predecessor_id`, `duration_days`, `lag_days`, `dependency_type`, `total_float`, and `is_critical`, backed by dedicated dependency table `projects.milestone_dependencies`. Implement server-side CPM (Critical Path Method) topological sorting using Kahn's algorithm with cycle detection to compute early start, early finish, late start, late finish, total float, and critical path flag. Baseline dates remain locked once committed.
- **Consequences**: Enables accurate schedule health forecasting, flags critical path activities with zero or negative float, and prevents unrealistic target dates without sequence logic.

## ADR 002: Tenant & Project Isolation Integrity
- **Context**: All project operations must enforce strict multi-tenant and project-scoped isolation.
- **Decision**: Every table must have `organization_id UUID NOT NULL REFERENCES core.organizations(id)` and `project_id UUID NOT NULL REFERENCES projects.projects(id)`. All SQL queries enforce both `organization_id = :org_id` and `project_id = :project_id`. API endpoints use `enforce_project_path_scope` and permission checks (`projects.read`, `projects.update`, etc.). Row Level Security (RLS) is applied across all new project tables.

## ADR 003: Subcontractor Commercials & Ledger Unification
- **Context**: Subcontractor payments, retentions, and back-charges touch procurement and general financials.
- **Decision**: Avoid duplicate subledgers. Subcontractor packages belong to the project commercial scope. Payment certificates post liabilities through `finance.cost_transactions` (`source_type = 'subcontractor_certificate'`) and accrue retentions into `finance.retention_ledger` (`source_type = 'subcontractor_retention'`). Idempotency is strictly guarded via `UNIQUE (organization_id, source_type, source_id, cost_category)`. Contra-charges deduct directly from certificate net payable amounts.

## ADR 004: Concrete Pour Cards & QA Verification Gate
- **Context**: Concrete pours represent high-liability structural operations requiring strict sign-off gates before concrete trucks discharge.
- **Decision**: Concrete Pour Cards model pre-pour checks (`rebar_inspected`, `formwork_inspected`, `cleanliness_inspected`, `embedded_mep_inspected`, `cover_blocks_verified`), pour execution (slump tests, batch time), and post-pour testing (cube crushing results at 7 and 28 days). The pre-pour checklist must be approved by the Site Engineer before the pour status can transition to 'approved_for_pour'. Failing any of the 5 checks prevents pour authorization server-side with HTTP 400.

## ADR 005: Progress Pack Architecture
- **Context**: Month-end client reporting currently requires manually gathering spreadsheets and daily report PDFs.
- **Decision**: Build a composite query endpoint `GET /projects/{id}/progress-pack` that compiles executive metrics, milestone schedule variances, concrete pour registries, equipment utilization, delay events/EOT claims, and progress photos into a structured dossier suitable for on-screen viewing and PDF export via native browser print media queries.

## ADR 006: Plant Allocation and Telemetry Integration (No Duplicate Plant Register)
- **Context**: Operating rule 1 requires reusing existing fleet services without creating a second asset register.
- **Decision**: Project plant and equipment workflows query existing tables: `fleet.fleet_assignments` (linking asset to project), `fleet.fleet` (master specifications, benchmark L/hr, hourly rates), `fleet.utilization_logs` (operating, idle, breakdown hours), and `fleet.fuel_transactions` (fuel issues). The unified analytics service `project_plant.py` computes real-time utilization $(Op / (Op + Idle + Breakdown)) \times 100$, burn rate vs benchmark, and productivity without duplicating machine master data.

## ADR 007: Contractual Delay Events and Statutory Time-Bar Logic
- **Context**: Construction standard contracts (FIDIC Clause 20.1 / 8.4, NEC4, JBCC) impose strict statutory notice time-bars (e.g. 28 days from event occurrence). Failure to serve notice forfeits entitlement to Extension of Time and prolongation costs.
- **Decision**: Model `projects.contractual_delay_events` with `notice_required_days` and `event_occurred_date`. The system computes `deadline = occurred + notice_days`. If notice is unserved past deadline, the event is automatically flagged as `is_time_barred = true`. EOT claims link directly to CPM schedule milestones, and granted days automatically update project and milestone target completion dates.

## ADR 008: Controlled Drawing Revisions and Superseded Audit History
- **Context**: Site teams working to obsolete drawing revisions causes severe rework and structural clashes.
- **Decision**: Model `projects.controlled_drawings` with unique constraint `(organization_id, project_id, drawing_number)`. When a revised drawing is uploaded (e.g. Rev A -> Rev B), the previous revision metadata is archived automatically into `superseded_history` JSONB array with timestamp and link, preserving a permanent audit trail while ensuring only the latest revision is displayed as current.

## ADR 009: Earned Value Management (EVM), S-Curve Studio & Mobile Speed Dial
- **Context**: Construction leadership requires mathematical verification of cost efficiency ($CPI$), schedule velocity ($SPI$), and statistical forecast at completion ($EAC = BAC / CPI$), while site engineers need low-friction mobile capture without navigating multiple desktop menus.
- **Decision**:
  1. Build `imperium-api/app/services/project_evm.py` computing $BAC, PV, EV, AC, CV, SV, CPI, SPI, EAC, VAC, TCPI$, alongside an S-curve time series generated using Sigmoid curve progression ($S(t) = 3t^2 - 2t^3$) mapped to actual milestone completion epochs.
  2. Embed `ProjectEvmStudio.tsx` inside the Financials workspace with an interactive SVG multi-line S-curve renderer.
  3. Deploy `SiteEngineerSpeedDial.tsx` as a floating action speed dial (FAB) across the project workspace layout, providing 1-tap mobile access to Pour Cards, Geotagged Photos, Defect Snags, Plant Shifts, Site Store Requisitions, and Adverse Weather Delay notices.
  4. Embed an Executive Portfolio Cockpit strip on `/dashboard/projects` summarizing portfolio contract value, active sites, at-risk/delayed projects, and pre-mobilisation readiness.

