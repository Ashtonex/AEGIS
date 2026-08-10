-- Executive (Admin) had create/update/delete on almost every CRM resource but
-- was missing the matching .read permission on 18 of them (leads, opportunities
-- detail views, contacts, activities, automations, communications, organizations,
-- campaigns, segments, marketing, support, reports, and CRM import) - discovered
-- live: the CRM Opportunities Kanban, Leads list, Contacts, and Activity log all
-- 403'd and rendered "could not be loaded" for this role, despite it being able to
-- create/edit/delete records it could not read back. Same class of gap as
-- migrations 063, 064, and 071.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'crm.campaigns.create',
    'crm.campaigns.delete',
    'crm.campaigns.read',
    'crm.campaigns.update',
    'crm.import',
    'crm.marketing.read',
    'crm.reports.read',
    'crm.segments.create',
    'crm.segments.read',
    'crm.segments.update',
    'crm.support.read',
    'crm.view_opportunities',
    'crm_activities.read',
    'crm_automations.read',
    'crm_communications.read',
    'crm_contacts.read',
    'crm_leads.read',
    'crm_organizations.read'
)
WHERE o.is_deleted = false
  AND r.name = 'Executive (Admin)'
ON CONFLICT (role_id, permission_id) DO NOTHING;
