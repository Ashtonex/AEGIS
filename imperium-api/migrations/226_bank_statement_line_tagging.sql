-- ============================================================================
-- AEGIS MIGRATION 226 — BANK STATEMENT LINE TAGGING
-- ============================================================================
-- Lets Finance say what each bank statement line actually was: which project
-- it belongs to, who the money came from / went to, a category, and a note.
--
-- Tagging is deliberately separate from reconciliation: a tagged line is NOT
-- a cashbook entry and never touches finance.cash_accounts.current_balance.
-- That is what lets years of historical bank history be allocated to
-- projects without re-posting it through the cashbook.
--
-- Purely additive - only new nullable columns on bank_statement_lines.
-- ============================================================================

ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS project_id        UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS counterparty_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS category          VARCHAR(60),
    ADD COLUMN IF NOT EXISTS notes             TEXT,
    ADD COLUMN IF NOT EXISTS tagged_by         UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS tagged_at         TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bank_statement_lines_project_idx
    ON finance.bank_statement_lines (organization_id, project_id)
    WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS bank_statement_lines_account_line_idx
    ON finance.bank_statement_lines (organization_id, cash_account_id, transaction_date, line_number);

-- Tagging is a "match"-level action (it edits a line's meaning, not the books),
-- so it reuses finance.reconciliation.match rather than introducing a new key.
