# Workforce Phase 2 progress — 19 September 2026

Phase 2 remains open. This is an evidence checkpoint, not phase acceptance or a production release certificate. The owner has authorised sequential delivery through Phase 11 without repeated phase approvals.

## Verified shared access-control repair

The current HTTP authorization path no longer accepts cached account status, roles or permission grants. Every new request checks the authoritative account and assigned roles. Each granular permission decision checks current database grants. Removing a user's last administrator assignment cannot restore that assignment through a stale token claim. Token-signature verification caching and its authentication-service outage behavior remain unchanged.

Changed implementation: `imperium-api/core/security.py`. Regression evidence: `imperium-api/tests/test_rbac_acceptance.py`.

Before the repair, all 11 new warm-cache scenarios failed, including deactivated/deleted users, removed administrator assignments, and removed grants through direct, resource and business permission checks. After the repair:

- Python compilation and Ruff passed for both changed files.
- Authentication and RBAC suites: **43 passed**. This includes current legitimate grants, database-assigned administrators, tenant mismatch rejection and token verification behavior.
- An independent read-only candidate review found no surviving bypass in the changed HTTP paths and independently reproduced the 43 passing tests.

This repair adds authoritative database reads to requests previously satisfied by authorization caches. Existing WebSocket connections still retain their connection-time permission snapshot; immediate revocation of already-open connections is a separate unresolved shared control. Already-running requests are not cancelled by this change.

## Foundation database verification

Recreated a synthetic, localhost-only PostgreSQL fixture because the earlier runtime had been removed. Historical prerequisite table definitions and the complete Workforce migration 176 applied successfully. No hosted database or customer personnel were used.

Command: `WORKFORCE_LOCAL_DB_TESTS=1 python -m pytest tests/test_workforce_foundation_postgres.py tests/test_workforce_security_contract.py tests/test_workforce_compliance_gate_contract.py tests/test_workforce_operations.py tests/test_migration_preflight_comments.py -q --tb=short`.

Result: **47 passed, 6 subtests passed**. Includes tenant isolation, immutable evidence, independent verification, durable retries, rollback, concurrent duplicate commands and event receipts. This selected prerequisite fixture does not establish successful upgrade of the entire production migration ledger or external Storage/Redis delivery.

## Interface progress

Previously committed work includes capability-based Workforce navigation and the server-resolved My Profile screen. Added `/dashboard/workforce/organisation`, a paginated view of reporting relationships effective on a selected date, using the existing protected API and current shared page header. Its navigation requires `workforce.organisation.read`. Loading, empty, error and retry states are explicit.

## Remaining Phase 2 exit work

- Authenticated multi-role browser verification and mobile checks against the isolated API/database.
- HR training schedule integration with dated availability; existing training records do not contain a planned date interval.
- Controlled reporting-authority revisions and engagement termination/successor workflow, preserving approved evidence.
- Assigned-supervisor scope and role-conflict reporting.
- Historical foreign-key validation and full migration upgrade evidence.
- Event transport and external document-storage integration verification.
- Resolve the remaining shared control findings and produce the full phase acceptance pack before starting Phase 3 implementation.

Phases 3–11 are not represented as completed by this checkpoint.
