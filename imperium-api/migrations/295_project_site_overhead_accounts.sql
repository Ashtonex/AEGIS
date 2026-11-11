-- ============================================================================
-- AEGIS MIGRATION 295 — SITE OVERHEADS ON A PROJECT ARE DIRECT JOB COSTS
-- ============================================================================
-- Rent, utilities, insurance, professional fees, travel, site admin and
-- statutory levies charged to a project already count as that project's cost,
-- but the ledger booked them to head-office overheads (6100-6900) or Other
-- Expense (7900), so the project cost report and the P&L disagreed.
--
-- From 1 September 2026 (the first open period; closed periods are not
-- restated) money out tagged to a project books to a direct project cost
-- (bank_books.money_out_account):
--   rent                  -> 5510 Site Rent & Yard Hire
--   utilities             -> 5520 Site Utilities & Communications
--   insurance             -> 5530 Project Insurance & Bonds
--   professional_fees     -> 5540 Project Professional Fees
--   travel_accommodation  -> 5550 Site Travel & Accommodation
--   office_admin/marketing-> 5560 Site Administration & Signage
--   tax_statutory         -> 5570 Project Statutory Levies
--   other                 -> 5950 Unclassified Project Costs (exists)
-- Office vouchers (no project) still book to the 6xxx overhead accounts.
--
-- This migration only adds the accounts to every organisation that has a
-- chart of accounts. Additive only; safe to re-run.
-- ============================================================================

INSERT INTO finance.chart_of_accounts (organization_id, account_code, account_name, account_category, normal_balance, description)
SELECT coa.organization_id, v.code, v.name, 'direct_project_cost', 'debit', v.description
FROM (SELECT DISTINCT organization_id FROM finance.chart_of_accounts WHERE account_code = '1000' AND is_deleted = false) coa
CROSS JOIN (VALUES
    ('5510', 'Site Rent & Yard Hire', 'Rent for site offices, yards, storage and accommodation used by one project.'),
    ('5520', 'Site Utilities & Communications', 'Power, water, airtime and internet used on one project.'),
    ('5530', 'Project Insurance & Bonds', 'Contractor''s all-risk cover, performance and advance-payment bonds for one project.'),
    ('5540', 'Project Professional Fees', 'Engineers, surveyors, consultants and legal fees incurred for one project.'),
    ('5550', 'Site Travel & Accommodation', 'Travel, lodging and subsistence for staff working on one project.'),
    ('5560', 'Site Administration & Signage', 'Site office admin, stationery, software and project signboards.'),
    ('5570', 'Project Statutory Levies', 'Levies, permits and statutory charges arising on one project.')
) AS v(code, name, description)
WHERE NOT EXISTS (
    SELECT 1 FROM finance.chart_of_accounts x
    WHERE x.organization_id = coa.organization_id AND x.account_code = v.code
);
