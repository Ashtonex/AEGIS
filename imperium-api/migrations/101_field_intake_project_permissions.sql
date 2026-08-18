-- ============================================================================
-- Field Intake project permissions
-- ============================================================================
-- Lets Site Agent, Project Manager, and Procurement Manager start a "Field
-- Intake" project (a real projects.projects row, status='field_intake')
-- from the Inventory Stores page for an ongoing site project that predates
-- AEGIS or never went through the CRM tender/opportunity/quotation
-- pipeline. None of the three roles previously held projects.create -
-- Project Manager only had projects.read.
--
-- Also adds projects.registration.approve for the Finance sign-off step
-- that promotes a Field Intake project to a fully registered one.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('projects.registration.approve', 'Approve a Field Intake project''s promotion to a fully registered project (Finance sign-off)')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Site Agent',          'projects.create'),
    ('Site Agent',          'projects.read'),
    ('Project Manager',     'projects.create'),
    ('Procurement Manager', 'projects.create'),
    ('Procurement Manager', 'projects.read'),
    ('Finance Manager',     'projects.registration.approve'),
    ('Executive (Admin)',   'projects.registration.approve')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
