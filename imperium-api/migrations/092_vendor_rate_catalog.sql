-- ============================================================================
-- Vendor rate catalog: lets a supplier or subcontractor portal user submit
-- their own pricing (materials + transport for suppliers, services for
-- subcontractors). One polymorphic table keyed by crm.subcontractors.id -
-- the identity both account kinds already share - discriminated by
-- rate_type, rather than three near-duplicate tables.
--
-- v1 scope is deliberately informational: internal procurement staff get a
-- read-only browse screen to consult when sourcing, but nothing here is
-- wired into RFQ auto-population. Self-submitted, unverified pricing should
-- not silently masquerade as a competitive quote.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement.vendor_rate_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    subcontractor_id UUID NOT NULL REFERENCES crm.subcontractors(id) ON DELETE CASCADE,
    rate_type VARCHAR(24) NOT NULL CHECK (rate_type IN ('material', 'transport', 'service')),
    item_code VARCHAR(80),
    description TEXT NOT NULL,
    unit_of_measure VARCHAR(40) NOT NULL DEFAULT 'each',
    unit_price NUMERIC(15,4) NOT NULL CHECK (unit_price >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    min_quantity NUMERIC(14,3),
    lead_time_days SMALLINT,
    route_from VARCHAR(255),
    route_to VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT true,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    submitted_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS vendor_rate_items_org_subcontractor_type_code_key
    ON procurement.vendor_rate_items (organization_id, subcontractor_id, rate_type, item_code)
    WHERE item_code IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_vendor_rate_items_subcontractor
    ON procurement.vendor_rate_items (organization_id, subcontractor_id)
    WHERE is_deleted = false;

ALTER TABLE procurement.vendor_rate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.vendor_rate_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON procurement.vendor_rate_items FROM anon, authenticated;

DROP POLICY IF EXISTS "Vendor rate catalog service role only" ON procurement.vendor_rate_items;
CREATE POLICY "Vendor rate catalog service role only" ON procurement.vendor_rate_items FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('procurement.vendor_rate.read', 'Browse the supplier/subcontractor submitted rate catalog')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Procurement Manager', 'procurement.vendor_rate.read'),
    ('Finance Manager',     'procurement.vendor_rate.read'),
    ('Executive (Admin)',   'procurement.vendor_rate.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_audit_vendor_rate_items ON procurement.vendor_rate_items;
    CREATE TRIGGER trg_audit_vendor_rate_items AFTER INSERT OR UPDATE OR DELETE ON procurement.vendor_rate_items
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;
