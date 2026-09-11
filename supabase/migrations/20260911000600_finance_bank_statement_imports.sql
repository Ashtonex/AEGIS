-- ============================================================================
-- AEGIS MIGRATION 193 — BANK STATEMENT IMPORTS & LINES (PHASE 4)
-- ============================================================================
-- Introduces the "bank statement" concept, which does not exist anywhere in
-- the schema today - finance.cashbook_transactions only ever represented
-- "our books" side. finance.bank_statement_imports (one row per uploaded
-- CSV) + finance.bank_statement_lines (one row per parsed statement line,
-- with its own match_status vocabulary distinct from
-- cashbook_transactions.reconciliation_status) let the matching engine
-- compare "what the bank says" against "what we recorded" for the first
-- time.
--
-- Purely additive - no existing table is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.bank_statement_imports (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    cash_account_id        UUID NOT NULL REFERENCES finance.cash_accounts(id) ON DELETE RESTRICT,
    document_id            UUID REFERENCES core.documents(id),
    file_name              VARCHAR(255) NOT NULL,
    column_mapping         JSONB NOT NULL DEFAULT '{}'::jsonb,
    statement_period_start DATE,
    statement_period_end   DATE,
    status                 VARCHAR(20) NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'parsed', 'reviewing', 'completed', 'cancelled')),
    total_lines            INT NOT NULL DEFAULT 0,
    matched_count          INT NOT NULL DEFAULT 0,
    suggested_count        INT NOT NULL DEFAULT 0,
    unmatched_count        INT NOT NULL DEFAULT 0,
    duplicate_count        INT NOT NULL DEFAULT 0,
    uploaded_by            UUID REFERENCES core.users(id),
    uploaded_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_statement_imports_org_account_idx
    ON finance.bank_statement_imports (organization_id, cash_account_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS finance.bank_statement_lines (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id                UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    import_id                      UUID NOT NULL REFERENCES finance.bank_statement_imports(id) ON DELETE CASCADE,
    cash_account_id                UUID NOT NULL REFERENCES finance.cash_accounts(id) ON DELETE RESTRICT,
    line_number                    INT NOT NULL,
    transaction_date               DATE NOT NULL,
    description                    TEXT,
    reference                      VARCHAR(160),
    amount                         NUMERIC(15,2) NOT NULL,
    match_status                   VARCHAR(20) NOT NULL DEFAULT 'unmatched'
        CHECK (match_status IN ('unmatched', 'suggested', 'matched', 'duplicate', 'difference')),
    matched_cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    match_confidence               NUMERIC(5,2),
    reviewed_by                    UUID REFERENCES core.users(id),
    reviewed_at                    TIMESTAMPTZ,
    created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (import_id, line_number)
);

CREATE INDEX IF NOT EXISTS bank_statement_lines_import_status_idx
    ON finance.bank_statement_lines (organization_id, import_id, match_status);
CREATE INDEX IF NOT EXISTS bank_statement_lines_account_date_idx
    ON finance.bank_statement_lines (organization_id, cash_account_id, transaction_date);

-- 1. RLS — service-role-only, org isolation enforced in the application
-- layer (the proven Phase 1 pattern, mirrored from
-- migrations/078_finance_department_transfers.sql).

ALTER TABLE finance.bank_statement_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_statement_imports FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_statement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_statement_lines FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.bank_statement_imports, finance.bank_statement_lines FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_statement_imports;
CREATE POLICY "Finance service role only" ON finance.bank_statement_imports
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_statement_lines;
CREATE POLICY "Finance service role only" ON finance.bank_statement_lines
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. AUDIT TRIGGERS

DO $$
DECLARE t_name text;
BEGIN
    FOR t_name IN SELECT unnest(ARRAY['bank_statement_imports', 'bank_statement_lines'])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON finance.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON finance.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, t_name, t_name, t_name
        );
    END LOOP;
END $$;

-- 3. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.bank_statement_imports;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.bank_statement_imports
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

DROP TRIGGER IF EXISTS live_change_notify ON finance.bank_statement_lines;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.bank_statement_lines
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
