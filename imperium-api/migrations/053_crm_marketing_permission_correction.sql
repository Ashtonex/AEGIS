-- ============================================================================
-- CRM marketing/templates permission correction
-- ============================================================================
-- 052_crm_templates_permission_gap_fix.sql granted crm.templates.read/create/
-- update, but verified against the live router code those keys are never
-- actually checked anywhere - GET/POST /api/v1/crm/templates and
-- GET /api/v1/crm/nurture-sequences all require crm.marketing.read /
-- crm.marketing.create instead. Grant the permissions that are actually
-- enforced.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm.marketing.read'),
    ('Executive (Admin)', 'crm.marketing.create'),
    ('Executive (Admin)', 'crm.marketing.update'),
    ('Project Manager', 'crm.marketing.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
