-- ============================================================================
-- documents.delete permission
-- ============================================================================
-- routers/documents.py gained a DELETE /{document_id} endpoint (soft delete)
-- as part of the universal per-entity Documents panel work. Without a
-- registered permission, require_permission("documents.delete") would deny
-- everyone except SUPERADMIN. Granted to every role that already holds
-- documents.create, on the assumption that whoever can attach a document to
-- a record can also remove one they (or a teammate) attached in error.
-- ============================================================================

INSERT INTO core.permissions (key, description) VALUES
    ('documents.delete', 'Delete (soft-remove) a document and its entity links')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key = 'documents.delete'
ON CONFLICT (role_id, permission_id) DO NOTHING;
