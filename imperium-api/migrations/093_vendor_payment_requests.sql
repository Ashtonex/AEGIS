-- ============================================================================
-- Self-service "AEGIS owes this vendor" payment requests, for suppliers and
-- subcontractors alike (both share the crm.subcontractors portal identity).
-- Deliberately lighter than procurement.supplier_invoices (no 3-way-match
-- fields required up front) - linked_supplier_invoice_id is an optional
-- bridge Finance can set if/when they want to formalize a request into the
-- full invoice trail.
--
-- Clearing ALWAYS posts a finance.cashbook_transactions row, regardless of
-- which party clears it (vendor or Finance) - money must never move without
-- a corresponding ledger entry. A vendor self-clearing (uploading their own
-- proof-of-payment receipt) still posts immediately so cash position isn't
-- stale; the posted row starts reconciliation_status='unreconciled' (the
-- cashbook's normal default) so Finance retains their usual bank-rec safety
-- net rather than being blocked from acting until they get to it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.vendor_payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    subcontractor_id UUID NOT NULL REFERENCES crm.subcontractors(id),
    supplier_id UUID REFERENCES procurement.suppliers(id),
    project_id UUID REFERENCES projects.projects(id),
    rate_type VARCHAR(24) CHECK (rate_type IN ('material', 'transport', 'service')),
    reference_description TEXT NOT NULL,
    linked_supplier_invoice_id UUID REFERENCES procurement.supplier_invoices(id),
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(24) NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted', 'acknowledged', 'cleared', 'disputed', 'cancelled')),
    cleared_by_party VARCHAR(20) CHECK (cleared_by_party IN ('vendor', 'finance')),
    cleared_by UUID REFERENCES core.users(id),
    cleared_at TIMESTAMPTZ,
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    submitted_by UUID REFERENCES core.users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_vendor_payment_requests_subcontractor
    ON finance.vendor_payment_requests (organization_id, subcontractor_id)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_vendor_payment_requests_status
    ON finance.vendor_payment_requests (organization_id, status)
    WHERE is_deleted = false;

ALTER TABLE finance.vendor_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.vendor_payment_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.vendor_payment_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Vendor payment requests service role only" ON finance.vendor_payment_requests;
CREATE POLICY "Vendor payment requests service role only" ON finance.vendor_payment_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('finance.vendor_payment.clear', 'Clear a supplier/subcontractor self-service payment request')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Finance Manager',    'finance.vendor_payment.clear'),
    ('Executive (Admin)',  'finance.vendor_payment.clear')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_audit_vendor_payment_requests ON finance.vendor_payment_requests;
    CREATE TRIGGER trg_audit_vendor_payment_requests AFTER INSERT OR UPDATE OR DELETE ON finance.vendor_payment_requests
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;
