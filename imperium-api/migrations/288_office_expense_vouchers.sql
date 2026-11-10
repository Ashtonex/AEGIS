-- ============================================================================
-- AEGIS MIGRATION 288 — OFFICE EXPENSE VOUCHERS
-- ============================================================================
-- Office (head-office) spending can now be recorded as its own voucher,
-- instead of only being "recognised" when someone tags a bank line or splits
-- a cash withdrawal.
--
-- A voucher is a finance.project_money_entries row with no project. It goes
-- into the books the moment it is saved, exactly like a project entry:
--   paid in cash  -> Dr expense account, Cr 1010 Cash (HQ Cash runs down)
--   paid by bank  -> Dr expense account, Cr 1070 "Recorded, awaiting bank";
--                    pairs with its statement line on import, which then
--                    posts Bank against 1070, so nothing is counted twice.
--
-- The expense account comes from the category (bank_books.money_out_account):
-- rent 6100, utilities 6200, professional fees 6300, insurance 6400,
-- travel 6500, office_admin 6600, marketing 6700, bank charges 6800,
-- salaries 6000 ... - all accounts already in the chart.
--
-- New columns record who spent the money, who approved it and which
-- department it belongs to (carried onto the GL line so department budgets
-- see it). The receipt itself is attached through core.document_links with
-- entity_type 'money_entry'; is_deleted mirrors is_void so the documents
-- router's generic entity check works on this table.
--
-- Additive only: existing project entries are unchanged.
-- ============================================================================

ALTER TABLE finance.project_money_entries ALTER COLUMN project_id DROP NOT NULL;

ALTER TABLE finance.project_money_entries
    ADD COLUMN IF NOT EXISTS spent_by      VARCHAR(160),
    ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES finance.departments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_deleted    BOOLEAN GENERATED ALWAYS AS (is_void) STORED;

-- An entry with no project is an office expense: money out with a category,
-- so it always lands on a named expense account (never Suspense).
ALTER TABLE finance.project_money_entries DROP CONSTRAINT IF EXISTS project_money_entries_office_expense_check;
ALTER TABLE finance.project_money_entries ADD CONSTRAINT project_money_entries_office_expense_check
    CHECK (project_id IS NOT NULL OR (direction = 'out' AND category IS NOT NULL));

CREATE INDEX IF NOT EXISTS project_money_entries_office_idx
    ON finance.project_money_entries (organization_id, entry_date DESC)
    WHERE project_id IS NULL AND NOT is_void;
