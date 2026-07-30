-- Executive project drill-down data model. These fields deliberately have no defaults:
-- absent data must remain absent on the executive dashboard.

CREATE TABLE IF NOT EXISTS projects.project_profiles (
    project_id UUID PRIMARY KEY REFERENCES projects.projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    region VARCHAR(120),
    province VARCHAR(120),
    site_location VARCHAR(255),
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    viability_status VARCHAR(50),
    viability_notes TEXT,
    delivery_manager_id UUID REFERENCES core.users(id),
    budget_amount NUMERIC(15, 2),
    forecast_cost NUMERIC(15, 2),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects.project_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    check_name VARCHAR(255) NOT NULL,
    check_type VARCHAR(100),
    status VARCHAR(50) NOT NULL,
    completed_at TIMESTAMPTZ,
    evidence_reference TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_profiles_org_region_idx ON projects.project_profiles (organization_id, region);
CREATE INDEX IF NOT EXISTS project_checks_project_idx ON projects.project_checks (project_id, status);

ALTER TABLE finance.quotations ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id);
ALTER TABLE crm.tenders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id);
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id);
ALTER TABLE procurement.procurement_orders ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id);
