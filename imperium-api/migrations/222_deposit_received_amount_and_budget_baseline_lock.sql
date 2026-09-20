-- ============================================================================
-- AEGIS MIGRATION 222 — DEPOSIT RECEIVED AMOUNT + BUDGET BASELINE LOCK
-- ============================================================================
-- Two gaps closed together:
--
-- 1. confirm-deposit (projects.py, 121_tender_award_and_project_deposit_gate.sql)
--    only ever recorded a free-text deposit_reference, never an actual
--    amount received. Finance had nothing numeric to work with once a
--    deposit was confirmed. deposit_received_amount closes that - it flows
--    through automatically wherever the project row is already read
--    (executive detail, finance views) since nothing selects columns by an
--    explicit allowlist there.
--
-- 2. The master budget baseline (finance.project_budgets, set via
--    POST /projects/{id}/budget) could be superseded by anyone holding the
--    broad projects.registration.approve permission, forever - there was no
--    durable guarantee that an already-approved/"protected" baseline could
--    only be adjusted by Finance, independent of how registration-approve
--    happens to be assigned later. projects.budget_baseline.lock is checked
--    in routers/projects.py's set_project_budget only once a prior approved
--    baseline exists for the project; the first bake (initial setup) stays
--    open to the broader registration-approve roles.
-- ============================================================================

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS deposit_received_amount NUMERIC(15,2);

INSERT INTO core.permissions (key, description) VALUES
    ('projects.budget_baseline.lock', 'Adjust a project''s master budget baseline after it has already been approved/protected - Finance only')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'projects.budget_baseline.lock'),
    ('Finance Manager',   'projects.budget_baseline.lock')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
