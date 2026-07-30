-- ============================================================================
-- CRM automations permission gap fix
-- ============================================================================
-- Discovered via live testing: the Automations Engine page's "Create Workflow"
-- button calls POST /api/v1/crm-automations/, which is mounted with
-- require_resource_permission("crm_automations") in main.py - deriving
-- crm_automations.create for POST. That permission (and .update/.delete) was
-- never granted to any non-SUPERADMIN role; Executive (Admin) only had
-- crm_automations.read, so every attempt to create/edit/delete a rule
-- returned 403.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm_automations.create'),
    ('Executive (Admin)', 'crm_automations.update'),
    ('Executive (Admin)', 'crm_automations.delete')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
