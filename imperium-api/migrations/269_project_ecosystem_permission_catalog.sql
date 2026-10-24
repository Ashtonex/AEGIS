-- ============================================================================
-- Migration 269: Project Ecosystem Permission Catalog Closure
-- ============================================================================
-- Seeds router permissions for site operations reporting, procurement order creation,
-- and finance management/viewing across project lifecycle routes.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.report.submit',  'Submit daily site reports and progress entries'),
    ('site_operations.report.approve', 'Approve daily site reports and milestone entries'),
    ('site_operations.report.view',    'View site operations and progress reports'),
    ('procurement.order.create',       'Create procurement orders from project BOM/material requests'),
    ('finance.manage',                 'Manage project financial baselines and allocations'),
    ('finance.report.view',            'View project financial and budget reports')
ON CONFLICT (key) DO NOTHING;

-- Grant to relevant operational and administrative roles
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'site_operations.report.submit'),
    ('Executive (Admin)', 'site_operations.report.approve'),
    ('Executive (Admin)', 'site_operations.report.view'),
    ('Executive (Admin)', 'procurement.order.create'),
    ('Executive (Admin)', 'finance.manage'),
    ('Executive (Admin)', 'finance.report.view'),

    ('SUPERADMIN', 'site_operations.report.submit'),
    ('SUPERADMIN', 'site_operations.report.approve'),
    ('SUPERADMIN', 'site_operations.report.view'),
    ('SUPERADMIN', 'procurement.order.create'),
    ('SUPERADMIN', 'finance.manage'),
    ('SUPERADMIN', 'finance.report.view'),

    ('Project Manager', 'site_operations.report.submit'),
    ('Project Manager', 'site_operations.report.approve'),
    ('Project Manager', 'site_operations.report.view'),
    ('Project Manager', 'procurement.order.create'),
    ('Project Manager', 'finance.manage'),
    ('Project Manager', 'finance.report.view'),

    ('Site Engineer', 'site_operations.report.submit'),
    ('Site Engineer', 'site_operations.report.view'),

    ('Site Agent', 'site_operations.report.submit'),
    ('Site Agent', 'site_operations.report.approve'),
    ('Site Agent', 'site_operations.report.view'),

    ('Site Manager', 'site_operations.report.submit'),
    ('Site Manager', 'site_operations.report.approve'),
    ('Site Manager', 'site_operations.report.view'),

    ('FOREMAN', 'site_operations.report.submit'),
    ('FOREMAN', 'site_operations.report.view'),

    ('Procurement Officer', 'procurement.order.create'),
    ('Procurement Manager', 'procurement.order.create'),

    ('Finance Manager', 'finance.manage'),
    ('Finance Manager', 'finance.report.view'),
    ('Accountant', 'finance.report.view'),
    ('Quantity Surveyor', 'finance.report.view')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
