-- ============================================================================
-- Corporate Credentials Vault
-- ============================================================================
-- Today, tender-bid compliance is 5 raw booleans directly on crm.tenders
-- (nssa_clearance, praz_registration, tax_clearance, plus the bond flags -
-- see 096_tender_bid_detail_columns.sql) with no evidence file, no expiry,
-- and no verification workflow. Every tender re-asks the same yes/no
-- questions with no institutional memory of what the company actually
-- holds.
--
-- compliance.corporate_credentials is the permanent, reusable, org-wide
-- store of SNC's own registrations/certifications/insurance/financial
-- evidence (PRAZ, ZIMRA, NSSA, CIFOZ, ZBCA, insurance, HSE, financial,
-- technical). Tenders (crm.tender_requirements, see migration 199) read
-- from this vault instead of re-collecting the same evidence per tender.
--
-- credential_type deliberately enumerates PRAZ / CIFOZ / ZBCA / other
-- registrations as distinct values - they are never interchangeable, and
-- the matching logic in app/services/tenders/compliance_matching.py must
-- never treat one as satisfying another.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS compliance;

CREATE TABLE IF NOT EXISTS compliance.corporate_credentials (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    credential_type         VARCHAR(64) NOT NULL,
    issuing_organisation    VARCHAR(255),
    registration_number     VARCHAR(120),
    category                VARCHAR(120),
    classification_grade    VARCHAR(120),
    permitted_scope         TEXT,
    value_limit             NUMERIC(18, 2),
    issue_date              DATE,
    expiry_date             DATE,
    review_date             DATE,
    status                  VARCHAR(24) NOT NULL DEFAULT 'unverified',
    verification_date       TIMESTAMPTZ,
    verified_by_user_id     UUID REFERENCES core.users(id),
    evidence_document_id    UUID REFERENCES core.documents(id),
    notes                   TEXT,
    applicability           TEXT,
    created_by              UUID REFERENCES core.users(id),
    updated_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT corporate_credentials_status_check
        CHECK (status IN ('valid', 'expiring', 'expired', 'pending_verification', 'unverified', 'not_applicable')),
    CONSTRAINT corporate_credentials_type_check
        CHECK (credential_type IN (
            -- Corporate & legal
            'certificate_of_incorporation', 'cr6', 'cr14', 'cr5', 'company_constitution',
            'company_profile', 'registered_address', 'director_particulars',
            'signing_authority', 'power_of_attorney',
            -- PRAZ
            'praz_registration', 'praz_supplier_category', 'praz_contractor_category',
            -- ZIMRA / tax
            'zimra_tax_clearance', 'vat_registration', 'other_tax_evidence',
            -- NSSA
            'nssa_compliance',
            -- Construction / industry registration (CIFOZ, ZBCA and others are
            -- distinct bodies - never merge these into one credential_type)
            'cifoz_registration', 'cifoz_category', 'cifoz_classification',
            'zbca_registration', 'zbca_category', 'zbca_classification',
            'other_construction_registration', 'engineering_registration',
            'local_authority_registration', 'specialist_contractor_registration',
            -- Insurance
            'insurance_public_liability', 'insurance_contractors_all_risks',
            'insurance_workers_liability', 'insurance_motor', 'insurance_plant',
            'insurance_professional_indemnity', 'insurance_other',
            -- HSE / policy
            'hse_policy', 'environmental_policy', 'quality_policy', 'risk_management_policy',
            -- Financial
            'audited_financial_statements', 'management_accounts', 'bank_statements',
            'bank_reference_letter', 'facility_letter', 'turnover_evidence',
            -- Technical
            'plant_register', 'equipment_ownership_records', 'hire_agreements',
            'personnel_cvs', 'professional_qualifications', 'project_references',
            'completion_certificates', 'award_letters'
        ))
);

CREATE INDEX IF NOT EXISTS idx_corporate_credentials_org
    ON compliance.corporate_credentials (organization_id) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_corporate_credentials_type
    ON compliance.corporate_credentials (organization_id, credential_type) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_corporate_credentials_expiry
    ON compliance.corporate_credentials (organization_id, expiry_date)
    WHERE is_deleted = false AND expiry_date IS NOT NULL;

ALTER TABLE compliance.corporate_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.corporate_credentials FORCE ROW LEVEL SECURITY;

REVOKE ALL ON compliance.corporate_credentials FROM anon, authenticated;
GRANT ALL ON compliance.corporate_credentials TO service_role;

DROP POLICY IF EXISTS "Corporate credentials service role only" ON compliance.corporate_credentials;
CREATE POLICY "Corporate credentials service role only"
    ON compliance.corporate_credentials
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_corporate_credentials ON compliance.corporate_credentials;
CREATE TRIGGER trg_audit_corporate_credentials AFTER INSERT OR UPDATE OR DELETE ON compliance.corporate_credentials
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- ----------------------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('compliance_credentials.read', 'View corporate credentials vault entries'),
    ('compliance_credentials.create', 'Add corporate credentials vault entries'),
    ('compliance_credentials.update', 'Edit or verify corporate credentials vault entries'),
    ('compliance_credentials.delete', 'Remove corporate credentials vault entries')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'compliance_credentials.read'),
    ('Executive (Admin)', 'compliance_credentials.create'),
    ('Executive (Admin)', 'compliance_credentials.update'),
    ('Executive (Admin)', 'compliance_credentials.delete'),
    ('Managing Director', 'compliance_credentials.read'),
    ('Managing Director', 'compliance_credentials.create'),
    ('Managing Director', 'compliance_credentials.update'),
    ('Compliance Officer', 'compliance_credentials.read'),
    ('Compliance Officer', 'compliance_credentials.create'),
    ('Compliance Officer', 'compliance_credentials.update'),
    ('Compliance Officer', 'compliance_credentials.delete'),
    ('Tender / Bid Manager', 'compliance_credentials.read'),
    ('Commercial Manager', 'compliance_credentials.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
