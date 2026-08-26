-- Stores and Procurement Manager access repair.
--
-- Procurement and Inventory use separate permission families and the frontend
-- also gates pages by role name. Create the combined manager role explicitly,
-- grant the permissions needed to open and operate Procurement + Stores, and
-- keep supplier payment approval outside this role.

INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id, role_def.name, role_def.description, '/dashboard/procurement'
FROM core.organizations o
CROSS JOIN (VALUES
    ('Stores and Procurement Manager', 'Owns procurement, supplier records, inventory stores, stock receipts, transfers and catalogue control'),
    ('Stores & Procurement Manager', 'Alias for Stores and Procurement Manager access where the ampersand title is used')
) AS role_def(name, description)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1
      FROM core.roles r
      WHERE r.organization_id = o.id
        AND r.name = role_def.name
        AND r.is_deleted = false
  );

WITH target_permissions AS (
    SELECT key
    FROM (VALUES
        ('procurement_orders.read'),
        ('procurement_orders.create'),
        ('procurement.requisition.read'),
        ('procurement.requisition.create'),
        ('procurement.requisition.submit'),
        ('procurement.requisition.approve'),
        ('procurement.po.read'),
        ('procurement.po.create'),
        ('procurement.po.issue'),
        ('procurement.rfq.read'),
        ('procurement.rfq.create'),
        ('procurement.rfq.manage'),
        ('procurement.invoice.read'),
        ('procurement.invoice.create'),
        ('procurement.invoice.match'),
        ('procurement.grn.read'),
        ('procurement.grn.create'),
        ('procurement.grn.confirm'),
        ('procurement.supplier.read'),
        ('procurement.vendor_rate.read'),
        ('supplier_records.read'),
        ('supplier_records.create'),
        ('supplier_records.update'),
        ('inventory_items.read'),
        ('inventory_items.create'),
        ('inventory_items.update'),
        ('inventory_items.delete'),
        ('inventory.receipt.create'),
        ('inventory.issue.create'),
        ('inventory.transfer.create'),
        ('inventory.count.create'),
        ('inventory.store.manage'),
        ('documents.read'),
        ('documents.create'),
        ('documents.link')
    ) AS permissions(key)
),
target_roles AS (
    SELECT id, organization_id
    FROM core.roles
    WHERE name IN ('Procurement Manager', 'Stores and Procurement Manager', 'Stores & Procurement Manager')
      AND is_deleted = false
)
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM target_roles r
JOIN core.permissions p ON p.key IN (SELECT key FROM target_permissions)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM core.role_permissions rp
USING core.roles r, core.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name IN ('Procurement Manager', 'Stores and Procurement Manager', 'Stores & Procurement Manager')
  AND r.is_deleted = false
  AND p.key IN (
      'procurement.po.approve',
      'procurement.invoice.approve_payment'
  );
