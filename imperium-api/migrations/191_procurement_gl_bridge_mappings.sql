-- ============================================================================
-- AEGIS MIGRATION 191 — PROCUREMENT GL BRIDGE MAPPINGS (PHASE 3A)
-- ============================================================================
-- Seeds the two new finance.gl_account_mappings keys the Phase 3A GL bridge
-- extension needs: reclassifying accrued project costs into a specific
-- supplier's payable on invoice approval, and clearing that payable against
-- cash on payment. Same per-organization seed pattern as migration 184.
-- ============================================================================

INSERT INTO finance.gl_account_mappings (organization_id, mapping_key, account_id, description)
SELECT o.id, v.mapping_key, a.id, v.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('supplier_invoice.accounts_payable', '2000', 'Credit side when a supplier invoice is approved for payment - reclassifies accrued project costs into a specific payable'),
    ('supplier_payment.cash_account',     '1000', 'Credit side when a supplier payment batch is posted - clears the payable against cash')
) AS v(mapping_key, account_code, description)
JOIN finance.chart_of_accounts a ON a.organization_id = o.id AND a.account_code = v.account_code
WHERE o.is_deleted = false
ON CONFLICT (organization_id, mapping_key) DO NOTHING;
