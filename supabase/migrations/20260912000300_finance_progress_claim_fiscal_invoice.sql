-- ============================================================================
-- AEGIS MIGRATION 208 — PROGRESS CLAIM FISCAL INVOICE TRACKING (PHASE 8B)
-- ============================================================================
-- finance.progress_claims.status has always allowed 'invoiced' (migration
-- 023) but nothing has ever transitioned a claim into it. This phase adds
-- the fields needed to record the fiscal invoice number Finance's own real
-- fiscal device issued for a certified claim, and to make that recording
-- the certified -> invoiced transition. Pure internal record-keeping - no
-- fiscal device integration, no generated numbers.
--
-- Purely additive - all columns nullable, no existing row affected.
-- ============================================================================

ALTER TABLE finance.progress_claims
    ADD COLUMN IF NOT EXISTS fiscal_invoice_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS fiscal_invoice_issued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS fiscal_invoice_issued_by UUID REFERENCES core.users(id);
