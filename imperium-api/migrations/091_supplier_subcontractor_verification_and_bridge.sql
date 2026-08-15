-- ============================================================================
-- Bridges crm.subcontractors (the shared portal identity for both "supplier"
-- and "subcontractor" managed-account kinds) to procurement.suppliers (the
-- financial identity used by the whole PO -> GRN -> invoice -> payment
-- pipeline), and adds a two-stage (system + HR) verification workflow on top
-- of the portal identity.
--
-- Why a bridge instead of a second payable pipeline for subcontractors:
-- procurement.supplier_invoices.po_id and .grn_id are already nullable, so a
-- subcontractor's services invoice can skip the 3-way-match fields cleanly -
-- there is no need to fork a parallel "subcontractor payments" system just
-- because subcontractors typically bill for completed milestones rather than
-- goods against a PO.
--
-- Verification is two stages: "system" is a deterministic, code-computed
-- check (profile completeness + required compliance docs present and not
-- expired) with no human judgment involved; "hr" is the manual approval gate
-- that follows it. Only hr_verified vendors are treated as eligible
-- counterparties for new payment requests going forward - existing suppliers
-- created before this migration are left at verification_stage='incomplete'
-- and simply verify going forward rather than being backfilled.
-- ============================================================================

ALTER TABLE crm.subcontractors
    ADD COLUMN IF NOT EXISTS linked_supplier_id UUID REFERENCES procurement.suppliers(id),
    ADD COLUMN IF NOT EXISTS system_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS system_verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS hr_verified_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS hr_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS hr_verification_notes TEXT,
    ADD COLUMN IF NOT EXISTS verification_stage VARCHAR(24) NOT NULL DEFAULT 'incomplete';

ALTER TABLE crm.subcontractors
    DROP CONSTRAINT IF EXISTS subcontractors_verification_stage_check;
ALTER TABLE crm.subcontractors
    ADD CONSTRAINT subcontractors_verification_stage_check
    CHECK (verification_stage IN ('incomplete', 'system_pending', 'system_verified', 'hr_verified', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_subcontractors_linked_supplier ON crm.subcontractors(linked_supplier_id) WHERE linked_supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subcontractors_verification_stage ON crm.subcontractors(organization_id, verification_stage) WHERE is_deleted = false;

-- Compliance-document expiry, needed by the system-verification check to
-- refuse to pass a subcontractor whose linked document has lapsed.
ALTER TABLE core.documents
    ADD COLUMN IF NOT EXISTS expiry_date DATE;

-- ----------------------------------------------------------------------------
-- Permissions for the HR vendor-verification queue.
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('hr.vendor_verification.read',   'View the supplier/subcontractor verification queue'),
    ('hr.vendor_verification.decide', 'Approve or reject a system-verified supplier/subcontractor profile')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('HR Manager',         'hr.vendor_verification.read'),
    ('HR Manager',         'hr.vendor_verification.decide'),
    ('HR Officer',         'hr.vendor_verification.read'),
    ('Executive (Admin)',  'hr.vendor_verification.read'),
    ('Executive (Admin)',  'hr.vendor_verification.decide')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
