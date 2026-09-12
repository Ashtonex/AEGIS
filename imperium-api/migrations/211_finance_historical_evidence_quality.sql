-- ============================================================================
-- AEGIS MIGRATION 211 — HISTORICAL ENTRY EVIDENCE QUALITY (PHASE 9)
-- ============================================================================
-- Phase 9 extends the existing historical-entry tool (routers/
-- financial_performance.py's /historical/revenue and /historical/cost-
-- activities, permission migration 095) in place, per the master spec's
-- "never presented as fully verified" requirement - a required, honest
-- self-assessment grade at entry time, not an optional label someone could
-- skip:
--   A - verified against an attached original source document
--   B - verified against a secondary record, document optional
--   C - corroborated by recollection cross-checked against another data point
--   D - single-source best estimate, no corroboration
--   E - unverified/unknown provenance, placeholder pending better evidence
--
-- Nullable and unused by every live (non-historical) writer - this column
-- only ever gets set by the historical-entry endpoints.
--
-- Purely additive - no existing row or reader is affected.
-- ============================================================================

ALTER TABLE finance.progress_claims
    ADD COLUMN IF NOT EXISTS evidence_quality VARCHAR(1)
        CHECK (evidence_quality IN ('A', 'B', 'C', 'D', 'E'));

ALTER TABLE finance.cost_transactions
    ADD COLUMN IF NOT EXISTS evidence_quality VARCHAR(1)
        CHECK (evidence_quality IN ('A', 'B', 'C', 'D', 'E'));
