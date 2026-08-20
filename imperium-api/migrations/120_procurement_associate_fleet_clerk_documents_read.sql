-- ============================================================================
-- Grant documents.read to Procurement Associate and Fleet Clerk
-- ============================================================================
-- Follow-up to 118: both roles should be able to view attachments (PO/
-- invoice/fleet documents) linked to the records they can already read.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Procurement Associate', 'documents.read'),
    ('Fleet Clerk',           'documents.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
