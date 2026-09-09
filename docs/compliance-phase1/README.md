# AEGIS Compliance: Phase 1 architecture review

Initial inspection: 2026-09-05; resumed verification: 2026-09-08. Status: architecture proposed; human review pending. This package is a design, not a declaration of implemented controls or legal advice.

## Scope and review gate

Phase 1 delivers repository assessment, boundaries, data model, controls, interfaces, events, reports, tests and implementation backlog. No application code, migration, permission grant or production configuration is changed. Phases 2–10 require sequential approval and successful phase-specific tests. The request to continue to a functioning module is retained; it does not waive the explicit architecture-review gate.

Read [Database specification](DATA_MODEL.md), [Permissions and workflows](CONTROLS.md), [Interfaces and events](INTERFACES.md), and [Delivery and verification](DELIVERY.md).

## Repository assessment

Evidence is the local working tree, including uncommitted changes; database deployment state has not been inspected. Paths below are repository-relative.

| Area | Observed implementation | Decision |
|---|---|---|
| Backend | `imperium-api/main.py`, FastAPI, SQLAlchemy async sessions, Pydantic; SQL-oriented routers | Follow existing SQL service style; do not introduce another ORM architecture |
| Frontend | `aegis-web/package.json`: Next 16.3.3 range, React 19; README still describes Next 15 | Treat installed dependencies and local Next guides as authoritative during UI implementation |
| Authentication/RBAC | `imperium-api/core/security.py`, `core.permissions`, existing router middleware | Reuse identity and permission resolution; add capabilities and record scope checks |
| Database | `imperium-api/core/database.py` uses a transaction pooler; session dependency does not itself bind tenant context | Require scoped transaction context and a non-owner, non-BYPASSRLS runtime role |
| Compliance | `routers/compliance_items.py`, migrations 025, 028, 029; `core/compliance.py` | Evolve existing module; compatibility adapters must invoke the same guarded services |
| Approvals | `app/services/workflow_service.py` uses `core.approval_instances`, steps and decisions; caller owns transaction | Reuse this active SQL service, not placeholder generic foreign keys in `app/models/workflow.py` |
| Workforce changes | Uncommitted foundation, transaction and event services, migration 176, workforce pages | Dependency under concurrent development: preserve and re-inspect before integration |
| Documents | `routers/documents.py`, `core.documents`, `core.document_links`; versions partly reconstructed from audit | Reuse storage; establish immutable version-addressable evidence contract before Phase 3 |
| Supplier records | migration 168 and `tests/test_supplier_compliance_documents_contract.py` | Reuse procurement document review data and existing supplier/subcontractor identities |
| Notifications/events | `app/shared/events.py`, `app/events/bus.py`, `app/workers/arq_worker.py` | Use Core events as transactional outbox, Redis transport and Arq delivery |
| Durable delivery | Uncommitted `app/services/workforce_events.py` has deduplicated consumers and transport tracking | Generalise existing infrastructure after workforce baseline stabilises; do not create a second event bus |
| Settings | `app/services/settings_service.py`, `routers/settings.py` | Version compliance rule/settings snapshots using the existing settings service |
| Audit | `core.process_audit_log()` in migrations 002/031; workflow writes audit actions | Reuse Core audit; verify append-only privileges/triggers and retention rather than presume immutability |
| UI | `dashboard/compliance/page.tsx`, `[tab]/page.tsx`, `src/lib/api.ts`, `RBACGuard` | Incrementally replace six-tab workspace with capability-scoped connected screens |
| Integrations | Workforce, fleet, procurement, payments, projects, risk, executive routers | Owners execute operations; Compliance supplies current, auditable gate decisions |

## Observed gaps and integration risks

These are source observations, not a production penetration-test result.

| ID | Priority | Evidence and required treatment |
|---|---|---|
| C01 | High | Obligation creation uses `finance.budget.create` and writes `compliant`; replace with compliance capability and Draft, never infer proof from a future expiry |
| C02 | High | Equipment credential payload accepts `verified`; forbid submitters choosing final verification and block all legacy bypass routes |
| C03 | High | Migration 028 has service-role-only policy with `USING (true)`; cannot substantiate database tenant isolation for privileged connections |
| C04 | High | Local event helper uses current timestamp for idempotency; stable command and aggregate-version keys required |
| C05 | High | Deployment override updates a blocked record with reason/reference; require approved, bounded, evidence-backed exception and atomic recheck |
| C06 | High | `core/compliance.py` commits a blocked gate before raising; transaction ownership can commit unrelated writes; replace with dedicated denial-record transaction after operational rollback |
| C07 | High | Existing records, document deletion paths and cascading foreign keys cannot establish immutable compliance history; add reference protection and controlled revision |
| C08 | Medium | Current score aggregates certificates, inspections and historical gates rather than current applicable requirements; replace with denominator-driven status projections |
| C09 | Medium | Existing UI creates HSE incidents; preserve HSE ownership and deep-link to its workflow |
| C10 | Medium | Models, migrations and README differ; migration inventory and runtime-role validation are prerequisites, not assumptions |

## Ownership boundaries

Compliance owns obligation versions, assessments, assignments, deadlines, evidence requirements and verification decisions, credentials, project plans, third-party compliance profiles, compliance inspections, findings/CAPA, attestations, changes and exceptions. Organisation, project, worker, party and asset are references to existing owners.

Legal owns interpretations, advice, disputes, litigation, drafting and privileged content. Store a restricted reference and approved decision summary, never copy privileged advice into broad compliance exports. Risk owns enterprise risks, appetite, treatment and assurance; Compliance sends finding/escalation references. HSE owns incidents, operational safety inspections, PPE, talks and work permits; Compliance monitors their evidence. HR owns employment and personnel administration. Finance owns calculation, payments, accounting and reconciliation; Compliance returns hold/release decisions. Documents owns storage, versions, retention and distribution. Core owns users, organisations, approvals, notifications, settings and audit.

## Architecture decisions

1. Preserve platform spelling `organization_id` in database/API. It implements the requested `organisation_id` concept without duplicate columns. Every module-owned row, child, join, snapshot and delivery receipt is tenant scoped. Project requirements always carry `project_id`.
2. Use a versioned obligation plus a subject-specific compliance item. A rule's approval is distinct from evidence proving fulfilment. Applicability can be unknown; missing assessments never imply exemption.
3. Use one typed subject registry referencing existing entities, not duplicated worker/party/asset masters. Explicit tenant-aware foreign keys prevent orphaned and cross-tenant references.
4. Commands own atomic transactions: tenant context, row lock/version check, permission/SoD, source validation, decision, audit and outbox commit together. Redis/email is delivered after commit.
5. Status is evaluated at a specified instant from effective rules, requirements and accepted evidence. Cache results only with dependency versions and earliest expiry; operational gates synchronously recheck.
6. Distinguish unknown, documentary satisfaction, independently verified satisfaction, partial/noncompliance and authorised exception. An exception is never a compliant result. Zero applicable requirements yields not-assessed/not-applicable with an approved explanation, never 100% by default.
7. Existing Core workflow and delivery changes are reused only after their tests pass. Extract shared helpers with regression tests rather than copying workforce infrastructure.
8. No universally valid laws, penalties or due dates are seeded. Jurisdiction content is sourced and approved by humans. AI proposals cannot execute approval transitions.

Database guidance consulted: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). Service roles bypass RLS; grants and policies must both be verified. Changelog markdown retrieval failed; recheck before implementation. No Supabase feature was implemented in this phase.
