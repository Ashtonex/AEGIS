-- Full-catalog audit (triggered by the CRM read-gap found in migration 072)
-- showed Executive (Admin) is missing 135 of the org's 271 permissions -
-- roughly half the catalog, spanning nearly every module. Most of those are
-- create/update/delete/approve actions that are a real access-policy call,
-- not a bug, and are deliberately NOT touched here.
--
-- This migration only grants the subset that is unambiguously a visibility
-- bug for a role literally named "Executive (Admin)": the 23 remaining
-- .read/.view permissions across Fleet, Finance, HR, Procurement, Site
-- Operations, Documents, HSE, Workforce, Equipment, Maintenance, Supplier
-- Records, Website Enquiries, Client Portal, Internal Messages, Analytics,
-- and Settings. Same class of gap as migrations 063, 064, 071, and 072 -
-- read access denied while the matching write/action permissions were
-- already granted.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key IN (
    'analytics.exceptions.read',
    'client_portal_tickets.read',
    'documents.read',
    'equipment_assets.read',
    'finance.bank.read',
    'finance.commitment.read',
    'finance.cost.read',
    'finance.cost.view',
    'finance.forecast.read',
    'fleet.profitability.view',
    'fleet.read',
    'hr.payroll.read',
    'hse_incidents.read',
    'internal_messages.read',
    'maintenance_schedules.read',
    'procurement.grn.read',
    'procurement.requisition.read',
    'settings.read',
    'site_operations.daily_report.read',
    'site_operations.read',
    'supplier_records.read',
    'website_enquiries.read',
    'workforce.read'
)
WHERE o.is_deleted = false
  AND r.name = 'Executive (Admin)'
ON CONFLICT (role_id, permission_id) DO NOTHING;
