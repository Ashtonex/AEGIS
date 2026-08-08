-- The tender_bids.delete permission already existed but was never granted to
-- any role, so Tenders & Bids had no working delete path in the UI even
-- though the backend endpoint (DELETE /tender-bids/{id}) was already there -
-- same shape as tender_bids.update, which is Executive (Admin)-only today.
-- Grant delete alongside it so duplicate/junk tenders (e.g. the pre-existing
-- PETROTRADE duplicates) can actually be cleaned up.

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN core.permissions p ON p.key = 'tender_bids.delete'
WHERE o.is_deleted = false
  AND r.name = 'Executive (Admin)'
ON CONFLICT (role_id, permission_id) DO NOTHING;
