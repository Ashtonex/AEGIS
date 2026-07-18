# AEGIS Modules Registry

Last updated: 2026-07-18

The AEGIS ecosystem consists of 26 interconnected business modules resting on the Imperium base layer. This registry reflects the current implementation state from the delivery log, route inventory, dashboard inventory, and contract-test evidence. It replaces the earlier all-`STUB` table, which is now stale.

This document is a delivery status guide, not a production sign-off. A module can be source-backed and verified locally while still requiring authenticated production probes, live Supabase migration verification, storage policy finalization, or release hardening.

## Module Status Definitions

- **OPERATIONAL**: Source-backed business flow exists, is exposed through API/dashboard surfaces, has permission checks or failure visibility, and has recent verification evidence.
- **PARTIAL**: Meaningful API or dashboard surface exists, but the module still depends on adjacent workflows, production data, or additional hardening before it should be treated as operationally complete.
- **SUPPORTING**: Router/table/surface exists primarily as a dependency or generic register. It has not yet received the same scenario-level hardening as the operational modules.
- **PRODUCTION PENDING**: The module has local or container verification but still needs authenticated production probes, live Supabase validation, deployment/storage finalization, or release sign-off.

## Current Module List

| ID | Module Name | Status | Current Evidence | Remaining Work |
|---|---|---|---|---|
| 01 | Projects | OPERATIONAL / PRODUCTION PENDING | Project dashboards, canonical reference lookup, executive drill-through, and source-backed finance tab hardening are implemented. | Authenticated production probes and live finance/project-control data validation. |
| 02 | Site Operations | OPERATIONAL / PRODUCTION PENDING | Daily site report vertical slice feeds executive exceptions, material requests, labour, equipment, and material evidence. | Approved report/export polish and authenticated action probes. |
| 03 | Workforce | OPERATIONAL / PRODUCTION PENDING | Workforce dashboard, deployment gate visibility, attendance, employee details, skills, certifications, and failure visibility are implemented. | Authenticated allocation/restriction probes. |
| 04 | Fleet | OPERATIONAL / PRODUCTION PENDING | Fleet operations, deployment gate visibility, utilisation, delivery controls, and explicit `fleet.read` checks are implemented. | Authenticated restriction/action probes. |
| 05 | Equipment Assets | OPERATIONAL / PRODUCTION PENDING | Equipment finance visibility, inspection-history failure visibility, and fleet permission checks are implemented. | Authenticated assignment and finance-source probes. |
| 06 | Procurement Orders | OPERATIONAL / PRODUCTION PENDING | Requisition, RFQ, supplier quote, direct PO rationale gate, GRN, invoice, three-way match, and payment evidence gates are implemented. | Authenticated write-flow and production data probes. |
| 07 | Inventory Items | OPERATIONAL / PRODUCTION PENDING | Stock levels, movements, issue controls, insufficient-stock conflict handling, and reorder events are implemented. | Authenticated issue/receipt probes against live stock ledger. |
| 08 | Budgets | OPERATIONAL / PRODUCTION PENDING | Budget reads are permission-gated through finance budget permissions and exposed through finance dashboards. | Authenticated budget create/update probes and live budget data validation. |
| 09 | Financial Performance | OPERATIONAL / PRODUCTION PENDING | Finance summary/detail, cost codes, variations, progress claims, failure visibility, and action-level permissions are implemented. | Authenticated finance workflow probes and production accounting evidence validation. |
| 10 | Quotations | PARTIAL / PRODUCTION PENDING | Typed quotation calculator, BOQ importer, PDF/XLSX generation, and worker smoke evidence exist. | Production storage, signed downloads, approval workflow, and authenticated generation probes. |
| 11 | HR Records | OPERATIONAL / PRODUCTION PENDING | Leave requests, leave decisions, skills, certifications, and HR failure visibility are implemented. | Authenticated HR approval probes. |
| 12 | Compliance Items | OPERATIONAL / PRODUCTION PENDING | Source-backed obligations, credentials, deployment gates, score, corrective actions, and controlled override endpoint are implemented. | Authenticated override execution probe with valid admin session. |
| 13 | HSE Incidents | PARTIAL / PRODUCTION PENDING | HSE incident evidence contributes to compliance and executive exception signals. | Scenario-level incident workflow hardening and authenticated write probes. |
| 14 | Documents | OPERATIONAL / PRODUCTION PENDING | Document list/detail/version/link reads, registration/status contracts, audit-backed versions, permissions, and failure visibility are implemented. | Production storage, retention, and signed-download policy. |
| 15 | CRM Contacts | OPERATIONAL / PRODUCTION PENDING | Contact registry, server-ID enforcement, no fake fallback records, and failed-write hardening are implemented. | Authenticated create/update probes. |
| 16 | CRM Leads | OPERATIONAL / PRODUCTION PENDING | Lead intake, public intake hardening, external-source fallback cleanup, Signal Bot failure handling, and CRM contract guards are implemented. | Authenticated lead conversion and automation integration probes. |
| 17 | Client Portal Tickets | PARTIAL / PRODUCTION PENDING | Portal router and client portal page exist. | Full ticket lifecycle, authenticated client session probes, and notification workflow. |
| 18 | Supplier Records | PARTIAL / PRODUCTION PENDING | Supplier registration/public routes and procurement supplier dependencies exist. | Source-backed supplier profile lifecycle, authenticated approval probes, and supplier portal validation. |
| 19 | Internal Messages | SUPPORTING | Router exists and supports communication plumbing. | Scenario-level messaging workflow, permissions, notifications, and dashboard verification. |
| 20 | KPI Metrics | SUPPORTING | KPI router exists as a BI dependency. | Source-backed KPI definition/governance workflow and dashboard verification. |
| 21 | BI Reports | OPERATIONAL / PRODUCTION PENDING | BI analytics endpoints are source-backed, permission-gated, and have failure visibility. | Authenticated executive analytics probes and live metric validation. |
| 22 | Risk Register | SUPPORTING | Router exists as a site/project dependency. | Source-backed risk lifecycle, mitigation workflow, permissions, and dashboard verification. |
| 23 | Tender Bids | PARTIAL / PRODUCTION PENDING | Tender public pages, CRM tender dashboard, interest forms, and tender routes exist. | Source-backed tender lifecycle and authenticated bid/award probes. |
| 24 | Maintenance Schedules | SUPPORTING | Router exists as a fleet dependency. | Preventive maintenance workflow, work orders, evidence attachments, and dashboard verification. |
| 25 | Automated Reports | OPERATIONAL / PRODUCTION PENDING | Templates, schedules, recent runs, generation, approval permissions, source snapshots, and failure visibility are implemented. | Management-pack polish, storage policy, and authenticated generation/approval probes. |
| 26 | Website Enquiries | OPERATIONAL / PRODUCTION PENDING | Public intake, website enquiries, CRM inbox integration, no fake local-send success, and failure visibility are implemented. | Authenticated reply/progression probes and production notification integration. |

## Cross-Cutting Completion Items

1. Run authenticated browser/API probes for the configured superadmin account.
2. Execute and validate live Supabase migrations deliberately per environment.
3. Finalize production document/report storage, retention, and signed-download flows.
4. Re-run frontend build, TypeScript, lint, backend tests, and Docker builds in a clean release environment.
5. Decide which public website content may remain static/mock-backed and which content must be CMS/API-backed before launch.

## Recommended Completion Sequence

1. Authenticated superadmin and permission-gated workflow probes.
2. Live Supabase migration and RLS validation.
3. Storage/download policy for documents, quotations, and reports.
4. Remaining partial modules: client portal tickets, supplier records, tender bids, HSE incidents.
5. Supporting modules: internal messages, KPI metrics, risk register, maintenance schedules.
