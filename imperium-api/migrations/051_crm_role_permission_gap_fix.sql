-- ============================================================================
-- CRM permission gap fix
-- ============================================================================
-- Discovered via live smoke testing: 050_functional_role_catalog.sql derived
-- its role -> permission mapping from RBACGuard's allowedRoles arrays, but
-- the CRM module's pages (Leads, Opportunities, Tenders & Bids,
-- Organizations, Contacts, Subcontractors, Activities, Automations) are not
-- wrapped in RBACGuard at all - the sidebar shows them to everyone and the
-- backend's require_permission() checks are the only real gate. That meant
-- "Executive (Admin)" (and every other new role) had zero CRM permissions
-- and got a 403 creating a lead despite being the broadest admin-tier role.
--
-- Grants full CRM read/write to Executive (Admin) and Project Manager (both
-- already had crm.reports.read from 050, implying CRM visibility was
-- intended), and CRM opportunity/customer visibility to Finance Manager
-- (deal pipeline affects revenue forecasting).

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm_leads.read'),
    ('Executive (Admin)', 'crm_leads.create'),
    ('Executive (Admin)', 'crm_leads.update'),
    ('Executive (Admin)', 'crm_leads.qualify'),
    ('Executive (Admin)', 'crm_contacts.read'),
    ('Executive (Admin)', 'crm_contacts.create'),
    ('Executive (Admin)', 'crm_contacts.update'),
    ('Executive (Admin)', 'crm_organizations.read'),
    ('Executive (Admin)', 'crm_organizations.create'),
    ('Executive (Admin)', 'crm_organizations.update'),
    ('Executive (Admin)', 'crm_activities.read'),
    ('Executive (Admin)', 'crm_activities.create'),
    ('Executive (Admin)', 'crm_activities.update'),
    ('Executive (Admin)', 'crm_communications.read'),
    ('Executive (Admin)', 'crm_communications.create'),
    ('Executive (Admin)', 'crm_automations.read'),
    ('Executive (Admin)', 'crm.view_opportunities'),
    ('Executive (Admin)', 'crm.create_opportunities'),
    ('Executive (Admin)', 'crm.update_opportunities'),
    ('Executive (Admin)', 'crm.opportunities.read'),
    ('Executive (Admin)', 'crm.opportunities.update'),
    ('Executive (Admin)', 'crm.opportunities.close'),
    ('Executive (Admin)', 'crm.opportunities.quote'),
    ('Executive (Admin)', 'crm.view_tenders'),
    ('Executive (Admin)', 'crm.create_tenders'),
    ('Executive (Admin)', 'tender_bids.read'),
    ('Executive (Admin)', 'tender_bids.create'),
    ('Executive (Admin)', 'tender_bids.update'),
    ('Executive (Admin)', 'crm.view_subcontractors'),
    ('Executive (Admin)', 'crm.create_subcontractors'),
    ('Executive (Admin)', 'crm.update_subcontractors'),
    ('Executive (Admin)', 'crm.customer360.read'),
    ('Executive (Admin)', 'crm.view_accountability'),
    ('Executive (Admin)', 'crm.support.read'),
    ('Executive (Admin)', 'crm.support.create'),
    ('Executive (Admin)', 'crm.export'),
    ('Executive (Admin)', 'crm.import'),

    ('Project Manager', 'crm_leads.read'),
    ('Project Manager', 'crm_leads.create'),
    ('Project Manager', 'crm_leads.update'),
    ('Project Manager', 'crm_contacts.read'),
    ('Project Manager', 'crm_contacts.create'),
    ('Project Manager', 'crm_organizations.read'),
    ('Project Manager', 'crm_activities.read'),
    ('Project Manager', 'crm_activities.create'),
    ('Project Manager', 'crm.view_opportunities'),
    ('Project Manager', 'crm.opportunities.read'),
    ('Project Manager', 'crm.view_tenders'),
    ('Project Manager', 'tender_bids.read'),
    ('Project Manager', 'crm.customer360.read'),

    ('Finance Manager', 'crm.view_opportunities'),
    ('Finance Manager', 'crm.opportunities.read'),
    ('Finance Manager', 'crm.customer360.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
