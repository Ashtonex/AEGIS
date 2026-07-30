-- Public website intake is processed server-side by the API. These tables are
-- internal CRM/HR records and are never granted to anonymous clients.

CREATE TABLE IF NOT EXISTS crm.web_intakes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    intake_type VARCHAR(40) NOT NULL,
    source VARCHAR(80) NOT NULL DEFAULT 'website',
    payload JSONB NOT NULL,
    idempotency_key VARCHAR(128),
    spam_status VARCHAR(30) NOT NULL DEFAULT 'pending',
    lead_id UUID REFERENCES crm.leads(id),
    opportunity_id UUID REFERENCES crm.opportunities(id),
    subcontractor_id UUID REFERENCES crm.subcontractors(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS web_intakes_org_idempotency_uidx
    ON crm.web_intakes (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS web_intakes_org_created_idx ON crm.web_intakes (organization_id, created_at DESC);

ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS website_intake_id UUID REFERENCES crm.web_intakes(id);
ALTER TABLE crm.opportunities ADD COLUMN IF NOT EXISTS lead_id UUID REFERENCES crm.leads(id);

ALTER TABLE crm.subcontractors
    ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tax_clearance_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS coverage_provinces TEXT[],
    ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
    ADD COLUMN IF NOT EXISTS submission_data JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS subcontractors_org_registration_uidx
    ON crm.subcontractors (organization_id, registration_number) WHERE registration_number IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.tender_interests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    tender_id UUID NOT NULL REFERENCES crm.tenders(id),
    contact_id UUID REFERENCES crm.contacts(id),
    company_name VARCHAR(255) NOT NULL,
    registration_number VARCHAR(100),
    praz_number VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, tender_id, registration_number)
);

CREATE TABLE IF NOT EXISTS hr.applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    position_id VARCHAR(100) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    province VARCHAR(100),
    application_data JSONB NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'received',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS applications_org_created_idx ON hr.applications (organization_id, created_at DESC);

ALTER TABLE crm.web_intakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.tender_interests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant Isolation Policy" ON crm.web_intakes FOR ALL
    USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');
CREATE POLICY "Tenant Isolation Policy" ON crm.tender_interests FOR ALL
    USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');
CREATE POLICY "Tenant Isolation Policy" ON hr.applications FOR ALL
    USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');
