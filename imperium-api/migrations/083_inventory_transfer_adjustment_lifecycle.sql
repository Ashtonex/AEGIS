-- procurement.stock_ledger already supports transfer_in/transfer_out/adjustment
-- movement types (021_daily_site_report_vertical_slice.sql) and the
-- inventory.transfer.create / inventory.count.create permissions already
-- exist (022_procurement_domain.sql), but no backend endpoint or frontend
-- ever wrote them. This adds the two small missing columns those flows need
-- (a notes/reason column already accepted-but-silently-dropped by
-- inventory.py's payload, and a location_label column the "Add Store" UI
-- already collects but has nowhere to put), wires the Storekeeper role up to
-- the permissions it was always meant to have, and removes the orphaned
-- procurement_orders table/permissions - a legacy scaffold table unrelated
-- to the real procurement.purchase_orders workflow, with no FKs pointing
-- into it.

-- 1. Movement notes/reason (used by transfers and, mandatorily, adjustments)
ALTER TABLE procurement.stock_ledger ADD COLUMN IF NOT EXISTS notes TEXT;

-- 2. Free-text location label the Add Store UI already collects
ALTER TABLE procurement.stores ADD COLUMN IF NOT EXISTS location_label VARCHAR(255);

-- 3. Grant the already-cataloged inventory permissions to Storekeeper
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('inventory.transfer.create', 'inventory.count.create')
WHERE r.name = 'Storekeeper' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 4. Remove the orphaned procurement_orders table and its permissions.
--    Nothing FKs into procurement.procurement_orders; the real purchase
--    order workflow lives entirely in procurement.purchase_orders.
DELETE FROM core.role_permissions
WHERE permission_id IN (SELECT id FROM core.permissions WHERE key LIKE 'procurement_orders.%');

DELETE FROM core.permissions WHERE key LIKE 'procurement_orders.%';

DROP TABLE IF EXISTS procurement.procurement_orders;
