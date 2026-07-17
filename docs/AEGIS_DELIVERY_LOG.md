# AEGIS Delivery Log

This log records bounded implementation increments completed during the autonomous AEGIS hardening run. It is not a claim that the full programme is complete.

## Current verified increments

### Python dependency and security tooling integration

- Installed and pinned the missing approved Python security, document and assurance packages in the project virtual environment.
- Regenerated `imperium-api/requirements.lock.txt` from the project virtual environment.
- Added `scripts/verify_dependency_imports.py` to import every approved package used by the backend stack.
- Switched the backend logging facade from Loguru to `structlog` while preserving the existing exported logger/context interface.
- Added required security documents:
  - `docs/SECURITY_ARCHITECTURE.md`
  - `docs/SECURITY_OPERATIONS.md`
  - `docs/DEPENDENCY_SECURITY_REPORT.md`
- Replaced the partial AEGIS migration runner with a deterministic numbered SQL migration runner and excluded seed migrations by default.
- Aligned the backend Dockerfile with the tested Python 3.13 runtime.
- Upgraded vulnerable document-processing packages after `pip-audit` findings:
  - `pypdf` to `6.14.2`
  - `bleach` to `6.4.0`
  - `pdfplumber` to `0.11.10`
  - transitive `pdfminer.six` to `20260107`

Remaining verification limits:

- Full frontend production build still hangs beyond ten minutes in the local workspace.
- Docker API rebuild could not be completed because Docker Hub token retrieval hit a TLS handshake timeout.
- Actual database migration execution was not rerun against live Supabase from the new runner because the existing workspace already contains applied migration evidence and the new runner intentionally avoids unsafe seed execution by default.

### Authentication and original failure hardening

- Preserved the rule that `ashton@admin.com` is the only intended SUPERADMIN.
- No migrations or scripts in this run create or seed any SUPERADMIN user.
- Project detail loading now retries canonical ERP references: UUID, project code, project name and project_name.
- Shared frontend API handling now normalizes raw abort messages such as `signal is aborted without reason` into a controlled retry/service readiness message.
- Workforce dashboard now treats the employee register as the mandatory source and degrades HR/compliance side panels independently when optional sources fail.

### Settings administration

- Settings overview includes organization settings, notifications, integration metadata, role assignment, page-permission matrix, website content, and audit log.
- Settings audit reads both settings-specific events and canonical ERP `core.audit_log` entries, scoped by organization.
- Settings payloads remain typed and reject unexpected fields.
- Secrets are not persisted in settings tables; integrations store metadata only.

### Scenario A procurement flow

- Site material request bridges site operations, inventory, procurement and finance.
- RFQ, supplier quotation, quotation decision and purchase order generation are API-backed.
- Purchase order drawer now guides the flow through:
  - PO created
  - finance commitment
  - goods received
  - supplier invoice
  - three-way match
  - payment evidence gate
- Supplier invoice payment approval requires linked PO, GRN, supplier invoice and approval evidence documents.

### Automated reporting

- Added migration `027_reporting_controls.sql`.
- Automated report runs now store project, period, format, publication status and `evidence_snapshot`.
- Generated reports capture counts from live operational sources:
  - daily site reports
  - labour lines
  - equipment lines
  - material lines
  - purchase orders
  - supplier invoices
  - finance cost transactions
- Removed hard-coded recent report and schedule rows from reporting endpoints.

### Analytics and executive intelligence

- BI endpoints now query live tenant-scoped sources instead of hard-coded demo rows:
  - project performance from projects and finance cost transactions
  - equipment intelligence from fleet and utilisation logs
  - procurement intelligence from suppliers, POs, GRNs and invoices
  - workforce intelligence from attendance and labour cost transactions
- Analytics page now shows explicit empty states instead of fake charts or named demo projects/assets/suppliers.
- Executive exceptions now include source-backed signals from:
  - HSE incidents
  - compliance expiries
  - project viability
  - finance forecasts
  - supplier performance
  - equipment utilisation

### Scenario B equipment-to-finance visibility

- Fleet asset detail now exposes the Scenario B control rail:
  - project allocation
  - operator assignment
  - operating and idle hours
  - hourly charge rate
  - hourly operating cost
  - monthly ownership cost
  - estimated revenue
  - estimated operating cost
  - estimated margin
  - finance source / assignment trace
- Cost allocation readiness is calculated from live fleet fields; no asset profitability is fabricated when rates or utilisation are missing.

### Compliance source-backed controls

- Added migration `028_compliance_source_backed_controls.sql`.
- Added `compliance.corrective_actions` with tenant indexes, RLS forced on, and service-role-only access.
- Corrective actions now persist and emit `compliance.corrective_action.created.v1`.
- Compliance obligations, employee credentials, equipment credentials, corrective actions and score now return persisted tenant data or explicit empty/no-score states.
- Removed hard-coded compliance obligations, employee credential names, equipment licence examples and CAPA rows from the compliance API.
- Compliance score is calculated from obligations, employee credentials, deployment gates and corrective actions; it is `null` when no source evidence exists.

### Scenario C/F workforce-to-compliance gate visibility

- Workforce Command now pulls deployment gate checks directly from the compliance API.
- Added a “Workforce deployment gate status” panel showing:
  - checked time
  - employee
  - project/asset/deployment context
  - pass/block result
  - missing credential evidence
- Employee drawer now includes linked deployment gate evidence.
- Workforce dashboard now counts blocked deployments so restricted allocation failures are visible outside the Compliance module.

### Scenario C/F equipment-assignment gate visibility

- Fleet Operations now pulls deployment gate checks directly from the compliance API.
- Added an “Equipment assignment gate status” panel showing:
  - checked time
  - asset
  - operator
  - project
  - pass/block result
  - missing credential evidence
- Selected asset details now include linked equipment assignment gate evidence.
- Fleet dashboard now counts blocked deployments so operator/equipment restriction failures are visible outside the Compliance module.

### Scenario E site report to executive intelligence

- Executive exceptions now include approved daily site report exceptions for:
  - cost exposure
  - delays
  - safety notes
  - material wastage
- Site-report exception payloads include evidence:
  - daily site report id
  - report date
  - cost exposure
  - delay and safety text
  - labour/equipment/material line counts
  - material wastage quantity
- Executive project detail now reads `projects.daily_site_reports` for linked site reports instead of the legacy `projects.site_operations` table.
- Executive exception cards now show evidence and drill into project detail whenever a `project_id` is present.

### Automated reporting source evidence visibility

- Recent report runs now return `evidence_snapshot` and `source_status`.
- Reports UI now displays source evidence counts for generated reports.
- Reports UI no longer fabricates available templates when the reporting API is unavailable; it shows an explicit empty/service state instead.

### Controlled compliance deployment override

- Migration `029_compliance_gate_override_audit.sql` adds auditable override authority fields to `compliance.deployment_gate_checks`:
  - `override_by`
  - `override_at`
  - `override_reference`
  - partial index for active override lookup
- Backend now exposes `POST /api/v1/compliance-items/deployment-gate-checks/{check_id}/override`.
- Override rules:
  - requires `compliance.gate.override`
  - only blocked deployment gate checks can be overridden
  - requires a formal reason
  - records authority reference where provided
  - emits `compliance.deployment_override_recorded.v1`
- Compliance UI now surfaces blocked deployment gates with a controlled override action and evidence modal.
- Override status rows show reason and authority reference instead of hiding the missing credential evidence.

### CRM enterprise-record fallback cleanup

- Contacts registry no longer injects named fallback contacts or activity records when CRM services return no data or fail.
- Client organizations registry no longer injects named fallback organizations, contacts or activities when CRM services return no data or fail.
- Failed CRM contact, organization and activity writes no longer mutate browser state as if the database accepted the operation.
- Subcontractor registry no longer displays legacy sample subcontractors at runtime when the API returns no data or fails.
- CRM documents registry no longer fabricates version history with random uploaders; version history now comes only from API-provided document evidence.
- CRM inbox no longer appends mock WhatsApp threads to website enquiry threads.
- Failed inbox reply logging no longer marks the message as sent locally.
- CRM leads external-source panels no longer ship seeded prospect, scraped tender or LinkedIn mock opportunities.
- Signal Bot lead failures now report unsaved service failures instead of claiming a local queue.
- CRM automations no longer seed fallback workflow rules, fake telemetry history or local-only deploy/toggle/delete success.
- Automation simulation remains UI-only and explicitly reports that no production telemetry was written.
- CRM contact and client-account create failures no longer create browser-only records.
- Legacy named subcontractor sample records were removed from the subcontractor registry source.
- CRM contact, activity, organization and subcontractor create flows now require server-returned IDs before mutating local state.
- Added a CRM contract guard to prevent reintroducing fake enterprise records into operational dashboard registries.

### Project financial tab source-backed hardening

- Project detail financial tab no longer generates fallback contract values from project IDs.
- Budgeted cost, actual cost, committed cost and forecast cost are no longer derived from generated percentages when source data is missing.
- Financial scenario sliders are disabled/read-only until finance exposes a controlled forecast scenario workflow.
- Missing finance/project-control evidence now shows an explicit “Finance evidence not recorded” notice.

## Verification evidence

Latest verification completed:

- Approved Python package import verification: `38/38` imports succeeded.
- Backend pytest suite after dependency/security tooling integration: `132/132 passed`.
- Backend Ruff after dependency/security tooling integration: passed.
- Backend mypy after dependency/security tooling integration: passed for the configured checked scope.
- `pip check`: no broken requirements found.
- `pip-audit -r requirements.txt`: no known vulnerabilities found after package upgrades.
- Bandit: completed with documented temporary exclusions for pre-existing `B608` and `B110` debt.
- Scoped detect-secrets scan over source/docs/config placeholders: no findings.
- FastAPI local Uvicorn health check: `/health` returned HTTP 200.
- Arq worker settings import: 3 registered functions, timeout 300 seconds, max tries 3.
- Arq quotation document worker smoke with Redis: queued job completed with result `True`.
- Frontend TypeScript with stale incremental state disabled: `npx tsc --noEmit --incremental false` passed.
- Frontend lint: `npm run lint -- --no-cache` passed.

- Backend pytest suite previously completed: `67/67 passed`
- Standard-library backend contract discovery: `59/59 passed`
- Standard-library backend contract discovery after Scenario E: `62/62 passed`
- Standard-library backend contract discovery after controlled deployment overrides: `64/64 passed`
- Standard-library backend contract discovery after CRM fallback cleanup: `67/67 passed`
- Standard-library backend contract discovery after CRM document-evidence cleanup: `68/68 passed`
- Standard-library backend contract discovery after CRM inbox cleanup: `69/69 passed`
- Standard-library backend contract discovery after CRM leads cleanup: `70/70 passed`
- Standard-library backend contract discovery after CRM automations cleanup: `71/71 passed`
- Standard-library backend contract discovery after CRM write-failure hardening: `71/71 passed`
- Standard-library backend contract discovery after project finance fallback removal: `72/72 passed`
- Standard-library backend contract discovery after legacy subcontractor sample removal: `72/72 passed`
- Standard-library backend contract discovery after CRM server-ID enforcement: `72/72 passed`
- Focused Scenario B + compliance contracts: `15/15 passed`
- Focused Workforce + compliance gate contracts after UI gate visibility: `15/15 passed`
- Focused Workforce + compliance gate contracts after controlled override workflow: `11/11 passed`
- Focused Fleet Scenario B + equipment gate contracts: `6/6 passed`
- Focused executive + daily-site-report contracts: `13/13 passed`
- Focused automated-reporting contracts after source-evidence UI: `4/4 passed`
- Frontend TypeScript: `npx tsc --noEmit` passed
- Frontend lint: passed
- Docker production rebuild: passed for `imperium-api` and `aegis-web`
- Docker web rebuild after Workforce gate panel: passed
- Docker web rebuild after Fleet gate panel: passed
- Docker API + web rebuild after Scenario E executive integration: passed
- Docker API + web rebuild after reporting source-evidence visibility: passed
- Docker web rebuild after CRM fallback cleanup: passed
- Docker web rebuild after CRM document-evidence cleanup: passed
- Docker web rebuild after CRM inbox cleanup: passed
- Docker web rebuild after CRM leads cleanup: passed
- Docker web rebuild after CRM automations cleanup: passed
- Docker web rebuild after CRM write-failure hardening: passed
- Docker web rebuild after project finance fallback removal: passed
- Docker web rebuild after legacy subcontractor sample removal: passed
- Docker web rebuild after CRM server-ID enforcement: passed
- Migration `027_reporting_controls.sql`: applied successfully through the API container before Docker Desktop became unavailable.
- Migration `028_compliance_source_backed_controls.sql`: applied successfully through the API container.
- Migration `029_compliance_gate_override_audit.sql`: applied successfully through the API container.

Runtime verification status:

- Dashboard page probes returned HTTP 200:
  - `/dashboard/fleet`
  - `/dashboard/compliance`
  - `/dashboard/analytics`
  - `/dashboard/reports`
  - `/dashboard/executive`
  - `/dashboard/projects`
  - `/dashboard/settings`
  - `/dashboard/workforce`
- Broad post-hardening dashboard route probe returned HTTP 200 for 20/20 checked pages:
  - `/dashboard/projects`
  - `/dashboard/settings`
  - `/dashboard/workforce`
  - `/dashboard/fleet`
  - `/dashboard/compliance`
  - `/dashboard/procurement`
  - `/dashboard/inventory`
  - `/dashboard/finance`
  - `/dashboard/reports`
  - `/dashboard/executive`
  - `/dashboard/site-operations`
  - `/dashboard/documents`
  - `/dashboard/crm`
  - `/dashboard/crm/leads`
  - `/dashboard/crm/contacts`
  - `/dashboard/crm/organizations`
  - `/dashboard/crm/subcontractors`
  - `/dashboard/crm/documents`
  - `/dashboard/crm/inbox`
  - `/dashboard/crm/automations`
- `/dashboard/workforce` was re-probed after the gate visibility rebuild and returned HTTP 200.
- `/dashboard/fleet` was re-probed after the equipment gate visibility rebuild and returned HTTP 200.
- `/dashboard/executive` and `/dashboard/site-operations` were re-probed after the Scenario E rebuild and returned HTTP 200.
- OpenAPI registration confirmed for:
  - `/api/v1/executive/exceptions`
  - `/api/v1/executive/projects/{project_id}/detail`
  - `/api/v1/site-operations/daily-reports/{report_id}/decision`
- Unauthenticated `/api/v1/executive/exceptions` returned HTTP 403, confirming the route is live and protected.
- `/dashboard/reports` was re-probed after the reporting source-evidence rebuild and returned HTTP 200.
- OpenAPI registration confirmed for:
  - `/api/v1/automated-reports/recent`
  - `/api/v1/automated-reports/generate`
  - `/api/v1/automated-reports/{report_id}/approve`
- Unauthenticated `/api/v1/automated-reports/recent` returned HTTP 403, confirming the route is live and protected.
- `/dashboard/compliance` was re-probed after the controlled override rebuild on the active compose port and returned HTTP 200.
- CRM dashboard registry probes after fallback cleanup returned HTTP 200:
  - `/dashboard/crm/contacts`
  - `/dashboard/crm/organizations`
  - `/dashboard/crm/subcontractors`
- `/dashboard/crm/documents` was re-probed after document-evidence cleanup and returned HTTP 200.
- `/dashboard/crm/inbox` was re-probed after inbox cleanup and returned HTTP 200.
- `/dashboard/crm/leads` was re-probed after leads external-source cleanup and returned HTTP 200.
- `/dashboard/crm/automations` was re-probed after automations cleanup and returned HTTP 200.
- `/dashboard/crm/contacts` and `/dashboard/crm/organizations` were re-probed after write-failure hardening and returned HTTP 200.
- `/dashboard/projects` was re-probed after project finance fallback removal and returned HTTP 200.
- `/dashboard/crm/subcontractors` was re-probed after legacy subcontractor sample removal and returned HTTP 200.
- `/dashboard/crm/contacts`, `/dashboard/crm/organizations` and `/dashboard/crm/subcontractors` were re-probed after CRM server-ID enforcement and returned HTTP 200.
- OpenAPI registration confirmed for:
  - `/api/v1/compliance-items/deployment-gate-checks`
  - `/api/v1/compliance-items/deployment-gate-checks/{check_id}/override`
- Unauthenticated deployment-gate override returned HTTP 403, confirming the route is live and protected.
- OpenAPI registration confirmed for:
  - `/api/v1/compliance-items/corrective-actions`
  - `/api/v1/compliance-items/equipment-credentials`
  - `/api/v1/compliance-items/score`
  - `/api/v1/fleet/`
  - `/api/v1/fleet/utilization`
  - `/api/v1/bi-reports/equipment`
  - `/api/v1/executive/exceptions`
  - `/api/v1/automated-reports/generate`
- Protected API probes returned HTTP 403 without authentication, confirming routes are live and guarded.

## Project material evidence hardening

- Project detail now returns `material_records` from `projects.daily_report_materials`, joined through daily site reports and enriched with inventory item/store context.
- Project Materials tab now reads only API-provided daily site report material lines.
- Removed generated material targets/progress, browser-only material delivery logs, random IDs and unsupported blockchain/audit claims from the project Materials tab.
- Empty state now explicitly reports `No material evidence recorded` until source material lines exist.

Verification:

- `python -m unittest imperium-api.tests.test_projects_router_contract` passed: 7/7.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 73/73.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt and restarted both services successfully.
- `/dashboard/projects` returned HTTP 200 after rebuild.
- `/api/v1/executive/projects/{project_id}/detail` is present in OpenAPI.
- Unauthenticated `/api/v1/executive/projects/SNC-KARIBA/detail` returned HTTP 403, confirming the route is live and protected.

## Shared API client hardening

- Operational `/api/v1` calls now default to no mock/demo fallback unless explicitly overridden.
- API timeout aborts now carry an explicit `TimeoutError` reason instead of an unreasoned abort signal.
- Existing upstream abort signals are respected and forwarded through the shared API client.
- Non-OK backend responses now read structured response bodies before surfacing a message, so API errors can show backend detail instead of generic `API Error: Not Found`.

Verification:

- `python -m unittest imperium-api.tests.test_frontend_api_contract` passed: 3/3.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 75/75.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build aegis-web` rebuilt and restarted the web service successfully.
- Dashboard route probes returned HTTP 200:
  - `/dashboard/settings`
  - `/dashboard/fleet`
  - `/dashboard/workforce`
  - `/dashboard/projects`
  - `/dashboard/procurement`
  - `/dashboard/inventory`
- Protected unauthenticated API probes returned HTTP 403:
  - `/api/v1/settings/overview`
  - `/api/v1/fleet/`
  - `/api/v1/workforce/`

## Settings access and website-content hardening

- Settings role assignment now enforces the configured sole-superadmin invariant: `SUPERADMIN` access is restricted to `ashton@admin.com`.
- Settings role removal now prevents removing the configured `SUPERADMIN` role from `ashton@admin.com`.
- Website content overview no longer silently falls back to default placeholder content when the storage table query fails; missing migration now returns a controlled 503.
- Website content editor now sends a strict backend-compatible payload only (`page_key`, `section_key`, title/subtitle/body, status, metadata), avoiding rejected saves caused by UI-only fields such as `id` and `updated_at`.

Verification:

- `python -m unittest imperium-api.tests.test_settings_router_contract imperium-api.tests.test_settings_security_contract` passed: 10/10.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 77/77.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt and restarted both services successfully.
- `/dashboard/settings` returned HTTP 200 after rebuild.
- OpenAPI registration confirmed for:
  - `/api/v1/settings/overview`
  - `/api/v1/settings/audit-events`
  - `/api/v1/settings/website-content`
  - `/api/v1/settings/users/{target_user_id}/roles`
  - `/api/v1/settings/users/{target_user_id}/roles/{role_id}`
- Unauthenticated `/api/v1/settings/audit-events` returned HTTP 403, confirming the route is live and protected.

## Procurement direct-PO supplier rationale gate

- Direct purchase orders from approved requisitions now require a supplier-selection rationale.
- RFQ-based purchase orders remain governed by quotation response selection/evaluation; this gate targets only direct supplier selection.
- Procurement UI now captures `Supplier selection rationale` before direct PO creation and sends it as the PO notes/rationale.
- The Create PO action remains disabled until a supplier is selected and the rationale has enough substance to be auditable.

Verification:

- `python -m unittest imperium-api.tests.test_procurement_inventory_contract` passed: 8/8.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 78/78.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt and restarted both services successfully.
- `/dashboard/procurement` returned HTTP 200 after rebuild.
- OpenAPI registration confirmed for:
  - `/api/v1/procurement/purchase-orders`
  - `/api/v1/procurement/purchase-orders/from-rfq`
  - `/api/v1/site-operations/material-requests`
- Unauthenticated `/api/v1/procurement/purchase-orders` returned HTTP 403, confirming the route is live and protected.

## Inventory stock issue control hardening

- Manual stock issue now checks source-backed stock ledger balance before inserting a negative issue movement.
- If available stock is insufficient, the API returns HTTP 409 with guidance to use a material request/procurement shortfall path instead of silently driving inventory negative.
- Successful stock issues now evaluate the inventory item's reorder level and emit `inventory.below_reorder_level.v1` when the remaining balance crosses the threshold.

Verification:

- `python -m unittest imperium-api.tests.test_procurement_inventory_contract` passed: 9/9.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 79/79.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `docker compose up -d --build imperium-api` rebuilt and restarted the API service successfully.
- `/dashboard/inventory` returned HTTP 200 after rebuild.
- OpenAPI registration confirmed for:
  - `/api/v1/inventory/issue`
  - `/api/v1/inventory/stock-levels`
  - `/api/v1/inventory/movements`
- Unauthenticated `/api/v1/inventory/stock-levels` returned HTTP 403, confirming the route is live and protected.
- Broad dashboard regression after procurement/inventory hardening returned HTTP 200 for 20/20 checked pages:
  - `/dashboard/projects`
  - `/dashboard/settings`
  - `/dashboard/workforce`
  - `/dashboard/fleet`
  - `/dashboard/compliance`
  - `/dashboard/procurement`
  - `/dashboard/inventory`
  - `/dashboard/finance`
  - `/dashboard/reports`
  - `/dashboard/executive`
  - `/dashboard/site-operations`
  - `/dashboard/documents`
  - `/dashboard/crm`
  - `/dashboard/crm/leads`
  - `/dashboard/crm/contacts`
  - `/dashboard/crm/organizations`
  - `/dashboard/crm/subcontractors`
  - `/dashboard/crm/documents`
  - `/dashboard/crm/inbox`
  - `/dashboard/crm/automations`

## Finance failure-visibility hardening

- Finance dashboard no longer converts failed finance service calls into successful empty arrays.
- Finance data load failures now surface as a visible error banner: `Finance data could not be loaded.`
- Existing finance API client calls remain explicit `allowFallback: false` operational calls.

Verification:

- `python -m unittest imperium-api.tests.test_finance_frontend_contract` passed: 2/2.
- `python -m unittest discover -s imperium-api\tests -p "test_*contract.py"` passed: 81/81.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build aegis-web` rebuilt and restarted the web service successfully.
- `/dashboard/finance` returned HTTP 200 after rebuild.
- OpenAPI registration confirmed for:
  - `/api/v1/financial-performance/projects`
  - `/api/v1/financial-performance/cost-codes`
  - `/api/v1/financial-performance/variations`
  - `/api/v1/financial-performance/progress-claims`
  - `/api/v1/budgets/`
- Unauthenticated `/api/v1/financial-performance/projects` returned HTTP 403, confirming the route is live and protected.

## Enterprise document management source-backed hardening

- Document repository APIs now use explicit action-level permissions:
  - `documents.read` for list/detail/version/link reads
  - `documents.create` for document registration
  - `documents.update` for document status decisions
- Document create/status payloads are now strict Pydantic contracts with extra fields rejected and whitespace normalized.
- Document version history no longer returns hard-coded release data. The versions endpoint now returns the current `core.documents` record plus source-backed audit entries from `core.audit_log`.
- Document dashboard no longer masks document service failures as empty successful data.
- Document dashboard now shows a visible failure banner: `Document data could not be loaded.`
- Document registration no longer pre-populates fake file names or file sizes.
- Document detail now reads backend file size from `file_size_bytes` and avoids synthetic document numbers or version labels when those fields are absent.

Verification:

- `python -m unittest imperium-api.tests.test_documents_contract -v` passed: 5/5.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 96/96.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt and restarted both services successfully.
- `/dashboard/documents` returned HTTP 200 after rebuild on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/documents/`
  - `/api/v1/documents/{document_id}`
  - `/api/v1/documents/{document_id}/versions`
  - `/api/v1/documents/{document_id}/links`
- Unauthenticated `/api/v1/documents/` returned HTTP 403, confirming the route is live and protected.

## Automated reporting failure-visibility and permission hardening

- Automated reporting endpoints now use explicit action permissions:
  - `automated_reports.read` for templates, schedules, and recent runs
  - `automated_reports.create` for report generation
  - `automated_reports.approve` for publication approval
- Report generation payloads now reject unexpected fields, normalize whitespace, restrict output format to `pdf` or `excel`, and reject date ranges where `end_date` is before `start_date`.
- Reports dashboard no longer converts reporting endpoint failures into successful empty arrays.
- Reports dashboard now surfaces a visible failure banner: `Reporting data could not be loaded.`
- Existing report runs continue to display source evidence snapshots from operational tables.

Verification:

- `python -m unittest imperium-api.tests.test_reporting_contract -v` passed: 5/5.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 97/97.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt images and recreated both services; the shell command timed out after Docker had already reported both containers started.
- `docker compose ps` confirmed `imperium-api` and `aegis-web` are up.
- `/dashboard/reports` returned HTTP 200 after rebuild on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/automated-reports/available`
  - `/api/v1/automated-reports/scheduled`
  - `/api/v1/automated-reports/recent`
  - `/api/v1/automated-reports/generate`
  - `/api/v1/automated-reports/{report_id}/approve`
- Unauthenticated `/api/v1/automated-reports/recent` returned HTTP 403, confirming the route is live and protected.

## Analytics decision-intelligence failure-visibility and permission hardening

- BI analytics endpoints now require `executive.view_dashboard` instead of only checking for an authenticated identity.
- Analytics dashboard no longer converts failed intelligence calls into successful empty arrays.
- Analytics dashboard now surfaces a visible failure banner: `Analytics data could not be loaded.`
- Existing analytics empty states remain available only for genuine source-backed empty result sets.

Verification:

- `python -m unittest imperium-api.tests.test_analytics_contract -v` passed: 4/4.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 98/98.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build imperium-api aegis-web` rebuilt and restarted both services successfully.
- `docker compose ps` confirmed `imperium-api` and `aegis-web` are up.
- `/dashboard/analytics` returned HTTP 200 after rebuild on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/bi-reports/projects`
  - `/api/v1/bi-reports/equipment`
  - `/api/v1/bi-reports/procurement`
  - `/api/v1/bi-reports/workforce`
  - `/api/v1/executive/exceptions`
- Unauthenticated `/api/v1/bi-reports/projects` returned HTTP 403, confirming the route is live and protected.
- Broad dashboard regression after document/reporting/analytics hardening returned HTTP 200 for 21/21 checked pages:
  - `/dashboard/projects`
  - `/dashboard/settings`
  - `/dashboard/workforce`
  - `/dashboard/fleet`
  - `/dashboard/compliance`
  - `/dashboard/procurement`
  - `/dashboard/inventory`
  - `/dashboard/finance`
  - `/dashboard/reports`
  - `/dashboard/analytics`
  - `/dashboard/executive`
  - `/dashboard/site-operations`
  - `/dashboard/documents`
  - `/dashboard/crm`
  - `/dashboard/crm/leads`
  - `/dashboard/crm/contacts`
  - `/dashboard/crm/organizations`
  - `/dashboard/crm/subcontractors`
  - `/dashboard/crm/documents`
  - `/dashboard/crm/inbox`
  - `/dashboard/crm/automations`

## Compliance failure-visibility hardening

- Compliance dashboard no longer converts failed compliance, credential, deployment-gate, HSE, or score API calls into successful empty arrays/null score.
- Compliance dashboard now surfaces a visible failure banner: `Compliance data could not be loaded.`
- This prevents missing compliance service connectivity from being misread as zero blocked deployments, zero expired credentials, or no open obligations.

Verification:

- `python -m unittest imperium-api.tests.test_workforce_compliance_gate_contract -v` passed: 11/11.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 98/98.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build aegis-web` rebuilt and restarted the web service successfully.
- `docker compose ps` confirmed `imperium-api` and `aegis-web` are up.
- `/dashboard/compliance` returned HTTP 200 after rebuild on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/compliance-items/deployment-requirements`
  - `/api/v1/compliance-items/deployment-gate-checks`
  - `/api/v1/compliance-items/deployment-gate-checks/{check_id}/override`
  - `/api/v1/compliance-items/score`
- Unauthenticated `/api/v1/compliance-items/deployment-gate-checks` returned HTTP 403, confirming the route is live and protected.

## HR failure-visibility hardening

- HR dashboard no longer converts failed leave-request, employee-skill, or employee-certification API calls into successful empty arrays.
- HR dashboard now surfaces a visible failure banner: `HR data could not be loaded.`
- Employee detail now fails visibly if skills/certification evidence cannot be loaded, instead of presenting missing competency/credential records as “none on file.”

Verification:

- `python -m unittest imperium-api.tests.test_hr_frontend_contract -v` passed: 2/2.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 100/100.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npx tsc --noEmit` passed for `aegis-web`.
- `docker compose up -d --build aegis-web` rebuilt and restarted the web service successfully.
- `docker compose ps` confirmed `imperium-api` and `aegis-web` are up.
- `/dashboard/hr` returned HTTP 200 after rebuild on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/workforce/`
  - `/api/v1/workforce/{employee_id}`
  - `/api/v1/workforce/{employee_id}/skills`
  - `/api/v1/workforce/{employee_id}/certifications`
  - `/api/v1/workforce/attendance`
  - `/api/v1/hr-records/leave`
  - `/api/v1/hr-records/leave/{leave_id}/decision`
- Unauthenticated `/api/v1/workforce/` and `/api/v1/hr-records/leave` returned HTTP 403, confirming the routes are live and protected.

## Finance permission hardening

- Finance summary/detail routes now require `finance.cost.read`.
- Finance cost-code reads now require `finance.budget.read`.
- Finance variation reads now require `finance.variation.read`.
- Finance progress-claim reads now require `finance.claim.read`.
- Budget reads now require `finance.budget.read` instead of a bare identity check.
- Finance create payloads remain strict Pydantic contracts with extra fields rejected and whitespace normalized.

Verification:

- `python -m unittest imperium-api.tests.test_finance_frontend_contract -v` passed: 4/4.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 102/102.
- `docker compose up -d imperium-api aegis-web` restarted the stack successfully after Docker Desktop was restored.
- `/dashboard/finance` returned HTTP 200 after the restart on the active host port `3001`.
- OpenAPI registration confirmed for:
  - `/api/v1/financial-performance/projects`
  - `/api/v1/financial-performance/projects/{project_id}`
  - `/api/v1/financial-performance/cost-codes`
  - `/api/v1/financial-performance/variations`
  - `/api/v1/financial-performance/progress-claims`
  - `/api/v1/budgets/`
- Unauthenticated `/api/v1/financial-performance/projects` returned HTTP 403, confirming the route is live and protected.

## Immediate next work

1. Continue Scenario C/F hardening:
   - authenticated override execution probe when a valid admin session token is available
   - restriction visibility in workforce and fleet deployment actions
2. Add authenticated browser probes for the single configured superadmin session when a browser auth token/session is available.
3. Continue reporting/export polish for approved site reports and management packs.

## Equipment and settings failure-visibility hardening

- Equipment detail no longer swallows inspection-history load failures.
- Equipment asset read paths now require explicit `fleet.read` permission rather than bare identity checks.
- Settings website broadcast loading now surfaces a visible error state instead of logging failures only to the console.

Verification:

- `python -m unittest imperium-api.tests.test_equipment_finance_contract -v` passed: 8/8.
- `python -m unittest imperium-api.tests.test_settings_router_contract -v` passed: 6/6.
- `python -m unittest imperium-api.tests.test_settings_security_contract -v` passed: 4/4.
- `python -m unittest discover -s imperium-api/tests -p "test_*.py" -v` passed: 104/104.
- `npm run lint --prefix aegis-web` passed with no warnings/errors.
- `npm exec --prefix aegis-web -- tsc --noEmit --project aegis-web/tsconfig.json` passed.
- `docker compose up -d --build aegis-web` rebuilt the web image successfully.
- `docker compose ps` confirmed the rebuilt `aegis-web` container is up.
- `/dashboard/equipment` returned HTTP 200 after the rebuild on the active host port `3001`.
- `/dashboard/settings` returned HTTP 200 after the rebuild on the active host port `3001`.
