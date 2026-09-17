-- ============================================================================
-- AEGIS MIGRATION 221 — SNC FINANCIAL DATA ROOM: SHAREPOINT SYNC
-- ============================================================================
-- Lets the Financial Data Room (finance.data_room_folders/documents, see
-- migrations/178) push uploads to, and pull files from, the org's real
-- SharePoint site instead of (or alongside, during rollout) Supabase
-- Storage. Deliberately independent of the generic Documents feature's
-- library_map (migrations/219) - the Data Room has its own 18-folder
-- taxonomy (01 CORPORATE .. 18 BANKABILITY) that doesn't match that
-- feature's library names (00_DIRECTORS .. 10_ARCHIVE), so it gets its own
-- dedicated root folder in the same connected drive instead of reusing that
-- routing table.
-- ============================================================================

-- 1. Data Room's own sync toggle + root folder pointer on the existing
-- per-organisation Microsoft 365 connection row. Kept separate from
-- sync_documents/library_map so enabling one feature never silently enables
-- the other.
ALTER TABLE core.organisation_integrations
    ADD COLUMN IF NOT EXISTS sync_data_room BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS data_room_root_drive_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS data_room_root_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS data_room_root_web_url TEXT;

-- 2. Provider columns on finance.data_room_documents, mirroring
-- core.file_attachments' provider columns (migrations/219) so a
-- provider='sharepoint' row is addressed by stable Graph IDs rather than a
-- renameable path. storage_path (NOT NULL + UNIQUE per migrations/179)
-- keeps holding the SharePoint web URL for these rows - the same
-- convention app/services/microsoft/document_service.py already uses for
-- core.file_attachments - so every existing read of storage_path keeps
-- working unchanged.
ALTER TABLE finance.data_room_documents
    ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'supabase',
    ADD COLUMN IF NOT EXISTS provider_drive_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_parent_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS sharepoint_web_url TEXT,
    ADD COLUMN IF NOT EXISTS sharepoint_etag VARCHAR(255),
    ADD COLUMN IF NOT EXISTS sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable',
    ADD COLUMN IF NOT EXISTS sync_error TEXT,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;

ALTER TABLE finance.data_room_documents
    DROP CONSTRAINT IF EXISTS chk_data_room_documents_sync_status;
ALTER TABLE finance.data_room_documents
    ADD CONSTRAINT chk_data_room_documents_sync_status
    CHECK (sync_status IN ('not_applicable', 'pending', 'syncing', 'synced', 'failed'));

-- Makes the "pull" reconcile step idempotent: an item already imported from
-- SharePoint is skipped on the next reconcile run instead of duplicated.
CREATE UNIQUE INDEX IF NOT EXISTS uq_data_room_documents_provider_item
    ON finance.data_room_documents (organization_id, provider_item_id)
    WHERE provider = 'sharepoint' AND is_deleted = false;

-- 3. Stable per-folder SharePoint identifiers, so resolving a Data Room
-- folder_path to a Graph drive/item id only walks/creates the SharePoint
-- folder tree once instead of on every upload.
ALTER TABLE finance.data_room_folders
    ADD COLUMN IF NOT EXISTS provider_drive_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_item_id VARCHAR(255);

-- 4. Permission gating the manual "Sync from SharePoint" (pull) endpoint -
-- upload/download reuse the existing finance.data_room.upload/read grants,
-- but reconciling arbitrary SharePoint content into the Data Room is closer
-- in nature to finance.data_room.manage, so it gets its own explicit key
-- granted to the same roles as that migrations/178 permission.
INSERT INTO core.permissions (key, description) VALUES
    ('finance.data_room.sharepoint_sync', 'Trigger a manual pull of new/changed files from the connected SharePoint site into the Financial Data Room')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.data_room.sharepoint_sync'
WHERE r.is_deleted = false
  AND r.name IN ('Executive (Admin)', 'Finance Manager', 'SUPERADMIN')
ON CONFLICT DO NOTHING;
