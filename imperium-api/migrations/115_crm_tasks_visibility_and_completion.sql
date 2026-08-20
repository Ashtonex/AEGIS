-- ============================================================================
-- Task/team visibility scoping + completion timestamp
-- ============================================================================
-- Today crm_tasks.read/teams.read are only granted to the same holder set as
-- documents.create (105/106) - EMPLOYEE ships with zero ERP permissions by
-- default, so a plain member of staff can't reach Tasks/Teams at all. This
-- opens both pages to everyone, but list_tasks()/list_teams() (routers/
-- crm_tasks.py, routers/teams.py) now scope results to "assigned to me or my
-- team" unless the caller holds the new *_read_all permission, which stays
-- restricted to the existing admin/lead-tier role set.
-- ============================================================================

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

INSERT INTO core.permissions (key, description) VALUES
    ('crm_tasks.read_all', 'View every org task, not just tasks assigned directly to you or your team'),
    ('teams.read_all', 'View every team in the org, not just teams you belong to')
ON CONFLICT (key) DO NOTHING;

-- Same holder set that already has crm_tasks.read/teams.read (105/106: the
-- documents.create tier) keeps full visibility via the new _all permissions.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('crm_tasks.read_all', 'teams.read_all')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- SUPERADMIN already gets every permission implicitly (core/security.py's
-- user_has_permission/require_permission short-circuit on role == SUPERADMIN),
-- so no explicit grant is needed for it here.

-- Baseline crm_tasks.read/teams.read (existing keys, view-only) now go to
-- EMPLOYEE org-wide, scoped down to "mine + my team" by the app-layer query
-- changes in this same phase.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('crm_tasks.read', 'teams.read')
WHERE r.name = 'EMPLOYEE' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
