-- ============================================================================
-- AEGIS MIGRATION 189 — PROCUREMENT: INVOICE LINE -> PO LINE LINK (PHASE 3A)
-- ============================================================================
-- procurement.supplier_invoice_lines exists but has no way to pair an
-- invoice line to a specific PO line, so real line-level quantity/price
-- three-way matching cannot happen (today's match_invoice is header-amount
-- only). Nullable, additive - existing invoice lines (which have none) are
-- simply not eligible for line-level matching, which is correct, not broken.
-- ============================================================================

ALTER TABLE procurement.supplier_invoice_lines
    ADD COLUMN IF NOT EXISTS po_line_id UUID REFERENCES procurement.purchase_order_lines(id);

CREATE INDEX IF NOT EXISTS supplier_invoice_lines_po_line_idx
    ON procurement.supplier_invoice_lines (po_line_id)
    WHERE po_line_id IS NOT NULL;
