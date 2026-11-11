-- ============================================================================
-- AEGIS MIGRATION 294 - PAYROLL ENGINE PHASE 1
-- ============================================================================
-- Brings the payroll run up to what a Zimbabwe payroll (Belina-style) must do
-- before it can be trusted with real pay:
--
--   1. Earning / deduction codes (finance.pay_elements) with the flags that
--      decide tax treatment: taxable, NSSA-insurable, bonus, pre-tax
--      (reduces taxable income), tax-credit %, loan.
--   2. Recurring per-employee assignments (finance.employee_pay_elements),
--      including loans with a running balance.
--   3. A line-by-line breakdown of every payslip (finance.payroll_item_lines).
--   4. USD/ZiG split pay: share per employee, exchange rate and second cash
--      account per run, and amounts paid in the second currency per item.
--   5. Org payroll settings: base currency, split-currency tax method,
--      whether employee NSSA reduces taxable income.
--   6. Monthly payroll periods that can be closed (locked) and reopened.
--   7. Year-to-date totals per employee per tax year (view).
--   8. 'bonus_exemption' as a rate-table type so the tax-free bonus limit is
--      data, not code.
--
-- No statutory rate is hard-coded here. Rates stay in finance.tax_rate_tables.
-- Production had 0 payroll runs when this was written, so nothing is back-filled.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.payroll_settings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL UNIQUE REFERENCES core.organizations(id) ON DELETE CASCADE,
    base_currency           VARCHAR(3) NOT NULL DEFAULT 'USD',
    -- base_tables: tax the whole (mixed) salary on the base-currency tables,
    --   then split each deduction by the currency share. This follows ZIMRA's
    --   PAYE explainer ("for salaries with both local and USD components use
    --   the USD tax tables").
    -- separate_tables: tax each currency portion on its own currency's tables.
    split_tax_method        VARCHAR(20) NOT NULL DEFAULT 'base_tables'
        CHECK (split_tax_method IN ('base_tables', 'separate_tables')),
    nssa_reduces_taxable    BOOLEAN NOT NULL DEFAULT true,
    updated_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Earning / deduction codes
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.pay_elements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    code                VARCHAR(20) NOT NULL,
    name                VARCHAR(120) NOT NULL,
    element_type        VARCHAR(24) NOT NULL
        CHECK (element_type IN ('earning', 'deduction', 'tax_credit', 'employer_contribution')),
    calc_method         VARCHAR(20) NOT NULL DEFAULT 'fixed'
        CHECK (calc_method IN ('fixed', 'pct_of_basic', 'per_hour', 'per_day')),
    default_amount      NUMERIC(15,4),
    is_taxable          BOOLEAN NOT NULL DEFAULT true,
    is_nssa_insurable   BOOLEAN NOT NULL DEFAULT false,
    is_bonus            BOOLEAN NOT NULL DEFAULT false,
    reduces_taxable     BOOLEAN NOT NULL DEFAULT false,
    tax_credit_pct      NUMERIC(7,4) NOT NULL DEFAULT 0 CHECK (tax_credit_pct >= 0 AND tax_credit_pct <= 100),
    is_loan             BOOLEAN NOT NULL DEFAULT false,
    is_system           BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    sort_order          SMALLINT NOT NULL DEFAULT 100,
    description         TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, code),
    -- Flags only make sense on the element types they belong to.
    CHECK (element_type = 'earning' OR (is_bonus = false AND is_nssa_insurable = false)),
    CHECK (element_type = 'deduction' OR (reduces_taxable = false AND tax_credit_pct = 0 AND is_loan = false))
);

CREATE INDEX IF NOT EXISTS pay_elements_org_idx
    ON finance.pay_elements (organization_id, element_type, sort_order)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.employee_pay_elements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    pay_element_id      UUID NOT NULL REFERENCES finance.pay_elements(id) ON DELETE RESTRICT,
    -- Meaning depends on the element's calc_method: a fixed amount, a % of
    -- basic, or a rate per hour/day. For a loan it is the instalment.
    amount              NUMERIC(15,4) NOT NULL CHECK (amount >= 0),
    loan_balance        NUMERIC(15,2) CHECK (loan_balance IS NULL OR loan_balance >= 0),
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    reference           VARCHAR(120),
    notes               TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS employee_pay_elements_lookup_idx
    ON finance.employee_pay_elements (organization_id, employee_id, effective_from)
    WHERE is_deleted = false AND is_active = true;
CREATE INDEX IF NOT EXISTS employee_pay_elements_element_idx
    ON finance.employee_pay_elements (pay_element_id);

-- ---------------------------------------------------------------------------
-- 3. Split pay on profiles, runs and items
-- ---------------------------------------------------------------------------

ALTER TABLE finance.employee_pay_profiles
    ADD COLUMN IF NOT EXISTS secondary_currency   VARCHAR(3),
    ADD COLUMN IF NOT EXISTS secondary_share_pct  NUMERIC(7,4) NOT NULL DEFAULT 0;

DO $$ BEGIN
    ALTER TABLE finance.employee_pay_profiles
        ADD CONSTRAINT employee_pay_profiles_split_check
        CHECK (secondary_share_pct >= 0 AND secondary_share_pct < 100
               AND (secondary_share_pct = 0 OR secondary_currency IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE finance.payroll_runs
    ADD COLUMN IF NOT EXISTS base_currency              VARCHAR(3) NOT NULL DEFAULT 'USD',
    ADD COLUMN IF NOT EXISTS secondary_currency         VARCHAR(3),
    ADD COLUMN IF NOT EXISTS exchange_rate              NUMERIC(18,6),
    ADD COLUMN IF NOT EXISTS secondary_cash_account_id  UUID REFERENCES finance.cash_accounts(id),
    ADD COLUMN IF NOT EXISTS secondary_net_pay          NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS split_tax_method           VARCHAR(20),
    ADD COLUMN IF NOT EXISTS tax_year                   SMALLINT;

DO $$ BEGIN
    ALTER TABLE finance.payroll_runs
        ADD CONSTRAINT payroll_runs_split_check
        CHECK (secondary_currency IS NULL OR (exchange_rate IS NOT NULL AND exchange_rate > 0));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS payroll_runs_secondary_cash_account_idx
    ON finance.payroll_runs (secondary_cash_account_id) WHERE secondary_cash_account_id IS NOT NULL;

ALTER TABLE finance.payroll_items
    ADD COLUMN IF NOT EXISTS total_earnings          NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS nssa_insurable          NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bonus_amount            NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bonus_exempt_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS pre_tax_deductions      NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paye_before_credits     NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS tax_credits_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS secondary_currency      VARCHAR(3),
    ADD COLUMN IF NOT EXISTS secondary_share_pct     NUMERIC(7,4) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS exchange_rate           NUMERIC(18,6),
    ADD COLUMN IF NOT EXISTS gross_secondary         NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS paye_secondary          NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aids_levy_secondary     NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS nssa_employee_secondary NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS nssa_employer_secondary NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS net_pay_secondary       NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS calc_trace              JSONB;

-- ---------------------------------------------------------------------------
-- 4. Payslip lines
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.payroll_item_lines (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    payroll_run_id           UUID NOT NULL REFERENCES finance.payroll_runs(id) ON DELETE CASCADE,
    payroll_item_id          UUID NOT NULL REFERENCES finance.payroll_items(id) ON DELETE CASCADE,
    line_kind                VARCHAR(24) NOT NULL
        CHECK (line_kind IN ('earning', 'deduction', 'tax_credit', 'employer_contribution', 'statutory')),
    code                     VARCHAR(30) NOT NULL,
    name                     VARCHAR(120) NOT NULL,
    pay_element_id           UUID REFERENCES finance.pay_elements(id) ON DELETE SET NULL,
    employee_pay_element_id  UUID REFERENCES finance.employee_pay_elements(id) ON DELETE SET NULL,
    quantity                 NUMERIC(12,4),
    rate                     NUMERIC(15,4),
    amount                   NUMERIC(15,2) NOT NULL,
    is_taxable               BOOLEAN NOT NULL DEFAULT false,
    is_nssa_insurable        BOOLEAN NOT NULL DEFAULT false,
    reduces_taxable          BOOLEAN NOT NULL DEFAULT false,
    sort_order               SMALLINT NOT NULL DEFAULT 100,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_item_lines_item_idx
    ON finance.payroll_item_lines (organization_id, payroll_item_id, sort_order);
CREATE INDEX IF NOT EXISTS payroll_item_lines_run_idx
    ON finance.payroll_item_lines (payroll_run_id);
CREATE INDEX IF NOT EXISTS payroll_item_lines_epe_idx
    ON finance.payroll_item_lines (employee_pay_element_id) WHERE employee_pay_element_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payroll_item_lines_element_idx
    ON finance.payroll_item_lines (pay_element_id) WHERE pay_element_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. Monthly payroll periods (lock / reopen)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.payroll_periods (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    period_month        DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    status              VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_by           UUID REFERENCES core.users(id),
    closed_at           TIMESTAMPTZ,
    reopened_by         UUID REFERENCES core.users(id),
    reopened_at         TIMESTAMPTZ,
    reopen_reason       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, period_month)
);

-- ---------------------------------------------------------------------------
-- 6. Bonus exemption as a rate-table type
-- ---------------------------------------------------------------------------

ALTER TABLE finance.tax_rate_tables DROP CONSTRAINT IF EXISTS tax_rate_tables_tax_type_check;
ALTER TABLE finance.tax_rate_tables ADD CONSTRAINT tax_rate_tables_tax_type_check
    CHECK (tax_type IN ('paye', 'nssa_employee', 'nssa_employer', 'vat_output', 'vat_input',
                        'aids_levy', 'withholding_tax', 'bonus_exemption', 'other'));

-- ---------------------------------------------------------------------------
-- 7. Year-to-date view (Zimbabwe tax year = calendar year of payment date)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW finance.v_payroll_ytd
WITH (security_invoker = true) AS
SELECT
    pi.organization_id,
    pi.employee_id,
    EXTRACT(YEAR FROM pr.payment_date)::int AS tax_year,
    pr.base_currency,
    COUNT(*)                              AS runs_count,
    SUM(pi.total_earnings)                AS total_earnings,
    SUM(pi.gross_pay)                     AS gross_pay,
    SUM(pi.taxable_gross)                 AS taxable_income,
    SUM(pi.bonus_amount)                  AS bonus_amount,
    SUM(pi.bonus_exempt_amount)           AS bonus_exempt_amount,
    SUM(pi.pre_tax_deductions)            AS pre_tax_deductions,
    SUM(pi.paye_before_credits)           AS paye_before_credits,
    SUM(pi.tax_credits_amount)            AS tax_credits_amount,
    SUM(pi.paye_amount)                   AS paye_amount,
    SUM(pi.aids_levy_amount)              AS aids_levy_amount,
    SUM(pi.nssa_insurable)                AS nssa_insurable,
    SUM(pi.nssa_employee_amount)          AS nssa_employee_amount,
    SUM(pi.nssa_employer_amount)          AS nssa_employer_amount,
    SUM(pi.other_deduction)               AS other_deductions,
    SUM(pi.net_pay)                       AS net_pay,
    SUM(pi.net_pay_secondary)             AS net_pay_secondary,
    SUM(pi.paye_secondary)                AS paye_secondary,
    SUM(pi.aids_levy_secondary)           AS aids_levy_secondary,
    SUM(pi.nssa_employee_secondary)       AS nssa_employee_secondary,
    MAX(pr.payment_date)                  AS last_payment_date
FROM finance.payroll_items pi
JOIN finance.payroll_runs pr
  ON pr.id = pi.payroll_run_id AND pr.organization_id = pi.organization_id
WHERE pr.status = 'posted' AND pr.is_deleted = false
GROUP BY pi.organization_id, pi.employee_id, EXTRACT(YEAR FROM pr.payment_date), pr.base_currency;

REVOKE ALL ON finance.v_payroll_ytd FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS (service role only, like the rest of finance payroll)
-- ---------------------------------------------------------------------------

DO $$
DECLARE t_name text;
BEGIN
    FOREACH t_name IN ARRAY ARRAY['payroll_settings', 'pay_elements', 'employee_pay_elements', 'payroll_item_lines', 'payroll_periods']
    LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t_name);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t_name);
        EXECUTE format('REVOKE ALL ON finance.%I FROM anon, authenticated', t_name);
        EXECUTE format('DROP POLICY IF EXISTS "Finance service role only" ON finance.%I', t_name);
        EXECUTE format('CREATE POLICY "Finance service role only" ON finance.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t_name);
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON finance.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON finance.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, t_name, t_name, t_name
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO core.permissions (key, description) VALUES
    ('finance.payroll.period.close',  'Close (lock) a payroll month'),
    ('finance.payroll.period.reopen', 'Reopen a closed payroll month')
ON CONFLICT (key) DO NOTHING;

-- Closing follows whoever can post payroll.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT DISTINCT rp.organization_id, rp.role_id, p_new.id
FROM core.role_permissions rp
JOIN core.permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'finance.payroll.post'
JOIN core.permissions p_new ON p_new.key = 'finance.payroll.period.close'
ON CONFLICT DO NOTHING;

-- Reopening a locked month is a high-trust action - grant narrowly.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.payroll.period.reopen'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Finance Manager')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Starter catalogue of codes for every organisation. Flags only, no amounts
-- and no rates; every row stays editable. BASIC and OT are system codes the
-- engine uses for pay derived from the pay profile.
-- ---------------------------------------------------------------------------

INSERT INTO finance.pay_elements (
    organization_id, code, name, element_type, calc_method,
    is_taxable, is_nssa_insurable, is_bonus, reduces_taxable, tax_credit_pct, is_loan, is_system, sort_order, description
)
SELECT o.id, v.code, v.name, v.element_type, v.calc_method,
       v.is_taxable, v.is_nssa_insurable, v.is_bonus, v.reduces_taxable, v.tax_credit_pct, v.is_loan, v.is_system, v.sort_order, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('BASIC',     'Basic pay',              'earning',    'fixed', true,  true,  false, false, 0::numeric,  false, true,  10, 'From the pay profile (salary, hours or days).'),
    ('OT',        'Overtime',               'earning',    'fixed', true,  true,  false, false, 0::numeric,  false, true,  20, 'From overtime hours on the run.'),
    ('HOUSING',   'Housing allowance',      'earning',    'fixed', true,  true,  false, false, 0::numeric,  false, false, 30, NULL),
    ('TRANSPORT', 'Transport allowance',    'earning',    'fixed', true,  true,  false, false, 0::numeric,  false, false, 40, NULL),
    ('BONUS',     'Bonus',                  'earning',    'fixed', true,  false, true,  false, 0::numeric,  false, false, 50, 'Tax-free up to the bonus_exemption rate table for the year.'),
    ('PENSION',   'Pension fund',           'deduction',  'fixed', false, false, false, true,  0::numeric,  false, false, 110, 'Pre-tax: reduces taxable income.'),
    ('MEDAID',    'Medical aid',            'deduction',  'fixed', false, false, false, false, 50::numeric, false, false, 120, 'Earns a tax credit of 50% of the contribution.'),
    ('LOAN',      'Staff loan',             'deduction',  'fixed', false, false, false, false, 0::numeric,  true,  false, 130, 'Instalment until the balance is cleared.'),
    ('ADVANCE',   'Salary advance',         'deduction',  'fixed', false, false, false, false, 0::numeric,  true,  false, 140, NULL),
    ('UNION',     'Union dues',             'deduction',  'fixed', false, false, false, false, 0::numeric,  false, false, 150, NULL),
    ('OTHER',     'Other deduction',        'deduction',  'fixed', false, false, false, false, 0::numeric,  false, true,  190, 'One-off deduction entered on the run.'),
    ('CR_ELDER',  'Elderly person credit',  'tax_credit', 'fixed', false, false, false, false, 0::numeric,  false, false, 210, NULL),
    ('CR_DISAB',  'Blind / disabled credit','tax_credit', 'fixed', false, false, false, false, 0::numeric,  false, false, 220, NULL)
) AS v(code, name, element_type, calc_method, is_taxable, is_nssa_insurable, is_bonus, reduces_taxable, tax_credit_pct, is_loan, is_system, sort_order, description)
ON CONFLICT (organization_id, code) DO NOTHING;

INSERT INTO finance.payroll_settings (organization_id)
SELECT id FROM core.organizations
ON CONFLICT (organization_id) DO NOTHING;
