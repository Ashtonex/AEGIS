-- ============================================================================
-- Tender visit control, recycling, and win/loss engine fields
-- ============================================================================
-- Tenders need two operational dates: mandatory site visit and submission
-- deadline. Lost tenders also need a recycling track so the team follows up
-- with the winning contractor for subcontract/supply opportunities.
-- ============================================================================

ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS site_visit_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS site_visit_mandatory BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS winning_contractor TEXT,
    ADD COLUMN IF NOT EXISTS recycling_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (recycling_status IN ('not_started', 'winner_identified', 'approach_planned', 'approached', 'converted', 'closed'));

CREATE INDEX IF NOT EXISTS idx_crm_tenders_site_visit
    ON crm.tenders (organization_id, site_visit_at)
    WHERE is_deleted = false AND site_visit_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_tenders_recycling
    ON crm.tenders (organization_id, recycling_status, closeout_recorded_at DESC)
    WHERE is_deleted = false AND closeout_status = 'lost';
