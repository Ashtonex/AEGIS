-- ============================================================================
-- AEGIS MIGRATION 035 — ESTIMATING & QUOTATIONS METADATA STRUCTURE
-- Adds metadata and status tracking columns to finance.quotations table
-- ============================================================================

ALTER TABLE finance.quotations 
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS status VARCHAR(50) NOT NULL DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS quotations_metadata_idx ON finance.quotations USING gin (metadata);
CREATE INDEX IF NOT EXISTS quotations_status_idx ON finance.quotations (status);
