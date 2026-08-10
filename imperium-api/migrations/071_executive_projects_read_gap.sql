-- Executive (Admin) was granted projects.create and projects.update but never
-- projects.read (discovered live: the Quotations Overview dashboard fetches
-- quotations and internal projects in a single Promise.all - the missing
-- permission threw on the projects call, which silently blanked the entire
-- quotations ledger for this role, not just the projects widget). Same class
-- of gap as migration 063 (quotations) and 064 (workforce).

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'projects.read'
WHERE o.is_deleted = false
  AND r.name = 'Executive (Admin)'
ON CONFLICT (role_id, permission_id) DO NOTHING;
