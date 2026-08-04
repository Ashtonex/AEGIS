-- ============================================================================
-- AEGIS MIGRATION 066 — ROLE CATALOG EXPANSION
-- Full audit of core.permissions (266 keys) against every role's actual
-- grants turned up two distinct problems:
--
-- 1. Six live, working features that literally nobody could reach (not even
--    the obviously-correct existing role ever got granted the permission) -
--    same class of bug as 063/064's permission-gap fixes. One of them
--    (budgets) is a genuine double-gate bug: the router-level check requires
--    'budgets.read' while the route itself separately requires
--    'finance.budget.read' - two different keys, so Finance Manager (who
--    already holds the second) was still blocked by the first.
--
-- 2. Two job functions with no representative role at all: Sales/Marketing
--    (CRM) and HSE/Safety. CRM permissions existed only on Executive (Admin)
--    and Project Manager - too broad/wrong-department for a front-line sales
--    hire. hse_incidents had zero holders of any kind.
--
-- Also splits crm.opportunities.close into two permissions:
-- mark-opportunity-lost (pure status update, no side effect) keeps
-- 'crm.opportunities.close'; mark-opportunity-won (can INSERT a real
-- projects.projects row with a real contract_value) now requires the new
-- 'crm.opportunities.close_won' - so a Sales Executive can keep their own
-- pipeline honest (mark deals lost) without being able to unilaterally spin
-- up a real company project.
-- ============================================================================

-- New permission for the won/lost split described above.
INSERT INTO core.permissions (key, description) VALUES
    ('crm.opportunities.close_won', 'Mark a CRM opportunity as won - can create a real project with a real contract value, so held separately from ordinary opportunity-close')
ON CONFLICT (key) DO NOTHING;

-- Preserve current behavior for existing crm.opportunities.close holders,
-- plus extend to Finance Manager (co-approves quotations.decide already) and
-- Project Manager (owns the project this action can create).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)', 'crm.opportunities.close_won'),
    ('Finance Manager',   'crm.opportunities.close_won'),
    ('Project Manager',   'crm.opportunities.close_won')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- PART 1: Bug-fix grants - obviously-correct existing role, permission was
-- simply never granted.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    -- KPI Metrics (executive.kpi_metrics) - matches existing executive.view_dashboard/bi_reports.read holders
    ('Executive (Admin)', 'kpi_metrics.read'),
    ('Executive (Admin)', 'kpi_metrics.create'),
    ('Executive (Admin)', 'kpi_metrics.update'),
    ('Executive (Admin)', 'kpi_metrics.delete'),
    ('Project Manager',   'kpi_metrics.read'),
    ('Finance Manager',   'kpi_metrics.read'),

    -- Risk Register (executive.risk_register)
    ('Executive (Admin)',  'risk_register.read'),
    ('Executive (Admin)',  'risk_register.create'),
    ('Executive (Admin)',  'risk_register.update'),
    ('Executive (Admin)',  'risk_register.delete'),
    ('Project Manager',    'risk_register.read'),
    ('Project Manager',    'risk_register.create'),
    ('Project Manager',    'risk_register.update'),
    ('Compliance Officer', 'risk_register.read'),
    ('Compliance Officer', 'risk_register.create'),
    ('Compliance Officer', 'risk_register.update'),

    -- Budgets (/budgets router) - double-gate bug fix: grant budgets.* to the
    -- same roles that already hold the equivalent finance.budget.* keys.
    ('Executive (Admin)', 'budgets.read'),
    ('Executive (Admin)', 'budgets.create'),
    ('Executive (Admin)', 'budgets.update'),
    ('Executive (Admin)', 'budgets.delete'),
    ('Finance Manager',   'budgets.read'),
    ('Finance Manager',   'budgets.create'),
    ('Finance Manager',   'budgets.update'),
    ('Finance Manager',   'budgets.delete'),
    ('Project Manager',   'budgets.read'),

    -- Client Portal Tickets (crm.support_tickets, portal-facing) - the CLIENT
    -- role itself couldn't see its own submitted tickets.
    ('CLIENT', 'client_portal_tickets.read'),
    ('CLIENT', 'client_portal_tickets.create'),
    ('CLIENT', 'client_portal_tickets.update'),

    -- Supplier Records (procurement.suppliers) - parity with procurement.supplier.* holders.
    ('Procurement Manager', 'supplier_records.read'),
    ('Procurement Manager', 'supplier_records.create'),
    ('Procurement Manager', 'supplier_records.update'),
    ('Finance Manager',     'supplier_records.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Internal Messages (core.internal_messages) isn't department-specific -
-- grant to the base EMPLOYEE role so every account has it regardless of
-- functional role (a user commonly holds EMPLOYEE alongside a functional
-- role - see core/security.py's auto-provisioning comment).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.name = 'EMPLOYEE' AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'internal_messages.read', 'internal_messages.create', 'internal_messages.update', 'internal_messages.delete'
)
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================================
-- PART 2: New roles for job functions with no representative today.
-- ============================================================================

INSERT INTO core.roles (organization_id, name, description)
SELECT o.id, role_def.name, role_def.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('Sales Executive',    'Front-line CRM sales and marketing - leads, opportunities, contacts, accounts, campaigns'),
    ('HSE / Safety Officer', 'Site health, safety and environmental incident recording and tracking')
) AS role_def(name, description)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id AND r.name = role_def.name AND r.is_deleted = false
  );

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    -- Sales Executive: full working CRM access. Notably excludes
    -- crm.opportunities.close_won (creates a real project - needs PM/Finance/
    -- Exec sign-off) and crm.campaigns.send (drafts/builds campaigns, a
    -- senior reviewer sends them) and every *.delete key (destructive
    -- actions stay with Executive/PM).
    ('Sales Executive', 'crm_leads.read'),
    ('Sales Executive', 'crm_leads.create'),
    ('Sales Executive', 'crm_leads.update'),
    ('Sales Executive', 'crm_leads.qualify'),
    ('Sales Executive', 'crm.opportunities.read'),
    ('Sales Executive', 'crm.opportunities.update'),
    ('Sales Executive', 'crm.opportunities.quote'),
    ('Sales Executive', 'crm.opportunities.close'), -- mark-lost only; see close_won split above
    ('Sales Executive', 'crm_contacts.read'),
    ('Sales Executive', 'crm_contacts.create'),
    ('Sales Executive', 'crm_contacts.update'),
    ('Sales Executive', 'crm_organizations.read'),
    ('Sales Executive', 'crm_organizations.create'),
    ('Sales Executive', 'crm_organizations.update'),
    ('Sales Executive', 'crm_activities.read'),
    ('Sales Executive', 'crm_activities.create'),
    ('Sales Executive', 'crm_activities.update'),
    ('Sales Executive', 'crm_communications.read'),
    ('Sales Executive', 'crm_communications.create'),
    ('Sales Executive', 'crm_communications.update'),
    ('Sales Executive', 'crm.marketing.read'),
    ('Sales Executive', 'crm.marketing.create'),
    ('Sales Executive', 'crm.marketing.update'),
    ('Sales Executive', 'crm.campaigns.read'),
    ('Sales Executive', 'crm.campaigns.create'),
    ('Sales Executive', 'crm.campaigns.update'),
    ('Sales Executive', 'crm.templates.read'),
    ('Sales Executive', 'crm.templates.create'),
    ('Sales Executive', 'crm.templates.update'),
    ('Sales Executive', 'crm.segments.read'),
    ('Sales Executive', 'crm.segments.create'),
    ('Sales Executive', 'crm.segments.update'),
    ('Sales Executive', 'crm.customer360.read'),
    ('Sales Executive', 'crm.reports.read'),
    ('Sales Executive', 'documents.read'),
    ('Sales Executive', 'documents.create'),

    -- HSE / Safety Officer
    ('HSE / Safety Officer', 'hse_incidents.read'),
    ('HSE / Safety Officer', 'hse_incidents.create'),
    ('HSE / Safety Officer', 'hse_incidents.update'),
    ('HSE / Safety Officer', 'hse_incidents.delete'),
    ('HSE / Safety Officer', 'compliance_items.read'),
    ('HSE / Safety Officer', 'documents.read'),
    ('HSE / Safety Officer', 'documents.create')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
