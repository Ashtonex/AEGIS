-- ============================================================================
-- Finance module permission gap fix
-- ============================================================================
-- Discovered auditing the Settings Access Control page-permission catalog:
-- GET /api/v1/financial-performance/projects (the Finance dashboard's
-- primary data load) requires finance.cost.read, which - unlike every
-- other finance.*.read permission (budget/cash/payroll, all granted to
-- Executive (Admin)/Finance Manager/Project Manager) - was only ever
-- granted to Quantity Surveyor. No admin/manager role could load the
-- Finance dashboard. finance.claim.read had the same gap, and
-- finance.variation.read/create had no grants at all.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'finance.cost.read'),
    ('Finance Manager', 'finance.cost.read'),
    ('Project Manager', 'finance.cost.read'),
    ('Executive (Admin)', 'finance.claim.read'),
    ('Finance Manager', 'finance.claim.read'),
    ('Project Manager', 'finance.claim.read'),
    ('Executive (Admin)', 'finance.variation.read'),
    ('Finance Manager', 'finance.variation.read'),
    ('Project Manager', 'finance.variation.read'),
    ('Finance Manager', 'finance.variation.create')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
