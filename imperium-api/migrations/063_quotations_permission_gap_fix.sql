-- ============================================================================
-- AEGIS MIGRATION 063 — QUOTATIONS PERMISSION GAP FIX
-- The quotations.read/create/update/delete permission keys existed in
-- core.permissions but had ZERO grants to any role in the org - the entire
-- Estimating & Quotations module was inaccessible to every non-SUPERADMIN
-- user, discovered during live verification (only quotations.decide, added
-- in migration 062, had any grants at all). Same bug class as the CRM/
-- Settings/Finance permission-catalog gaps fixed in migrations 051-060.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',    'quotations.read'),
    ('Executive (Admin)',    'quotations.create'),
    ('Executive (Admin)',    'quotations.update'),
    ('Executive (Admin)',    'quotations.delete'),
    ('Executive (Admin)',    'quotations.approve_ccb_override'),
    ('Executive (Admin)',    'quotations.manage_assemblies'),
    ('Executive (Admin)',    'quotations.manage_rate_intelligence'),
    ('Finance Manager',      'quotations.read'),
    ('Finance Manager',      'quotations.create'),
    ('Finance Manager',      'quotations.update'),
    ('Finance Manager',      'quotations.approve_ccb_override'),
    ('Finance Manager',      'quotations.manage_rate_intelligence'),
    ('Quantity Surveyor',    'quotations.read'),
    ('Quantity Surveyor',    'quotations.create'),
    ('Quantity Surveyor',    'quotations.update'),
    ('Quantity Surveyor',    'quotations.manage_assemblies'),
    ('Quantity Surveyor',    'quotations.manage_rate_intelligence'),
    ('Project Manager',      'quotations.read'),
    ('Project Manager',      'quotations.create'),
    ('Project Manager',      'quotations.update'),
    ('Site Agent',           'quotations.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
