-- ============================================================================
-- AEGIS MIGRATION 244 — BOQ KNOWLEDGE BASE AND STAGE-MOVE LOGS
-- ============================================================================
-- 1. finance.boq_knowledge_lines - every line of a BOQ that has been green-lit
--    for production (POST /quotations/{id}/boq-approval). Only approved BOQs
--    land here, so the library AEGIS learns from is reviewed data, not raw
--    uploads. The builder's "past projects" lookup searches it to suggest
--    rates and items for new work. Re-approving a BOQ replaces its lines.
--
-- 2. crm.activities.tender_id - tenders had nowhere to keep an activity log,
--    so a tender stage move's mandatory note had nowhere to go. Opportunity
--    stage moves already log against opportunity_id.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.boq_knowledge_lines (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    quotation_id           UUID NOT NULL REFERENCES finance.quotations(id) ON DELETE CASCADE,
    source_type            VARCHAR(20),
    source_id              UUID,
    project_title          TEXT,
    client_name            TEXT,
    section                TEXT,
    item_no                VARCHAR(60),
    description            TEXT NOT NULL,
    normalized_description TEXT NOT NULL,
    unit                   VARCHAR(40),
    quantity               NUMERIC(18, 4),
    rate                   NUMERIC(18, 4),
    amount                 NUMERIC(18, 2),
    currency               VARCHAR(10),
    approved_by            UUID REFERENCES core.users(id),
    approved_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted             BOOLEAN NOT NULL DEFAULT false,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_boq_knowledge_lines_org_unit
    ON finance.boq_knowledge_lines (organization_id, lower(unit))
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_boq_knowledge_lines_quotation
    ON finance.boq_knowledge_lines (organization_id, quotation_id);

ALTER TABLE finance.boq_knowledge_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.boq_knowledge_lines FROM anon, authenticated;
DROP POLICY IF EXISTS "BOQ knowledge service role only" ON finance.boq_knowledge_lines;
CREATE POLICY "BOQ knowledge service role only" ON finance.boq_knowledge_lines
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE crm.activities
    ADD COLUMN IF NOT EXISTS tender_id UUID REFERENCES crm.tenders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_activities_tender
    ON crm.activities (organization_id, tender_id, created_at DESC)
    WHERE tender_id IS NOT NULL AND is_deleted = false;
