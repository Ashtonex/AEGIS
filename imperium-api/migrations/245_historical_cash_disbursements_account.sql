-- 245: GL account for cash withdrawn before AEGIS bookkeeping started.
--
-- Before September 2026 cash withdrawn from the bank was spent on salaries,
-- subcontractors and other business payments without vouchers, so the uses
-- cannot be traced to a project or cost type. bank_books maps the
-- 'historical_cash_use' cash-use category to this account so HQ Petty Cash
-- is cleared without inventing a split.

INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, '5960', 'Historical Cash Disbursements', 'direct_project_cost', 'debit',
       'Cash withdrawn before September 2026 and spent on salaries, subcontractors and other business payments; not traceable to a project or cost type.'
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1010' AND is_deleted = false) coa
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = '5960'
);
