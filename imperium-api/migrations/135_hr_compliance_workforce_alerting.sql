-- HR / Compliance / Workforce proactive alerting: gives HSE incidents a real
-- status lifecycle (previously only incident_date + severity existed, so
-- "unresolved incident" could not be detected) and adds a real data source
-- for equipment credential expiry (previously hardcoded NULL - there was no
-- backing table).

ALTER TABLE projects.hse_incidents
    ADD COLUMN IF NOT EXISTS title VARCHAR(255),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS status VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'investigating', 'resolved')),
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS reported_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS hse_incidents_org_status_idx
    ON projects.hse_incidents (organization_id, status)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS compliance.equipment_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id) ON DELETE CASCADE,
    credential_name VARCHAR(200) NOT NULL,
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
    UNIQUE (organization_id, fleet_id, credential_name, certificate_number)
);

CREATE INDEX IF NOT EXISTS equipment_credentials_expiry_idx
    ON compliance.equipment_credentials (organization_id, expires_on)
    WHERE is_deleted = false;

-- Direct Data API access remains unavailable. The authenticated API applies
-- RBAC and tenant scoping; RLS remains a defensive backstop for new data
-- (matches the pattern used for hr.employee_certifications in migration 016).
ALTER TABLE compliance.equipment_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.equipment_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON compliance.equipment_credentials FROM anon, authenticated;
