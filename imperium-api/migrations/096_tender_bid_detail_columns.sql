-- ============================================================================
-- Tender bid detail columns + tender_bids.update grant gap
-- ============================================================================
-- The "Log Construction Bid / Tender" modal (aegis-web tenders page) creates
-- a tender via POST /crm/tenders, then immediately PUTs the rest of the form
-- (bid number, category, JV partners, bid bond amount, deliverables
-- checklist) to /tender-bids/{id}. That second call targets crm.tenders
-- columns that were never created by any migration - the dynamic-SQL CRUD
-- router has no schema validation, so Postgres rejected the UPDATE with
-- "column does not exist", surfacing to the user as a 500 -> generic
-- "Tender was not logged. Check the CRM service connection and retry."
-- Every failed submission also left an orphaned tender row behind from the
-- first call (e.g. the pre-existing PETROTRADE duplicates referenced in
-- 070_grant_tender_delete.sql).
--
-- Add the missing columns so the second call has somewhere to write.
-- ============================================================================

ALTER TABLE crm.tenders
ADD COLUMN IF NOT EXISTS bid_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS category VARCHAR(100),
ADD COLUMN IF NOT EXISTS jv_partners TEXT,
ADD COLUMN IF NOT EXISTS bond_amount NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS technical_proposal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS financial_proposal BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS nssa_clearance BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS praz_registration BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS tax_clearance BOOLEAN DEFAULT FALSE;

-- tender_bids.update (needed for the second call) was Executive (Admin)-only
-- (051_crm_role_permission_gap_fix.sql), but 085_sales_executive_crm_permission_gaps.sql
-- already gave Sales Executive and Project Manager crm.create_tenders - so
-- both roles could start the flow but never finish it. Close the gap the
-- same way 085 closed it for crm.create_tenders.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Sales Executive', 'tender_bids.update'),
    ('Project Manager', 'tender_bids.update')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
