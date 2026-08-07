-- Opportunities had no delete endpoint at all (Contacts, Organizations, and
-- Activities all support soft-delete, but Opportunities was never given one),
-- so users had no way to remove duplicate or test deals. Add the permission
-- for the new DELETE /opportunities/{id} endpoint, following the same
-- crm.create_opportunities / crm.update_opportunities naming convention, and
-- grant it to Executive (Admin) alongside crm.update_opportunities.

INSERT INTO core.permissions (key, description) VALUES
  ('crm.delete_opportunities', 'Delete CRM direct opportunities')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'crm.delete_opportunities'
WHERE o.is_deleted = false
  AND r.name = 'Executive (Admin)'
ON CONFLICT (role_id, permission_id) DO NOTHING;
