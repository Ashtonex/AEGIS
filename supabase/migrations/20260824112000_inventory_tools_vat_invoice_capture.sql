-- Inventory tools, ZIMRA VAT pricing, and multi-line invoice capture.

ALTER TABLE procurement.inventory_items
    ADD COLUMN IF NOT EXISTS item_type VARCHAR(24) NOT NULL DEFAULT 'material',
    ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(6,3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vat_inclusive BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS unit_price_ex_vat NUMERIC(15,4),
    ADD COLUMN IF NOT EXISTS unit_price_inc_vat NUMERIC(15,4);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_items_item_type_chk'
          AND conrelid = 'procurement.inventory_items'::regclass
    ) THEN
        ALTER TABLE procurement.inventory_items
            ADD CONSTRAINT inventory_items_item_type_chk
            CHECK (item_type IN ('material', 'supply', 'tool'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'inventory_items_vat_rate_chk'
          AND conrelid = 'procurement.inventory_items'::regclass
    ) THEN
        ALTER TABLE procurement.inventory_items
            ADD CONSTRAINT inventory_items_vat_rate_chk
            CHECK (vat_rate >= 0 AND vat_rate <= 100);
    END IF;
END $$;

UPDATE procurement.inventory_items
SET item_type = 'tool'
WHERE lower(COALESCE(category, '')) LIKE '%tool%';

UPDATE procurement.inventory_items
SET
    unit_price_ex_vat = COALESCE(unit_price_ex_vat, standard_cost),
    unit_price_inc_vat = COALESCE(unit_price_inc_vat, standard_cost)
WHERE standard_cost IS NOT NULL;

CREATE TABLE IF NOT EXISTS procurement.supplier_invoice_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    supplier_invoice_id UUID NOT NULL REFERENCES procurement.supplier_invoices(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES procurement.inventory_items(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES procurement.stores(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES projects.projects(id) ON DELETE RESTRICT,
    description TEXT,
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_of_measure VARCHAR(40),
    unit_cost_ex_vat NUMERIC(15,4) NOT NULL CHECK (unit_cost_ex_vat >= 0),
    vat_rate NUMERIC(6,3) NOT NULL DEFAULT 0 CHECK (vat_rate >= 0 AND vat_rate <= 100),
    vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (vat_amount >= 0),
    unit_cost_inc_vat NUMERIC(15,4) NOT NULL CHECK (unit_cost_inc_vat >= 0),
    line_subtotal NUMERIC(15,2) NOT NULL CHECK (line_subtotal >= 0),
    line_total NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS supplier_invoice_lines_invoice_idx
    ON procurement.supplier_invoice_lines (organization_id, supplier_invoice_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS supplier_invoice_lines_item_store_idx
    ON procurement.supplier_invoice_lines (organization_id, item_id, store_id)
    WHERE is_deleted = false;

ALTER TABLE procurement.supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.supplier_invoice_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.supplier_invoice_lines FROM anon, authenticated;
DROP POLICY IF EXISTS "Supplier invoice lines service role only" ON procurement.supplier_invoice_lines;
CREATE POLICY "Supplier invoice lines service role only"
    ON procurement.supplier_invoice_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'procurement.invoice.create'
WHERE r.name IN ('Procurement Manager', 'Inventory Controller', 'Storekeeper')
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
