-- ============================================================================
-- CRM Associate: add tender view/create access
-- ============================================================================
-- 084_role_landing_pages_and_crm_associate.sql scoped CRM Associate to
-- leads + opportunities only, deliberately excluding tenders. Extending
-- that on request: CRM Associate can now see the tender pipeline and add a
-- new tender (crm.view_tenders / crm.create_tenders - the same permissions
-- gating GET/POST /api/v1/crm/tenders). This does NOT grant editing an
-- existing tender's fields, uploading tender documents, or managing the
-- submission checklist - those are separate permissions (tender_bids.update,
-- documents.create) on a different router and were left untouched pending
-- confirmation those are also wanted.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('crm.view_tenders', 'crm.create_tenders')
WHERE r.name = 'CRM Associate' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
