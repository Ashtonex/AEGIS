-- Mirrors imperium-api/migrations/222_deposit_received_amount_and_budget_baseline_lock.sql
-- See that file for the full rationale.

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
