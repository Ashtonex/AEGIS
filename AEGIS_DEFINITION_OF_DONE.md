# AEGIS Definition of Done (DoD)

**System**: Project AEGIS / Imperium Operations Platform  
**Target Enterprise**: Six Nine Construction (Pvt) Ltd (SNC)  
**Authority**: Master System Architect & Product Integrity Lead  

Every future pull request, feature branch, bug fix, or module extension must satisfy all thirteen criteria below before merging or production release.

---

## The 13 Mandatory Quality Gates

1. **Database Schema Verified**
   - Every referenced table, column, enum, index, and foreign key constraint has been verified against live migration files.
   - Idempotent migration scripts added (`IF NOT EXISTS` guards) with documented rollback/compensating SQL.

2. **Tenant Isolation Enforced**
   - The user’s `organization_id` is extracted strictly from the cryptographically verified JWT (`user["org_id"]`), never trusted from client-supplied body or query parameters alone.
   - All queries, CTEs, joins, and aggregates enforce tenant boundary conditions.

3. **RBAC & Least Privilege Verified**
   - Every route is protected by `require_permission("<domain>.<action>")`.
   - The permission key exists in the migration seed catalog and passes `test_permission_registry_contract.py`.

4. **Audit Trail Present**
   - Critical business actions (approvals, financial postings, inventory movements, gate releases, user provisioning) emit structured events via `emit_event` to `core.audit_events`.

5. **Data Truth & Anti-Mock Compliance**
   - Zero hardcoded mock arrays, fake fallbacks, random generators, or fictitious percentages.
   - Unknown or unmeasured metrics surface an explicit `UNKNOWN` truth state rather than defaulting to `$0` or synthetic baselines.

6. **Concurrency & Atomicity Guaranteed**
   - Multi-step stock, financial, or status updates are wrapped in an explicit database transaction.
   - Competitive resource mutations (inventory transfers, stock issues) acquire row-level locks via `FOR UPDATE`.

7. **API Contract Compatibility**
   - Existing endpoint URLs and JSON response structures are strictly preserved.
   - Structured JSON error responses returned with `error.code`, `error.message`, and `correlation_id`.

8. **Frontend Loading, Empty & Error States Handled**
   - Dedicated loading skeletons matching final card/table geometry.
   - Honest, actionable empty states ("No purchase orders found for this project").
   - Explicit permission-denied indicators differentiating authorization blocks from system outages.

9. **UX Navigation & Layout Persistence**
   - Operator layout preferences (sidebar accordion state, mini-rail mode) persist to `localStorage`.
   - Desktop and mobile layouts take full responsive advantage of available viewport width.

10. **Performance Budgets Respected**
    - Initial dashboard mounts execute ≤ 3 batched HTTP requests.
    - Endpoints execute ≤ 5 database queries without N+1 loops.
    - Response times on standard 4G mobile connections remain ≤ 1.8s.

11. **Comprehensive Automated Tests Added**
    - Unit, contract, or negative permission tests added to `imperium-api/tests/`.
    - Pytest backend suite passes with zero failures.
    - Frontend TypeScript compilation (`npm run typecheck`) exits with 0 errors.

12. **Documentation Updated**
    - `AEGIS_MASTER_SYSTEM_REGISTER.md` updated with issue status, code locations, and evidence.
    - Module maturity status updated in `AEGIS_MODULE_COMPLETION_BACKLOG.md`.

13. **Safe Rollback Plan Formulated**
    - A step-by-step, reviewable rollback plan documented, specifying git revert commits and compensating migrations.
