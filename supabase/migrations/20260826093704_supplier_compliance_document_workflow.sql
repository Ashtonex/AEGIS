-- Supplier compliance documents are first-class review items, while the
-- uploaded files remain in core.documents so the Documents module can still
-- find and serve them.

CREATE TABLE IF NOT EXISTS procurement.supplier_compliance_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    supplier_id UUID REFERENCES procurement.suppliers(id) ON DELETE CASCADE,
    subcontractor_id UUID REFERENCES crm.subcontractors(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES core.documents(id) ON DELETE CASCADE,
    document_type VARCHAR(80) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending_review',
    uploaded_by_party VARCHAR(24) NOT NULL DEFAULT 'staff',
    review_notes TEXT,
    reviewed_by UUID REFERENCES core.users(id),
    reviewed_at TIMESTAMPTZ,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT supplier_compliance_documents_owner_check
        CHECK (supplier_id IS NOT NULL OR subcontractor_id IS NOT NULL),
    CONSTRAINT supplier_compliance_documents_type_check
        CHECK (document_type IN ('tax_clearance', 'nssa', 'praz', 'vat', 'company_registration')),
    CONSTRAINT supplier_compliance_documents_status_check
        CHECK (status IN ('pending_review', 'verified', 'rejected', 'needs_update')),
    CONSTRAINT supplier_compliance_documents_party_check
        CHECK (uploaded_by_party IN ('staff', 'supplier')),
    UNIQUE (organization_id, document_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_supplier_compliance_documents_supplier
    ON procurement.supplier_compliance_documents (organization_id, supplier_id, document_type, created_at DESC)
    WHERE supplier_id IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_supplier_compliance_documents_subcontractor
    ON procurement.supplier_compliance_documents (organization_id, subcontractor_id, document_type, created_at DESC)
    WHERE subcontractor_id IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_supplier_compliance_documents_status
    ON procurement.supplier_compliance_documents (organization_id, status)
    WHERE is_deleted = false;

ALTER TABLE procurement.supplier_compliance_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.supplier_compliance_documents FORCE ROW LEVEL SECURITY;

REVOKE ALL ON procurement.supplier_compliance_documents FROM anon, authenticated;
GRANT ALL ON procurement.supplier_compliance_documents TO service_role;

DROP POLICY IF EXISTS "Supplier compliance documents service role only" ON procurement.supplier_compliance_documents;
CREATE POLICY "Supplier compliance documents service role only"
    ON procurement.supplier_compliance_documents
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('supplier_compliance_documents.read', 'View supplier compliance document review status'),
    ('supplier_compliance_documents.upload', 'Upload or replace supplier compliance documents'),
    ('supplier_compliance_documents.verify', 'Verify or reject supplier compliance documents')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'supplier_compliance_documents.read'),
    ('Executive (Admin)', 'supplier_compliance_documents.upload'),
    ('Executive (Admin)', 'supplier_compliance_documents.verify'),
    ('Procurement Manager', 'supplier_compliance_documents.read'),
    ('Procurement Manager', 'supplier_compliance_documents.upload'),
    ('Procurement Manager', 'supplier_compliance_documents.verify'),
    ('Stores and Procurement Manager', 'supplier_compliance_documents.read'),
    ('Stores and Procurement Manager', 'supplier_compliance_documents.upload'),
    ('Stores and Procurement Manager', 'supplier_compliance_documents.verify'),
    ('HR Manager', 'supplier_compliance_documents.read'),
    ('HR Manager', 'supplier_compliance_documents.verify'),
    ('HR Officer', 'supplier_compliance_documents.read'),
    ('HR Officer', 'supplier_compliance_documents.verify')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
