-- ============================================================================
-- CRM message templates permission gap fix
-- ============================================================================
-- Discovered via live testing: the Sales Inbox / Communications Hub page
-- calls GET /api/v1/crm/templates unconditionally when loading, which
-- requires crm.templates.read - a permission 050/051 never granted to any
-- role, so the page always showed "Message templates could not be loaded"
-- for every non-SUPERADMIN user.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm.templates.read'),
    ('Executive (Admin)', 'crm.templates.create'),
    ('Executive (Admin)', 'crm.templates.update'),
    ('Project Manager', 'crm.templates.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
