-- ============================================================================
-- FINAL ACCOUNTS — project close-out workflow
--
-- Closes the QS gap where nothing formalised practical/final measurement,
-- final-account negotiation, retention release, or a locked budget-vs-
-- actual-vs-profit/loss report at project completion. finance.retention_ledger
-- (migration 023) already anticipated this - its source_type enum includes
-- 'practical_completion'/'final_completion' - but had zero reader/writer
-- code until now.
--
-- finance.final_accounts is a versioned snapshot (mirrors finance.
-- project_budgets' budget_version pattern) built from the same live
-- source-of-truth query as finance.project_forecasts (compute_project_
-- financials). finance.final_account_lines rolls up finance.boq_line_items
-- (migration 097) into a final measured-vs-contracted comparison.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.final_accounts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id                  UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    account_version             SMALLINT NOT NULL DEFAULT 1 CHECK (account_version > 0),
    status                      VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'under_negotiation', 'agreed', 'closed')),
    final_contract_value        NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_approved_variations   NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_certified_claims      NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_actual_cost           NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_committed_outstanding NUMERIC(15,2) NOT NULL DEFAULT 0,
    retention_held               NUMERIC(15,2) NOT NULL DEFAULT 0,
    retention_released           NUMERIC(15,2) NOT NULL DEFAULT 0,
    final_profit_loss            NUMERIC(15,2) GENERATED ALWAYS AS (final_contract_value - total_actual_cost) STORED,
    final_margin_pct             NUMERIC(7,4),
    outstanding_variations_count INTEGER NOT NULL DEFAULT 0,
    outstanding_claims_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes                        TEXT,
    prepared_by                  UUID REFERENCES core.users(id),
    prepared_at                  TIMESTAMPTZ,
    agreed_by                    UUID REFERENCES core.users(id),
    agreed_at                    TIMESTAMPTZ,
    closed_by                    UUID REFERENCES core.users(id),
    closed_at                    TIMESTAMPTZ,
    created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted                   BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, account_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS final_accounts_single_open
    ON finance.final_accounts (organization_id, project_id)
    WHERE status IN ('draft', 'under_negotiation', 'agreed') AND is_deleted = false;

CREATE INDEX IF NOT EXISTS final_accounts_project_idx
    ON finance.final_accounts (organization_id, project_id, account_version DESC);

CREATE TABLE IF NOT EXISTS finance.final_account_lines (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    final_account_id UUID NOT NULL REFERENCES finance.final_accounts(id) ON DELETE CASCADE,
    boq_line_item_id UUID REFERENCES finance.boq_line_items(id),
    final_qty        NUMERIC(14,3) NOT NULL DEFAULT 0,
    final_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    variance_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
    variance_amount  NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS final_account_lines_account_idx
    ON finance.final_account_lines (organization_id, final_account_id);

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS final_account_closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS final_account_closed_by UUID REFERENCES core.users(id);

ALTER TABLE finance.final_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.final_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.final_account_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.final_account_lines FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.final_accounts, finance.final_account_lines FROM anon, authenticated;

DROP POLICY IF EXISTS "Final accounts service role only" ON finance.final_accounts;
CREATE POLICY "Final accounts service role only" ON finance.final_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Final account lines service role only" ON finance.final_account_lines;
CREATE POLICY "Final account lines service role only" ON finance.final_account_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('finance.final_account.read',    'View project final accounts and close-out reports'),
    ('finance.final_account.prepare', 'Prepare or edit a draft final account'),
    ('finance.final_account.agree',   'Mark a final account as client-agreed'),
    ('finance.final_account.close',   'Permanently close a project final account and release retention')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',  'finance.final_account.read'),
    ('Executive (Admin)',  'finance.final_account.prepare'),
    ('Executive (Admin)',  'finance.final_account.agree'),
    ('Executive (Admin)',  'finance.final_account.close'),
    ('Finance Manager',    'finance.final_account.read'),
    ('Finance Manager',    'finance.final_account.prepare'),
    ('Finance Manager',    'finance.final_account.agree'),
    ('Finance Manager',    'finance.final_account.close'),
    -- Project Manager can prepare/negotiate but the final lock is reserved
    -- for the two "commercial controller" roles above.
    ('Project Manager',    'finance.final_account.read'),
    ('Project Manager',    'finance.final_account.prepare')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'final_accounts'
        UNION ALL VALUES
        ('finance', 'final_account_lines')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
