-- ============================================================================
-- Zimbabwe Tender Requirements Library + Per-Tender Compliance Matrix
-- ============================================================================
-- crm.tender_requirements (099) is a deliberately freeform checklist
-- (label + is_satisfied) with no category, no severity, and no link to a
-- canonical requirement catalog or to compliance.corporate_credentials
-- (198). This migration:
--
--   1. Adds crm.tender_requirement_templates - the Zimbabwe Requirements
--      Library - one individually-named row per requirement across 18
--      categories (never a single bundled "Company Documents" checkbox).
--   2. Extends crm.tender_requirements with category/severity/status,
--      credential linkage, category/classification match results, and
--      responsibility/verification fields, turning it into a structured
--      compliance matrix while keeping every existing row and column.
--   3. Backfills existing data honestly: historical rows get a known
--      status derived from is_satisfied (never invented), and the 3
--      legacy boolean flags on crm.tenders that are TRUE become matching
--      SATISFIED matrix rows so the new UI doesn't show old tenders as
--      missing compliance it actually had. A FALSE/NULL legacy flag is
--      NOT converted into a MISSING row - we don't know whether it was
--      actually required for that historical tender, so the gap is left
--      for a human to assess rather than fabricated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Zimbabwe Tender Requirements Library
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS crm.tender_requirement_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID REFERENCES core.organizations(id) ON DELETE CASCADE,
    category                VARCHAR(48) NOT NULL,
    requirement_name        VARCHAR(255) NOT NULL,
    description             TEXT,
    default_severity        VARCHAR(16) NOT NULL DEFAULT 'MAJOR',
    maps_to_credential_type VARCHAR(64),
    is_active               BOOLEAN NOT NULL DEFAULT true,
    sort_order              INTEGER NOT NULL DEFAULT 0,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT tender_requirement_templates_category_check
        CHECK (category IN (
            'CORPORATE_LEGAL', 'PRAZ', 'ZIMRA_TAX', 'NSSA', 'CONSTRUCTION_REGISTRATION',
            'TENDER_FORMS_DECLARATIONS', 'BID_SECURITY', 'FINANCIAL_CAPACITY',
            'COMMERCIAL_BOQ', 'TECHNICAL_CAPABILITY', 'EXPERIENCE_REFERENCES',
            'KEY_PERSONNEL', 'PLANT_EQUIPMENT', 'HSE_ENVIRONMENTAL', 'INSURANCE',
            'SITE_VISIT', 'TENDER_SPECIFIC_FEES', 'POST_AWARD'
        )),
    CONSTRAINT tender_requirement_templates_severity_check
        CHECK (default_severity IN ('FATAL', 'CRITICAL', 'MAJOR', 'MINOR', 'INFORMATIONAL'))
);

-- System-wide defaults (organization_id IS NULL) are visible to every org;
-- an org can add its own custom rows alongside them.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_requirement_templates_unique_name
    ON crm.tender_requirement_templates (COALESCE(organization_id::text, 'system'), category, requirement_name)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_tender_requirement_templates_category
    ON crm.tender_requirement_templates (category) WHERE is_deleted = false AND is_active = true;

ALTER TABLE crm.tender_requirement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.tender_requirement_templates FORCE ROW LEVEL SECURITY;

REVOKE ALL ON crm.tender_requirement_templates FROM anon, authenticated;
GRANT ALL ON crm.tender_requirement_templates TO service_role;

DROP POLICY IF EXISTS "Tender requirement templates service role only" ON crm.tender_requirement_templates;
CREATE POLICY "Tender requirement templates service role only"
    ON crm.tender_requirement_templates
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_tender_requirement_templates ON crm.tender_requirement_templates;
CREATE TRIGGER trg_audit_tender_requirement_templates AFTER INSERT OR UPDATE OR DELETE ON crm.tender_requirement_templates
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- Seed data - system-wide defaults (organization_id NULL). One row per
-- individually named requirement, never a bundled category checkbox.
INSERT INTO crm.tender_requirement_templates (category, requirement_name, description, default_severity, maps_to_credential_type, sort_order) VALUES
    ('CORPORATE_LEGAL', 'Certificate of Incorporation', 'Proof of incorporation as a legal entity.', 'FATAL', 'certificate_of_incorporation', 10),
    ('CORPORATE_LEGAL', 'CR6', 'Notice of situation of registered office / postal address.', 'CRITICAL', 'cr6', 20),
    ('CORPORATE_LEGAL', 'CR14 / Current Company Particulars', 'Current directors and registered particulars.', 'CRITICAL', 'cr14', 30),
    ('CORPORATE_LEGAL', 'CR5', 'Memorandum of association extract, where required.', 'MAJOR', 'cr5', 40),
    ('CORPORATE_LEGAL', 'Company Constitution', 'Memorandum and articles of association.', 'MAJOR', 'company_constitution', 50),
    ('CORPORATE_LEGAL', 'Company Profile', 'Company profile document.', 'MINOR', 'company_profile', 60),
    ('CORPORATE_LEGAL', 'Registered Address', 'Evidence of registered business address.', 'MAJOR', 'registered_address', 70),
    ('CORPORATE_LEGAL', 'Director Particulars', 'Identity/particulars of directors.', 'CRITICAL', 'director_particulars', 80),
    ('CORPORATE_LEGAL', 'Power of Attorney', 'Authority for the signatory to bind the company.', 'CRITICAL', 'power_of_attorney', 90),
    ('CORPORATE_LEGAL', 'Signing Authority', 'Board resolution or equivalent confirming signing authority.', 'CRITICAL', 'signing_authority', 100),

    ('PRAZ', 'PRAZ Registration', 'Valid Procurement Regulatory Authority of Zimbabwe registration.', 'FATAL', 'praz_registration', 10),
    ('PRAZ', 'PRAZ Supplier Category', 'Correct PRAZ supplier category for this tender.', 'FATAL', 'praz_supplier_category', 20),
    ('PRAZ', 'PRAZ Contractor Category', 'Correct PRAZ contractor category/classification.', 'FATAL', 'praz_contractor_category', 30),

    ('ZIMRA_TAX', 'ZIMRA Tax Clearance / ITF263', 'Current tax clearance certificate.', 'FATAL', 'zimra_tax_clearance', 10),
    ('ZIMRA_TAX', 'VAT Registration', 'VAT registration certificate, where applicable.', 'CRITICAL', 'vat_registration', 20),
    ('ZIMRA_TAX', 'Other Tax Evidence', 'Any other tax compliance evidence requested.', 'MINOR', 'other_tax_evidence', 30),

    ('NSSA', 'NSSA Compliance Certificate', 'Current NSSA compliance/clearance certificate.', 'FATAL', 'nssa_compliance', 10),

    ('CONSTRUCTION_REGISTRATION', 'CIFOZ Registration', 'Construction Industry Federation of Zimbabwe registration.', 'CRITICAL', 'cifoz_registration', 10),
    ('CONSTRUCTION_REGISTRATION', 'CIFOZ Category', 'Correct CIFOZ category for the required work.', 'CRITICAL', 'cifoz_category', 20),
    ('CONSTRUCTION_REGISTRATION', 'CIFOZ Classification / Grade', 'Correct CIFOZ classification/grade.', 'CRITICAL', 'cifoz_classification', 30),
    ('CONSTRUCTION_REGISTRATION', 'ZBCA Registration', 'Zimbabwe Building Contractors Association registration.', 'CRITICAL', 'zbca_registration', 40),
    ('CONSTRUCTION_REGISTRATION', 'ZBCA Category', 'Correct ZBCA category for the required work.', 'CRITICAL', 'zbca_category', 50),
    ('CONSTRUCTION_REGISTRATION', 'ZBCA Classification / Grade', 'Correct ZBCA classification/grade.', 'CRITICAL', 'zbca_classification', 60),
    ('CONSTRUCTION_REGISTRATION', 'Other Construction Registration', 'Any other required construction industry registration.', 'MAJOR', 'other_construction_registration', 70),
    ('CONSTRUCTION_REGISTRATION', 'Engineering / Professional Registration', 'Registration with an engineering/professional body.', 'MAJOR', 'engineering_registration', 80),
    ('CONSTRUCTION_REGISTRATION', 'Local Authority Registration', 'Registration with the relevant local authority.', 'MAJOR', 'local_authority_registration', 90),
    ('CONSTRUCTION_REGISTRATION', 'Specialist Contractor Registration', 'Specialist trade registration, where required.', 'MAJOR', 'specialist_contractor_registration', 100),

    ('TENDER_FORMS_DECLARATIONS', 'Tender Form / Bid Submission Form', 'Completed and signed tender submission form.', 'FATAL', NULL, 10),
    ('TENDER_FORMS_DECLARATIONS', 'Non-Debarment Declaration', 'Declaration of no debarment from public procurement.', 'FATAL', NULL, 20),
    ('TENDER_FORMS_DECLARATIONS', 'Conflict of Interest Declaration', 'Declaration of no conflict of interest.', 'CRITICAL', NULL, 30),
    ('TENDER_FORMS_DECLARATIONS', 'Other Mandatory Declarations', 'Any other declaration required by the tender document.', 'MAJOR', NULL, 40),

    ('BID_SECURITY', 'Bid Security / Bid Bond', 'Bid security in the required form and amount.', 'FATAL', NULL, 10),
    ('BID_SECURITY', 'Performance Security', 'Performance security/bond commitment, where required at bid stage.', 'CRITICAL', NULL, 20),

    ('FINANCIAL_CAPACITY', 'Turnover Requirement Evidence', 'Evidence of minimum required annual turnover.', 'CRITICAL', 'turnover_evidence', 10),
    ('FINANCIAL_CAPACITY', 'Bank Statements', 'Recent bank statements as required.', 'CRITICAL', 'bank_statements', 20),
    ('FINANCIAL_CAPACITY', 'Bank Reference Letter', 'Reference letter from the company bankers.', 'MAJOR', 'bank_reference_letter', 30),
    ('FINANCIAL_CAPACITY', 'Audited Financial Statements', 'Most recent audited financial statements.', 'CRITICAL', 'audited_financial_statements', 40),
    ('FINANCIAL_CAPACITY', 'Management Accounts', 'Recent management accounts, where audited statements are insufficient alone.', 'MINOR', 'management_accounts', 50),
    ('FINANCIAL_CAPACITY', 'Facility Letter', 'Evidence of an approved credit/overdraft facility.', 'MAJOR', 'facility_letter', 60),
    ('FINANCIAL_CAPACITY', 'Working Capital Statement', 'Statement of available working capital.', 'MAJOR', NULL, 70),

    ('COMMERCIAL_BOQ', 'Priced Bill of Quantities', 'Fully priced BOQ in the required format.', 'FATAL', NULL, 10),
    ('COMMERCIAL_BOQ', 'Pricing Schedule / Rate Build-Up', 'Supporting rate build-up or pricing schedule.', 'MAJOR', NULL, 20),

    ('TECHNICAL_CAPABILITY', 'Methodology Statement', 'Proposed method of construction/execution.', 'CRITICAL', NULL, 10),
    ('TECHNICAL_CAPABILITY', 'Work Programme', 'Proposed programme of works.', 'CRITICAL', NULL, 20),
    ('TECHNICAL_CAPABILITY', 'Quality Management Documentation', 'Quality plan/policy documentation.', 'MAJOR', 'quality_policy', 30),

    ('EXPERIENCE_REFERENCES', 'Required Years of Experience', 'Evidence of the minimum years of relevant experience.', 'CRITICAL', NULL, 10),
    ('EXPERIENCE_REFERENCES', 'Similar Projects Completed', 'Evidence of the minimum number of similar completed projects.', 'CRITICAL', 'project_references', 20),
    ('EXPERIENCE_REFERENCES', 'Client References', 'Reference letters from previous clients.', 'MAJOR', 'project_references', 30),
    ('EXPERIENCE_REFERENCES', 'Completion Certificates', 'Certificates of completion for referenced projects.', 'MAJOR', 'completion_certificates', 40),
    ('EXPERIENCE_REFERENCES', 'Award Letters', 'Letters of award for referenced projects.', 'MINOR', 'award_letters', 50),

    ('KEY_PERSONNEL', 'Key Personnel CVs', 'CVs for nominated key personnel.', 'CRITICAL', 'personnel_cvs', 10),
    ('KEY_PERSONNEL', 'Personnel Qualifications', 'Professional qualifications for key personnel.', 'CRITICAL', 'professional_qualifications', 20),
    ('KEY_PERSONNEL', 'Personnel Availability Confirmation', 'Confirmation nominated personnel are available for this project.', 'MAJOR', NULL, 30),

    ('PLANT_EQUIPMENT', 'Plant/Equipment List', 'List of plant and equipment to be deployed.', 'CRITICAL', 'plant_register', 10),
    ('PLANT_EQUIPMENT', 'Equipment Ownership Records', 'Ownership records for listed plant/equipment.', 'MAJOR', 'equipment_ownership_records', 20),
    ('PLANT_EQUIPMENT', 'Hire Agreements', 'Hire agreements for any hired plant/equipment.', 'MAJOR', 'hire_agreements', 30),

    ('HSE_ENVIRONMENTAL', 'HSE Policy', 'Health and safety policy document.', 'CRITICAL', 'hse_policy', 10),
    ('HSE_ENVIRONMENTAL', 'Environmental Policy', 'Environmental management policy document.', 'MAJOR', 'environmental_policy', 20),
    ('HSE_ENVIRONMENTAL', 'Risk Management Policy', 'Risk management policy document.', 'MINOR', 'risk_management_policy', 30),

    ('INSURANCE', 'Public Liability Insurance', 'Current public liability insurance certificate.', 'CRITICAL', 'insurance_public_liability', 10),
    ('INSURANCE', 'Contractors All Risks Insurance', 'Current contractors-all-risks insurance certificate.', 'CRITICAL', 'insurance_contractors_all_risks', 20),
    ('INSURANCE', 'Workers / Employer Liability Insurance', 'Current workers/employer liability insurance certificate.', 'CRITICAL', 'insurance_workers_liability', 30),
    ('INSURANCE', 'Motor Insurance', 'Current motor insurance for vehicles to be used.', 'MAJOR', 'insurance_motor', 40),
    ('INSURANCE', 'Plant Insurance', 'Current insurance for plant/equipment to be used.', 'MAJOR', 'insurance_plant', 50),
    ('INSURANCE', 'Professional Indemnity Insurance', 'Current professional indemnity insurance, where required.', 'MAJOR', 'insurance_professional_indemnity', 60),

    ('SITE_VISIT', 'Site Visit Attendance', 'Attendance at a mandatory or optional site visit.', 'FATAL', NULL, 10),

    ('TENDER_SPECIFIC_FEES', 'Tender Document Fee', 'Payment of the non-refundable tender document fee.', 'CRITICAL', NULL, 10),

    ('POST_AWARD', 'Performance Bond Commitment', 'Confirmed ability to provide a performance bond on award.', 'MAJOR', NULL, 10),
    ('POST_AWARD', 'Advance Payment Guarantee Commitment', 'Confirmed ability to provide an advance payment guarantee, if applicable.', 'MINOR', NULL, 20)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. Per-tender Compliance Matrix - extend crm.tender_requirements (099)
-- ----------------------------------------------------------------------------

ALTER TABLE crm.tender_requirements
    ADD COLUMN IF NOT EXISTS requirement_template_id UUID REFERENCES crm.tender_requirement_templates(id),
    ADD COLUMN IF NOT EXISTS category VARCHAR(48),
    ADD COLUMN IF NOT EXISTS tender_clause_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS mandatory BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS severity VARCHAR(16) NOT NULL DEFAULT 'MAJOR',
    ADD COLUMN IF NOT EXISTS status VARCHAR(24),
    ADD COLUMN IF NOT EXISTS credential_id UUID REFERENCES compliance.corporate_credentials(id),
    ADD COLUMN IF NOT EXISTS required_category VARCHAR(120),
    ADD COLUMN IF NOT EXISTS required_classification VARCHAR(120),
    ADD COLUMN IF NOT EXISTS correct_category BOOLEAN,
    ADD COLUMN IF NOT EXISTS correct_classification BOOLEAN,
    ADD COLUMN IF NOT EXISTS valid_through_closing BOOLEAN,
    ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS due_date DATE,
    ADD COLUMN IF NOT EXISTS included_in_final_submission BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS reviewer_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS review_date DATE,
    ADD COLUMN IF NOT EXISTS source VARCHAR(24) NOT NULL DEFAULT 'MANUAL';

ALTER TABLE crm.tender_requirements
    DROP CONSTRAINT IF EXISTS tender_requirements_severity_check,
    ADD CONSTRAINT tender_requirements_severity_check
        CHECK (severity IN ('FATAL', 'CRITICAL', 'MAJOR', 'MINOR', 'INFORMATIONAL'));

ALTER TABLE crm.tender_requirements
    DROP CONSTRAINT IF EXISTS tender_requirements_status_check,
    ADD CONSTRAINT tender_requirements_status_check
        CHECK (status IS NULL OR status IN (
            'PRESENT', 'MISSING', 'EXPIRED', 'EXPIRING', 'WRONG_CATEGORY',
            'WRONG_CLASSIFICATION', 'UNVERIFIED', 'PENDING', 'SATISFIED', 'NOT_APPLICABLE'
        ));

ALTER TABLE crm.tender_requirements
    DROP CONSTRAINT IF EXISTS tender_requirements_source_check,
    ADD CONSTRAINT tender_requirements_source_check
        CHECK (source IN ('MANUAL', 'TEMPLATE_SEEDED', 'AI_EXTRACTED_UNVERIFIED'));

CREATE INDEX IF NOT EXISTS idx_tender_requirements_status
    ON crm.tender_requirements (organization_id, tender_id, status) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_tender_requirements_credential
    ON crm.tender_requirements (credential_id) WHERE credential_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_audit_tender_requirements ON crm.tender_requirements;
CREATE TRIGGER trg_audit_tender_requirements AFTER INSERT OR UPDATE OR DELETE ON crm.tender_requirements
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- ----------------------------------------------------------------------------
-- 3. Backfill - honest, never invented
-- ----------------------------------------------------------------------------

-- Existing freeform rows: derive a known status from is_satisfied. Never
-- MISSING/FATAL for historical rows we have no real evidence about.
UPDATE crm.tender_requirements
SET status = CASE WHEN is_satisfied THEN 'SATISFIED' ELSE 'PENDING' END,
    severity = 'MAJOR',
    source = 'MANUAL'
WHERE status IS NULL;

-- Legacy boolean flags on crm.tenders that are TRUE become matching
-- SATISFIED matrix rows (only where no such category row already exists
-- for that tender, so this migration is safe to re-run). FALSE/NULL flags
-- are intentionally left alone - we do not know whether they were even
-- required for that historical tender.
INSERT INTO crm.tender_requirements (
    organization_id, tender_id, label, is_satisfied, category, severity,
    status, mandatory, source, sort_order
)
SELECT t.organization_id, t.id, 'PRAZ Registration (migrated from legacy flag)', true,
       'PRAZ', 'FATAL', 'SATISFIED', true, 'MANUAL', 0
FROM crm.tenders t
WHERE t.praz_registration IS TRUE
  AND NOT EXISTS (
      SELECT 1 FROM crm.tender_requirements r
      WHERE r.tender_id = t.id AND r.category = 'PRAZ' AND r.is_deleted = false
  );

INSERT INTO crm.tender_requirements (
    organization_id, tender_id, label, is_satisfied, category, severity,
    status, mandatory, source, sort_order
)
SELECT t.organization_id, t.id, 'NSSA Clearance (migrated from legacy flag)', true,
       'NSSA', 'FATAL', 'SATISFIED', true, 'MANUAL', 0
FROM crm.tenders t
WHERE t.nssa_clearance IS TRUE
  AND NOT EXISTS (
      SELECT 1 FROM crm.tender_requirements r
      WHERE r.tender_id = t.id AND r.category = 'NSSA' AND r.is_deleted = false
  );

INSERT INTO crm.tender_requirements (
    organization_id, tender_id, label, is_satisfied, category, severity,
    status, mandatory, source, sort_order
)
SELECT t.organization_id, t.id, 'ZIMRA Tax Clearance (migrated from legacy flag)', true,
       'ZIMRA_TAX', 'FATAL', 'SATISFIED', true, 'MANUAL', 0
FROM crm.tenders t
WHERE t.tax_clearance IS TRUE
  AND NOT EXISTS (
      SELECT 1 FROM crm.tender_requirements r
      WHERE r.tender_id = t.id AND r.category = 'ZIMRA_TAX' AND r.is_deleted = false
  );

-- ----------------------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('tender_requirements_library.read', 'View the Zimbabwe tender requirements library'),
    ('tender_requirements_library.manage', 'Maintain the Zimbabwe tender requirements library')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'tender_requirements_library.read'),
    ('Executive (Admin)', 'tender_requirements_library.manage'),
    ('Managing Director', 'tender_requirements_library.read'),
    ('Compliance Officer', 'tender_requirements_library.read'),
    ('Compliance Officer', 'tender_requirements_library.manage'),
    ('Tender / Bid Manager', 'tender_requirements_library.read'),
    ('Commercial Manager', 'tender_requirements_library.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
