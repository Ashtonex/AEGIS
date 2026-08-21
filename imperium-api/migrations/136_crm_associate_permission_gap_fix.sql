-- ============================================================================
-- CRM Associate: fix permission gaps blocking day-to-day CRM work
-- ============================================================================
-- 084_role_landing_pages_and_crm_associate.sql deliberately scoped CRM
-- Associate to leads + opportunities only. In practice that also silently
-- broke pages that have nothing to do with that scoping decision:
--
-- 1. Tasks (/dashboard/crm/tasks) and Teams (/dashboard/crm/teams) both load
--    via Promise.all([...,  getAssignableUsers(), getTeams()]) - a single
--    403 on any one of those calls fails the whole page, surfacing the raw
--    "Missing required permission: users.read_assignable" detail to the
--    user. crm_tasks.read/teams.read/users.read_assignable were never
--    granted to this role at all (105/106/115 granted them to the
--    documents.create tier and, separately, to EMPLOYEE by name - CRM
--    Associate is neither). list_tasks()/list_teams() already scope
--    baseline (non-_all) holders down to "assigned to me or my team", so
--    granting the baseline keys here is safe: an associate sees tasks
--    assigned to them by a manager or team lead, and a whole stack handed to
--    their team, but not the org-wide task list. crm_tasks.update is
--    included so they can actually complete/reassign their own tasks -
--    update_task() already restricts redistributing a task OUT of a team to
--    that team's lead (or crm_tasks.read_all), so this doesn't hand
--    associates the lead-only stack-redistribution action.
--
-- 2. Contacts/Organizations/Activity Log were excluded on purpose by 084 as
--    part of narrowing this role down from Sales Executive. Per updated
--    request, CRM Associates now need working access to those - the same
--    read/create/update scope Sales Executive already holds (066), not
--    delete (kept admin-only per 060).
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'users.read_assignable',
    'teams.read',
    'crm_tasks.read',
    'crm_tasks.update',
    'crm_contacts.read', 'crm_contacts.create', 'crm_contacts.update',
    'crm_organizations.read', 'crm_organizations.create', 'crm_organizations.update',
    'crm_activities.read', 'crm_activities.create', 'crm_activities.update'
)
WHERE r.name = 'CRM Associate' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
