# AEGIS Projects Module: Acceptance Matrix & Verification Evidence

All 7 construction operations & commercial control capabilities have been delivered as full vertical slices (Database -> ORM/Service -> API Router -> Frontend UI -> Automated Tests):

---

### Capability 1: Subcontractor Packages, Payment Certification, Retentions & Back-Charges
- **Acceptance Criteria**:
  - [x] Subcontract work packages defined with scope, allocated budget, and trade subcontractor linkage.
  - [x] Interim Payment Certificate (IPC) valuation ledger: gross certified, retention percentage deducted up to contractual cap, net payable.
  - [x] General ledger idempotency: certified liabilities post to `finance.cost_transactions` and retention to `finance.retention_ledger` without duplication.
  - [x] Contra-charges / back-charges deducted automatically from subcontractor certificates.
- **Verification Evidence**:
  - Database: `imperium-api/migrations/266_subcontractor_packages_and_commercial_controls.sql` applied.
  - Automated Tests: `imperium-api/tests/test_subcontractor_commercials.py` (2 tests passed).
  - UI: `aegis-web/src/components/projects/SubcontractCommercialsWorkspace.tsx` integrated in Project Financials.

---

### Capability 2: QA Inspections, Concrete Pour Cards & Mobile Snag Management
- **Acceptance Criteria**:
  - [x] Concrete pour card lifecycle: pre-pour inspection, pour execution, curing, cube compressive strength (7-day / 28-day).
  - [x] Site Engineer Quality Gate: all 5 pre-pour checks mandatory (`rebar_inspected`, `formwork_inspected`, `cleanliness_inspected`, `embedded_mep_inspected`, `cover_blocks_verified`) before authorization.
  - [x] Mobile snag defect register: pin, element location, severity, trade subcontractor, before/rectified photos, QA closure gate.
- **Verification Evidence**:
  - Database: `imperium-api/migrations/265_quality_pour_cards_and_site_snags.sql` applied.
  - Automated Tests: `imperium-api/tests/test_pour_cards_and_snags.py` (3 tests passed).
  - UI: `aegis-web/src/app/dashboard/projects/[id]/quality/page.tsx` with interactive 5-point gate and mobile snag cards.

---

### Capability 3: Project Plant Allocation, Utilization, Downtime & Fuel Analysis
- **Acceptance Criteria**:
  - [x] Project plant roster joining active fleet assignments (`fleet.fleet_assignments`).
  - [x] Real-time utilization calculation: $(Operating / (Operating + Idle + Breakdown)) \times 100$ with zero denominator safety.
  - [x] Fuel burn rate (litres/hour) reconciled against asset engineering benchmarks with variance alerts.
  - [x] Output productivity tracking ($m^3$, tonnes, trips per machine hour).
  - [x] Ownership classification: Company-owned vs Hired/leased plant distinction.
- **Verification Evidence**:
  - Service: `imperium-api/app/services/project_plant.py`.
  - Automated Tests: `imperium-api/tests/test_project_plant_analytics.py` (1 test passed).
  - UI: `aegis-web/src/app/dashboard/projects/[id]/plant/page.tsx` with quick shift log modal.

---

### Capability 4: Interactive Project Scheduling with CPM & Critical Path
- **Acceptance Criteria**:
  - [x] Predecessor/successor activity dependencies (`FS`, `SS`, `FF`, `SF`) with lag days.
  - [x] Forward and backward pass CPM float calculation ($TF = LS - ES$).
  - [x] Cyclic dependency loop detection via Kahn's topological sort.
  - [x] Critical path tagging (`is_critical = true` for zero/negative float).
  - [x] Interactive Gantt timeline with baseline vs forecast comparison bars.
- **Verification Evidence**:
  - Database: `imperium-api/migrations/264_project_scheduling_cpm_and_dependencies.sql` applied.
  - Automated Tests: `imperium-api/tests/test_project_schedule_cpm.py` (4 tests passed).
  - UI: `aegis-web/src/app/dashboard/projects/[id]/schedule/page.tsx`.

---

### Capability 5: Contractual Delay Events, Notices & EOT Tracking
- **Acceptance Criteria**:
  - [x] Contractual delay register with cause categorization (employer risk, adverse weather, force majeure, differing conditions).
  - [x] Contract clause linkage (FIDIC Red Book Cl. 8.4 / 20.1, NEC4, JBCC).
  - [x] Statutory notice time-bar countdown (e.g. 28-day notice window) with time-barred status alerting.
  - [x] Extension of Time (EOT) claim ledger linked to CPM milestone and critical path validation.
  - [x] Formal Engineer determination workflow: days granted, approved prolongation costs, and revised contractual completion date adjustment.
- **Verification Evidence**:
  - Database: `imperium-api/migrations/267_contractual_delays_and_eot_claims.sql` applied.
  - Automated Tests: `imperium-api/tests/test_project_delays_and_eot.py` (2 tests passed).
  - UI: `aegis-web/src/components/projects/ContractualDelaysWorkspace.tsx` integrated in Project Risks.

---

### Capability 6: Controlled Drawing Revision Register & Progress Photo Diary
- **Acceptance Criteria**:
  - [x] Controlled drawing register categorized by engineering discipline (Architectural, Structural, MEP, Civil, Geotechnical).
  - [x] Revision progression tracking: automatic archiving of previous revisions into `superseded_history`.
  - [x] IFC (Issued for Construction) status validation.
  - [x] Site progress photo diary: element/milestone tagged, capture date, weather condition, and GPS coordinates.
- **Verification Evidence**:
  - Database: `imperium-api/migrations/268_controlled_drawings_and_progress_photo_diary.sql` applied.
  - Automated Tests: `imperium-api/tests/test_project_progress_pack.py` (2 tests passed).
  - UI: `aegis-web/src/components/projects/ControlledDrawingsWorkspace.tsx` integrated in Project Documents.

---

### Capability 7: Client and Month-End Progress Pack Generation
- **Acceptance Criteria**:
  - [x] Consolidated progress pack API endpoint (`GET /projects/{project_id}/progress-pack`) synthesizing verified live operational and commercial data.
  - [x] Includes executive schedule progress, CPM critical path milestones, QA concrete pours, snag metrics, plant deployment & fuel, subcontractor liabilities, contractual delay notices, drawings, and photos.
  - [x] Print-ready executive preview modal (`ProgressPackModal.tsx`) supporting direct export to PDF with contractor and client signature blocks.
- **Verification Evidence**:
  - Service: `imperium-api/app/services/project_progress_pack.py`.
  - UI: `aegis-web/src/components/projects/ProgressPackModal.tsx` accessible from Documents and Mission Control.
  - Automated Tests: Tested in `test_project_progress_pack.py` (100% pass).
