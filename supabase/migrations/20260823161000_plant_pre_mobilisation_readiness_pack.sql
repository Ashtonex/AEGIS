-- Plant & Equipment pre-mobilisation readiness pack
-- Adds an asset-level readiness gate without replacing the existing plant
-- request, reservation, dispatch, return or financial closure lifecycle.

ALTER TABLE fleet.plant_requests
    ADD COLUMN IF NOT EXISTS readiness_pack JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS readiness_blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS readiness_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (readiness_status IN ('not_started', 'blocked', 'ready')),
    ADD COLUMN IF NOT EXISTS plant_manager_ready_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS plant_manager_ready_by UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS plant_requests_readiness_status_idx
    ON fleet.plant_requests (organization_id, readiness_status, status)
    WHERE is_deleted = false;

COMMENT ON COLUMN fleet.plant_requests.readiness_pack IS
    'Pre-mobilisation readiness checklist for technical spec, sourcing, budget, asset identity, inspection, compliance, operator, site, transport, fuel, maintenance and Plant Manager declaration.';

COMMENT ON COLUMN fleet.plant_requests.readiness_blockers IS
    'Current blockers preventing Plant & Equipment mobilisation.';

COMMENT ON COLUMN fleet.plant_requests.plant_manager_ready_at IS
    'Timestamp when the Plant Manager readiness declaration became complete.';
