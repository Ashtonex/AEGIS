-- ============================================================================
-- AEGIS MIGRATION 026 — SITE MATERIAL REQUEST BRIDGE
-- Connects Site Operations to Inventory and Procurement for Scenario A:
-- site material request -> stock check -> stock issue or purchase requisition.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement.material_requests (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    request_number           VARCHAR(40) NOT NULL,
    project_id               UUID NOT NULL REFERENCES projects.projects(id),
    site_id                  UUID REFERENCES projects.sites(id),
    store_id                 UUID REFERENCES procurement.stores(id),
    item_id                  UUID NOT NULL REFERENCES procurement.inventory_items(id),
    requested_by             UUID NOT NULL REFERENCES core.users(id),
    requested_quantity       NUMERIC(14,3) NOT NULL CHECK (requested_quantity > 0),
    issued_quantity          NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (issued_quantity >= 0),
    shortfall_quantity       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (shortfall_quantity >= 0),
    unit_cost                NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    total_estimated          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_estimated >= 0),
    required_by_date         DATE,
    priority                 VARCHAR(12) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'urgent', 'emergency')),
    status                   VARCHAR(36) NOT NULL
        CHECK (status IN ('fulfilled_from_stock', 'partially_issued_requisitioned', 'requisitioned', 'cancelled')),
    work_package             VARCHAR(160),
    justification            TEXT,
    stock_ledger_id          UUID REFERENCES procurement.stock_ledger(id),
    purchase_requisition_id  UUID REFERENCES procurement.purchase_requisitions(id),
    created_by               UUID REFERENCES core.users(id),
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted               BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, request_number),
    CHECK (issued_quantity + shortfall_quantity = requested_quantity)
);

CREATE INDEX IF NOT EXISTS material_requests_project_status_idx
    ON procurement.material_requests (organization_id, project_id, status, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS material_requests_item_store_idx
    ON procurement.material_requests (organization_id, item_id, store_id, created_at DESC)
    WHERE is_deleted = false;

ALTER TABLE procurement.material_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.material_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.material_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Material requests service role only" ON procurement.material_requests;
CREATE POLICY "Material requests service role only" ON procurement.material_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.material.request', 'Request site materials with stock check and procurement escalation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'site_operations.material.request'
WHERE r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Project Manager', 'Site Agent', 'Site Clerk', 'Storekeeper', 'Procurement Officer')
ON CONFLICT DO NOTHING;

DROP TRIGGER IF EXISTS trg_audit_material_requests ON procurement.material_requests;
CREATE TRIGGER trg_audit_material_requests
AFTER INSERT OR UPDATE OR DELETE ON procurement.material_requests
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
