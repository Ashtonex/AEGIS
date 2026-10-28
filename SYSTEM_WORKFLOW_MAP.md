# AEGIS System Workflow Map

Living map of every discoverable module, what it is for, and how far its
behaviour has been **verified** (not merely found in code). Statuses:
UNTESTED / FAILED / IN PROGRESS / BLOCKED / VERIFIED / NOT APPLICABLE.
Earlier `AEGIS_*` documents claim many items "VERIFIED FIXED"; treat those as
unverified unless this map links evidence in `SYSTEM_VERIFICATION_REPORT.md`.

Last updated: 2026-10-26.

## Environment facts (establish before any mutation)

| Item | Finding |
|---|---|
| Frontend | `aegis-web/` Next.js (App Router, custom Next version - read `node_modules/next/dist/docs/`), deployed on Vercel |
| Backend | `imperium-api/` FastAPI, raw SQL via SQLAlchemy `text()`, 80+ routers under `/api/v1/*`, Arq worker for jobs; deployed to DigitalOcean on push to `main` |
| Database | Supabase project `mzwwkwokpakdweyyscef` (AEGIS_SNC) = **production**. No dev branch, no separate test DB. Local `.env` and `imperium-api/.env` point at production |
| Safe mutation testing | Only inside an outer transaction that is always rolled back (`AsyncSession(bind=conn, join_transaction_mode="create_savepoint")`), see `imperium-api/scripts/verify_quotation_budget_sync.py`. Confirm row counts unchanged afterwards |
| Migrations | Raw SQL in `imperium-api/migrations/NNN_*.sql`, auto-applied on backend deploy; latest 274 |
| Auth / RBAC | Supabase JWT; permissions are rows in `core.permissions` checked by `require_permission`; project visibility via `core/project_scope.py` (`projects.read_all` vs assignment) |
| Live data volumes (2026-10-25) | 27 projects, 30 project budgets, 2 POs, 0 GRNs, 0 payroll runs, 2,502 journal entries, 228 stock-ledger rows, 47 supplier invoices |

## Module inventory

| # | Module (backend router → UI area) | Business purpose | Key actions | Main records | Downstream effects | Status |
|---|---|---|---|---|---|---|
| A | CRM & tenders (`crm*`, `pursuits`, `tender_bids`, `tender_requirement_templates` → `/dashboard/crm`) | Lead → opportunity → tender → won/lost | create/assign/stage-move leads, tasks, bids, mark won | `crm.*`, `finance.quotations`, `projects.projects` | Won opportunity/tender creates project and seeds budget (has $0 guard) | UNTESTED end-to-end; budget-seed guard reviewed. **e-GP discovery → tender import** VERIFIED in isolated DB + live portal read (migration 275 not yet applied in production) - docs/EGP_TENDER_DISCOVERY.md |
| B | Quotations & BOQs (`quotations`, `drawings`, `boq_progress` → `/dashboard/quotations`) | Price work, approve BOQ, win/lose, convert/link to project | create, BOQ edit/import, decision, convert-to-project, link-project | `finance.quotations.metadata.items`, `finance.boq_line_items` | Sets project approved budget + BOQ lines | **IN PROGRESS** - seeding paths repaired & verified (REG-001..004); cost-basis decision open (DEC-001) |
| C | Projects & budgets (`projects`, `budgets`, `financial_performance` → `/dashboard/projects/[id]`) | Project setup, team, budget baseline, gates, commitments vs actuals | create, assign roles, set/upload budget, Sync from Quotation, category summary | `projects.projects`, `finance.project_budgets`, `finance.budget_lines`, `finance.commitments`, `finance.cost_transactions` | Executive dashboards, forecasts | **IN PROGRESS** - Sync from Quotation VERIFIED (REG-002/003/005/006); 4 projects carry corrupted $0 budgets (DEC-002) |
| D | Site operations (`site_reports`, `site_day`, `site_operations`, `workforce*` → `/dashboard/site-operations`) | Attendance, daily reports, material requests | site day, labour register, daily report, material request | `projects.site_day_attendance`, `projects.daily_report_*`, `procurement.material_requests` | Procurement, cost, site pay | **IN PROGRESS** - register → report → payable hours repaired & VERIFIED (REG-018/019/020); overnight hours already accepted need correction (DEC-003); material requests UNTESTED |
| E | Procurement & inventory (`procurement`, `inventory`, `inventory_items`, `supplier_records` → `/dashboard/procurement`, `/dashboard/inventory`) | Requisition → PO (two-step sign-off) → GRN → stock → invoice → payment | requisition, RFQ, PO, sign-off, receive, issue/transfer | `procurement.*`, `finance.commitments` | Stock ledger, commitments, AP, GL proposal | **IN PROGRESS** - issued PO → GRN (partial/rejected) → stock → invoice → 3-way match → payment approval VERIFIED (REG-012..015); requisition/RFQ/sign-off, issue/transfer, returns, cancellation UNTESTED |
| F | Finance & GL (`general_ledger`, `gl_bridge`, `bank_*`, `payments`, `finance_*`, `financial_statements`, `management_accounts`, `audit_controls`) | Post, reconcile, report | journal post/reverse, bank import/allocate, statements | `finance.journal_entries/lines`, bank tables | Statements, cash forecast | Data check VERIFIED: 0 unbalanced posted journals, 0 header mismatches, duplicate-source postings are reversed pairs only. Workflows UNTESTED |
| G | HR, workforce & payroll (`hr_*`, `payroll_runs`, `payslips`, `workforce*`) | Employees → attendance → hours → payroll | employee setup, time approval, payroll run, payslips | `hr.*`, `finance.payroll_runs` | GL bridge | UNTESTED (0 payroll runs in production) |
| H | Plant, fleet & equipment (`fleet`, `equipment_assets`, `maintenance_schedules` → `/dashboard/fleet`, `/dashboard/equipment`) | Asset register, allocation, usage, maintenance | allocate, log shifts/fuel, work orders | `fleet.*` | Project plant cost | UNTESTED |
| I | Compliance, HSE & documents (`compliance_*`, `hse_incidents`, `documents`, `corporate_credentials`, `sop_compliance`) | Records, evidence, expiry, CAPA | create, attach, approve, expire alerts | `compliance.*`, `core.documents` | Gates (SOPs block quotation win) | UNTESTED |
| J | Executive dashboards & reports (`executive`, `kpi_metrics`, `bi_reports`, `automated_reports`, `analytics_ml`) | Metrics traced to source | overview bundle, drill-downs | reads across schemas | - | UNTESTED |
| K | Portals, tasks, comms (`portals`, `client_portal_tickets`, `internal_messages`, `notifications`, `teams`, `assignments`, `pwa`) | Client/supplier access, tasks, notifications | tickets, messages, push | `core.notifications`, portal tables | - | UNTESTED |
| L | Platform (`auth`, `users`, `settings`, `profiles`, `integrations_microsoft`, `public_intake`) | Identity, RBAC, settings, integrations | login, roles, permissions | `core.*` | Every module | Project-code deep-link scope VERIFIED (REG-007); rest UNTESTED |

## Workflow B/C detail: quotation → project budget (verified 2026-10-25)

```
Quotation (finance.quotations.metadata.items)
  ├─ decision=won ──► auto-link project by lineage only (quotation_id / opportunity / tender, unique)
  ├─ convert-to-project ──► new project
  ├─ link-project ──► existing project
  └─ Project ▸ Budget ▸ "Sync from Quotation" / "Choose & Link Quotation"
        │
        ▼  QuotationCalculator (single canonical calculation)
  guards: no items / $0 execution cost → no budget written (422 or "budget left unchanged")
          approved baseline exists and caller lacks projects.budget_baseline.lock → 403 / unchanged
        │
        ▼  seed_project_budget_from_quotation  → finance.project_budgets (approved, versioned; prior → superseded)
                                               → finance.budget_lines (sum == header)
           seed_boq_line_items_from_quotation → finance.boq_line_items (prior active → superseded, only if new lines exist)
           project.quotation_id / quotation.project_id stamped; domain event emitted
```
