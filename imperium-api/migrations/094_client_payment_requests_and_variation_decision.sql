-- ============================================================================
-- "Client owes AEGIS" payment requests, raised by internal staff and
-- clearable by either the client (via their portal) or Finance, always with
-- a receipt. Complements the existing finance.progress_claims formal-billing
-- lifecycle rather than replacing it - progress_claim_id is an optional
-- wrap so clearing a request that references a claim also flows through the
-- existing finance.receipt_allocations mechanism and flips that claim to
-- 'paid', instead of inventing a second allocation concept.
--
-- Also grants the existing (until now ungranted) finance.variation.approve
-- permission - the column/permission were defined in migration 023 but no
-- endpoint or role grant ever wired them up, which blocked client-submitted
-- variations from ever being able to move past 'pending'.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.client_payment_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    project_id UUID NOT NULL REFERENCES projects.projects(id),
    progress_claim_id UUID REFERENCES finance.progress_claims(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'USD',
    due_date DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'sent'
        CHECK (status IN ('sent', 'viewed', 'cleared', 'disputed', 'cancelled')),
    cleared_by_party VARCHAR(20) CHECK (cleared_by_party IN ('client', 'finance')),
    cleared_by UUID REFERENCES core.users(id),
    cleared_at TIMESTAMPTZ,
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_client_payment_requests_project
    ON finance.client_payment_requests (organization_id, project_id)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_client_payment_requests_status
    ON finance.client_payment_requests (organization_id, status)
    WHERE is_deleted = false;

ALTER TABLE finance.client_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.client_payment_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.client_payment_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Client payment requests service role only" ON finance.client_payment_requests;
CREATE POLICY "Client payment requests service role only" ON finance.client_payment_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('finance.client_payment.create', 'Raise a payment request to a client'),
    ('finance.client_payment.clear',  'Clear a client payment request on Finance''s side')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Finance Manager',    'finance.client_payment.create'),
    ('Finance Manager',    'finance.client_payment.clear'),
    ('Executive (Admin)',  'finance.client_payment.create'),
    ('Executive (Admin)',  'finance.client_payment.clear'),
    -- finance.variation.approve was defined in migration 023 but never
    -- granted to any role and never checked by any endpoint.
    ('Project Manager',    'finance.variation.approve'),
    ('Finance Manager',    'finance.variation.approve'),
    ('Executive (Admin)',  'finance.variation.approve')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
BEGIN
    DROP TRIGGER IF EXISTS trg_audit_client_payment_requests ON finance.client_payment_requests;
    CREATE TRIGGER trg_audit_client_payment_requests AFTER INSERT OR UPDATE OR DELETE ON finance.client_payment_requests
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;
