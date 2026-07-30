-- Controlled deployment gate override audit fields.
-- This migration does not create users or role assignments.

ALTER TABLE compliance.deployment_gate_checks
    ADD COLUMN IF NOT EXISTS override_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS override_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS override_reference VARCHAR(160);

CREATE INDEX IF NOT EXISTS deployment_gate_checks_override_idx
    ON compliance.deployment_gate_checks (organization_id, override_at DESC)
    WHERE status = 'override' AND is_deleted = false;
