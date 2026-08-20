-- ============================================================================
-- Procurement Associate and Fleet Clerk - junior/associate tiers
-- ============================================================================
-- Both procurement and fleet currently have exactly one role each
-- (Procurement Manager, Fleet Supervisor), and both are full-power roles that
-- can approve/issue spend or edit fleet/asset records. There's no lighter
-- tier for a junior buyer or a driver/clerk who only needs to read status and
-- log routine activity - same gap CRM Associate (066/084) filled under Sales
-- Executive.
--
-- Procurement Associate: read across requisitions/RFQs/POs/suppliers/vendor
-- rates, plus grn.create (logging a goods receipt is routine data entry, not
-- a spend commitment). Excludes requisition.approve, po.approve/issue,
-- rfq.create/manage, and invoice.create/match - those stay with Procurement
-- Manager.
--
-- Fleet Clerk: fleet.read plus fuel/utilization recording only. Excludes
-- fleet.create/update, fleet.assignment.create, and maintenance.complete -
-- those stay with Fleet Supervisor.
-- ============================================================================

INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id, role_def.name, role_def.description, role_def.landing_path
FROM core.organizations o
CROSS JOIN (VALUES
    ('Procurement Associate', 'Junior procurement support - reads requisitions/RFQs/POs/suppliers, logs goods receipts - no approve, issue, or spend-commitment power', '/dashboard/procurement'),
    ('Fleet Clerk',            'Records fuel and utilization only - no fleet record edits, assignments, or maintenance sign-off', '/dashboard/fleet')
) AS role_def(name, description, landing_path)
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
    ('Procurement Associate', 'procurement.requisition.read'),
    ('Procurement Associate', 'procurement.rfq.read'),
    ('Procurement Associate', 'procurement.po.read'),
    ('Procurement Associate', 'procurement.supplier.read'),
    ('Procurement Associate', 'procurement.vendor_rate.read'),
    ('Procurement Associate', 'procurement.grn.create'),
    ('Procurement Associate', 'procurement.invoice.read'),

    ('Fleet Clerk', 'fleet.read'),
    ('Fleet Clerk', 'fleet.fuel.record'),
    ('Fleet Clerk', 'fleet.utilization.record')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
