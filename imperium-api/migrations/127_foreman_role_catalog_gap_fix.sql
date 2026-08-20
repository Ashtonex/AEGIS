-- The foreman portal gate already admits FOREMAN users, but the functional
-- role catalog did not create that role for fresh organizations. This creates
-- the unassigned role template only; it does not provision or change accounts.
INSERT INTO core.roles (organization_id, name, description)
SELECT o.id, 'FOREMAN', 'Field foreman portal access for daily site reporting, materials requests, and deployment gate checks.'
FROM core.organizations o
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1
      FROM core.roles r
      WHERE r.organization_id = o.id
        AND UPPER(r.name) = 'FOREMAN'
        AND r.is_deleted = false
  );

WITH role_permission_definitions(role_name, permission_key) AS (
    VALUES
    ('FOREMAN', 'site_operations.read'),
    ('FOREMAN', 'site_operations.create'),
    ('FOREMAN', 'site_operations.update'),
    ('FOREMAN', 'inventory_items.read'),
    ('FOREMAN', 'inventory.item.read'),
    ('FOREMAN', 'inventory.issue.create'),
    ('FOREMAN', 'inventory.receipt.create'),
    ('FOREMAN', 'documents.read'),
    ('FOREMAN', 'documents.create'),
    ('FOREMAN', 'procurement.requisition.read'),
    ('FOREMAN', 'procurement.requisition.create'),
    ('FOREMAN', 'compliance.gate.read'),
    ('FOREMAN', 'workforce.read')
)
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM role_permission_definitions def
JOIN core.roles r
  ON UPPER(r.name) = def.role_name
 AND r.is_deleted = false
JOIN core.permissions p
  ON p.key = def.permission_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
