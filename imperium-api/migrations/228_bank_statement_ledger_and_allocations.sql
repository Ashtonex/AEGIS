-- ============================================================================
-- AEGIS MIGRATION 228 — BANK STATEMENT INTO THE GENERAL LEDGER + ALLOCATIONS
-- ============================================================================
-- 1. Every bank statement line gets its own posted GL journal (Cash and Bank
--    against whatever the line was), so the GL-sourced financial statements
--    carry the full bank history and GL cash ties to the bank. The line
--    remembers its journal and a signature of what it was posted as; when
--    the line is re-tagged the old journal is reversed and a new one posted.
--
-- 2. finance.bank_line_allocations lets one line be split across several
--    uses (project / category / amount / why). On a cash withdrawal line the
--    allocations are how the withdrawn cash was then used: each one is a
--    spend out of HQ Petty Cash.
--
-- 3. Chart of accounts additions the bank history needs, and monthly
--    accounting periods covering it (GL posting requires an open period).
--
-- Additive only.
-- ============================================================================

-- 1. Line -> journal link --------------------------------------------------
ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS gl_journal_id UUID REFERENCES finance.journal_entries(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS gl_signature  TEXT;

-- 2. Allocations ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.bank_line_allocations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    line_id                 UUID NOT NULL REFERENCES finance.bank_statement_lines(id) ON DELETE CASCADE,
    project_id              UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    category                VARCHAR(60),
    amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    description             TEXT,
    allocation_date         DATE NOT NULL,
    books_claim_id          UUID REFERENCES finance.progress_claims(id) ON DELETE SET NULL,
    petty_cashbook_id       UUID REFERENCES finance.cashbook_transactions(id) ON DELETE SET NULL,
    gl_journal_id           UUID REFERENCES finance.journal_entries(id) ON DELETE SET NULL,
    gl_signature            TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_line_allocations_line_idx
    ON finance.bank_line_allocations (organization_id, line_id);
CREATE INDEX IF NOT EXISTS bank_line_allocations_project_idx
    ON finance.bank_line_allocations (organization_id, project_id) WHERE project_id IS NOT NULL;

ALTER TABLE finance.bank_line_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_line_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_line_allocations FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_line_allocations;
CREATE POLICY "Finance service role only" ON finance.bank_line_allocations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_bank_line_allocations ON finance.bank_line_allocations;
CREATE TRIGGER trg_audit_bank_line_allocations AFTER INSERT OR UPDATE OR DELETE ON finance.bank_line_allocations
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
DROP TRIGGER IF EXISTS live_change_notify ON finance.bank_line_allocations;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.bank_line_allocations
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

CREATE INDEX IF NOT EXISTS cost_transactions_bank_allocation_source_idx
    ON finance.cost_transactions (source_id)
    WHERE source_type = 'bank_line_allocation';

-- 3. Chart of accounts additions (every org that already has a chart) -----
INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, v.code, v.name, v.category, v.normal_balance, v.description
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1000' AND is_deleted = false) coa
CROSS JOIN (VALUES
    ('1010', 'HQ Petty Cash', 'asset', 'debit',
     'Cash withdrawn from the bank and held at HQ until spent or passed to a site petty cash float.'),
    ('1060', 'Inter-account Transfers', 'asset', 'debit',
     'Clearing for money moving between the company''s own bank accounts.'),
    ('5950', 'Unclassified Project Costs', 'direct_project_cost', 'debit',
     'Project spending from the bank statement whose cost type has not been classified yet.'),
    ('6900', 'Taxes and Statutory Levies', 'operating_expense', 'debit',
     'ZIMRA and other statutory payments not yet matched to a specific liability.'),
    ('7800', 'Donations and Tithes', 'other_expense', 'debit',
     'Tithes, church and charitable donations.')
) AS v(code, name, category, normal_balance, description)
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = v.code
);

-- 4. Monthly periods covering the bank history ----------------------------
INSERT INTO finance.accounting_periods (organization_id, period_code, fiscal_year, period_number, period_start, period_end)
SELECT span.organization_id, to_char(m, 'YYYY-MM'), EXTRACT(YEAR FROM m)::int, EXTRACT(MONTH FROM m)::int,
       m::date, (m + INTERVAL '1 month - 1 day')::date
FROM (
    SELECT organization_id, date_trunc('month', MIN(transaction_date)) AS first_month
    FROM finance.bank_statement_lines GROUP BY organization_id
) span
CROSS JOIN LATERAL generate_series(span.first_month, date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS m
WHERE NOT EXISTS (
    SELECT 1 FROM finance.accounting_periods p
    WHERE p.organization_id = span.organization_id AND m::date BETWEEN p.period_start AND p.period_end
);
