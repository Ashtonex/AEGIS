-- ============================================================================
-- Tender won/lost close-out governance
-- ============================================================================
-- Moving a tender to Awarded/Lost is a decision, not a plain board move.
-- Capture why it was won/lost, the next steps the team must follow, and the
-- actor/timestamp that recorded the decision.
-- ============================================================================

ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS closeout_status VARCHAR(12)
        CHECK (closeout_status IN ('won', 'lost')),
    ADD COLUMN IF NOT EXISTS closeout_reason TEXT,
    ADD COLUMN IF NOT EXISTS closeout_next_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS closeout_recorded_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS closeout_recorded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenders_closeout_status
    ON crm.tenders (organization_id, closeout_status, closeout_recorded_at DESC)
    WHERE is_deleted = false AND closeout_status IS NOT NULL;
