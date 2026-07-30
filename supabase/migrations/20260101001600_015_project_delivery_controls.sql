-- Project delivery controls. No seed rows or default commercial assumptions.

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS project_code VARCHAR(80),
    ADD COLUMN IF NOT EXISTS project_type VARCHAR(100),
    ADD COLUMN IF NOT EXISTS client_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contract_value NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS planned_completion_date DATE,
    ADD COLUMN IF NOT EXISTS actual_completion_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS projects_org_project_code_unique
    ON projects.projects (organization_id, project_code)
    WHERE project_code IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS projects.project_milestones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'complete', 'blocked', 'cancelled')),
    baseline_date DATE,
    forecast_date DATE,
    actual_date DATE,
    weight NUMERIC(5, 2) CHECK (weight IS NULL OR (weight >= 0 AND weight <= 100)),
    owner_id UUID REFERENCES core.users(id),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS projects.project_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    change_number VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'implemented', 'withdrawn')),
    type VARCHAR(80),
    requested_at TIMESTAMPTZ,
    decision_at TIMESTAMPTZ,
    cost_impact NUMERIC(15, 2),
    programme_impact_days INTEGER,
    rationale TEXT,
    evidence_reference TEXT,
    approved_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, change_number)
);

CREATE TABLE IF NOT EXISTS projects.project_risks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(80),
    status VARCHAR(40) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'mitigating', 'accepted', 'closed')),
    likelihood SMALLINT CHECK (likelihood IS NULL OR likelihood BETWEEN 1 AND 5),
    impact SMALLINT CHECK (impact IS NULL OR impact BETWEEN 1 AND 5),
    response_plan TEXT,
    owner_id UUID REFERENCES core.users(id),
    due_date DATE,
    closed_at TIMESTAMPTZ,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS project_milestones_project_status_idx
    ON projects.project_milestones (organization_id, project_id, status)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS project_changes_project_status_idx
    ON projects.project_changes (organization_id, project_id, status)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS project_risks_project_status_idx
    ON projects.project_risks (organization_id, project_id, status)
    WHERE is_deleted = false;

ALTER TABLE projects.project_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_risks ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.project_milestones FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.project_changes FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.project_risks FORCE ROW LEVEL SECURITY;

-- The service-role API enforces tenant access; direct authenticated/anon table access remains revoked.
REVOKE ALL ON projects.project_milestones, projects.project_changes, projects.project_risks FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA projects FROM anon, authenticated;
