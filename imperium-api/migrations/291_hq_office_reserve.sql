-- ============================================================================
-- AEGIS MIGRATION 291 — HQ OFFICE RESERVE FUNDED FROM PROJECT RECEIPTS
-- ============================================================================
-- Every project pays a share of what its client pays into a reserve that
-- funds head-office purchases. The share is a percentage of the project's
-- client receipts each month: a company default rate, which a project can
-- override (including 0 to exempt it).
--
-- A contribution is an internal charge, not a cash movement - all the money
-- is in the same company bank. For each project and month it posts:
--     Dr 5970 HQ Overhead Contribution  (direct project cost, on the project)
--     Cr 6990 HQ Overhead Recovered from Projects  (reduces HQ expenses)
-- so company profit is unchanged, each project's margin carries its share of
-- head office, and a finance.cost_transactions row (cost type 'overhead',
-- source 'hq_reserve_contribution') shows it in project budget vs actual.
--
-- Client receipts are read from the posted GL: credits to 4100 revenue or
-- 1100 receivable on a project, from bank statement lines, project money
-- entries and bank-line splits (and their reversals). Invoicing a claim is
-- not a receipt and is not counted.
--
-- app/services/finance/hq_reserve.py keeps one finance.hq_reserve_contributions
-- row per project and month in line with those receipts. A month before the
-- current one keeps the rate it was first worked out with; a rate change
-- applies from the current month on. The reserve's spending is the office
-- expense vouchers (migration 288) dated on or after starts_on.
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.hq_reserve_settings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL UNIQUE REFERENCES core.organizations(id) ON DELETE CASCADE,
    is_active         BOOLEAN NOT NULL DEFAULT false,
    default_rate_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_rate_pct >= 0 AND default_rate_pct <= 100),
    starts_on         DATE NOT NULL DEFAULT date_trunc('month', CURRENT_DATE)::date,
    updated_by        UUID REFERENCES core.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance.hq_reserve_project_rates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    rate_pct          NUMERIC(5,2) NOT NULL CHECK (rate_pct >= 0 AND rate_pct <= 100),
    note              TEXT,
    updated_by        UUID REFERENCES core.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_id)
);

CREATE TABLE IF NOT EXISTS finance.hq_reserve_contributions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id        UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    month             DATE NOT NULL CHECK (month = date_trunc('month', month)::date),
    receipts          NUMERIC(15,2) NOT NULL DEFAULT 0,
    rate_pct          NUMERIC(5,2) NOT NULL,
    amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
    entry_date        DATE,
    gl_journal_id     UUID REFERENCES finance.journal_entries(id) ON DELETE SET NULL,
    blocked_reason    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_id, month)
);

CREATE INDEX IF NOT EXISTS cost_transactions_hq_reserve_source_idx
    ON finance.cost_transactions (source_id)
    WHERE source_type = 'hq_reserve_contribution';

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['hq_reserve_settings', 'hq_reserve_project_rates', 'hq_reserve_contributions'] LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON finance.%I FROM anon, authenticated', t);
        EXECUTE format('DROP POLICY IF EXISTS "Finance service role only" ON finance.%I', t);
        EXECUTE format('CREATE POLICY "Finance service role only" ON finance.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON finance.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION core.process_audit_log()', t, t);
    END LOOP;
END $$;

-- Accounts (every org that already has a chart) ------------------------------
INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, v.code, v.name, v.category, v.normal_balance, v.description
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1000' AND is_deleted = false) coa
CROSS JOIN (VALUES
    ('5970', 'HQ Overhead Contribution', 'direct_project_cost', 'debit',
     'Each project''s share of head-office costs: a percentage of its client receipts paid into the HQ office reserve.'),
    ('6990', 'HQ Overhead Recovered from Projects', 'operating_expense', 'debit',
     'Contributions charged to projects for the HQ office reserve. Carries credits that offset head-office expenses.')
) AS v(code, name, category, normal_balance, description)
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = v.code
);
