# AEGIS Master System Register

**Enterprise**: Six Nine Construction (Private) Limited (SNC)  
**System**: Project AEGIS / Imperium Platform  
**Authority**: Master System Architect & Product Integrity Lead  
**Last Updated**: October 2026  
**Baseline Test Baseline**: 1,344 passing backend tests / 0 TypeScript errors / 142 dashboard routes  

---

## 1. System Invariants (Non-Negotiable Rules)

1. **Data Truth**: Never fabricate, mock, default to zero, or optimistically display data not confirmed by backend records.
2. **Tenant Isolation**: Every query, mutation, storage object, and report must be strictly scoped to `organization_id`.
3. **Least Privilege**: All protected endpoints must enforce verified RBAC permissions from `core.permissions`.
4. **No Silent Failures**: Every error must produce a precise log, standard HTTP status, traceable request ID, and clear user action.
5. **Preserve Working Systems**: Never break or replace working production contracts; apply additive, reversible changes.

---

## 2. Master System Issue Register

| ID | Domain | Category | Title | Code Location | Severity | Root Cause | Proposed Fix | Status |
|---|---|---|---|---|---|---|---|---|
| **SYS-001** | Performance | Infrastructure | 5-Connection Pool Ceiling | `core/database.py:133-146` | CRITICAL | Supavisor session pool limit forced tight 3+2 pool setting | Size pool safely for transaction mode; optimize connection hold time | ANALYZED |
| **SYS-002** | Performance | Frontend | Executive Dashboard 21-Request Storm | `aegis-web/src/app/dashboard/executive/page.tsx:250` | HIGH | Page requests 21 separate API endpoints in parallel on mount | Create unified `GET /api/v1/executive/overview-bundle` | VERIFIED FIXED |
| **SYS-003** | Security | Data Access | Backend RLS Bypass & Manual Tenant Scoping | `routers/*.py` (1,316 raw SQL queries) | HIGH | Backend connects as db admin; RLS bypassed; manual `WHERE organization_id` | Add central query scope validator in CI / central query helper | IN PROGRESS |
| **SYS-004** | Security | Authorization | Dynamic Permission Table Drift | `core/security.py:766`, `core.permissions` | HIGH | Permissions defined in DB rows; missing rows throw 403 to non-admins | Add automated CI guard verifying all router permissions exist | VERIFIED FIXED |
| **SYS-005** | UX / Shell | Navigation | Ephemeral In-Memory Sidebar State | `DashboardShell.tsx:51` | MEDIUM | `openGroups` stored in React `useState`; wiped on page reload | Persist accordion state to `localStorage` | VERIFIED FIXED |
| **SYS-006** | UX / Shell | Navigation | Missing Desktop Sidebar Collapse Rail | `DashboardShell.tsx:535` | MEDIUM | Desktop sidebar hardcoded to `w-56`; hogs screen on wide tables | Add toggleable mini-rail (`w-16`) icon mode | VERIFIED FIXED |
| **SYS-007** | UX / Shell | Mobile Nav | Mobile Drawer Auto-Close on Nested Navigation | `DashboardShell.tsx:178` | LOW | Drawer closes on every `pathname` change | Preserve drawer state during sub-branch navigation | VERIFIED FIXED |
| **SYS-008** | Reliability | Error Handling | Generic 500 Error Masking | `aegis-web/src/lib/api/core.ts:508` | HIGH | Frontend maps all non-JSON 500+ errors to generic string | Surface HTTP code, snippet, and `X-Correlation-ID` in UI | VERIFIED FIXED |
| **SYS-009** | Architecture | Backend | 59,688-Line Fat Router Layer | `imperium-api/routers/*.py` (80+ files) | HIGH | Business logic and raw SQL coupled directly in FastAPI endpoints | Incrementally extract services into `app/services/` | PLANNED |
| **SYS-010** | Database | Migrations | 267 Raw SQL Migrations Without Rollbacks | `migrations/*.sql`, `alembic/` | HIGH | Alembic frozen; raw SQL runner has no down-migration capability | Establish schema baseline; enforce forward/compensating SQL rules | PLANNED |
| **SYS-011** | Security | Auth | JWT Verification Latency Fallback | `core/security.py:68` | MEDIUM | Asymmetric fallback to Supabase Auth API adds 200-400ms | Configure canonical JWT secret for in-process verification | PLANNED |
| **SYS-012** | Data Truth | Website API | Marketing Website CMS Mock Fallbacks | `aegis-web/src/lib/api/website.ts:98` | MEDIUM | Missing CMS backend falls back to hardcoded mock articles | Connect to `public.articles` or render as static content | VERIFIED FIXED |
| **SYS-013** | Modules | Commercial | Quotations Approval Workflow Incomplete | `routers/quotations.py`, `dashboard/quotations` | MEDIUM | Quotation generation works; signed URLs & multi-level sign-off partial | Finalize signed download links and approval state machine | VERIFIED FIXED |
| **SYS-014** | Modules | Operations | HSE Incident Closure Lifecycle Partial | `routers/hse_incidents.py`, `dashboard/compliance` | MEDIUM | Incident logging works; root-cause investigation sign-off partial | Add formal CAPA investigation and sign-off modal | VERIFIED FIXED |
| **SYS-015** | Modules | Portals | Client Portal Tickets Partial Lifecycle | `routers/client_portal_tickets.py`, `/portal/client`| MEDIUM | Basic ticket list exists; reply thread and notifications incomplete | Wire ticket conversation thread and email/push notification | PLANNED |
| **SYS-016** | Modules | Portals | Supplier Self-Service Onboarding Partial | `routers/supplier_records.py`, `/portal/supplier` | MEDIUM | Vendor registration exists; compliance document vetting incomplete | Build vendor compliance checklist and approval gate | PLANNED |
| **SYS-017** | Performance | Infrastructure | Cross-Region Latency (London to Harare) | Supabase EU-West to Zimbabwe | MEDIUM | ~200ms RTT per sequential database round trip | Batch independent reads via composite endpoints; CDN cache | PLANNED |
| **SYS-018** | Integration | Supply Chain | Multi-Store Stock Transfers Non-Atomic | `routers/inventory.py` | MEDIUM | Store issue and receipt executed in separate non-locked updates | Wrap inventory transfer in explicit atomic database transaction | VERIFIED FIXED |
| **SYS-019** | Data Truth | CRM | Automations Visual Workflow Simulation | `aegis-web/src/app/dashboard/crm/automations` | LOW | Visual builder saves to UI state; no Arq worker execution | Clearly label as "Simulation / Staging Mode" | VERIFIED FIXED |
| **SYS-020** | Performance | Database | Disabled Prepared Statement Caching | `core/database.py:40-44` | LOW | Supavisor transaction mode disables statement caching | Benchmark prepared statements under transaction pooler | PLANNED |
| **SYS-021** | UX / Shell | Onboarding | Tour Re-Triggering on Navigation | `DashboardShell.tsx:215-221` | LOW | Tour checked profile on mount; re-triggered on cold loads | Stabilized via localStorage completion cache | VERIFIED FIXED |
| **SYS-022** | Reliability | PWA | VAPID Key Loss on Container Deploy | `deploy/digitalocean/docker-compose.yml` | HIGH | Container prune wiped keys from non-persistent volume | Persistent named volume `aegis_runtime` mounted | VERIFIED FIXED |
| **SYS-023** | Security | Multi-Tenancy | Root Tenant Auto-Enrollment Loophole | `core/security.py`, `routers/auth.py` | CRITICAL | Unknown identities defaulted to root org with EMPLOYEE role | Closed registration; returns 403 unless provisioned | VERIFIED FIXED |
| **SYS-024** | Integration | Projects | Broken Budget Linkage in Quotation Sync | `routers/projects.py`, `useProjectWorkspace.ts` | HIGH | Public API naming collision + missing `projects.write` permission | Created dedicated API client + aligned RBAC permissions | VERIFIED FIXED |
| **SYS-025** | Reliability | Logging | Plain-Text Starlette 500 Responses | `imperium-api/main.py` | MEDIUM | Uncaught exceptions returned raw text, breaking frontend JSON | Add global JSON exception handlers for SQLAlchemy/Exception | VERIFIED FIXED |

---

## 3. Prioritized Remediation Backlog

### Priority P0: System Safety, Tenancy & Core Stability
1. **P0-1 (SYS-008 & SYS-025)**: Standardize error taxonomy, correlation IDs, and global JSON exception handlers.
2. **P0-2 (SYS-005 & SYS-006)**: Implement persistent sidebar navigation state (`localStorage`) and add desktop mini-rail collapse toggle.
3. **P0-3 (SYS-004)**: Add automated CI test validating that all `require_permission` strings across routers exist in the seed migration catalog.
4. **P0-4 (SYS-003)**: Establish automated tenant isolation audit rule in CI to detect raw SQL missing `organization_id`.

### Priority P1: Performance & Operational Latency
5. **P1-1 (SYS-002)**: Create unified composite workspace bundle endpoint `GET /api/v1/executive/workspace-bundle` to eliminate 21-request fan-out.
6. **P1-2 (SYS-001 & SYS-017)**: Tune database connection acquisition, pool timeout logging, and async read batching.
7. **P1-3 (SYS-018)**: Enforce atomic transactional integrity on multi-store inventory transfers.

### Priority P2: Data Truth & Module Hardening
8. **P2-1 (SYS-012 & SYS-019)**: Eliminate website mock fallbacks and clearly label un-wired automation builders as simulation mode.
9. **P2-2 (SYS-013 & SYS-014)**: Finish Quotation signed document generation and HSE incident closure lifecycle.
10. **P2-3 (SYS-015 & SYS-016)**: Harden Client Portal and Supplier Portal self-service workflows.
