-- ============================================================================
-- Consolidate duplicate inventory item permission keys
-- ============================================================================
-- Two permission namespaces grew up around the same procurement.inventory_items
-- table: 'inventory_items.*' (gates the master-catalogue CRUD router mounted at
-- /api/v1/inventory-items, used by the frontend catalogue page) and
-- 'inventory.item.*' (gates read access to the stock-ledger views in
-- routers/inventory.py - stock-levels, movements, stores). Every role that was
-- ever granted 'inventory.item.read' was always also granted
-- 'inventory_items.read' in lockstep, and 'inventory.item.create' was granted
-- to Storekeeper but never checked by any endpoint (dead permission). This
-- collapses both into the single 'inventory_items.*' family; routers/inventory.py
-- now checks 'inventory_items.read' directly.
-- ============================================================================

DELETE FROM core.role_permissions
WHERE permission_id IN (
    SELECT id FROM core.permissions WHERE key IN ('inventory.item.read', 'inventory.item.create')
);

DELETE FROM core.permissions WHERE key IN ('inventory.item.read', 'inventory.item.create');
