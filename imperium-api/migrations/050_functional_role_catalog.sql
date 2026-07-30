-- ============================================================================
-- Functional role catalog reconciliation
-- ============================================================================
-- The frontend's RBACGuard components gate ~15 dashboard pages behind
-- functional role names (e.g. "Finance Manager", "Site Agent") that never
-- existed as core.roles rows - only CLIENT, EMPLOYEE, SUPERADMIN and SUPPLIER
-- did. That made those pages unreachable by design intent for anyone except
-- SUPERADMIN (see 049_executive_dashboard_permission_repair.sql, which could
-- only grant executive.view_dashboard to SUPERADMIN for the same reason).
--
-- This migration creates the missing roles per organization and grants each
-- one the read/write permissions matching the pages it's allowed to see in
-- the frontend today (cross-referenced against each router's actual
-- require_permission() keys). It does not assign any existing user to a new
-- role - which employee holds which functional title is a business decision
-- for an org admin to make via the users/roles admin UI, not something to
-- infer here.
--
-- Note: aegis-web/src/app/dashboard/inventory/page.tsx previously said
-- "Store Keeper" while site-operations/page.tsx said "Storekeeper" for the
-- same job function - the frontend was fixed to use "Storekeeper"
-- consistently, so only one role is created for it.

INSERT INTO core.roles (organization_id, name, description)
SELECT o.id, role_def.name, role_def.description
FROM core.organizations o
CROSS JOIN (VALUES
    ('Executive (Admin)', 'Organization-wide read access across all operational dashboards'),
    ('Project Manager', 'Cross-functional project delivery oversight'),
    ('Finance Manager', 'Cash, payroll, budget and financial performance management'),
    ('HR Manager', 'Workforce and HR records management, leave approval'),
    ('HR Officer', 'HR records and leave/attendance administration'),
    ('Compliance Officer', 'Compliance obligations, corrective actions and deployment gates'),
    ('Internal Auditor', 'Read-only compliance and audit visibility'),
    ('Site Agent', 'Site operations, inventory movement and site documentation'),
    ('Site Clerk', 'Site operations and inventory recording'),
    ('Storekeeper', 'Inventory and store management'),
    ('Quantity Surveyor', 'Inventory, cost and claims visibility'),
    ('Fleet Supervisor', 'Fleet assignment, fuel, maintenance and utilization tracking'),
    ('Equipment Manager', 'Equipment asset and maintenance schedule management'),
    ('Site Manager', 'Site-level equipment and operations visibility'),
    ('Procurement Manager', 'Requisitions, purchase orders, RFQs, invoices and GRNs')
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
    -- Executive (Admin): broad read visibility matching every page it appears on
    ('Executive (Admin)', 'executive.view_dashboard'),
    ('Executive (Admin)', 'bi_reports.read'),
    ('Executive (Admin)', 'automated_reports.read'),
    ('Executive (Admin)', 'automated_reports.approve'),
    ('Executive (Admin)', 'crm.reports.read'),
    ('Executive (Admin)', 'compliance_items.read'),
    ('Executive (Admin)', 'compliance.requirement.read'),
    ('Executive (Admin)', 'compliance.gate.read'),
    ('Executive (Admin)', 'compliance.corrective_action.read'),
    ('Executive (Admin)', 'inventory_items.read'),
    ('Executive (Admin)', 'inventory.item.read'),
    ('Executive (Admin)', 'documents.read'),
    ('Executive (Admin)', 'documents.create'),
    ('Executive (Admin)', 'projects.read'),
    ('Executive (Admin)', 'projects.create'),
    ('Executive (Admin)', 'projects.update'),
    ('Executive (Admin)', 'equipment_assets.read'),
    ('Executive (Admin)', 'fleet.read'),
    ('Executive (Admin)', 'hr_records.read'),
    ('Executive (Admin)', 'hr.leave.read'),
    ('Executive (Admin)', 'hr.attendance.read'),
    ('Executive (Admin)', 'procurement_orders.read'),
    ('Executive (Admin)', 'procurement.requisition.read'),
    ('Executive (Admin)', 'procurement.po.read'),
    ('Executive (Admin)', 'procurement.rfq.read'),
    ('Executive (Admin)', 'procurement.invoice.read'),
    ('Executive (Admin)', 'procurement.supplier.read'),
    ('Executive (Admin)', 'finance.cash.read'),
    ('Executive (Admin)', 'finance.payroll.read'),
    ('Executive (Admin)', 'financial_performance.read'),
    ('Executive (Admin)', 'finance.budget.read'),
    ('Executive (Admin)', 'workforce.read'),
    ('Executive (Admin)', 'site_operations.read'),

    -- Project Manager: appears on nearly every operational page
    ('Project Manager', 'workforce.read'),
    ('Project Manager', 'site_operations.read'),
    ('Project Manager', 'site_operations.create'),
    ('Project Manager', 'executive.view_dashboard'),
    ('Project Manager', 'bi_reports.read'),
    ('Project Manager', 'automated_reports.read'),
    ('Project Manager', 'crm.reports.read'),
    ('Project Manager', 'compliance_items.read'),
    ('Project Manager', 'compliance.requirement.read'),
    ('Project Manager', 'inventory_items.read'),
    ('Project Manager', 'inventory.item.read'),
    ('Project Manager', 'documents.read'),
    ('Project Manager', 'documents.create'),
    ('Project Manager', 'projects.read'),
    ('Project Manager', 'projects.update'),
    ('Project Manager', 'hr_records.read'),
    ('Project Manager', 'hr.leave.read'),
    ('Project Manager', 'procurement_orders.read'),
    ('Project Manager', 'procurement.requisition.read'),
    ('Project Manager', 'procurement.requisition.create'),
    ('Project Manager', 'procurement.po.read'),
    ('Project Manager', 'finance.cash.read'),
    ('Project Manager', 'finance.payroll.read'),
    ('Project Manager', 'financial_performance.read'),
    ('Project Manager', 'finance.budget.read'),

    -- Finance Manager
    ('Finance Manager', 'finance.cash.read'),
    ('Finance Manager', 'finance.cash.manage'),
    ('Finance Manager', 'finance.cash.post'),
    ('Finance Manager', 'finance.payroll.read'),
    ('Finance Manager', 'finance.payroll.manage'),
    ('Finance Manager', 'finance.budget.read'),
    ('Finance Manager', 'finance.budget.create'),
    ('Finance Manager', 'finance.budget.approve'),
    ('Finance Manager', 'financial_performance.read'),
    ('Finance Manager', 'financial_performance.create'),
    ('Finance Manager', 'executive.view_dashboard'),
    ('Finance Manager', 'bi_reports.read'),
    ('Finance Manager', 'automated_reports.read'),
    ('Finance Manager', 'crm.reports.read'),
    ('Finance Manager', 'documents.read'),
    ('Finance Manager', 'documents.create'),
    ('Finance Manager', 'procurement_orders.read'),
    ('Finance Manager', 'procurement.invoice.read'),
    ('Finance Manager', 'procurement.invoice.approve_payment'),

    -- HR Manager
    ('HR Manager', 'workforce.read'),
    ('HR Manager', 'workforce.create'),
    ('HR Manager', 'workforce.update'),
    ('HR Manager', 'hr_records.read'),
    ('HR Manager', 'hr_records.create'),
    ('HR Manager', 'hr_records.update'),
    ('HR Manager', 'hr.leave.read'),
    ('HR Manager', 'hr.leave.approve'),
    ('HR Manager', 'hr.attendance.read'),
    ('HR Manager', 'hr.attendance.record'),
    ('HR Manager', 'hr.payroll.read'),

    -- HR Officer
    ('HR Officer', 'hr_records.read'),
    ('HR Officer', 'hr_records.create'),
    ('HR Officer', 'hr.leave.read'),
    ('HR Officer', 'hr.leave.create'),
    ('HR Officer', 'hr.attendance.read'),
    ('HR Officer', 'hr.attendance.record'),

    -- Compliance Officer
    ('Compliance Officer', 'compliance_items.read'),
    ('Compliance Officer', 'compliance_items.create'),
    ('Compliance Officer', 'compliance_items.update'),
    ('Compliance Officer', 'compliance.requirement.read'),
    ('Compliance Officer', 'compliance.requirement.manage'),
    ('Compliance Officer', 'compliance.gate.read'),
    ('Compliance Officer', 'compliance.corrective_action.read'),
    ('Compliance Officer', 'compliance.corrective_action.create'),
    ('Compliance Officer', 'crm.reports.read'),
    ('Compliance Officer', 'automated_reports.read'),
    ('Compliance Officer', 'documents.read'),

    -- Internal Auditor: read-only
    ('Internal Auditor', 'compliance_items.read'),
    ('Internal Auditor', 'compliance.requirement.read'),
    ('Internal Auditor', 'compliance.gate.read'),
    ('Internal Auditor', 'compliance.corrective_action.read'),

    -- Site Agent
    ('Site Agent', 'site_operations.read'),
    ('Site Agent', 'site_operations.create'),
    ('Site Agent', 'site_operations.update'),
    ('Site Agent', 'inventory_items.read'),
    ('Site Agent', 'inventory.item.read'),
    ('Site Agent', 'inventory.issue.create'),
    ('Site Agent', 'inventory.receipt.create'),
    ('Site Agent', 'documents.read'),
    ('Site Agent', 'documents.create'),
    ('Site Agent', 'procurement.requisition.read'),
    ('Site Agent', 'procurement.requisition.create'),

    -- Site Clerk
    ('Site Clerk', 'site_operations.read'),
    ('Site Clerk', 'site_operations.create'),
    ('Site Clerk', 'inventory_items.read'),
    ('Site Clerk', 'inventory.item.read'),
    ('Site Clerk', 'inventory.receipt.create'),

    -- Storekeeper
    ('Storekeeper', 'inventory_items.read'),
    ('Storekeeper', 'inventory_items.create'),
    ('Storekeeper', 'inventory_items.update'),
    ('Storekeeper', 'inventory.item.read'),
    ('Storekeeper', 'inventory.item.create'),
    ('Storekeeper', 'inventory.issue.create'),
    ('Storekeeper', 'inventory.receipt.create'),
    ('Storekeeper', 'inventory.store.manage'),
    ('Storekeeper', 'site_operations.read'),

    -- Quantity Surveyor
    ('Quantity Surveyor', 'inventory_items.read'),
    ('Quantity Surveyor', 'inventory.item.read'),
    ('Quantity Surveyor', 'finance.cost.read'),
    ('Quantity Surveyor', 'finance.claim.read'),

    -- Fleet Supervisor
    ('Fleet Supervisor', 'fleet.read'),
    ('Fleet Supervisor', 'fleet.create'),
    ('Fleet Supervisor', 'fleet.update'),
    ('Fleet Supervisor', 'fleet.assignment.create'),
    ('Fleet Supervisor', 'fleet.fuel.record'),
    ('Fleet Supervisor', 'fleet.maintenance.complete'),
    ('Fleet Supervisor', 'fleet.utilization.record'),
    ('Fleet Supervisor', 'equipment_assets.read'),

    -- Equipment Manager
    ('Equipment Manager', 'equipment_assets.read'),
    ('Equipment Manager', 'equipment_assets.create'),
    ('Equipment Manager', 'equipment_assets.update'),
    ('Equipment Manager', 'maintenance_schedules.read'),
    ('Equipment Manager', 'maintenance_schedules.create'),
    ('Equipment Manager', 'fleet.read'),

    -- Site Manager
    ('Site Manager', 'equipment_assets.read'),
    ('Site Manager', 'fleet.read'),
    ('Site Manager', 'site_operations.read'),

    -- Procurement Manager
    ('Procurement Manager', 'procurement_orders.read'),
    ('Procurement Manager', 'procurement_orders.create'),
    ('Procurement Manager', 'procurement.requisition.read'),
    ('Procurement Manager', 'procurement.requisition.approve'),
    ('Procurement Manager', 'procurement.po.read'),
    ('Procurement Manager', 'procurement.po.create'),
    ('Procurement Manager', 'procurement.po.issue'),
    ('Procurement Manager', 'procurement.po.approve'),
    ('Procurement Manager', 'procurement.rfq.read'),
    ('Procurement Manager', 'procurement.rfq.create'),
    ('Procurement Manager', 'procurement.rfq.manage'),
    ('Procurement Manager', 'procurement.invoice.read'),
    ('Procurement Manager', 'procurement.invoice.create'),
    ('Procurement Manager', 'procurement.invoice.match'),
    ('Procurement Manager', 'procurement.grn.read'),
    ('Procurement Manager', 'procurement.grn.create'),
    ('Procurement Manager', 'procurement.grn.confirm'),
    ('Procurement Manager', 'procurement.supplier.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
