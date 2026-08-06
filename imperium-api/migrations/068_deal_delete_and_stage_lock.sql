-- ============================================================================
-- AEGIS MIGRATION 068 — DEAL DELETE + STAGE-LOCK PERMISSIONS
-- ============================================================================
-- 1. Bug fix: migration 066 created the 'Sales Executive' role and granted it
--    dot-style opportunity keys ('crm.opportunities.read'/'update') that no
--    router actually checks. crm.py's list/create/update opportunity routes
--    check the older underscore-style keys ('crm.view_opportunities',
--    'crm.create_opportunities', 'crm.update_opportunities' - see 003/030),
--    which were only ever granted to Executive (Admin)/Project Manager/
--    Finance Manager (051). Sales Executive has therefore been unable to
--    view, create, or update opportunities since the role was introduced.
--
-- 2. New permission 'crm.opportunities.delete' so duplicate/junk deals can be
--    removed - opportunities had no delete route at all before this
--    migration. Held by Executive (Admin), Managing Director, and Project
--    Manager, matching the existing "destructive actions stay with
--    Executive/PM" pattern used for crm_leads.delete etc (060/066). Also
--    backfills 'crm_leads.delete' onto Managing Director, which 060 missed.
--
-- 3. New override permissions so that once a deal/lead has been decided
--    (opportunity stage Contract/Lost, lead status converted/disqualified),
--    only Admin/Executive/Managing Director can change its state again -
--    front-line Sales Executives can still freely work deals up to that
--    point, but can't reopen or re-stage something already closed out.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('crm.opportunities.delete', 'Delete (soft-delete) a CRM opportunity - used for removing duplicate/junk deals'),
    ('crm.opportunities.override_stage', 'Change the stage of an opportunity that is already won (Contract) or lost - reopening/re-staging a closed deal'),
    ('crm_leads.override_status', 'Change the status of a lead that is already converted (qualified) or disqualified')
ON CONFLICT (key) DO NOTHING;

-- Part 1: fix the Sales Executive opportunity permission mismatch.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'Sales Executive' AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'crm.view_opportunities', 'crm.create_opportunities', 'crm.update_opportunities'
)
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Part 2: opportunity delete, held by the same roles as other CRM delete keys.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',   'crm.opportunities.delete'),
    ('Managing Director',   'crm.opportunities.delete'),
    ('Project Manager',     'crm.opportunities.delete'),
    ('Managing Director',   'crm_leads.delete')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Part 3: stage/status override, restricted to Admin/Executive/Managing Director.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',  'crm.opportunities.override_stage'),
    ('Managing Director',  'crm.opportunities.override_stage'),
    ('Executive (Admin)',  'crm_leads.override_status'),
    ('Managing Director',  'crm_leads.override_status')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
