-- ============================================================================
-- AEGIS MIGRATION 204 — GL PAYROLL BRIDGE: ACCOUNT MAPPINGS (PHASE 7A)
-- ============================================================================
-- Configurable key->account lookups the payroll GL bridge (gl_bridge.py's
-- propose_journal_for_payroll_run) resolves against instead of hardcoding
-- account codes, following the exact pattern migration 184 established for
-- the Phase 2 cost/revenue bridge. Finance can repoint any of these per-org
-- via the existing GL bridge mappings API without a source-code change.
--
-- Purely additive - no existing table or mapping key is touched.
-- ============================================================================

INSERT INTO finance.gl_account_mappings (organization_id, mapping_key, account_id, description)
SELECT o.id, v.mapping_key, a.id, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('payroll.project_labour',                 '5100', 'Debit for gross wages allocated to a project'),
    ('payroll.hq_salaries',                     '6000', 'Debit for gross wages with no project allocation'),
    ('payroll.employer_statutory_contributions','5150', 'Debit for employer-side NSSA contributions'),
    ('payroll.paye_payable',                    '8100', 'Credit for PAYE (and AIDS Levy) withheld'),
    ('payroll.aids_levy_payable',                '8100', 'Credit for AIDS Levy withheld (shares the PAYE payable account by default)'),
    ('payroll.nssa_payable',                     '8200', 'Credit for employee + employer NSSA contributions'),
    ('payroll.other_deductions_payable',        '2400', 'Credit for other withheld deductions (loans, garnishees, advances)'),
    ('payroll.net_pay_cash',                     '1000', 'Credit for the net pay cash outflow')
) AS v(mapping_key, account_code, description)
JOIN finance.chart_of_accounts a ON a.organization_id = o.id AND a.account_code = v.account_code
WHERE o.is_deleted = false
ON CONFLICT (organization_id, mapping_key) DO NOTHING;
