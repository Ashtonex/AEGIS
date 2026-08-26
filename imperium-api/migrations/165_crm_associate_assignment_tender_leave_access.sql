-- ============================================================================
-- CRM Associate operational access bridge
-- ============================================================================
-- CRM Associate was expanded into a working CRM operator role in migration
-- 163, but several pages call shared routers whose permission keys do not
-- use the crm.* prefix:
--
-- - AssignmentPanel calls /assignments and requires assignments.manage.
-- - Tender board saves through /tender-bids and requires tender_bids.*.
-- - HR self-service leave was introduced in 162 but did not include CRM
--   Associate in the baseline employee-style leave grant.
--
-- These grants are non-delete working permissions. They let CRM Associates
-- assign CRM pursuits, move/edit tenders, finish won/lost sales work, and
-- submit their own leave without giving them admin/settings access.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'assignments.manage',
    'tender_bids.read',
    'tender_bids.create',
    'tender_bids.update',
    'tender_bids.award',
    'crm.opportunities.close_won',
    'hr.leave.self_service'
)
WHERE r.name = 'CRM Associate'
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
