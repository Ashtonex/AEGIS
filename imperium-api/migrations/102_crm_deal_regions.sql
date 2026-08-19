-- ============================================================================
-- Region tagging for opportunities and tenders
-- ============================================================================
-- Projects already carry a region (projects.project_profiles.region, added in
-- migration 005) that powers the executive regional footprint view. Deals
-- (opportunities, tenders) had no equivalent column, so the CRM "Geographic
-- Intelligence" card had nothing to aggregate and shipped as a static
-- placeholder. This adds the same free-text region tag to both tables so
-- deals can be broken down by region the same way projects already are.
-- ============================================================================

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS region VARCHAR(120);

ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS region VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_crm_opportunities_region
    ON crm.opportunities (organization_id, region) WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_tenders_region
    ON crm.tenders (organization_id, region) WHERE is_deleted = false;
