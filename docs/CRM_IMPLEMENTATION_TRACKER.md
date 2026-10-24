# AEGIS CRM Implementation Tracker & Live Operational Maintenance Gate

**Lead Engineer**: AI Lead Architecture Engineer  
**Scope**: Connected Commercial Workflow (`aegis-web`, `imperium-api`)  
**Operational Status**: LIVE SYSTEM MAINTENANCE — MUTATION UAT PAUSED  
**Last Updated**: 2026-10-20  

---

## 1. Actual Live System Architecture

The AEGIS system is in active daily operational use by Six Nine Construction:

| Dimension | Live Operating Infrastructure | Evidence / Source of Truth |
|---|---|---|
| **Live Web Application** | `https://sixnineconstruction.com` (Vercel deployment) & Microsoft Teams personal tab (`/teams/tasks`, `/dashboard/crm/tasks`) | `deploy/teams-app/manifest.json`, `aegis-web` CI/CD |
| **Live Backend API** | DigitalOcean Ubuntu Droplet via Caddy reverse-proxy (`/opt/aegis`) with Docker Compose | `.github/workflows/deploy-backend.yml`, `deploy/digitalocean/docker-compose.yml` |
| **Operational Database** | Supabase Project `mzwwkwokpakdweyyscef` (PostgreSQL 17 pooler at `aws-0-eu-west-1.pooler.supabase.com:6543`) | `imperium-api/core/database.py`, `.env` |
| **Active Organization** | `00000000-0000-0000-0000-000000000001` (`Six Nine Construction (Private) Limited`) — contains 38 active employees/executives, 34 live deals | Database query on `core.organizations`, `core.users`, `crm.opportunities` |
| **Authentication & RBAC** | Supabase GoTrue Auth, JWT verification, `core.user_roles`, `core.role_permissions` | `imperium-api/core/security.py` |
| **Document Storage** | Hybrid: Microsoft SharePoint via Microsoft Graph API & Supabase Storage | `app/services/microsoft/document_service.py`, `core.documents` |
| **Background Workers** | Arq Worker (`arq app.workers.arq_worker.WorkerSettings`) with Redis (`redis:6379/0`) | `deploy/digitalocean/docker-compose.yml`, `app/workers/arq_worker.py` |
| **Current Live Commit** | `36b07b0de9bd08350310f222b14938eb764c297a` | Droplet Git tracking / GitHub main |

---

## 2. Reconciled CRM Work Status

| CRM Feature / Workflow | Live Deployed (`36b07b0`) | Local Working Tree Changes | Implementation Status | Verification Level | Operational Risk |
|---|---|---|---|---|---|
| **OpportunityDetailDrawer** | Shared modal replaced by drawer | Deal-scoped attachments via `getDocumentsForEntity`, race protection via `currentOppIdRef`, unlinking support | **IMPLEMENTED** | Typecheck (0 errors), Build clean, Contract test passed | Read-only inspection safe; mutation paused |
| **Opportunity Document Scoping** | Global document library leakage present in legacy modal | Server-side entity ownership verified in `documents.py`; client strictly calls `for-entity` | **IMPLEMENTED** | Contract tests passed (`test_documents_contract.py`) | Zero data bleed |
| **Tender vs Deal Separation** | Separate tables exist; compliance checklists shared | Strict boundary maintained; compliance checklist isolated to `/dashboard/crm/tenders` | **IMPLEMENTED** | Route & contract tests passed | Safe |
| **Quotation & Project Handoff** | Unserialized handoff endpoints | `FOR UPDATE OF o` added to `create_opportunity_quotation`, `record_client_quotation`, `mark_opportunity_won` | **IMPLEMENTED** | AST contract passed; Live SQL concurrency passed | Mutation paused on live DB |
| **Stage Model & Terminal Outcomes** | Sequential stepper allowed stepping into Won/Lost | Canonical active stages (`Qualification`, `Proposal`, `Negotiation`) decoupled from terminal outcomes (`Won`, `Lost`) | **IMPLEMENTED** | Contract tests passed (`test_won_and_lost_are_alternative_terminal_outcomes`) | Safe |
| **Active Pipeline & Margin KPIs** | Synthetic velocity; closed deals counted in open total | Closed deals filtered out; genuine 30d deal count; value-weighted margin with deal coverage fraction | **IMPLEMENTED** | Typecheck passed; build clean | Safe |
| **Support Desk Consolidation** | Divergent `/crm/support` vs `/crm/tickets` | `/crm/tickets` redirects to `/crm/support`; drawer handles comments and attachments | **IMPLEMENTED** | Contract tests passed (`test_crm_support_pages_contract.py`) | Safe |
| **Campaign Telemetry** | Unwired buttons | Outbound events queued as pending ledger rows; real dispatch suppressed | **IMPLEMENTED** | Contract test passed | Real dispatch blocked |
| **Navigation Streamlining** | 22 cluttered items | 14 core pillars in `navigation.ts`; 142 routes verified reachable | **IMPLEMENTED** | `check-nav-completeness.js` (PASS) | Safe |

---

## 3. Implemented Safeguards Against Operational Mutations

1. **Server-Side Target Guard (`imperium-api/core/database.py`)**:
   - `OperationalDatabaseProtectionError` and `assert_mutation_allowed_for_testing()` implemented.
   - Detects if `DATABASE_URL` matches the live operational Supabase pooler (`mzwwkwokpakdweyyscef`) or `ENVIRONMENT=production`.
   - Aborts any test script attempting mutations unless `ALLOW_OPERATIONAL_MUTATIONS=true` is explicitly provided.
   - Verified by automated contract test `test_operational_database_guard_blocks_mutations_when_live_pooler_detected` (**PASS**).

2. **Frontend Visual Environment Indicator (`aegis-web/src/app/dashboard/DashboardShell.tsx`)**:
   - Renders a prominent warning badge in the global navigation bar next to the organization name whenever attached to an operational database in development:
     `Operational DB Attached` (amber badge).

---

## 4. Reconciled Test Evidence & Record Cleanup

- **Concurrency Test Execution**: Executed via direct SQL session script `scratch/live_postgres_concurrency_test.py`. It confirmed row-level serialization (`FOR UPDATE OF o`) in PostgreSQL: Worker 1 inserted quote/project; Worker 2 detected existing records and deduplicated.
- **Records Created & Deleted**:
  - Test deal `f9999999-0000-0000-0000-000000000001` $\rightarrow$ deleted.
  - Test quote `88c006eb-b684-47cc-8df7-dc6a3abb9c45` (in `finance.quotations`) $\rightarrow$ deleted.
  - Test project `2000c086-c336-4704-b714-037d765caad9` (in `projects.projects`) $\rightarrow$ deleted.
- **Operational Data Integrity**: Direct query confirms all **34 operational opportunities** in Six Nine Construction (including `CBC Yard paving`, `Milton Park`, `Mutare Dry Port`, `Staff Housing`) remain **100% intact**. Zero business records modified.

---

## 5. Corrected Rollback Procedure

> [!IMPORTANT]
> **Preserving Unrelated Work**:
> `git checkout main -- .` is strictly prohibited because it clobbers unrelated files across the entire workspace.

If rolling back this CRM iteration prior to live deployment:
1. Create a diff patch of the current CRM working tree:
   ```powershell
   git diff 36b07b0 > crm_release_candidate.patch
   ```
2. Revert strictly the CRM files modified in this iteration back to baseline commit `36b07b0`:
   ```powershell
   git checkout 36b07b0 -- `
     aegis-web/scripts/check-nav-completeness.js `
     aegis-web/src/app/dashboard/DashboardShell.tsx `
     aegis-web/src/app/dashboard/crm/campaigns/page.tsx `
     aegis-web/src/app/dashboard/crm/opportunities/page.tsx `
     aegis-web/src/app/dashboard/crm/page.tsx `
     aegis-web/src/components/crm/OpportunityDetailDrawer.tsx `
     imperium-api/core/database.py `
     imperium-api/routers/crm.py `
     imperium-api/tests/test_crm_opportunities_contract.py `
     imperium-api/tests/test_documents_contract.py `
     aegis-web/public/version.json `
     docs/CRM_IMPLEMENTATION_TRACKER.md
   ```
3. Because no database schema migrations were applied, no database rollbacks or table restores are required.

---

## 6. Reclassified Human UAT Checklist (Live Workflow Review)

All mutation workflows are paused on the live database. Human review is restricted to authorized read-only inspection:

| Step | Ingress Route | Type | Allowed on Operational DB? | Status | Review Scope |
|---|---|---|---|---|---|
| **A. Commercial Command** | `/dashboard/crm` | READ-ONLY | **YES** | **NOT EXECUTED** | Inspect Active Pipeline, Weighted Forecast, Expected Margin KPIs. Verify closed deals excluded from active totals. |
| **B. Opportunities Board Stage Move** | `/dashboard/crm/opportunities` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Moving deal stage modifies live deal. Requires isolated test tenant or genuine business intent. |
| **C. Open Opportunity Drawer** | `/dashboard/crm/opportunities` | READ-ONLY | **YES** | **NOT EXECUTED** | Click existing deal card. Verify drawer opens with focused commercial fields, deal-scoped attachments only (0 unrelated vault files). |
| **D. Link Document** | `/dashboard/crm/opportunities?open={id}` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Modifies live document links. Requires genuine business file or isolated DB. |
| **E. Unlink Document** | `/dashboard/crm/opportunities?open={id}` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Modifies live document links. Requires isolated DB. |
| **F. Switch Deals Rapidly** | `/dashboard/crm/opportunities` | READ-ONLY | **YES** | **NOT EXECUTED** | Click Deal A then Deal B. Verify drawer resets immediately without cross-deal attachment or activity bleeding. |
| **G. Generate Quotation** | `/dashboard/crm/opportunities?open={id}` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Inserts live row in `finance.quotations`. Requires genuine business deal. |
| **H. Mark Deal Won** | `/dashboard/crm/opportunities?open={id}` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Inserts live project in `projects.projects`. Requires genuine business deal. |
| **I. Support Desk** | `/dashboard/crm/support` | READ-ONLY | **YES** | **NOT EXECUTED** | Inspect support desk and ticket thread drawer. Do not submit test tickets. |
| **J. Campaign Telemetry** | `/dashboard/crm/campaigns` | MUTATION | **NO (PAUSED)** | **MUTATION PAUSED** | Writes to `crm.communication_events`. Requires isolated DB. |
