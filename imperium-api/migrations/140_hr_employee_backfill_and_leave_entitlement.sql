-- HR module was effectively dead for every regular user: hr.employees (the
-- workforce register Employee Register/Attendance/Leave all read from) had
-- zero rows. 11 real staff have core.users login accounts with real roles,
-- but hr.employees.linked_user_id - the column meant to bridge a login to
-- an employee record - was only ever populated by one narrow CRM
-- managed-account code path (_create_employee_record), never by the normal
-- Settings > Invite User flow. This backfills the gap for existing users;
-- routers/settings.py's invite_user is fixed separately (application code)
-- to populate it going forward.

ALTER TABLE hr.employees
    ADD COLUMN IF NOT EXISTS annual_leave_days INTEGER NOT NULL DEFAULT 21;

INSERT INTO hr.employees (
    organization_id, created_by, employee_name, job_title, linked_user_id, employment_status
)
SELECT
    u.organization_id,
    u.id,
    u.full_name,
    (
        SELECT r.name
        FROM core.user_roles ur
        JOIN core.roles r ON r.id = ur.role_id AND r.organization_id = u.organization_id AND r.is_deleted = false
        WHERE ur.user_id = u.id AND ur.organization_id = u.organization_id AND upper(r.name) != 'SUPERADMIN'
        ORDER BY r.name
        LIMIT 1
    ),
    u.id,
    'active'
FROM core.users u
WHERE u.is_active = true
  AND u.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM hr.employees e
      WHERE e.linked_user_id = u.id AND e.organization_id = u.organization_id
  );

-- HR Manager can already approve leave (hr.leave.approve) but held none of
-- the finance.payroll.* permissions, so the HR page's Payroll pointer
-- (application code, aegis-web) would otherwise send them somewhere they
-- still can't use. Matches the existing grant pattern for these keys
-- (migrations 034/050/081/084).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('HR Manager', 'finance.payroll.read'),
    ('HR Manager', 'finance.payroll.manage'),
    ('HR Manager', 'finance.payroll.post')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
