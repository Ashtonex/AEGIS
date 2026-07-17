-- Workforce operational controls. This migration deliberately creates no employees,
-- allocations, attendance events, or timesheets.

ALTER TABLE hr.employees
    ADD COLUMN IF NOT EXISTS employee_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS linked_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS employment_status VARCHAR(32) NOT NULL DEFAULT 'active'
        CHECK (employment_status IN ('active', 'on_leave', 'suspended', 'terminated')),
    ADD COLUMN IF NOT EXISTS employment_type VARCHAR(32),
    ADD COLUMN IF NOT EXISTS department VARCHAR(120),
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS work_location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS emergency_contact JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS employees_org_employee_number_unique
    ON hr.employees (organization_id, employee_number)
    WHERE employee_number IS NOT NULL AND is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS employees_org_linked_user_unique
    ON hr.employees (organization_id, linked_user_id)
    WHERE linked_user_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS hr.employee_skills (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    skill_name VARCHAR(160) NOT NULL,
    proficiency VARCHAR(24) NOT NULL DEFAULT 'working'
        CHECK (proficiency IN ('basic', 'working', 'advanced', 'expert')),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES core.users(id),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, employee_id, skill_name)
);

CREATE TABLE IF NOT EXISTS hr.employee_certifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    certification_name VARCHAR(200) NOT NULL,
    issuing_authority VARCHAR(200),
    certificate_number VARCHAR(160),
    issued_on DATE,
    expires_on DATE,
    verification_status VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (verification_status IN ('pending', 'verified', 'expired', 'rejected')),
    evidence_path TEXT,
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (expires_on IS NULL OR issued_on IS NULL OR expires_on >= issued_on),
    UNIQUE (organization_id, employee_id, certification_name, certificate_number)
);

CREATE TABLE IF NOT EXISTS hr.employee_availability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    available_from DATE NOT NULL,
    available_to DATE NOT NULL,
    status VARCHAR(24) NOT NULL CHECK (status IN ('available', 'leave', 'unavailable', 'training')),
    capacity_percent NUMERIC(5,2) NOT NULL DEFAULT 100 CHECK (capacity_percent >= 0 AND capacity_percent <= 100),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (available_to >= available_from)
);

CREATE TABLE IF NOT EXISTS hr.project_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    role_on_project VARCHAR(120),
    allocation_percent NUMERIC(5,2) NOT NULL CHECK (allocation_percent > 0 AND allocation_percent <= 100),
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS hr.timesheets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES projects.projects(id) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    regular_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0 AND regular_hours <= 24),
    overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
    status VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    description TEXT,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (regular_hours + overtime_hours > 0),
    UNIQUE (organization_id, employee_id, project_id, work_date)
);

CREATE TABLE IF NOT EXISTS hr.attendance_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_type VARCHAR(24) NOT NULL CHECK (event_type IN ('clock_in', 'clock_out', 'break_start', 'break_end')),
    source VARCHAR(32) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'mobile', 'biometric', 'import')),
    location_label VARCHAR(255),
    latitude NUMERIC(9,6),
    longitude NUMERIC(9,6),
    recorded_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);

CREATE INDEX IF NOT EXISTS employee_skills_employee_idx ON hr.employee_skills (organization_id, employee_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS employee_certifications_expiry_idx ON hr.employee_certifications (organization_id, expires_on) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS employee_availability_period_idx ON hr.employee_availability (organization_id, employee_id, available_from, available_to) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS project_allocations_schedule_idx ON hr.project_allocations (organization_id, project_id, starts_on, ends_on) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS timesheets_approval_idx ON hr.timesheets (organization_id, status, work_date) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS attendance_employee_occurred_idx ON hr.attendance_events (organization_id, employee_id, occurred_at DESC);

-- Direct Data API access remains unavailable. The authenticated API applies RBAC
-- and tenant scoping; RLS remains a defensive backstop for all new data.
ALTER TABLE hr.employee_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.project_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.timesheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_skills FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_certifications FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.employee_availability FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.project_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.timesheets FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON hr.employee_skills, hr.employee_certifications, hr.employee_availability,
    hr.project_allocations, hr.timesheets, hr.attendance_events FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA hr FROM anon, authenticated;
