-- ============================================================================
-- AEGIS MIGRATION 231 — BANK & PROJECT MONEY WORKBOOK: EDITABLE SPLITS (PHASE 3)
-- ============================================================================
-- The workbook's "Splits & Cash Uses" sheet becomes editable (change / clear
-- existing parts, add new ones in spare rows). Its changes are logged in the
-- same finance.bank_workbook_changes trail; allocation_id ties a log row to
-- the part it touched (no FK: the part may since have been removed) so the
-- sheet can show a per-row Sync status.
--
-- Additive only.
-- ============================================================================

ALTER TABLE finance.bank_workbook_changes
    ADD COLUMN IF NOT EXISTS allocation_id UUID;

-- A new split typed into a spare row may name a line that doesn't exist;
-- that rejection is still logged, with no line.
ALTER TABLE finance.bank_workbook_changes ALTER COLUMN line_id DROP NOT NULL;

-- New rows applied from Excel whose republish hasn't landed yet (e.g. the
-- upload was refused because someone was mid-edit). The next cycle re-reads
-- the same file, so these keys stop the same new row being added twice.
-- Cleared on every successful publish.
ALTER TABLE finance.bank_workbook_publications
    ADD COLUMN IF NOT EXISTS applied_new_row_keys JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS bank_workbook_changes_allocation_idx
    ON finance.bank_workbook_changes (allocation_id, created_at DESC)
    WHERE allocation_id IS NOT NULL;
