-- ============================================================================
-- Grant Procurement Manager full inventory/stores access
-- ============================================================================
-- Procurement Manager was created in 050_functional_role_catalog.sql with
-- only procurement.* permissions - no inventory access at all, so the
-- Inventory page's stock-levels/catalogue/stores/movements calls all 403
-- for this role (surfacing as "Store register could not be loaded." etc. on
-- the frontend, since a failed fetch is treated as a source warning rather
-- than a hard error). This role is explicitly responsible for procurement
-- AND stores, so it gets the same full inventory bundle Storekeeper has
-- (050_functional_role_catalog.sql + 083_inventory_transfer_adjustment_lifecycle.sql):
-- read/create/update the item catalogue, issue/receipt stock, manage
-- stores, and record transfers/counts.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'inventory_items.read',
    'inventory_items.create',
    'inventory_items.update',
    'inventory.issue.create',
    'inventory.receipt.create',
    'inventory.store.manage',
    'inventory.transfer.create',
    'inventory.count.create'
)
WHERE r.name = 'Procurement Manager' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
