-- ============================================================================
-- AEGIS MIGRATION 246 — MONEY RECORDED DIRECTLY ON A PROJECT
-- ============================================================================
-- Finance can now record money in (client receipts) and money out (costs)
-- straight from a project's money panel, instead of waiting for the bank
-- statement and attributing lines afterwards.
--
-- An entry goes into the books the moment it is saved:
--   money in  -> a paid progress claim (or pays an existing certified claim)
--   money out -> a finance.cost_transactions row
--   GL        -> one posted journal against 1070 "Recorded, awaiting bank"
--                (bank entries) or 1010 HQ Petty Cash (cash entries)
--
-- When a bank statement is imported the matcher pairs each bank entry with
-- its statement line (same direction, same amount, close date). A matched
-- line posts Bank against 1070 instead of revenue/cost, so nothing is
-- counted twice and 1070 clears. Lines it can't pair confidently become
-- suggestions for a person to confirm.
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.project_money_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    direction               VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
    paid_via                VARCHAR(10) NOT NULL DEFAULT 'bank' CHECK (paid_via IN ('bank', 'cash')),
    entry_date              DATE NOT NULL,
    amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    category                VARCHAR(60),
    counterparty_name       VARCHAR(200),
    reference               VARCHAR(160),
    description             TEXT,
    -- money in that pays an existing claim instead of creating its own
    pays_claim_id           UUID REFERENCES finance.progress_claims(id) ON DELETE SET NULL,
    pays_claim_prior_status VARCHAR(24),
    -- what the entry put in the books
    books_claim_id          UUID REFERENCES finance.progress_claims(id) ON DELETE SET NULL,
    petty_cashbook_id       UUID REFERENCES finance.cashbook_transactions(id) ON DELETE SET NULL,
    gl_journal_id           UUID REFERENCES finance.journal_entries(id) ON DELETE SET NULL,
    gl_signature            TEXT,
    -- bank statement pairing
    match_status            VARCHAR(12) NOT NULL DEFAULT 'awaiting'
        CHECK (match_status IN ('awaiting', 'suggested', 'matched', 'not_bank')),
    matched_line_id         UUID REFERENCES finance.bank_statement_lines(id) ON DELETE SET NULL,
    suggested_line_ids      UUID[] NOT NULL DEFAULT '{}',
    matched_at              TIMESTAMPTZ,
    matched_by              UUID REFERENCES core.users(id),
    is_void                 BOOLEAN NOT NULL DEFAULT false,
    voided_at               TIMESTAMPTZ,
    voided_by               UUID REFERENCES core.users(id),
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS project_money_entries_project_idx
    ON finance.project_money_entries (organization_id, project_id) WHERE NOT is_void;
CREATE INDEX IF NOT EXISTS project_money_entries_unmatched_idx
    ON finance.project_money_entries (organization_id, amount)
    WHERE NOT is_void AND paid_via = 'bank' AND match_status IN ('awaiting', 'suggested');
CREATE UNIQUE INDEX IF NOT EXISTS project_money_entries_one_per_line
    ON finance.project_money_entries (matched_line_id) WHERE matched_line_id IS NOT NULL AND NOT is_void;

ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS project_entry_id UUID REFERENCES finance.project_money_entries(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cost_transactions_project_entry_source_idx
    ON finance.cost_transactions (source_id)
    WHERE source_type = 'project_money_entry';

ALTER TABLE finance.project_money_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.project_money_entries FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.project_money_entries FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.project_money_entries;
CREATE POLICY "Finance service role only" ON finance.project_money_entries
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_project_money_entries ON finance.project_money_entries;
CREATE TRIGGER trg_audit_project_money_entries AFTER INSERT OR UPDATE OR DELETE ON finance.project_money_entries
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
DROP TRIGGER IF EXISTS live_change_notify ON finance.project_money_entries;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.project_money_entries
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

-- Clearing account: recorded on a project, not yet seen on the bank statement
INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, '1070', 'Recorded, Awaiting Bank Statement', 'asset', 'debit',
       'Clearing for receipts and payments recorded directly on a project. Clears when the matching bank statement line is imported; a balance here is money recorded but not yet seen on the statement.'
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1000' AND is_deleted = false) coa
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = '1070'
);
