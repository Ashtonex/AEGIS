-- Supplier profile editing repair.
-- The Procurement suppliers page is available to Executive Admin and Procurement
-- Manager users, but the supplier_records update endpoint was only granted to
-- Procurement Manager. Keep supplier payment controls separate; this only covers
-- the supplier master record profile.

WITH target_permissions AS (
  SELECT key
  FROM (VALUES
    ('supplier_records.read'),
    ('supplier_records.create'),
    ('supplier_records.update')
  ) AS permissions(key)
),
target_roles AS (
  SELECT id
  FROM core.roles
  WHERE name IN ('Executive (Admin)', 'Procurement Manager')
    AND is_deleted = false
)
INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM target_roles r
JOIN core.permissions p ON p.key IN (SELECT key FROM target_permissions)
ON CONFLICT (role_id, permission_id) DO NOTHING;
