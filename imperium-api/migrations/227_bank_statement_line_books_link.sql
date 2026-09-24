-- ============================================================================
-- AEGIS MIGRATION 227 — BANK STATEMENT LINES INTO PROJECT BOOKS
-- ============================================================================
-- Project-tagged bank statement lines now flow into the project books the
-- Finance dashboard reads:
--   money in  -> a paid historical progress claim  (Certified Revenue / Cash Collected)
--   money out -> a finance.cost_transactions row    (Actual Cost)
--
-- The cost side needs no new column: its cost_transactions row carries
-- source_type = 'bank_statement_line' and source_id = the line id. The
-- revenue side needs the claim id remembered on the line so a re-tag can
-- retire the old claim.
--
-- Neither side writes a cashbook entry: the bank statement import is already
-- the cash record, and the reconciled cash account balance must not move.
--
-- Purely additive - one nullable column.
-- ============================================================================

ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS books_claim_id UUID REFERENCES finance.progress_claims(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cost_transactions_bank_line_source_idx
    ON finance.cost_transactions (source_id)
    WHERE source_type = 'bank_statement_line';
