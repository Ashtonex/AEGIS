-- ============================================================================
-- CRM Executive (Admin) CRUD completion
-- ============================================================================
-- Extending the Settings PAGE_ACCESS audit method to every require_permission
-- key actually enforced across the CRM routers (crm.py, crm_leads.py,
-- crm_contacts.py, crm_organizations.py, crm_activities.py,
-- crm_communications.py, crm_automations.py, crm_lifecycle.py,
-- crm_import_export.py, documents.py) turned up a single consistent pattern:
-- Executive (Admin) has read/create/update for every CRM resource, but the
-- "top of the CRUD chain" action for each was left out of whatever migration
-- originally granted the rest - delete on leads/contacts/organizations/
-- activities, update on communications/support tickets/documents, send on
-- campaigns, execute on automations, and configure on SLA policies. None of
-- these had ever been granted to any non-SUPERADMIN role at all.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm_leads.delete'),
    ('Executive (Admin)', 'crm_contacts.delete'),
    ('Executive (Admin)', 'crm_organizations.delete'),
    ('Executive (Admin)', 'crm_activities.delete'),
    ('Executive (Admin)', 'crm_communications.update'),
    ('Executive (Admin)', 'crm.campaigns.send'),
    ('Executive (Admin)', 'crm.support.update'),
    ('Executive (Admin)', 'documents.update'),
    ('Executive (Admin)', 'crm.admin.configure'),
    ('Executive (Admin)', 'crm.automations.execute')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
