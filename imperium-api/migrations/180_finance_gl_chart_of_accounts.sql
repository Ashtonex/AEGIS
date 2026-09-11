-- ============================================================================
-- AEGIS MIGRATION 180 — FINANCE GENERAL LEDGER: CHART OF ACCOUNTS (PHASE 1)
-- ============================================================================
-- First piece of the AEGIS Finance Intelligence Engine's double-entry
-- accounting foundation. Introduces a proper, hierarchical, per-organization
-- Chart of Accounts that the General Ledger (migration 182) posts against.
--
-- Purely additive: no existing table is altered. Nothing currently posting
-- to finance.cost_transactions, finance.cashbook_transactions,
-- finance.department_transfers, finance.payroll_items, etc. changes
-- behaviour as a result of this migration - the Chart of Accounts and the
-- General Ledger it feeds are populated by manual, authorized journal entry
-- only until a later phase deliberately bridges existing operational tables
-- into it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.chart_of_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    account_code        VARCHAR(20) NOT NULL,
    account_name        VARCHAR(200) NOT NULL,
    account_category    VARCHAR(30) NOT NULL
        CHECK (account_category IN (
            'asset', 'liability', 'equity', 'revenue', 'direct_project_cost',
            'operating_expense', 'other_income', 'other_expense', 'tax'
        )),
    normal_balance      VARCHAR(6) NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
    parent_account_id   UUID REFERENCES finance.chart_of_accounts(id),
    is_control_account  BOOLEAN NOT NULL DEFAULT false,
    is_system           BOOLEAN NOT NULL DEFAULT false,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    currency_code       VARCHAR(3) NOT NULL DEFAULT 'USD',
    description         TEXT,
    created_by          UUID REFERENCES core.users(id),
    updated_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, account_code)
);

CREATE INDEX IF NOT EXISTS coa_org_category_idx
    ON finance.chart_of_accounts (organization_id, account_category)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS coa_parent_idx
    ON finance.chart_of_accounts (parent_account_id)
    WHERE is_deleted = false;

-- 1. RLS

ALTER TABLE finance.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.chart_of_accounts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.chart_of_accounts FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.chart_of_accounts;
CREATE POLICY "Finance service role only" ON finance.chart_of_accounts
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. SEED — a construction-specific starter Chart of Accounts for every
-- existing organization, marked is_system so it can be extended (but not
-- silently deleted) by Finance without touching source code, per spec §2.

INSERT INTO finance.chart_of_accounts
    (organization_id, account_code, account_name, account_category, normal_balance, is_system, description)
SELECT o.id, v.account_code, v.account_name, v.account_category, v.normal_balance, true, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    -- Assets
    ('1000', 'Cash and Bank',              'asset',              'debit',  'Consolidated cash and bank control account'),
    ('1100', 'Accounts Receivable',        'asset',              'debit',  'Client and trade receivables control account'),
    ('1200', 'Retention Receivable',       'asset',              'debit',  'Retention withheld by clients, recoverable on release'),
    ('1300', 'Work in Progress (WIP)',     'asset',              'debit',  'Unbilled contract costs and recognised revenue not yet invoiced'),
    ('1400', 'Fixed Assets',               'asset',              'debit',  'Plant, equipment and property at cost'),
    ('1500', 'Cash Advances Receivable',   'asset',              'debit',  'Outstanding staff and site cash advances'),
    ('1900', 'Suspense Account',           'asset',              'debit',  'Temporary holding account for unclassified postings pending investigation'),
    -- Liabilities
    ('2000', 'Accounts Payable',           'liability',          'credit', 'Supplier and subcontractor payables control account'),
    ('2100', 'Accrued Project Costs',      'liability',          'credit', 'Costs incurred but not yet invoiced by suppliers/subcontractors'),
    ('2200', 'Retentions Payable',         'liability',          'credit', 'Retention withheld from suppliers and subcontractors'),
    ('2300', 'Client Deposits',            'liability',          'credit', 'Advance payments and mobilisation deposits received from clients'),
    ('2400', 'Payroll Liabilities',        'liability',          'credit', 'Net pay, statutory deductions and employer contributions payable'),
    ('2500', 'Loans Payable',              'liability',          'credit', 'Bank and director loans payable'),
    -- Equity
    ('3000', 'Share Capital',              'equity',             'credit', 'Issued share capital'),
    ('3100', 'Retained Earnings',          'equity',             'credit', 'Accumulated retained earnings'),
    ('3200', 'Directors'' Accounts',       'equity',             'credit', 'Directors'' loan/current accounts'),
    ('3300', 'Shareholders'' Accounts',    'equity',             'credit', 'Shareholders'' loan/current accounts'),
    -- Revenue
    ('4000', 'Contract Revenue',           'revenue',            'credit', 'Total recognised construction contract revenue'),
    ('4100', 'Certified Revenue',          'revenue',            'credit', 'Revenue certified via approved progress claims'),
    ('4200', 'Uncertified Revenue',        'revenue',            'credit', 'Revenue recognised but not yet certified/claimed'),
    -- Direct Project Costs
    ('5000', 'Materials',                  'direct_project_cost', 'debit', 'Construction materials consumed on projects'),
    ('5100', 'Direct Labour',              'direct_project_cost', 'debit', 'Site labour directly chargeable to projects'),
    ('5200', 'Subcontractors',             'direct_project_cost', 'debit', 'Subcontractor costs and certified subcontract valuations'),
    ('5300', 'Plant Hire',                 'direct_project_cost', 'debit', 'Internal and external plant hire charges'),
    ('5400', 'Fuel',                       'direct_project_cost', 'debit', 'Fuel consumed by plant, equipment and vehicles'),
    ('5500', 'Site Establishment',         'direct_project_cost', 'debit', 'Site setup, accommodation and welfare costs'),
    ('5600', 'Mobilisation / Demobilisation', 'direct_project_cost', 'debit', 'Mobilisation and demobilisation costs'),
    ('5700', 'Temporary Works',            'direct_project_cost', 'debit', 'Temporary works design and construction costs'),
    ('5800', 'Plant Depreciation',         'direct_project_cost', 'debit', 'Depreciation charge for plant deployed to projects'),
    ('5900', 'Small Tools',                'direct_project_cost', 'debit', 'Consumable small tools and site equipment'),
    -- Operating Expenses (HQ / corporate overhead)
    ('6000', 'HQ Salaries and Wages',      'operating_expense',  'debit', 'Head-office payroll not chargeable to a project'),
    ('6100', 'Rent',                       'operating_expense',  'debit', 'Office and yard rent'),
    ('6200', 'Utilities',                  'operating_expense',  'debit', 'Electricity, water and communications'),
    ('6300', 'Professional Fees',          'operating_expense',  'debit', 'Legal, audit and consulting fees'),
    ('6400', 'Insurance',                  'operating_expense',  'debit', 'Corporate and project insurance premiums'),
    ('6500', 'Travel and Accommodation',   'operating_expense',  'debit', 'Corporate travel and accommodation'),
    ('6600', 'Office Administration',      'operating_expense',  'debit', 'General office administration costs'),
    ('6700', 'Marketing',                  'operating_expense',  'debit', 'Marketing and business development costs'),
    ('6800', 'Finance Costs',              'operating_expense',  'debit', 'Bank charges and interest expense'),
    -- Other Income / Expense
    ('4900', 'Other Income',               'other_income',       'credit', 'Income not directly related to construction contracts'),
    ('7900', 'Other Expense',              'other_expense',      'debit', 'Expenses not classified elsewhere'),
    -- Tax
    ('8000', 'VAT Payable',                'tax',                'credit', 'Net VAT payable to ZIMRA'),
    ('8100', 'PAYE Payable',               'tax',                'credit', 'PAYE and AIDS Levy payable to ZIMRA'),
    ('8200', 'NSSA Payable',               'tax',                'credit', 'NSSA statutory contributions payable')
) AS v(account_code, account_name, account_category, normal_balance, description)
WHERE o.is_deleted = false
ON CONFLICT (organization_id, account_code) DO NOTHING;

-- 3. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'chart_of_accounts', 'finance', 'chart_of_accounts', 'chart_of_accounts', 'finance', 'chart_of_accounts'
    );
END $$;

-- 4. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.chart_of_accounts;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.chart_of_accounts
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
