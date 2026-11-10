-- ============================================================================
-- AEGIS MIGRATION 289 — CONSUMABLES & SUPPLIES COST TYPE
-- ============================================================================
-- Finance had no cost type for what a site uses up day to day: food and
-- drinking water for crews, cleaning items, gas, stationery, batteries, small
-- PPE top-ups and the other small buys usually paid from petty cash. Those
-- entries ended up as "other" (7900) or unclassified (5950).
--
-- The category 'consumables_supplies' now books to:
--   on a project    -> 5910 Consumables & Supplies (direct project cost,
--                      cost type 'overhead' in project budget vs actual)
--   office voucher  -> 6600 Office Administration
-- (bank_books.money_out_account). This migration only adds account 5910 to
-- every organisation that already has a chart of accounts.
--
-- Additive only.
-- ============================================================================

INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, '5910', 'Consumables & Supplies', 'direct_project_cost', 'debit',
       'Items used up on a project: food and water for crews, cleaning items, gas, stationery, small PPE and other petty-cash purchases.'
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1000' AND is_deleted = false) coa
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = '5910'
);
