-- ============================================================================
-- Settings module permission gap fix
-- ============================================================================
-- Discovered via live testing: routers/settings.py gates every endpoint
-- behind settings.read / settings.update / settings.audit.read /
-- website_content.read / website_content.update, but none of those
-- permissions were ever granted to any non-SUPERADMIN role. The entire
-- System Settings module (configuration, access control, managed accounts,
-- website content, audit log) was completely inaccessible to every real
-- admin account.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'settings.read'),
    ('Executive (Admin)', 'settings.update'),
    ('Executive (Admin)', 'settings.audit.read'),
    ('Executive (Admin)', 'website_content.read'),
    ('Executive (Admin)', 'website_content.update')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
