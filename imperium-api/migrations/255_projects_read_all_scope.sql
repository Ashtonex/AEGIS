-- 255: project-level visibility (2026-10-09).
--
-- New permission projects.read_all = "see every project". Without it a user
-- only sees the projects they are assigned to (project team allocation, site
-- role assignment, or project owner) and the site records hanging off them -
-- see core/project_scope.py.
--
-- Granted to every role that can already see project/site/requisition data
-- EXCEPT the site field roles, so office roles keep exactly today's view and
-- site staff drop to their assigned projects. New custom roles start scoped
-- (no read_all) - tick it in Settings > Access Control to widen a role.

INSERT INTO core.permissions (key, description) VALUES
    ('projects.read_all', 'See every project, not only the projects the user is assigned to')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT DISTINCT r.organization_id, r.id, read_all.id
FROM core.roles r
JOIN core.role_permissions rp ON rp.role_id = r.id
JOIN core.permissions granted ON granted.id = rp.permission_id
CROSS JOIN (SELECT id FROM core.permissions WHERE key = 'projects.read_all') AS read_all
WHERE r.is_deleted = false
  AND granted.key IN ('projects.read', 'site_operations.read', 'procurement.requisition.read')
  AND r.name NOT IN ('Site Agent', 'Site Engineer', 'FOREMAN', 'Site Clerk', 'Site Manager', 'Storekeeper')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Site field roles that pick a project in Site Operations need projects.read
-- to load the project list. Safe now that the list is scoped to their own
-- assigned projects.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'projects.read'
WHERE r.is_deleted = false
  AND r.name IN ('FOREMAN', 'Site Clerk', 'Site Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
