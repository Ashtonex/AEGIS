-- ============================================================================
-- AEGIS MIGRATION 300 - PROJECT WORKSPACES IN MICROSOFT 365
-- ============================================================================
--   1. When a project becomes active, AEGIS sets up its workspace: the
--      standard folder tree under 03_PROJECTS in the connected SharePoint
--      site and, once a "projects" Team is linked and the admin has granted
--      Channel.Create + TeamsTab.Create, a channel in that Team with tabs to
--      the folder, the AEGIS project page and the project's Site Diary.
--   2. Site photos / delivery dockets attached to daily reports (stored in
--      Supabase Storage) are copied into the project's SharePoint folders,
--      one folder per report date. The Supabase file stays the source AEGIS
--      reads from; the copy is recorded on core.file_attachments.mirror_*.
--   3. One "Site Diary" workbook per project, a row per daily report,
--      republished when a report changes.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE core.organisation_integrations
    ADD COLUMN IF NOT EXISTS sync_project_workspaces BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS projects_team_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS projects_team_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS projects_team_web_url TEXT;

ALTER TABLE core.file_attachments
    ADD COLUMN IF NOT EXISTS mirror_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS mirror_item_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS mirror_web_url TEXT,
    ADD COLUMN IF NOT EXISTS mirror_error TEXT,
    ADD COLUMN IF NOT EXISTS mirror_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mirrored_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'file_attachments_mirror_status_chk') THEN
        ALTER TABLE core.file_attachments
            ADD CONSTRAINT file_attachments_mirror_status_chk
            CHECK (mirror_status IS NULL OR mirror_status IN ('pending', 'synced', 'failed', 'skipped'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_file_attachments_mirror_pending
    ON core.file_attachments (organization_id, created_at)
    WHERE mirror_status IS NULL OR mirror_status IN ('pending', 'failed');

CREATE TABLE IF NOT EXISTS projects.project_m365_workspaces (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id           UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    folder_name          VARCHAR(255),
    folder_drive_id      VARCHAR(255),
    folder_item_id       VARCHAR(255),
    folder_web_url       TEXT,
    folders_ready_at     TIMESTAMPTZ,
    -- 'not_linked' (no projects Team yet), 'needs_permission', 'ready', 'failed'
    channel_status       VARCHAR(30) NOT NULL DEFAULT 'not_linked',
    team_id              VARCHAR(255),
    channel_id           VARCHAR(255),
    channel_name         VARCHAR(255),
    channel_web_url      TEXT,
    tabs_installed       JSONB NOT NULL DEFAULT '[]'::jsonb,
    diary_item_id        VARCHAR(255),
    diary_web_url        TEXT,
    diary_signature      VARCHAR(64),
    diary_published_at   TIMESTAMPTZ,
    last_attempt_at      TIMESTAMPTZ,
    last_error           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT project_m365_workspaces_unique UNIQUE (organization_id, project_id),
    CONSTRAINT project_m365_workspaces_channel_chk
        CHECK (channel_status IN ('not_linked', 'needs_permission', 'ready', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_project_m365_workspaces_project
    ON projects.project_m365_workspaces (organization_id, project_id);

DO $$
BEGIN
    ALTER TABLE projects.project_m365_workspaces ENABLE ROW LEVEL SECURITY;
    ALTER TABLE projects.project_m365_workspaces FORCE ROW LEVEL SECURITY;
    REVOKE ALL ON projects.project_m365_workspaces FROM anon, authenticated;
    DROP POLICY IF EXISTS "Projects service role only" ON projects.project_m365_workspaces;
    CREATE POLICY "Projects service role only" ON projects.project_m365_workspaces
        FOR ALL TO service_role USING (true) WITH CHECK (true);
    DROP TRIGGER IF EXISTS trg_audit_project_m365_workspaces ON projects.project_m365_workspaces;
    CREATE TRIGGER trg_audit_project_m365_workspaces
        AFTER INSERT OR UPDATE OR DELETE ON projects.project_m365_workspaces
        FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
END $$;

-- Switch it on where the SharePoint side is already in place (document sync
-- on and a 03_PROJECTS library mapped). Team/channel setup stays off until
-- an admin links the Team.
UPDATE core.organisation_integrations
SET sync_project_workspaces = true, updated_at = NOW()
WHERE provider = 'microsoft365' AND is_deleted = false AND enabled = true
  AND sync_documents = true AND library_map ? '03_PROJECTS'
  AND sync_project_workspaces = false;
