-- ============================================================================
-- Tag stock receipts with a supplier - builds a per-supplier product catalog
-- ============================================================================
-- procurement.stock_ledger never recorded which supplier a receipt came
-- from. Suppliers were only ever linked to items indirectly, through the
-- formal Purchase Order -> Goods Received Note pipeline (purchase_order_
-- lines/grn_lines) - the quick "Receive Stock" action on the Inventory page
-- (routers/inventory.py's receive_stock, source_type='manual_receipt')
-- bypassed that entirely and had no supplier concept at all.
--
-- Adding supplier_id directly to stock_ledger - rather than a separate
-- supplier-catalogue table - means a supplier's product catalog is always
-- just "every distinct item ever received against them," derived live from
-- the ledger (see the new /procurement/suppliers/{id}/catalogue endpoint).
-- No second table to keep in sync with actual receiving activity.
--
-- Backfilled from goods_received_notes for existing GRN-sourced receipts
-- (source_type='goods_received_note') so historical PO-based receiving
-- activity shows up in a supplier's catalog too, not just receipts recorded
-- from now on.
-- ============================================================================

ALTER TABLE procurement.stock_ledger
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES procurement.suppliers(id);

CREATE INDEX IF NOT EXISTS stock_ledger_supplier_idx
    ON procurement.stock_ledger (organization_id, supplier_id, movement_type)
    WHERE supplier_id IS NOT NULL;

UPDATE procurement.stock_ledger sl
SET supplier_id = grn.supplier_id
FROM procurement.grn_lines gl
JOIN procurement.goods_received_notes grn ON grn.id = gl.grn_id AND grn.organization_id = gl.organization_id
WHERE sl.source_type = 'goods_received_note'
  AND sl.source_id = gl.id
  AND sl.organization_id = gl.organization_id
  AND sl.supplier_id IS NULL;
