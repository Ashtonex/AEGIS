-- ============================================================================
-- CRM Associate: add tender update access (edit fields + drag-to-change-stage)
-- ============================================================================
-- 108_crm_associate_tender_access.sql granted view + create. Both "edit a
-- tender's fields" (the Deal Parameters form) and "drag a tender card to
-- another stage column" on the tenders kanban go through the exact same
-- call - updateCrmTender() -> PUT /api/v1/tender-bids/{id} - gated by a
-- single permission, tender_bids.update (both the tender_bids router's own
-- per-endpoint check and its router-level require_resource_permission
-- gate use this same key for PUT/PATCH).
-- ============================================================================

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'tender_bids.update'
WHERE r.name = 'CRM Associate' AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
