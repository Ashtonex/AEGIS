-- HR operating layer: recruitment, onboarding, employee documents, medicals,
-- performance, discipline, asset assignment, training, org reporting,
-- workforce planning, payroll adjustments, and self-service leave visibility.

CREATE TABLE IF NOT EXISTS hr.recruitment_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    candidate_name VARCHAR(255) NOT NULL,
    role_applied_for VARCHAR(160) NOT NULL,
    department VARCHAR(120),
    project_id UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    stage VARCHAR(40) NOT NULL DEFAULT 'applied'
        CHECK (stage IN ('applied', 'screening', 'interview', 'offer', 'hired', 'rejected', 'withdrawn')),
    source VARCHAR(120),
    target_start_date DATE,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.onboarding_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES hr.employees(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES hr.recruitment_candidates(id) ON DELETE SET NULL,
    task_name VARCHAR(200) NOT NULL,
    owner_user_id UUID REFERENCES core.users(id),
    due_date DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'in_progress', 'done', 'blocked', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.employee_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    document_type VARCHAR(80) NOT NULL
        CHECK (document_type IN ('contract', 'id', 'work_permit', 'medical', 'license', 'induction', 'policy_acknowledgement', 'other')),
    title VARCHAR(200) NOT NULL,
    document_number VARCHAR(160),
    issued_on DATE,
    expires_on DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'current'
        CHECK (status IN ('current', 'expiring', 'expired', 'missing', 'superseded')),
    document_id UUID,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on)
);

CREATE TABLE IF NOT EXISTS hr.employee_medicals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    check_type VARCHAR(80) NOT NULL DEFAULT 'medical'
        CHECK (check_type IN ('medical', 'safety_induction', 'license', 'ppe_fit_test', 'drug_test', 'other')),
    title VARCHAR(200) NOT NULL,
    completed_on DATE,
    expires_on DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'current'
        CHECK (status IN ('current', 'due', 'expired', 'failed', 'waived')),
    provider VARCHAR(160),
    evidence_document_id UUID,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (expires_on IS NULL OR completed_on IS NULL OR expires_on >= completed_on)
);

CREATE TABLE IF NOT EXISTS hr.employee_performance_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    reviewer_user_id UUID REFERENCES core.users(id),
    review_period_start DATE,
    review_period_end DATE,
    rating NUMERIC(4,2),
    outcome VARCHAR(40) NOT NULL DEFAULT 'draft'
        CHECK (outcome IN ('draft', 'completed', 'development_plan', 'promotion_recommended', 'performance_warning')),
    summary TEXT,
    next_review_date DATE,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.employee_disciplinary_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    incident_date DATE NOT NULL,
    category VARCHAR(80) NOT NULL,
    severity VARCHAR(24) NOT NULL DEFAULT 'minor'
        CHECK (severity IN ('minor', 'moderate', 'serious', 'gross_misconduct')),
    status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'investigating', 'hearing_scheduled', 'resolved', 'appealed', 'closed')),
    outcome VARCHAR(120),
    summary TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.employee_asset_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    asset_type VARCHAR(40) NOT NULL CHECK (asset_type IN ('ppe', 'tool', 'vehicle', 'equipment', 'phone', 'laptop', 'other')),
    asset_label VARCHAR(200) NOT NULL,
    asset_reference VARCHAR(160),
    issued_on DATE NOT NULL DEFAULT CURRENT_DATE,
    due_back_on DATE,
    returned_on DATE,
    condition_out VARCHAR(80),
    condition_in VARCHAR(80),
    status VARCHAR(24) NOT NULL DEFAULT 'issued'
        CHECK (status IN ('issued', 'returned', 'lost', 'damaged', 'written_off')),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.training_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    role_name VARCHAR(160) NOT NULL,
    project_id UUID REFERENCES projects.projects(id) ON DELETE CASCADE,
    training_name VARCHAR(200) NOT NULL,
    mandatory BOOLEAN NOT NULL DEFAULT true,
    renewal_months INTEGER,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.training_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    requirement_id UUID REFERENCES hr.training_requirements(id) ON DELETE SET NULL,
    training_name VARCHAR(200) NOT NULL,
    completed_on DATE,
    expires_on DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'completed', 'expired', 'failed', 'waived')),
    trainer VARCHAR(160),
    evidence_document_id UUID,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.reporting_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    manager_employee_id UUID REFERENCES hr.employees(id) ON DELETE SET NULL,
    relationship_type VARCHAR(40) NOT NULL DEFAULT 'line_manager'
        CHECK (relationship_type IN ('line_manager', 'project_manager', 'mentor', 'dotted_line')),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (employee_id <> manager_employee_id),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE IF NOT EXISTS hr.workforce_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects.projects(id) ON DELETE CASCADE,
    site_id UUID,
    role_name VARCHAR(160) NOT NULL,
    required_headcount INTEGER NOT NULL DEFAULT 1 CHECK (required_headcount >= 0),
    planned_start DATE,
    planned_end DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'sourcing', 'filled', 'short', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hr.payroll_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    adjustment_type VARCHAR(40) NOT NULL CHECK (adjustment_type IN ('paye', 'nssa', 'deduction', 'loan', 'advance', 'allowance', 'garnishee')),
    description VARCHAR(240) NOT NULL,
    amount NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
    balance NUMERIC(15,2),
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'settled', 'suspended', 'cancelled')),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE hr.leave_requests
    ADD COLUMN IF NOT EXISTS calendar_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (calendar_status IN ('pending', 'approved', 'declined', 'cancelled')),
    ADD COLUMN IF NOT EXISTS calendar_title VARCHAR(200);

UPDATE hr.leave_requests
SET calendar_status = CASE status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'declined' WHEN 'cancelled' THEN 'cancelled' ELSE 'pending' END
WHERE calendar_status IS NULL OR calendar_status = 'pending';

CREATE INDEX IF NOT EXISTS recruitment_candidates_stage_idx ON hr.recruitment_candidates (organization_id, stage, created_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS onboarding_tasks_status_idx ON hr.onboarding_tasks (organization_id, status, due_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS employee_documents_expiry_idx ON hr.employee_documents (organization_id, expires_on, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS employee_medicals_expiry_idx ON hr.employee_medicals (organization_id, expires_on, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS performance_reviews_next_idx ON hr.employee_performance_reviews (organization_id, next_review_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS disciplinary_status_idx ON hr.employee_disciplinary_records (organization_id, status, incident_date DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS asset_assignments_employee_idx ON hr.employee_asset_assignments (organization_id, employee_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS training_requirements_role_idx ON hr.training_requirements (organization_id, role_name, project_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS training_records_employee_idx ON hr.training_records (organization_id, employee_id, status, expires_on) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS reporting_lines_employee_idx ON hr.reporting_lines (organization_id, employee_id, effective_from DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS workforce_plans_project_idx ON hr.workforce_plans (organization_id, project_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS payroll_adjustments_employee_idx ON hr.payroll_adjustments (organization_id, employee_id, status) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS leave_requests_calendar_idx ON hr.leave_requests (organization_id, start_date, end_date, status) WHERE is_deleted = false;

ALTER TABLE hr.recruitment_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.onboarding_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_medicals ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_disciplinary_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_asset_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.training_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.training_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.reporting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.workforce_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.payroll_adjustments ENABLE ROW LEVEL SECURITY;

ALTER TABLE hr.recruitment_candidates FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.onboarding_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_medicals FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_performance_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_disciplinary_records FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_asset_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.training_requirements FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.training_records FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.reporting_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.workforce_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.payroll_adjustments FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hr.recruitment_candidates, hr.onboarding_tasks, hr.employee_documents, hr.employee_medicals,
    hr.employee_performance_reviews, hr.employee_disciplinary_records, hr.employee_asset_assignments,
    hr.training_requirements, hr.training_records, hr.reporting_lines, hr.workforce_plans,
    hr.payroll_adjustments FROM anon, authenticated;

DO $$
DECLARE t_name text;
BEGIN
    FOREACH t_name IN ARRAY ARRAY[
        'recruitment_candidates', 'onboarding_tasks', 'employee_documents', 'employee_medicals',
        'employee_performance_reviews', 'employee_disciplinary_records', 'employee_asset_assignments',
        'training_requirements', 'training_records', 'reporting_lines', 'workforce_plans', 'payroll_adjustments'
    ]
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "HR operations service role only" ON hr.%I', t_name);
        EXECUTE format('CREATE POLICY "HR operations service role only" ON hr.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t_name);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON hr.%I', t_name, t_name);
        EXECUTE format('CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON hr.%I FOR EACH ROW EXECUTE FUNCTION core.process_audit_log()', t_name, t_name);
    END LOOP;
END $$;

INSERT INTO core.permissions (key, description) VALUES
    ('hr.operations.read', 'View HR operating layer records, alerts and planning dashboards'),
    ('hr.operations.create', 'Create HR operating layer records'),
    ('hr.operations.update', 'Update HR operating layer records'),
    ('hr.leave.self_service', 'Submit and view own leave requests')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('hr.operations.read', 'hr.operations.create', 'hr.operations.update', 'hr.leave.self_service')
WHERE r.name IN ('Executive (Admin)', 'HR Manager', 'HR Officer')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('hr.operations.read', 'hr.leave.self_service')
WHERE r.name IN ('Project Manager', 'Executive Read Only')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'hr.leave.self_service'
WHERE r.name IN ('EMPLOYEE', 'FOREMAN', 'Site Clerk', 'Site Engineer', 'Site Agent', 'Quantity Surveyor', 'Storekeeper', 'Procurement Associate', 'Procurement Manager')
ON CONFLICT DO NOTHING;
