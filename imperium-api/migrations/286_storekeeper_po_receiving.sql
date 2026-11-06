-- Storekeepers receive deliveries against purchase orders, and can draft
-- restock requests.
--
-- Inventory's Receive button now asks "which PO is this delivery for?" and its
-- Expected Deliveries view lists purchase orders sent to suppliers. That needs
-- the storekeeper to read purchase orders and record goods-received notes;
-- until now they only had inventory.receipt.create, so every delivery they
-- booked bypassed the PO and left it stuck at "awaiting delivery".
--
-- procurement.requisition.create lets them use "Request restock" on the
-- reorder watchlist (and create/edit DRAFT requests). It does not let them
-- submit, approve, order or pay: submit/approve/PO/invoice are separate
-- permissions, and a request already in process can only be amended by an
-- approver (PATCH /procurement/requisitions/{id}).
--
-- No PO creation, issue, sign-off, invoice or payment rights.

WITH target_permissions AS (
    SELECT key
    FROM (VALUES
        ('procurement.po.read'),
        ('procurement.grn.read'),
        ('procurement.grn.create'),
        ('procurement.requisition.create')
    ) AS permissions(key)
),
target_roles AS (
    SELECT id, organization_id
    FROM core.roles
    WHERE name IN ('Storekeeper', 'Store Keeper')
      AND is_deleted = false
)
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM target_roles r
JOIN core.permissions p ON p.key IN (SELECT key FROM target_permissions)
ON CONFLICT (role_id, permission_id) DO NOTHING;
