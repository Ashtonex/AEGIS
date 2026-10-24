-- ============================================================================
-- AEGIS MIGRATION 239 — FLEET WORK ORDER APPROVAL
-- ============================================================================
-- fleet.maintenance_work_orders had an 'awaiting_approval' status and a
-- repair_approved_by column, but nothing enforced an approval: the only
-- decision endpoint (PATCH /fleet/work-orders/{id}/decision) let anyone with
-- fleet.update set any status, and repair_approved_by was never written.
--
-- POST /fleet/work-orders/{id}/approval is now the only way out of
-- 'awaiting_approval' other than cancelling. It needs the new
-- fleet.work_order.approve permission, blocks the person who raised the work
-- order from approving it, and records who decided and when.
--
-- The permission goes to the roles that already approve plant requests.
-- ============================================================================

ALTER TABLE fleet.maintenance_work_orders
    ADD COLUMN IF NOT EXISTS repair_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS repair_rejected_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS repair_rejected_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

INSERT INTO core.permissions (key, description) VALUES
    ('fleet.work_order.approve', 'Approve or reject maintenance work order repairs awaiting approval')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'fleet.work_order.approve'
WHERE r.name IN ('Executive (Admin)', 'Fleet Supervisor', 'Equipment Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
