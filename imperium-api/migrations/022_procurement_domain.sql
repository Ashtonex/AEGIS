-- ============================================================================
-- AEGIS MIGRATION 022 — PROCUREMENT DOMAIN
-- Adds the full procurement lifecycle:
--   purchase_requisitions → rfqs → rfq_responses →
--   purchase_orders → purchase_order_lines →
--   goods_received_notes → grn_lines →
--   supplier_invoices → invoice_lines
-- Also adds core.sequences for reference number generation.
-- ============================================================================

-- 1. REFERENCE SEQUENCE TABLE (shared by all modules)

CREATE TABLE IF NOT EXISTS core.sequences (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    sequence_name     VARCHAR(120) NOT NULL,
    last_value        BIGINT NOT NULL DEFAULT 0 CHECK (last_value >= 0),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, sequence_name)
);

-- 2. EXTEND EXISTING PROCUREMENT TABLES

-- Add full supplier profile fields
ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS supplier_code          VARCHAR(80),
    ADD COLUMN IF NOT EXISTS trading_name           VARCHAR(255),
    ADD COLUMN IF NOT EXISTS registration_number    VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tax_number             VARCHAR(100),
    ADD COLUMN IF NOT EXISTS praz_number            VARCHAR(100),
    ADD COLUMN IF NOT EXISTS nssa_number            VARCHAR(100),
    ADD COLUMN IF NOT EXISTS primary_contact_name   VARCHAR(255),
    ADD COLUMN IF NOT EXISTS primary_contact_email  VARCHAR(255),
    ADD COLUMN IF NOT EXISTS primary_contact_phone  VARCHAR(80),
    ADD COLUMN IF NOT EXISTS payment_terms_days     SMALLINT DEFAULT 30,
    ADD COLUMN IF NOT EXISTS currency               VARCHAR(3) DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS status                 VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'blacklisted', 'pending_approval')),
    ADD COLUMN IF NOT EXISTS compliance_status      VARCHAR(24) DEFAULT 'pending'
        CHECK (compliance_status IN ('compliant', 'non_compliant', 'pending', 'exempt')),
    ADD COLUMN IF NOT EXISTS performance_score      NUMERIC(4,2) CHECK (performance_score IS NULL OR (performance_score >= 0 AND performance_score <= 5)),
    ADD COLUMN IF NOT EXISTS on_time_delivery_pct   NUMERIC(5,2) CHECK (on_time_delivery_pct IS NULL OR (on_time_delivery_pct >= 0 AND on_time_delivery_pct <= 100)),
    ADD COLUMN IF NOT EXISTS created_by             UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS is_deleted             BOOLEAN DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_org_code_unique
    ON procurement.suppliers (organization_id, supplier_code)
    WHERE supplier_code IS NOT NULL AND is_deleted = false;

-- Add full inventory item fields
ALTER TABLE procurement.inventory_items
    ADD COLUMN IF NOT EXISTS item_code           VARCHAR(80),
    ADD COLUMN IF NOT EXISTS description         TEXT,
    ADD COLUMN IF NOT EXISTS category            VARCHAR(80),
    ADD COLUMN IF NOT EXISTS unit_of_measure     VARCHAR(40) NOT NULL DEFAULT 'each',
    ADD COLUMN IF NOT EXISTS reorder_level       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    ADD COLUMN IF NOT EXISTS reorder_quantity    NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (reorder_quantity >= 0),
    ADD COLUMN IF NOT EXISTS standard_cost       NUMERIC(15,4) CHECK (standard_cost IS NULL OR standard_cost >= 0),
    ADD COLUMN IF NOT EXISTS is_hazardous        BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_org_code_unique
    ON procurement.inventory_items (organization_id, item_code)
    WHERE item_code IS NOT NULL AND is_deleted = false;

-- 3. PURCHASE REQUISITIONS

CREATE TABLE IF NOT EXISTS procurement.purchase_requisitions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    requisition_number  VARCHAR(40) NOT NULL,
    project_id          UUID REFERENCES projects.projects(id),
    site_id             UUID REFERENCES projects.sites(id),
    cost_code_id        UUID REFERENCES finance.cost_codes(id),
    requested_by        UUID NOT NULL REFERENCES core.users(id),
    required_by_date    DATE,
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled', 'ordered')),
    priority            VARCHAR(12) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'urgent', 'emergency')),
    justification       TEXT,
    total_estimated     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_estimated >= 0),
    submitted_at        TIMESTAMPTZ,
    submitted_by        UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES core.users(id),
    rejection_reason    TEXT,
    budget_checked      BOOLEAN NOT NULL DEFAULT false,
    budget_available    NUMERIC(15,2),
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, requisition_number)
);

CREATE TABLE IF NOT EXISTS procurement.requisition_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    requisition_id      UUID NOT NULL REFERENCES procurement.purchase_requisitions(id) ON DELETE CASCADE,
    item_id             UUID REFERENCES procurement.inventory_items(id),
    description         TEXT NOT NULL,
    quantity            NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_of_measure     VARCHAR(40) NOT NULL DEFAULT 'each',
    estimated_unit_cost NUMERIC(15,4) CHECK (estimated_unit_cost IS NULL OR estimated_unit_cost >= 0),
    work_package        VARCHAR(160),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS purchase_requisitions_project_status_idx
    ON procurement.purchase_requisitions (organization_id, project_id, status, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS requisition_lines_req_idx
    ON procurement.requisition_lines (organization_id, requisition_id)
    WHERE is_deleted = false;

-- 4. REQUEST FOR QUOTATION

CREATE TABLE IF NOT EXISTS procurement.rfqs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    rfq_number      VARCHAR(40) NOT NULL,
    requisition_id  UUID REFERENCES procurement.purchase_requisitions(id),
    project_id      UUID REFERENCES projects.projects(id),
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    closing_date    TIMESTAMPTZ,
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'issued', 'closed', 'cancelled')),
    issued_by       UUID REFERENCES core.users(id),
    issued_at       TIMESTAMPTZ,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, rfq_number)
);

CREATE TABLE IF NOT EXISTS procurement.rfq_responses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    rfq_id          UUID NOT NULL REFERENCES procurement.rfqs(id) ON DELETE CASCADE,
    supplier_id     UUID NOT NULL REFERENCES procurement.suppliers(id),
    reference       VARCHAR(160),
    total_amount    NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
    delivery_days   SMALLINT CHECK (delivery_days IS NULL OR delivery_days > 0),
    validity_days   SMALLINT DEFAULT 30,
    notes           TEXT,
    line_items      JSONB NOT NULL DEFAULT '[]'::jsonb,
    evaluation_score NUMERIC(5,2) CHECK (evaluation_score IS NULL OR (evaluation_score >= 0 AND evaluation_score <= 100)),
    status          VARCHAR(24) NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'evaluated', 'selected', 'rejected')),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, rfq_id, supplier_id)
);

-- 5. PURCHASE ORDERS

CREATE TABLE IF NOT EXISTS procurement.purchase_orders (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    po_number           VARCHAR(40) NOT NULL,
    requisition_id      UUID REFERENCES procurement.purchase_requisitions(id),
    rfq_id              UUID REFERENCES procurement.rfqs(id),
    rfq_response_id     UUID REFERENCES procurement.rfq_responses(id),
    supplier_id         UUID NOT NULL REFERENCES procurement.suppliers(id),
    project_id          UUID REFERENCES projects.projects(id),
    site_id             UUID REFERENCES projects.sites(id),
    cost_code_id        UUID REFERENCES finance.cost_codes(id),
    title               VARCHAR(255),
    delivery_address    TEXT,
    required_by_date    DATE,
    payment_terms_days  SMALLINT DEFAULT 30,
    currency            VARCHAR(3) DEFAULT 'USD',
    subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'issued', 'partially_received', 'received', 'invoiced', 'closed', 'cancelled')),
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    issued_by           UUID REFERENCES core.users(id),
    issued_at           TIMESTAMPTZ,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, po_number),
    CHECK (total_amount = subtotal + tax_amount)
);

CREATE TABLE IF NOT EXISTS procurement.purchase_order_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    po_id           UUID NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE CASCADE,
    item_id         UUID REFERENCES procurement.inventory_items(id),
    description     TEXT NOT NULL,
    quantity        NUMERIC(14,3) NOT NULL CHECK (quantity > 0),
    unit_of_measure VARCHAR(40) NOT NULL DEFAULT 'each',
    unit_price      NUMERIC(15,4) NOT NULL CHECK (unit_price >= 0),
    line_total      NUMERIC(15,2) NOT NULL CHECK (line_total >= 0),
    quantity_received NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_received >= 0),
    quantity_invoiced NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_invoiced >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    CHECK (quantity_received <= quantity),
    CHECK (quantity_invoiced <= quantity_received)
);

CREATE INDEX IF NOT EXISTS purchase_orders_project_status_idx
    ON procurement.purchase_orders (organization_id, project_id, status, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx
    ON procurement.purchase_orders (organization_id, supplier_id, status)
    WHERE is_deleted = false;

-- 6. GOODS RECEIVED NOTES

CREATE TABLE IF NOT EXISTS procurement.goods_received_notes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    grn_number          VARCHAR(40) NOT NULL,
    po_id               UUID NOT NULL REFERENCES procurement.purchase_orders(id) ON DELETE RESTRICT,
    supplier_id         UUID NOT NULL REFERENCES procurement.suppliers(id),
    store_id            UUID REFERENCES procurement.stores(id),
    project_id          UUID REFERENCES projects.projects(id),
    delivery_date       DATE NOT NULL,
    delivery_note_ref   VARCHAR(160),
    received_by         UUID NOT NULL REFERENCES core.users(id),
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'confirmed', 'cancelled')),
    condition_notes     TEXT,
    confirmed_at        TIMESTAMPTZ,
    confirmed_by        UUID REFERENCES core.users(id),
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, grn_number)
);

CREATE TABLE IF NOT EXISTS procurement.grn_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    grn_id          UUID NOT NULL REFERENCES procurement.goods_received_notes(id) ON DELETE CASCADE,
    po_line_id      UUID REFERENCES procurement.purchase_order_lines(id),
    item_id         UUID REFERENCES procurement.inventory_items(id),
    description     TEXT NOT NULL,
    quantity_ordered NUMERIC(14,3) NOT NULL CHECK (quantity_ordered >= 0),
    quantity_received NUMERIC(14,3) NOT NULL CHECK (quantity_received >= 0),
    quantity_rejected NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity_rejected >= 0),
    unit_price      NUMERIC(15,4) NOT NULL CHECK (unit_price >= 0),
    rejection_reason TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    CHECK (quantity_received + quantity_rejected <= quantity_ordered + 1) -- allow small variance
);

CREATE INDEX IF NOT EXISTS grn_po_idx
    ON procurement.goods_received_notes (organization_id, po_id, status)
    WHERE is_deleted = false;

-- 7. SUPPLIER INVOICES (Three-Way Matching)

CREATE TABLE IF NOT EXISTS procurement.supplier_invoices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    invoice_number      VARCHAR(40) NOT NULL,
    supplier_invoice_ref VARCHAR(160),     -- supplier's own reference
    supplier_id         UUID NOT NULL REFERENCES procurement.suppliers(id),
    po_id               UUID REFERENCES procurement.purchase_orders(id),
    grn_id              UUID REFERENCES procurement.goods_received_notes(id),
    project_id          UUID REFERENCES projects.projects(id),
    invoice_date        DATE NOT NULL,
    due_date            DATE,
    currency            VARCHAR(3) DEFAULT 'USD',
    subtotal            NUMERIC(15,2) NOT NULL CHECK (subtotal >= 0),
    tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    total_amount        NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
    matched_amount      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (matched_amount >= 0),
    variance_amount     NUMERIC(15,2) GENERATED ALWAYS AS (total_amount - matched_amount) STORED,
    status              VARCHAR(24) NOT NULL DEFAULT 'received'
        CHECK (status IN ('received', 'matching', 'matched', 'approved', 'paid', 'disputed', 'rejected', 'cancelled')),
    match_status        VARCHAR(24) NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'partial_match', 'matched', 'over_invoice', 'disputed')),
    is_duplicate_checked BOOLEAN NOT NULL DEFAULT false,
    payment_approved_by  UUID REFERENCES core.users(id),
    payment_approved_at  TIMESTAMPTZ,
    payment_reference    VARCHAR(160),
    paid_at              TIMESTAMPTZ,
    rejection_reason     TEXT,
    notes                TEXT,
    created_by           UUID REFERENCES core.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted           BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, invoice_number),
    UNIQUE (organization_id, supplier_id, supplier_invoice_ref)  -- duplicate detection
        DEFERRABLE INITIALLY DEFERRED,
    CHECK (total_amount = subtotal + tax_amount)
);

CREATE INDEX IF NOT EXISTS supplier_invoices_supplier_status_idx
    ON procurement.supplier_invoices (organization_id, supplier_id, status, invoice_date DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS supplier_invoices_po_idx
    ON procurement.supplier_invoices (organization_id, po_id)
    WHERE is_deleted = false;

-- 8. APPLY RLS

ALTER TABLE core.sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.sequences FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_requisitions FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.requisition_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.requisition_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.rfqs FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.rfq_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.rfq_responses FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.purchase_order_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.goods_received_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.goods_received_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.grn_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.grn_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.supplier_invoices FORCE ROW LEVEL SECURITY;

REVOKE ALL ON core.sequences FROM anon, authenticated;
REVOKE ALL ON procurement.purchase_requisitions, procurement.requisition_lines FROM anon, authenticated;
REVOKE ALL ON procurement.rfqs, procurement.rfq_responses FROM anon, authenticated;
REVOKE ALL ON procurement.purchase_orders, procurement.purchase_order_lines FROM anon, authenticated;
REVOKE ALL ON procurement.goods_received_notes, procurement.grn_lines FROM anon, authenticated;
REVOKE ALL ON procurement.supplier_invoices FROM anon, authenticated;

DROP POLICY IF EXISTS "Sequences service role only" ON core.sequences;
CREATE POLICY "Sequences service role only" ON core.sequences FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.purchase_requisitions;
CREATE POLICY "Procurement service role only" ON procurement.purchase_requisitions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.requisition_lines;
CREATE POLICY "Procurement service role only" ON procurement.requisition_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.rfqs;
CREATE POLICY "Procurement service role only" ON procurement.rfqs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.rfq_responses;
CREATE POLICY "Procurement service role only" ON procurement.rfq_responses FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.purchase_orders;
CREATE POLICY "Procurement service role only" ON procurement.purchase_orders FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.purchase_order_lines;
CREATE POLICY "Procurement service role only" ON procurement.purchase_order_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.goods_received_notes;
CREATE POLICY "Procurement service role only" ON procurement.goods_received_notes FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.grn_lines;
CREATE POLICY "Procurement service role only" ON procurement.grn_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Procurement service role only" ON procurement.supplier_invoices;
CREATE POLICY "Procurement service role only" ON procurement.supplier_invoices FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 9. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    -- Requisitions
    ('procurement.requisition.read',      'View purchase requisitions'),
    ('procurement.requisition.create',    'Create purchase requisitions'),
    ('procurement.requisition.update',    'Edit draft purchase requisitions'),
    ('procurement.requisition.submit',    'Submit purchase requisitions for approval'),
    ('procurement.requisition.approve',   'Approve or reject purchase requisitions'),
    -- RFQ
    ('procurement.rfq.read',              'View requests for quotation'),
    ('procurement.rfq.create',            'Create and issue RFQs'),
    ('procurement.rfq.manage',            'Manage RFQ responses and evaluation'),
    -- Purchase Orders
    ('procurement.po.read',               'View purchase orders'),
    ('procurement.po.create',             'Create purchase orders'),
    ('procurement.po.approve',            'Approve purchase orders'),
    ('procurement.po.issue',              'Issue approved purchase orders to suppliers'),
    -- Goods Received
    ('procurement.grn.read',              'View goods received notes'),
    ('procurement.grn.create',            'Record goods received'),
    ('procurement.grn.confirm',           'Confirm goods received notes'),
    -- Invoices
    ('procurement.invoice.read',          'View supplier invoices'),
    ('procurement.invoice.create',        'Register supplier invoices'),
    ('procurement.invoice.match',         'Perform three-way matching'),
    ('procurement.invoice.approve_payment', 'Approve supplier invoice for payment'),
    -- Suppliers
    ('procurement.supplier.read',         'View supplier register'),
    ('procurement.supplier.create',       'Add suppliers'),
    ('procurement.supplier.update',       'Update supplier records'),
    -- Inventory
    ('inventory.item.read',               'View inventory items and stock levels'),
    ('inventory.item.create',             'Add inventory items to catalogue'),
    ('inventory.receipt.create',          'Record stock receipts'),
    ('inventory.issue.create',            'Issue stock from stores'),
    ('inventory.transfer.create',         'Transfer stock between stores'),
    ('inventory.count.create',            'Conduct stock counts'),
    ('inventory.store.manage',            'Create and manage store locations')
ON CONFLICT (key) DO NOTHING;

-- 10. AUDIT TRIGGERS

DO $$
DECLARE
    t_name text;
    s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'core', 'sequences'
        UNION ALL VALUES
        ('procurement', 'purchase_requisitions'),
        ('procurement', 'requisition_lines'),
        ('procurement', 'rfqs'),
        ('procurement', 'rfq_responses'),
        ('procurement', 'purchase_orders'),
        ('procurement', 'purchase_order_lines'),
        ('procurement', 'goods_received_notes'),
        ('procurement', 'grn_lines'),
        ('procurement', 'supplier_invoices')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
