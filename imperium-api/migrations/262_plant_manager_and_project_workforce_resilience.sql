-- ============================================================================
-- AEGIS MIGRATION 262 — PLANT MANAGER & PROJECT WORKFORCE RESILIENCE
-- ============================================================================
-- Ensures all fleet, plant, and site execution roles (including Plant Manager,
-- Equipment Manager, Fleet Supervisor, Site Agent, Site Engineer, Project Manager)
-- have comprehensive permissions for plant requests, fleet utilization, and
-- workforce operations without 403 authorization failures.
-- ============================================================================

-- 1. Ensure core permissions exist
INSERT INTO core.permissions (key, description) VALUES
    ('fleet.plant_requests.read',    'View Plant & Equipment lifecycle requests'),
    ('fleet.plant_requests.create',  'Create Plant & Equipment requests'),
    ('fleet.plant_requests.update',  'Validate, reserve, dispatch and return Plant & Equipment requests'),
    ('fleet.plant_requests.approve', 'Approve Plant & Equipment allocations and commercial terms'),
    ('fleet.plant_requests.close',   'Close Plant & Equipment financial reconciliation'),
    ('fleet.read',                   'View fleet inventory and plant assets'),
    ('fleet.manage',                 'Manage fleet equipment and allocations')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant permissions to Plant Manager and Fleet operational roles
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    -- Plant Manager / Equipment Manager / Fleet Manager / Fleet Supervisor
    ('Plant Manager',      'fleet.plant_requests.read'),
    ('Plant Manager',      'fleet.plant_requests.create'),
    ('Plant Manager',      'fleet.plant_requests.update'),
    ('Plant Manager',      'fleet.plant_requests.approve'),
    ('Plant Manager',      'fleet.plant_requests.close'),
    ('Plant Manager',      'fleet.read'),
    ('Plant Manager',      'fleet.manage'),

    ('Equipment Manager',  'fleet.plant_requests.read'),
    ('Equipment Manager',  'fleet.plant_requests.create'),
    ('Equipment Manager',  'fleet.plant_requests.update'),
    ('Equipment Manager',  'fleet.plant_requests.approve'),
    ('Equipment Manager',  'fleet.plant_requests.close'),
    ('Equipment Manager',  'fleet.read'),
    ('Equipment Manager',  'fleet.manage'),

    ('Fleet Supervisor',   'fleet.plant_requests.read'),
    ('Fleet Supervisor',   'fleet.plant_requests.create'),
    ('Fleet Supervisor',   'fleet.plant_requests.update'),
    ('Fleet Supervisor',   'fleet.plant_requests.approve'),
    ('Fleet Supervisor',   'fleet.plant_requests.close'),
    ('Fleet Supervisor',   'fleet.read'),
    ('Fleet Supervisor',   'fleet.manage'),

    ('Fleet Clerk',        'fleet.plant_requests.read'),
    ('Fleet Clerk',        'fleet.plant_requests.create'),
    ('Fleet Clerk',        'fleet.read'),

    -- Site leadership who can request plant
    ('Project Manager',    'fleet.plant_requests.read'),
    ('Project Manager',    'fleet.plant_requests.create'),
    ('Project Manager',    'fleet.plant_requests.update'),
    ('Project Manager',    'fleet.read'),

    ('Site Agent',         'fleet.plant_requests.read'),
    ('Site Agent',         'fleet.plant_requests.create'),
    ('Site Agent',         'fleet.read'),

    ('Site Engineer',      'fleet.plant_requests.read'),
    ('Site Engineer',      'fleet.plant_requests.create'),
    ('Site Engineer',      'fleet.read'),

    ('Commercial Manager', 'fleet.plant_requests.read'),
    ('Commercial Manager', 'fleet.plant_requests.create'),
    ('Commercial Manager', 'fleet.plant_requests.approve'),
    ('Commercial Manager', 'fleet.read')
) AS v(role_name, perm_key) ON r.name ILIKE v.role_name
JOIN core.permissions p ON p.key = v.perm_key
ON CONFLICT (role_id, permission_id) DO NOTHING;
