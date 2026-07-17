-- Source-backed Compliance, Legal and Assurance controls.
-- This migration deliberately does not create users or role assignments.

CREATE SCHEMA IF NOT EXISTS compliance;

CREATE TABLE IF NOT EXISTS compliance.corrective_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    finding_trigger VARCHAR(255) NOT NULL,
    responsible_person VARCHAR(255) NOT NULL,
    due_date DATE NOT NULL,
    priority VARCHAR(40) NOT NULL DEFAULT 'high'
        CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(40) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'overdue', 'completed', 'cancelled')),
    notes TEXT,
    source_type VARCHAR(80),
    source_id UUID,
    created_by UUID REFERENCES core.users(id),
    completed_by UUID REFERENCES core.users(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS corrective_actions_org_status_due_idx
    ON compliance.corrective_actions (organization_id, status, due_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS corrective_actions_source_idx
    ON compliance.corrective_actions (organization_id, source_type, source_id)
    WHERE source_id IS NOT NULL AND is_deleted = false;

ALTER TABLE compliance.corrective_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.corrective_actions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON compliance.corrective_actions FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA compliance FROM anon, authenticated;

CREATE POLICY "Compliance corrective actions service role only"
    ON compliance.corrective_actions
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('compliance.corrective_action.read', 'View compliance corrective actions'),
    ('compliance.corrective_action.create', 'Create compliance corrective actions')
ON CONFLICT (key) DO NOTHING;
