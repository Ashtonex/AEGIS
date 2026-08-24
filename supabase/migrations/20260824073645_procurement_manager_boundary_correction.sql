-- Procurement Manager boundary correction.
--
-- Keep already-applied historical migrations immutable; apply this permission
-- correction as a forward migration.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'documents.read',
    'documents.create',
    'documents.link'
)
WHERE r.name = 'Procurement Manager' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM core.role_permissions rp
USING core.roles r, core.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name = 'Procurement Manager'
  AND p.key IN (
      'procurement.po.approve',
      'inventory.count.create'
  );
