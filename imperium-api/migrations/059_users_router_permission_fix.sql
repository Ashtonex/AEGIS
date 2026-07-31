-- ============================================================================
-- Users router permission fix
-- ============================================================================
-- Discovered while investigating an is_active/role anomaly: routers/users.py
-- gates list_users on users.read_all, delete_user on users.delete, and
-- assign_role on users.assign_role - but none of these permissions had ever
-- been granted to any role, and update_user checked the literal role name
-- "ADMIN" (a string that has never existed as a role in this org; the real
-- admin role is "Executive (Admin)"). The entire /api/v1/users router was
-- inaccessible to every non-SUPERADMIN account.

INSERT INTO core.permissions (key, description)
VALUES ('users.update', 'Update another user''s profile or activation status')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'users.read_all'),
    ('Executive (Admin)', 'users.update'),
    ('Executive (Admin)', 'users.delete'),
    ('Executive (Admin)', 'users.assign_role')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
