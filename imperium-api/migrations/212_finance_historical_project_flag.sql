-- ============================================================================
-- AEGIS MIGRATION 212 — HISTORICAL PROJECT FLAG (PHASE 9)
-- ============================================================================
-- The Phase 9 audit found no reliable way to identify a project created via
-- the historical-entry backfill tool - the only existing signal (absent
-- opportunity_id/quotation_id/tender_id) is indistinguishable from a live
-- project created outside the opportunity-win flow. The reconciliation
-- dashboard needs a real flag to find its own data.
--
-- Nullable-safe DEFAULT false - zero behavior change for any existing row
-- or reader; create_historical_project (routers/financial_performance.py)
-- is the only writer that ever sets this true.
-- ============================================================================

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS is_historical BOOLEAN NOT NULL DEFAULT false;
