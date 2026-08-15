-- ============================================================================
-- Permissions for the finance historical-backfill feature: letting a
-- Finance Manager record pre-AEGIS project history (revenue, cost
-- activities, opening cash position) and view period/segment-filterable
-- financial statements.
--
-- Finance Manager currently holds none of projects.create/read,
-- crm_organizations.create, or crm_contacts.create (confirmed via grep of
-- every core.role_permissions grant across all migrations) - needed because
-- backfilling a historical project may require creating the project and its
-- client organization/contact inline, the same way project creation
-- normally happens via the opportunity-win flow, just without an
-- opportunity behind it.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('finance.historical_entry.create', 'Record historical (pre-AEGIS) project revenue, cost activity, and project backfill entries'),
    ('finance.statement.read', 'View period- and segment-filterable financial statements')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Finance Manager',    'projects.create'),
    ('Finance Manager',    'projects.read'),
    ('Finance Manager',    'crm_organizations.create'),
    ('Finance Manager',    'crm_contacts.create'),
    ('Finance Manager',    'finance.historical_entry.create'),
    ('Executive (Admin)',  'finance.historical_entry.create'),
    ('Finance Manager',    'finance.statement.read'),
    ('Executive (Admin)',  'finance.statement.read'),
    ('Project Manager',    'finance.statement.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
