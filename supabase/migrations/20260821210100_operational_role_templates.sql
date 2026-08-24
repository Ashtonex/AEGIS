-- ============================================================================
-- AEGIS MIGRATION 142 -- OPERATIONAL ROLE TEMPLATES
-- ============================================================================
-- Adds missing non-duplicate role templates for job boundaries that are broader
-- or narrower than the existing manager roles. These are intentionally
-- unassigned: Settings -> Access Control remains the place where an admin
-- decides which user holds each role.
--
-- These roles only use existing permission keys. No new authority surface is
-- introduced here.
-- ============================================================================

INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id, role_def.name, role_def.description, role_def.landing_path
FROM core.organizations o
CROSS JOIN (VALUES
    ('Document Controller', 'Controls document filing, links, assignments and document lifecycle without broad module administration', '/dashboard/documents'),
    ('Tender / Bid Manager', 'Owns tender capture, bid preparation, pursuit coordination and tender documents before award', '/dashboard/crm/tenders'),
    ('Contracts Manager', 'Manages post-award contract controls, variations, claims, final accounts and contract evidence', '/dashboard/projects'),
    ('Commercial Manager', 'Senior commercial authority for quotations, CCB exceptions, margins, tenders, claims and final accounts', '/dashboard/quotations'),
    ('Inventory Controller', 'Senior inventory control for catalogue, stores, transfers, counts and stock movement governance', '/dashboard/inventory'),
    ('Maintenance Planner', 'Plans fleet and equipment maintenance without fleet assignment or commercial close authority', '/dashboard/fleet'),
    ('Executive Read Only', 'Read-only leadership visibility across operational, commercial, finance and compliance dashboards', '/dashboard/executive'),
    ('System Administrator', 'Tenant administration for users, roles, settings, audit evidence and website content without operational approval power', '/dashboard/settings'),
    ('Authorising Officer', 'Cross-functional approval role for controlled commercial, finance, procurement and compliance exceptions', '/dashboard/reports'),
    ('External Auditor', 'Time-boxed read-only audit visibility across projects, finance, compliance, documents and reports', '/dashboard/reports')
) AS role_def(name, description, landing_path)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1
      FROM core.roles r
      WHERE r.organization_id = o.id
        AND r.name = role_def.name
        AND r.is_deleted = false
  );

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    -- Document Controller: document lifecycle and assignment plumbing.
    ('Document Controller', 'documents.read'),
    ('Document Controller', 'documents.create'),
    ('Document Controller', 'documents.update'),
    ('Document Controller', 'documents.delete'),
    ('Document Controller', 'documents.link'),
    ('Document Controller', 'assignments.manage'),
    ('Document Controller', 'users.read_assignable'),
    ('Document Controller', 'teams.read'),
    ('Document Controller', 'crm_tasks.read'),
    ('Document Controller', 'crm_tasks.update'),

    -- Tender / Bid Manager: tender and bid preparation, not final award.
    ('Tender / Bid Manager', 'crm.view_tenders'),
    ('Tender / Bid Manager', 'crm.create_tenders'),
    ('Tender / Bid Manager', 'tender_bids.read'),
    ('Tender / Bid Manager', 'tender_bids.create'),
    ('Tender / Bid Manager', 'tender_bids.update'),
    ('Tender / Bid Manager', 'crm_leads.read'),
    ('Tender / Bid Manager', 'crm.view_opportunities'),
    ('Tender / Bid Manager', 'crm.opportunities.read'),
    ('Tender / Bid Manager', 'quotations.read'),
    ('Tender / Bid Manager', 'quotations.create'),
    ('Tender / Bid Manager', 'quotations.update'),
    ('Tender / Bid Manager', 'documents.read'),
    ('Tender / Bid Manager', 'documents.create'),
    ('Tender / Bid Manager', 'documents.link'),
    ('Tender / Bid Manager', 'crm_tasks.read'),
    ('Tender / Bid Manager', 'crm_tasks.create'),
    ('Tender / Bid Manager', 'crm_tasks.update'),
    ('Tender / Bid Manager', 'pursuits.read'),
    ('Tender / Bid Manager', 'pursuits.update'),
    ('Tender / Bid Manager', 'pursuit_teams.read'),
    ('Tender / Bid Manager', 'pursuit_teams.manage'),
    ('Tender / Bid Manager', 'users.read_assignable'),
    ('Tender / Bid Manager', 'teams.read'),
    ('Tender / Bid Manager', 'assignments.manage'),

    -- Contracts Manager: post-award contract administration.
    ('Contracts Manager', 'projects.read'),
    ('Contracts Manager', 'projects.update'),
    ('Contracts Manager', 'documents.read'),
    ('Contracts Manager', 'documents.create'),
    ('Contracts Manager', 'documents.update'),
    ('Contracts Manager', 'documents.link'),
    ('Contracts Manager', 'finance.variation.read'),
    ('Contracts Manager', 'finance.variation.create'),
    ('Contracts Manager', 'finance.variation.approve'),
    ('Contracts Manager', 'finance.claim.read'),
    ('Contracts Manager', 'finance.claim.create'),
    ('Contracts Manager', 'finance.claim.certify'),
    ('Contracts Manager', 'finance.final_account.read'),
    ('Contracts Manager', 'finance.final_account.prepare'),
    ('Contracts Manager', 'compliance_items.read'),
    ('Contracts Manager', 'compliance.requirement.read'),
    ('Contracts Manager', 'risk_register.read'),
    ('Contracts Manager', 'risk_register.create'),
    ('Contracts Manager', 'risk_register.update'),
    ('Contracts Manager', 'crm_tasks.read'),
    ('Contracts Manager', 'crm_tasks.create'),
    ('Contracts Manager', 'crm_tasks.update'),
    ('Contracts Manager', 'assignments.manage'),
    ('Contracts Manager', 'users.read_assignable'),

    -- Commercial Manager: commercial authority short of system administration.
    ('Commercial Manager', 'crm.view_opportunities'),
    ('Commercial Manager', 'crm.opportunities.read'),
    ('Commercial Manager', 'crm.opportunities.update'),
    ('Commercial Manager', 'crm.opportunities.close'),
    ('Commercial Manager', 'crm.opportunities.close_won'),
    ('Commercial Manager', 'crm.view_tenders'),
    ('Commercial Manager', 'tender_bids.read'),
    ('Commercial Manager', 'tender_bids.update'),
    ('Commercial Manager', 'tender_bids.award'),
    ('Commercial Manager', 'quotations.read'),
    ('Commercial Manager', 'quotations.create'),
    ('Commercial Manager', 'quotations.update'),
    ('Commercial Manager', 'quotations.approve_ccb_override'),
    ('Commercial Manager', 'quotations.manage_rate_intelligence'),
    ('Commercial Manager', 'finance.cost.read'),
    ('Commercial Manager', 'finance.forecast.read'),
    ('Commercial Manager', 'finance.commitment.read'),
    ('Commercial Manager', 'finance.variation.read'),
    ('Commercial Manager', 'finance.variation.approve'),
    ('Commercial Manager', 'finance.claim.read'),
    ('Commercial Manager', 'finance.claim.certify'),
    ('Commercial Manager', 'finance.final_account.read'),
    ('Commercial Manager', 'finance.final_account.prepare'),
    ('Commercial Manager', 'finance.final_account.agree'),
    ('Commercial Manager', 'documents.read'),
    ('Commercial Manager', 'documents.create'),
    ('Commercial Manager', 'bi_reports.read'),
    ('Commercial Manager', 'automated_reports.read'),
    ('Commercial Manager', 'kpi_metrics.read'),

    -- Inventory Controller: stock governance without procurement spend approval.
    ('Inventory Controller', 'inventory_items.read'),
    ('Inventory Controller', 'inventory_items.create'),
    ('Inventory Controller', 'inventory_items.update'),
    ('Inventory Controller', 'inventory_items.delete'),
    ('Inventory Controller', 'inventory.item.read'),
    ('Inventory Controller', 'inventory.item.create'),
    ('Inventory Controller', 'inventory.issue.create'),
    ('Inventory Controller', 'inventory.receipt.create'),
    ('Inventory Controller', 'inventory.store.manage'),
    ('Inventory Controller', 'inventory.transfer.create'),
    ('Inventory Controller', 'inventory.count.create'),
    ('Inventory Controller', 'procurement.supplier.read'),
    ('Inventory Controller', 'documents.read'),

    -- Maintenance Planner: maintenance scheduling and work order planning.
    ('Maintenance Planner', 'fleet.read'),
    ('Maintenance Planner', 'equipment_assets.read'),
    ('Maintenance Planner', 'maintenance_schedules.read'),
    ('Maintenance Planner', 'maintenance_schedules.create'),
    ('Maintenance Planner', 'maintenance_schedules.update'),
    ('Maintenance Planner', 'fleet.maintenance.complete'),
    ('Maintenance Planner', 'documents.read'),
    ('Maintenance Planner', 'documents.create'),

    -- Executive Read Only: leadership visibility only.
    ('Executive Read Only', 'executive.view_dashboard'),
    ('Executive Read Only', 'projects.read'),
    ('Executive Read Only', 'site_operations.read'),
    ('Executive Read Only', 'workforce.read'),
    ('Executive Read Only', 'fleet.read'),
    ('Executive Read Only', 'equipment_assets.read'),
    ('Executive Read Only', 'maintenance_schedules.read'),
    ('Executive Read Only', 'inventory_items.read'),
    ('Executive Read Only', 'inventory.item.read'),
    ('Executive Read Only', 'procurement.requisition.read'),
    ('Executive Read Only', 'procurement.po.read'),
    ('Executive Read Only', 'procurement.rfq.read'),
    ('Executive Read Only', 'procurement.invoice.read'),
    ('Executive Read Only', 'procurement.supplier.read'),
    ('Executive Read Only', 'finance.cost.read'),
    ('Executive Read Only', 'finance.forecast.read'),
    ('Executive Read Only', 'finance.commitment.read'),
    ('Executive Read Only', 'finance.budget.read'),
    ('Executive Read Only', 'finance.bank.read'),
    ('Executive Read Only', 'finance.final_account.read'),
    ('Executive Read Only', 'financial_performance.read'),
    ('Executive Read Only', 'compliance_items.read'),
    ('Executive Read Only', 'compliance.requirement.read'),
    ('Executive Read Only', 'compliance.gate.read'),
    ('Executive Read Only', 'compliance.corrective_action.read'),
    ('Executive Read Only', 'hse_incidents.read'),
    ('Executive Read Only', 'documents.read'),
    ('Executive Read Only', 'bi_reports.read'),
    ('Executive Read Only', 'automated_reports.read'),
    ('Executive Read Only', 'kpi_metrics.read'),
    ('Executive Read Only', 'risk_register.read'),
    ('Executive Read Only', 'crm.reports.read'),
    ('Executive Read Only', 'crm.view_opportunities'),
    ('Executive Read Only', 'crm.opportunities.read'),
    ('Executive Read Only', 'crm.view_tenders'),
    ('Executive Read Only', 'tender_bids.read'),
    ('Executive Read Only', 'crm.customer360.read'),

    -- System Administrator: tenant administration, not operational approvals.
    ('System Administrator', 'settings.read'),
    ('System Administrator', 'settings.update'),
    ('System Administrator', 'settings.audit.read'),
    ('System Administrator', 'website_content.read'),
    ('System Administrator', 'website_content.update'),
    ('System Administrator', 'users.read_all'),
    ('System Administrator', 'users.update'),
    ('System Administrator', 'users.delete'),
    ('System Administrator', 'users.assign_role'),
    ('System Administrator', 'users.read_assignable'),
    ('System Administrator', 'teams.read'),
    ('System Administrator', 'teams.manage'),

    -- Authorising Officer: explicit approval surface, no broad editing/admin.
    ('Authorising Officer', 'procurement.requisition.read'),
    ('Authorising Officer', 'procurement.requisition.approve'),
    ('Authorising Officer', 'procurement.po.read'),
    ('Authorising Officer', 'procurement.po.approve'),
    ('Authorising Officer', 'procurement.invoice.read'),
    ('Authorising Officer', 'procurement.invoice.approve_payment'),
    ('Authorising Officer', 'finance.budget.read'),
    ('Authorising Officer', 'finance.budget.approve'),
    ('Authorising Officer', 'finance.variation.read'),
    ('Authorising Officer', 'finance.variation.approve'),
    ('Authorising Officer', 'finance.claim.read'),
    ('Authorising Officer', 'finance.claim.certify'),
    ('Authorising Officer', 'finance.final_account.read'),
    ('Authorising Officer', 'finance.final_account.agree'),
    ('Authorising Officer', 'quotations.read'),
    ('Authorising Officer', 'quotations.approve_ccb_override'),
    ('Authorising Officer', 'crm.opportunities.read'),
    ('Authorising Officer', 'crm.opportunities.close_won'),
    ('Authorising Officer', 'tender_bids.read'),
    ('Authorising Officer', 'tender_bids.award'),
    ('Authorising Officer', 'compliance.gate.read'),
    ('Authorising Officer', 'compliance.gate.override'),
    ('Authorising Officer', 'documents.read'),
    ('Authorising Officer', 'automated_reports.read'),
    ('Authorising Officer', 'automated_reports.approve'),

    -- External Auditor: read-only evidence access.
    ('External Auditor', 'projects.read'),
    ('External Auditor', 'documents.read'),
    ('External Auditor', 'finance.cost.read'),
    ('External Auditor', 'finance.forecast.read'),
    ('External Auditor', 'finance.commitment.read'),
    ('External Auditor', 'finance.budget.read'),
    ('External Auditor', 'finance.final_account.read'),
    ('External Auditor', 'financial_performance.read'),
    ('External Auditor', 'procurement.requisition.read'),
    ('External Auditor', 'procurement.po.read'),
    ('External Auditor', 'procurement.rfq.read'),
    ('External Auditor', 'procurement.invoice.read'),
    ('External Auditor', 'compliance_items.read'),
    ('External Auditor', 'compliance.requirement.read'),
    ('External Auditor', 'compliance.gate.read'),
    ('External Auditor', 'compliance.corrective_action.read'),
    ('External Auditor', 'hse_incidents.read'),
    ('External Auditor', 'risk_register.read'),
    ('External Auditor', 'bi_reports.read'),
    ('External Auditor', 'automated_reports.read'),
    ('External Auditor', 'settings.audit.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
