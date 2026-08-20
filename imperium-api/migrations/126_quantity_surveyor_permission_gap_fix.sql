-- ============================================================================
-- AEGIS MIGRATION 126 — QUANTITY SURVEYOR PERMISSION GAP FIX
-- ============================================================================
-- A newly onboarded Quantity Surveyor hit "You don't have permission to view
-- linked project data" on their default landing page (/dashboard/quotations)
-- because the role never had 'projects.read' - the Quotations ledger fetches
-- the internal project register as a secondary widget (aegis-web's
-- quotations/page.tsx loadData()).
--
-- Auditing the rest of the Quotations & Estimating module (the role's whole
-- work surface) for the same class of gap turned up several more spots that
-- would 403 or silently render empty for this role:
--   - quotations.delete: router-wide gate (imperium-api/main.py's
--     require_resource_permission("quotations")) blocks Archive Quote on the
--     main ledger AND delete-custom-assembly / delete-rate-benchmark on the
--     CCB page, even though the role already holds quotations.manage_
--     assemblies / manage_rate_intelligence that those actions specifically
--     require.
--   - quotations.approve_ccb_override: blocks the CCB page's core "Override
--     flag" action.
--   - crm.view_tenders / crm.view_opportunities / crm_leads.read: the
--     Estimate Builder's three quote-source dropdowns (Tenders/Opportunities/
--     Leads) come up empty without these - the role already holds
--     crm.opportunities.quote/close_won to actually act on a source once
--     picked, just not to list them.
--   - finance.tax_rate.read / documents.create: fail gracefully today (VAT
--     falls back to a 15% default with a visible notice; BOQ file attach
--     shows an inline "could not be attached" message) rather than hard-
--     blocking, but both are still part of a QS's own estimating workflow.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Quantity Surveyor' AND r.is_deleted = false
JOIN (VALUES
    ('projects.read'),
    ('quotations.delete'),
    ('quotations.approve_ccb_override'),
    ('crm.view_tenders'),
    ('crm.view_opportunities'),
    ('crm_leads.read'),
    ('finance.tax_rate.read'),
    ('documents.create')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
