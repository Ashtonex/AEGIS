-- One requisition, several suppliers.
--
-- A purchase order stays one supplier's document (GRNs, supplier invoices,
-- three-way matching and payment all key on po.supplier_id). What changes is
-- the requisition -> PO step: the buyer can now give each requisition line, or
-- part of a line, to a different supplier, and one action raises one PO per
-- supplier.
--
-- How much of a requisition line is on order is derived, not stored: the sum
-- of purchase_order_lines.quantity linked to it through requisition_line_id,
-- on purchase orders that are not cancelled or deleted. The requisition is
-- 'partially_ordered' while some of it is still to order, and 'ordered' once
-- every line is fully on a PO.

ALTER TABLE procurement.purchase_order_lines
    ADD COLUMN IF NOT EXISTS requisition_line_id UUID
        REFERENCES procurement.requisition_lines(id);

CREATE INDEX IF NOT EXISTS purchase_order_lines_requisition_line_idx
    ON procurement.purchase_order_lines (organization_id, requisition_line_id)
    WHERE requisition_line_id IS NOT NULL AND is_deleted = false;

-- Requisition status gains 'partially_ordered'. The original CHECK was
-- declared inline (022), so drop whichever status check exists by definition
-- rather than by a guessed name.
DO $$
DECLARE
    con record;
BEGIN
    FOR con IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'procurement.purchase_requisitions'::regclass
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ILIKE '%status%'
          AND pg_get_constraintdef(c.oid) ILIKE '%ordered%'
    LOOP
        EXECUTE format('ALTER TABLE procurement.purchase_requisitions DROP CONSTRAINT %I', con.conname);
    END LOOP;
END $$;

ALTER TABLE procurement.purchase_requisitions
    ADD CONSTRAINT purchase_requisitions_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled',
                      'partially_ordered', 'ordered'));

-- Link existing PO lines to the requisition line they were copied from. Both
-- old PO paths copied description (and item_id) straight across, so a line is
-- linked only when exactly one requisition line on the PO's requisition
-- matches it and no other line on that PO matches the same requisition line.
-- Anything ambiguous (or the single 'lot' line an RFQ PO gets when its
-- requisition had no lines) stays unlinked; the API treats a requisition with
-- unlinked PO lines as ordered the old way and leaves its status alone.
WITH candidates AS (
    SELECT pol.id AS po_line_id, rl.id AS req_line_id, pol.po_id
    FROM procurement.purchase_order_lines pol
    JOIN procurement.purchase_orders po
      ON po.id = pol.po_id AND po.organization_id = pol.organization_id
    JOIN procurement.requisition_lines rl
      ON rl.requisition_id = po.requisition_id
     AND rl.organization_id = pol.organization_id
     AND rl.is_deleted = false
     AND lower(btrim(rl.description)) = lower(btrim(pol.description))
     AND rl.item_id IS NOT DISTINCT FROM pol.item_id
    WHERE pol.requisition_line_id IS NULL
      AND po.requisition_id IS NOT NULL
),
unique_pairs AS (
    SELECT c.po_line_id, c.req_line_id
    FROM candidates c
    WHERE (SELECT count(*) FROM candidates x WHERE x.po_line_id = c.po_line_id) = 1
      AND (SELECT count(*) FROM candidates y WHERE y.req_line_id = c.req_line_id AND y.po_id = c.po_id) = 1
)
UPDATE procurement.purchase_order_lines pol
SET requisition_line_id = u.req_line_id
FROM unique_pairs u
WHERE pol.id = u.po_line_id;
