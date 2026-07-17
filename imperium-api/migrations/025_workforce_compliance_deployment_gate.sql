-- Workforce to Compliance vertical-slice integration.
-- Adds auditable deployment gates that prevent project/equipment deployment
-- when required employee credentials are missing, unverified, or expired.

CREATE SCHEMA IF NOT EXISTS compliance;

CREATE TABLE IF NOT EXISTS compliance.deployment_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    requirement_scope VARCHAR(48) NOT NULL
        CHECK (requirement_scope IN ('all_deployments', 'workforce_project_allocation', 'equipment_assignment')),
    project_id UUID REFERENCES projects.projects(id) ON DELETE CASCADE,
    target_role VARCHAR(120),
    equipment_type VARCHAR(100),
    certification_name VARCHAR(200) NOT NULL,
    required_verification_status VARCHAR(24) NOT NULL DEFAULT 'verified'
        CHECK (required_verification_status IN ('pending', 'verified', 'expired', 'rejected')),
    warning_days INTEGER NOT NULL DEFAULT 30 CHECK (warning_days >= 0),
    is_active BOOLEAN NOT NULL DEFAULT true,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS deployment_requirements_unique_active
    ON compliance.deployment_requirements (
        organization_id,
        requirement_scope,
        COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(lower(target_role), ''),
        COALESCE(lower(equipment_type), ''),
        lower(certification_name)
    )
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS deployment_requirements_lookup_idx
    ON compliance.deployment_requirements (
        organization_id, requirement_scope, project_id, lower(target_role), lower(equipment_type)
    )
    WHERE is_active = true AND is_deleted = false;

CREATE TABLE IF NOT EXISTS compliance.deployment_gate_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    gate_type VARCHAR(48) NOT NULL
        CHECK (gate_type IN ('workforce_project_allocation', 'equipment_assignment')),
    subject_employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    fleet_id UUID REFERENCES fleet.fleet(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES projects.projects(id) ON DELETE RESTRICT,
    source_type VARCHAR(80) NOT NULL,
    source_id UUID,
    status VARCHAR(24) NOT NULL CHECK (status IN ('passed', 'blocked', 'override')),
    missing_requirements JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(missing_requirements) = 'array'),
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof(warnings) = 'array'),
    override_reason TEXT,
    checked_by UUID REFERENCES core.users(id),
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS deployment_gate_checks_employee_idx
    ON compliance.deployment_gate_checks (organization_id, subject_employee_id, checked_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS deployment_gate_checks_project_idx
    ON compliance.deployment_gate_checks (organization_id, project_id, status, checked_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS deployment_gate_checks_source_idx
    ON compliance.deployment_gate_checks (organization_id, source_type, source_id)
    WHERE source_id IS NOT NULL AND is_deleted = false;

ALTER TABLE fleet.fleet_assignments
    ADD COLUMN IF NOT EXISTS operator_employee_id UUID REFERENCES hr.employees(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS compliance_gate_check_id UUID REFERENCES compliance.deployment_gate_checks(id);

ALTER TABLE hr.project_allocations
    ADD COLUMN IF NOT EXISTS compliance_gate_check_id UUID REFERENCES compliance.deployment_gate_checks(id),
    ADD COLUMN IF NOT EXISTS compliance_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (compliance_status IN ('pending', 'passed', 'blocked', 'override'));

CREATE INDEX IF NOT EXISTS fleet_assignments_operator_idx
    ON fleet.fleet_assignments (organization_id, operator_employee_id, starts_at DESC)
    WHERE operator_employee_id IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS project_allocations_compliance_idx
    ON hr.project_allocations (organization_id, compliance_status, starts_on DESC)
    WHERE is_deleted = false;

ALTER TABLE compliance.deployment_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.deployment_gate_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.deployment_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.deployment_gate_checks FORCE ROW LEVEL SECURITY;

REVOKE ALL ON compliance.deployment_requirements, compliance.deployment_gate_checks FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA compliance FROM anon, authenticated;

CREATE POLICY "Compliance service role only" ON compliance.deployment_requirements
    FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Compliance service role only" ON compliance.deployment_gate_checks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('compliance.requirement.read', 'View deployment compliance requirements'),
    ('compliance.requirement.manage', 'Create and manage deployment compliance requirements'),
    ('compliance.gate.read', 'View deployment gate checks and blocked deployment evidence'),
    ('compliance.gate.override', 'Authorize controlled compliance gate overrides')
ON CONFLICT (key) DO NOTHING;
