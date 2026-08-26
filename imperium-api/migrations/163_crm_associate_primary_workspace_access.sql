-- ============================================================================
-- CRM Associate primary workspace and full CRM working access
-- ============================================================================
-- CRM Associates can also hold operational visibility roles such as Quantity
-- Surveyor. Login routing now resolves the primary role before choosing a
-- portal, so the role landing path must point at the CRM workspace, not a
-- site/commercial-control portal.
--
-- This migration also broadens CRM Associate from the original narrow
-- leads/opportunities-only role into a working CRM operator role. Destructive
-- delete permissions and executive/admin settings are deliberately excluded.
-- ============================================================================

UPDATE core.roles
SET default_landing_path = '/dashboard/crm',
    description = 'Front-line CRM operator for leads, opportunities, activities, communications, tasks, campaigns, support and CRM documents'
WHERE name = 'CRM Associate'
  AND is_deleted = false;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'crm_leads.read',
    'crm_leads.create',
    'crm_leads.update',
    'crm_leads.qualify',
    'crm.view_opportunities',
    'crm.create_opportunities',
    'crm.update_opportunities',
    'crm.opportunities.read',
    'crm.opportunities.update',
    'crm.opportunities.quote',
    'crm.opportunities.close',
    'crm.view_tenders',
    'crm.create_tenders',
    'crm.update_tenders',
    'crm_contacts.read',
    'crm_contacts.create',
    'crm_contacts.update',
    'crm_organizations.read',
    'crm_organizations.create',
    'crm_organizations.update',
    'crm_activities.read',
    'crm_activities.create',
    'crm_activities.update',
    'crm_communications.read',
    'crm_communications.create',
    'crm_communications.update',
    'crm.marketing.read',
    'crm.marketing.create',
    'crm.marketing.update',
    'crm.campaigns.read',
    'crm.campaigns.create',
    'crm.campaigns.update',
    'crm.templates.read',
    'crm.templates.create',
    'crm.templates.update',
    'crm.segments.read',
    'crm.segments.create',
    'crm.segments.update',
    'crm.customer360.read',
    'crm.reports.read',
    'crm.view_subcontractors',
    'crm.create_subcontractors',
    'crm.update_subcontractors',
    'crm_automations.read',
    'crm_automations.create',
    'crm_automations.update',
    'crm.automations.execute',
    'crm.support.read',
    'crm.support.create',
    'crm.support.update',
    'client_portal_tickets.read',
    'client_portal_tickets.create',
    'client_portal_tickets.update',
    'crm.import',
    'crm.export',
    'documents.read',
    'documents.create',
    'users.read_assignable',
    'teams.read',
    'crm_tasks.read',
    'crm_tasks.update'
)
WHERE r.name = 'CRM Associate'
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
