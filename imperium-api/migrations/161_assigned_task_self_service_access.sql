-- Assigned task self-service access
--
-- Tasks are no longer only a CRM/admin feature: task stacks are generated for
-- projects, site work, procurement, inventory, fleet and plant/equipment. A
-- person assigned work must be able to open /dashboard/crm/tasks, see their
-- team membership, submit proof, record outcome/next action, and send the
-- task for lead/approver verification.
--
-- This intentionally grants only baseline task/team permissions. Manager-only
-- controls remain separate:
-- - users.read_assignable: full assignment pickers
-- - teams.manage: add/remove/team-lead administration
-- - teams.read_all / crm_tasks.read_all: org-wide visibility

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
  'crm_tasks.read',
  'crm_tasks.update',
  'teams.read'
)
WHERE r.is_deleted = false
  AND r.name NOT IN ('CLIENT', 'SUPPLIER', 'Executive Read Only', 'External Auditor')
ON CONFLICT (role_id, permission_id) DO NOTHING;
