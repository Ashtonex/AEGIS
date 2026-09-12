-- ============================================================================
-- AEGIS MIGRATION 207 — GL VAT BRIDGE: ACCOUNT MAPPINGS (PHASE 8A)
-- ============================================================================
-- Configurable key->account lookups the VAT GL bridging logic resolves
-- against instead of hardcoding account codes - same pattern as migrations
-- 184/200. finance.chart_of_accounts already has 8000 VAT Payable (migration
-- 180) and finance.cash_accounts already resolves to 1000 Cash and Bank
-- elsewhere; this migration only adds the mapping keys, no new accounts.
--
-- Purely additive - no existing table or mapping key is touched.
-- ============================================================================

INSERT INTO finance.gl_account_mappings (organization_id, mapping_key, account_id, description)
SELECT o.id, v.mapping_key, a.id, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('statutory.vat_payable',         '8000', 'Net VAT control account - credited by output VAT, debited by input VAT and settlements'),
    ('statutory.vat_settlement_cash', '1000', 'Credit for the cash outflow when a VAT liability is settled')
) AS v(mapping_key, account_code, description)
JOIN finance.chart_of_accounts a ON a.organization_id = o.id AND a.account_code = v.account_code
WHERE o.is_deleted = false
ON CONFLICT (organization_id, mapping_key) DO NOTHING;
