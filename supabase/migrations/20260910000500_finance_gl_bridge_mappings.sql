-- ============================================================================
-- AEGIS MIGRATION 184 — FINANCE GL BRIDGE: ACCOUNT MAPPINGS (PHASE 2)
-- ============================================================================
-- Phase 2 bridges existing project cost/revenue records
-- (finance.cost_transactions, finance.progress_claims, finance.retention_ledger)
-- into the Phase 1 General Ledger as human-reviewed "proposed journals".
-- This migration adds the configurable key->account lookup that
-- interpretation logic uses instead of hardcoding account codes, so Finance
-- can repoint any mapping without a source-code change or deploy.
--
-- Purely additive - no existing table is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.gl_account_mappings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    mapping_key         VARCHAR(80) NOT NULL,
    account_id          UUID NOT NULL REFERENCES finance.chart_of_accounts(id),
    description         TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, mapping_key)
);

CREATE INDEX IF NOT EXISTS gl_account_mappings_org_idx
    ON finance.gl_account_mappings (organization_id);

-- 1. RLS

ALTER TABLE finance.gl_account_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.gl_account_mappings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.gl_account_mappings FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.gl_account_mappings;
CREATE POLICY "Finance service role only" ON finance.gl_account_mappings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. SEED — default mapping per organization, resolved against the Phase 1
-- seeded Chart of Accounts (migration 180) by account_code. cost_category
-- values mirror the shared enum used by finance.cost_codes/budget_lines/
-- commitments/cost_transactions (labour|equipment|materials|subcontract|
-- overhead|other). 'equipment' maps to Plant Hire (5300) rather than Plant
-- Depreciation (5800) - it's the closer fit for day-to-day plant usage costs;
-- Finance can repoint this per-org via the API if a different default suits
-- their operation.

INSERT INTO finance.gl_account_mappings (organization_id, mapping_key, account_id, description)
SELECT o.id, v.mapping_key, a.id, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('cost_category.labour',               '5100', 'Direct labour cost transactions'),
    ('cost_category.equipment',            '5300', 'Equipment/plant usage cost transactions'),
    ('cost_category.materials',            '5000', 'Materials cost transactions'),
    ('cost_category.subcontract',          '5200', 'Subcontractor cost transactions'),
    ('cost_category.overhead',             '7900', 'Project overhead cost transactions (no dedicated project-overhead account yet)'),
    ('cost_category.other',                '7900', 'Uncategorized cost transactions'),
    ('cost_transaction.credit_control',    '2100', 'Credit side for realized project costs pending supplier invoicing'),
    ('progress_claim.receivable',          '1100', 'Debit side for the non-retention portion of a certified claim'),
    ('progress_claim.retention_receivable','1200', 'Debit side for the retention portion of a certified claim'),
    ('progress_claim.revenue',             '4100', 'Credit side for certified progress claim revenue')
) AS v(mapping_key, account_code, description)
JOIN finance.chart_of_accounts a ON a.organization_id = o.id AND a.account_code = v.account_code
WHERE o.is_deleted = false
ON CONFLICT (organization_id, mapping_key) DO NOTHING;

-- 3. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'gl_account_mappings', 'finance', 'gl_account_mappings', 'gl_account_mappings', 'finance', 'gl_account_mappings'
    );
END $$;

-- 4. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.gl_account_mappings;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.gl_account_mappings
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
