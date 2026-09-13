-- ============================================================================
-- MICROSOFT 365 / GRAPH INTEGRATION - FOUNDATION (Phase 1)
-- ============================================================================
-- Adds the schema needed for AEGIS to treat SharePoint as the durable
-- business-document store and Microsoft Calendar as the scheduling layer,
-- while Supabase keeps owning application data, auth and workflow state.
--
-- Design notes:
--   - No client secret / certificate / refresh token is ever stored in a
--     table. Those live in server environment variables only (see
--     core/config.py MICROSOFT_GRAPH_* settings and docs/microsoft365-phase1/
--     SETUP_GUIDE.md). This table only stores non-secret identifiers
--     (tenant/site/drive/calendar IDs) needed to address the right Microsoft
--     resource per organisation.
--   - core.file_attachments (the existing Supabase-Storage-backed table used
--     by core.documents/core.document_links across leads, opportunities,
--     tenders, projects, fleet and machinery - see migrations/001, 006, 021,
--     076) gets provider columns rather than a parallel document table, so
--     every existing Documents panel keeps working unchanged for
--     provider='supabase' rows and just gains SharePoint fields for
--     provider='sharepoint' rows.
--   - Retry/dead-letter handling deliberately reuses core.domain_events +
--     core.event_receipts + core.event_dispatch_attempts (see migrations/021
--     and app/services/workforce_events.py's dispatch_workforce_events) via a
--     'microsoft.%' event_type prefix, instead of inventing a second outbox.
-- ============================================================================

-- 1. Per-organisation Microsoft 365 connection configuration.
CREATE TABLE IF NOT EXISTS core.organisation_integrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    provider VARCHAR(40) NOT NULL DEFAULT 'microsoft365',

    -- Non-secret Microsoft identifiers (see Phase 4/25 discovery flow).
    tenant_id VARCHAR(120),
    site_id VARCHAR(255),
    site_name VARCHAR(255),
    site_web_url TEXT,
    drive_id VARCHAR(255),
    calendar_owner_id VARCHAR(255),
    calendar_id VARCHAR(255),
    calendar_name VARCHAR(255),
    calendar_timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Harare',

    -- module -> {drive_id, item_id, web_url} for the top-level SharePoint
    -- library folders (00_DIRECTORS .. 10_ARCHIVE) discovered/selected during
    -- setup. Kept as JSONB rather than a rigid column set since the library
    -- list is organisation-configurable, not hardcoded to SNC.
    library_map JSONB NOT NULL DEFAULT '{}'::jsonb,

    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    sync_documents BOOLEAN NOT NULL DEFAULT FALSE,
    sync_calendar BOOLEAN NOT NULL DEFAULT FALSE,

    connection_status VARCHAR(40) NOT NULL DEFAULT 'not_connected'
        CHECK (connection_status IN ('not_connected', 'connected', 'error')),
    last_test_at TIMESTAMPTZ,
    last_test_error TEXT,
    last_synced_at TIMESTAMPTZ,

    created_by UUID REFERENCES core.users(id),
    updated_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT uq_organisation_integration_provider UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_organisation_integrations_org
    ON core.organisation_integrations (organization_id)
    WHERE is_deleted = false;

-- 2. Dual-provider columns on the existing file attachment table.
-- provider='supabase' (default) preserves every existing row/behaviour;
-- provider='sharepoint' rows are durable documents that live in SharePoint,
-- with these columns pointing at the stable Graph identifiers rather than a
-- human-readable path (files/folders can be renamed in SharePoint).
ALTER TABLE core.file_attachments
    ADD COLUMN IF NOT EXISTS provider VARCHAR(20) NOT NULL DEFAULT 'supabase',
    ADD COLUMN IF NOT EXISTS module VARCHAR(60),
    ADD COLUMN IF NOT EXISTS document_category VARCHAR(60),
    ADD COLUMN IF NOT EXISTS confidentiality_level VARCHAR(30) NOT NULL DEFAULT 'internal'
        CHECK (confidentiality_level IN ('public', 'internal', 'restricted', 'director_only')),
    ADD COLUMN IF NOT EXISTS provider_site_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_drive_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS provider_parent_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS sharepoint_web_url TEXT,
    ADD COLUMN IF NOT EXISTS sharepoint_etag VARCHAR(255),
    ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64),
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS modified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS sync_status VARCHAR(30) NOT NULL DEFAULT 'not_applicable'
        CHECK (sync_status IN ('not_applicable', 'pending', 'syncing', 'synced', 'failed')),
    ADD COLUMN IF NOT EXISTS sync_error TEXT,
    ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_file_attachments_provider
    ON core.file_attachments (organization_id, provider)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_file_attachments_sync_pending
    ON core.file_attachments (organization_id, sync_status)
    WHERE is_deleted = false AND provider = 'sharepoint' AND sync_status IN ('pending', 'failed');

-- 3. Stable SharePoint folder identifiers for routing (Phase 6/7).
-- Resolves module (+ optional project) to a Graph drive/item id so uploads
-- never depend on a human-readable path that could be renamed.
CREATE TABLE IF NOT EXISTS core.sharepoint_folder_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    module VARCHAR(60) NOT NULL,
    project_id UUID REFERENCES projects.projects(id),
    subfolder VARCHAR(160) NOT NULL DEFAULT '',
    drive_id VARCHAR(255) NOT NULL,
    item_id VARCHAR(255) NOT NULL,
    parent_item_id VARCHAR(255),
    web_url TEXT,
    path_label TEXT NOT NULL,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_sharepoint_folder_map UNIQUE (organization_id, module, project_id, subfolder)
);

CREATE INDEX IF NOT EXISTS idx_sharepoint_folder_map_lookup
    ON core.sharepoint_folder_map (organization_id, module, project_id)
    WHERE is_deleted = false;

-- 4. AEGIS <-> Microsoft Calendar event mapping (Phase 14/18).
-- The UNIQUE constraint on the source triple is the idempotency guarantee:
-- retries of "create the calendar event for this activity" can never create
-- a duplicate meeting.
CREATE TABLE IF NOT EXISTS core.calendar_event_map (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    source_module VARCHAR(60) NOT NULL,
    source_entity_type VARCHAR(80) NOT NULL,
    source_entity_id UUID NOT NULL,
    provider VARCHAR(20) NOT NULL DEFAULT 'microsoft365',
    microsoft_event_id VARCHAR(255),
    microsoft_calendar_id VARCHAR(255),
    microsoft_change_key VARCHAR(255),
    subject VARCHAR(500) NOT NULL,
    description TEXT,
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ,
    timezone VARCHAR(80) NOT NULL DEFAULT 'Africa/Harare',
    location VARCHAR(255),
    owner_user_id UUID REFERENCES core.users(id),
    calendar_category VARCHAR(60),
    sync_direction VARCHAR(30) NOT NULL DEFAULT 'aegis_to_microsoft'
        CHECK (sync_direction IN ('aegis_to_microsoft', 'microsoft_to_aegis', 'bidirectional')),
    sync_status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'synced', 'failed', 'cancelled')),
    sync_error TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancelled_at TIMESTAMPTZ,
    CONSTRAINT uq_calendar_event_source UNIQUE (organization_id, source_module, source_entity_type, source_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_map_sync
    ON core.calendar_event_map (organization_id, sync_status)
    WHERE cancelled_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_event_map_entity
    ON core.calendar_event_map (organization_id, source_entity_type, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_calendar_event_map_window
    ON core.calendar_event_map (organization_id, start_at)
    WHERE cancelled_at IS NULL;

-- 5. Permission catalog entries. Mirrors the crm_integrations.py convention
-- (crm.integrations.read / crm.integrations.manage) so the same roles that
-- already manage other integrations can be granted this one explicitly,
-- rather than defaulting to SUPERADMIN-only.
INSERT INTO core.permissions (key, description) VALUES
    ('integrations.microsoft.read', 'View Microsoft 365 connection status, SharePoint mapping and calendar mapping'),
    ('integrations.microsoft.manage', 'Connect, configure, test and disconnect the Microsoft 365 integration'),
    ('documents.microsoft.sync', 'Upload/replace AEGIS documents into the connected SharePoint site')
ON CONFLICT (key) DO NOTHING;

-- Grant read+manage to whichever roles already hold settings.update (the
-- existing "who administers integrations/settings" boundary - see
-- migrations/019_settings_controls.sql), and read-only + sync to whichever
-- roles already hold documents.create (the existing "who can attach
-- documents to records" boundary).
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'settings.update'
JOIN core.permissions new_p ON new_p.key IN ('integrations.microsoft.read', 'integrations.microsoft.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('integrations.microsoft.read', 'documents.microsoft.sync')
ON CONFLICT (role_id, permission_id) DO NOTHING;
