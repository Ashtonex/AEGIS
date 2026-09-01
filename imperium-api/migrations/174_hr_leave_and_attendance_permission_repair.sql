-- ============================================================================
-- AEGIS MIGRATION 174 — HR LEAVE AND ATTENDANCE PERMISSION REPAIR
-- ============================================================================
-- Discovered live when submitting leave requests from /dashboard/hr:
-- The HR dashboard allows "Executive (Admin)", "Project Manager", "HR Officer",
-- and "HR Manager". However:
--
-- 1. hr.leave.create was granted only to "HR Officer" in migration 050.
--    Neither "HR Manager", "Executive (Admin)", "Managing Director", nor
--    "Project Manager" had this permission, causing POST /api/v1/hr-records/leave
--    to fail with 403 Forbidden ("User lacks required permission: hr.leave.create").
--
-- 2. hr.leave.approve was granted only to "HR Manager". "Executive (Admin)"
--    and "Managing Director" could not approve/reject leave requests.
--
-- 3. hr.attendance.record was granted only to "HR Manager" and "HR Officer".
--    "Executive (Admin)" and "Managing Director" could not record attendance.
--
-- This migration closes these gaps across all active organizations.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'hr.leave.create'),
    ('Executive (Admin)', 'hr.leave.approve'),
    ('Executive (Admin)', 'hr.attendance.record'),
    ('Managing Director', 'hr.leave.read'),
    ('Managing Director', 'hr.leave.create'),
    ('Managing Director', 'hr.leave.approve'),
    ('Managing Director', 'hr.attendance.read'),
    ('Managing Director', 'hr.attendance.record'),
    ('HR Manager', 'hr.leave.create'),
    ('Project Manager', 'hr.leave.create')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
