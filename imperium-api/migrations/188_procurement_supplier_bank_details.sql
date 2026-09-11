-- ============================================================================
-- AEGIS MIGRATION 188 — PROCUREMENT: SUPPLIER BANK DETAILS (PHASE 3A)
-- ============================================================================
-- procurement.suppliers has zero bank-detail columns today - there is
-- nothing to detect a changed bank account against, one of the classic
-- vendor-fraud/BEC vectors the master Finance spec calls out. This adds
-- them, nullable, plus an explicit "who/when changed" stamp maintained by
-- the one endpoint that can write these fields (routers/supplier_records.py
-- update_item), not by a trigger that can't know the acting user.
--
-- Purely additive: every existing row and every existing query against
-- procurement.suppliers is unaffected.
-- ============================================================================

ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS bank_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS bank_branch_code VARCHAR(40),
    ADD COLUMN IF NOT EXISTS bank_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bank_updated_by UUID REFERENCES core.users(id);
