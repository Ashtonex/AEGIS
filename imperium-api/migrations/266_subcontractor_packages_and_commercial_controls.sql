-- Migration: 266_subcontractor_packages_and_commercial_controls.sql
-- Description: Subcontractor work packages, payment certification, retentions, and back-charges.

CREATE TABLE IF NOT EXISTS projects.subcontract_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    package_number VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    subcontractor_id UUID NOT NULL REFERENCES crm.subcontractors(id) ON DELETE RESTRICT,
    trade VARCHAR(80) NOT NULL,
    award_value NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (award_value >= 0),
    retention_percentage NUMERIC(5, 2) NOT NULL DEFAULT 10.0 CHECK (retention_percentage >= 0 AND retention_percentage <= 20),
    retention_cap NUMERIC(15, 2) DEFAULT 0,
    status VARCHAR(40) NOT NULL DEFAULT 'awarded'
        CHECK (status IN ('draft', 'awarded', 'active', 'practical_completion', 'final_account', 'terminated')),
    start_date DATE,
    completion_date DATE,
    scope_description TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, package_number)
);

CREATE TABLE IF NOT EXISTS projects.subcontractor_certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES projects.subcontract_packages(id) ON DELETE CASCADE,
    certificate_number VARCHAR(80) NOT NULL,
    valuation_date DATE NOT NULL,
    period_start DATE,
    period_end DATE,
    claimed_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (claimed_amount >= 0),
    certified_gross_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (certified_gross_amount >= 0),
    retention_deducted NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (retention_deducted >= 0),
    contra_charges_deducted NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (contra_charges_deducted >= 0),
    previous_certified_gross NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (previous_certified_gross >= 0),
    net_payable_amount NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (net_payable_amount >= 0),
    status VARCHAR(40) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'under_review', 'certified', 'approved', 'posted_to_finance', 'paid', 'rejected')),
    qs_assessor_id UUID REFERENCES core.users(id),
    commercial_manager_approver_id UUID REFERENCES core.users(id),
    certified_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, package_id, certificate_number)
);

CREATE TABLE IF NOT EXISTS projects.subcontractor_back_charges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    package_id UUID NOT NULL REFERENCES projects.subcontract_packages(id) ON DELETE CASCADE,
    subcontractor_id UUID NOT NULL REFERENCES crm.subcontractors(id) ON DELETE RESTRICT,
    charge_number VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    reason_category VARCHAR(60) NOT NULL
        CHECK (reason_category IN ('defective_work_rectification', 'plant_hire_recovery', 'material_usage_recovery', 'site_cleaning_penalty', 'safety_non_compliance')),
    amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
    evidence_reference TEXT,
    status VARCHAR(40) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'applied_to_certificate', 'disputed', 'waived')),
    applied_certificate_id UUID REFERENCES projects.subcontractor_certificates(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, charge_number)
);

CREATE INDEX IF NOT EXISTS ix_subcontract_packages_project
    ON projects.subcontract_packages (organization_id, project_id, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_subcontractor_certificates_package
    ON projects.subcontractor_certificates (organization_id, package_id, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_subcontractor_back_charges_package
    ON projects.subcontractor_back_charges (organization_id, package_id, status)
    WHERE is_deleted = false;

ALTER TABLE projects.subcontract_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.subcontract_packages FORCE ROW LEVEL SECURITY;

ALTER TABLE projects.subcontractor_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.subcontractor_certificates FORCE ROW LEVEL SECURITY;

ALTER TABLE projects.subcontractor_back_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.subcontractor_back_charges FORCE ROW LEVEL SECURITY;

REVOKE ALL ON projects.subcontract_packages FROM anon, authenticated;
REVOKE ALL ON projects.subcontractor_certificates FROM anon, authenticated;
REVOKE ALL ON projects.subcontractor_back_charges FROM anon, authenticated;

DROP POLICY IF EXISTS "Subcontract packages service role only" ON projects.subcontract_packages;
CREATE POLICY "Subcontract packages service role only" ON projects.subcontract_packages
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Subcontractor certificates service role only" ON projects.subcontractor_certificates;
CREATE POLICY "Subcontractor certificates service role only" ON projects.subcontractor_certificates
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Subcontractor back charges service role only" ON projects.subcontractor_back_charges;
CREATE POLICY "Subcontractor back charges service role only" ON projects.subcontractor_back_charges
    FOR ALL TO service_role USING (true) WITH CHECK (true);
