-- ============================================================================
-- AEGIS MIGRATION 064 — WORKFORCE PERMISSION GAP FIX
-- The Executive (Admin) role had only workforce.read granted - workforce.
-- create and workforce.update were missing entirely, blocking admins from
-- creating or editing employee records (POST/PUT /api/v1/workforce/).
-- Discovered live while verifying the core.audit_log actor-attribution fix.
-- Same bug class as the CRM/Settings/Finance/Quotations permission-catalog
-- gaps fixed in migrations 051-063.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'workforce.create'),
    ('Executive (Admin)', 'workforce.update')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
