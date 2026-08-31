-- Give CRM Associates access to task rate build-up and company rate standards.
-- The quotations router already uses this permission for creating/removing
-- organisation-specific rate intelligence benchmarks.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'quotations.manage_rate_intelligence'
WHERE o.is_deleted = false
  AND r.name = 'CRM Associate'
ON CONFLICT (role_id, permission_id) DO NOTHING;
