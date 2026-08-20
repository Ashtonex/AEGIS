-- ============================================================================
-- Project delete permission gap fix
-- ============================================================================
-- DELETE /api/v1/projects/{id} has gated on projects.delete since it was
-- written, but the permission was never granted to any role - identical
-- class of bug to migration 059's users-router fix. The Projects page itself
-- (ProjectsDashboard) is only reachable by Executive (Admin) and Project
-- Manager, so those are the two roles that should hold it.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'projects.delete'
WHERE o.is_deleted = false AND r.name IN ('Executive (Admin)', 'Project Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
