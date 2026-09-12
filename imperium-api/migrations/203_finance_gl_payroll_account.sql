-- ============================================================================
-- AEGIS MIGRATION 203 — GL PAYROLL: EMPLOYER STATUTORY CONTRIBUTIONS ACCOUNT (PHASE 7A)
-- ============================================================================
-- Phase 7A bridges finance.payroll_runs into the Phase 1 General Ledger. Most
-- of the accounts it needs already exist (5100 Direct Labour, 6000 HQ
-- Salaries and Wages, 8100 PAYE Payable - already documented as covering
-- AIDS Levy too, 8200 NSSA Payable, 2400 Payroll Liabilities, 1000 Cash and
-- Bank). The one real gap: employer NSSA contributions are a genuine
-- additional cost to the company, not a deduction from employee gross pay,
-- and no existing account represents that cost distinctly.
--
-- Purely additive - one new system-seeded account, no existing row touched.
-- ============================================================================

INSERT INTO finance.chart_of_accounts
    (organization_id, account_code, account_name, account_category, normal_balance, is_system, description)
SELECT o.id, '5150', 'Employer Statutory Contributions', 'direct_project_cost', 'debit',
       true, 'Employer-side NSSA and other statutory contributions arising from payroll'
FROM core.organizations o
WHERE o.is_deleted = false
ON CONFLICT (organization_id, account_code) DO NOTHING;
