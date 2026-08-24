-- ============================================================================
-- Procurement Manager ownership with separation-of-duties boundaries
-- ============================================================================
-- Procurement Manager owns the Procurement, Stores & Inventory process, but
-- must not be the independent approver for purchase orders or supplier
-- payments. Keep operational access and document control; remove approval
-- permissions that conflict with the control boundary.
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'documents.read',
    'documents.create',
    'documents.link'
)
WHERE r.name = 'Procurement Manager'
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

DELETE FROM core.role_permissions rp
USING core.roles r, core.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name = 'Procurement Manager'
  AND r.is_deleted = false
  AND p.key IN (
      'procurement.po.approve',
      'procurement.invoice.approve_payment',
      'inventory.count.create'
  );
