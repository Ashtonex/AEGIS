-- Reporting controls: make automated reports auditable operational records.
-- No users or superadmins are seeded here.

ALTER TABLE executive.automated_reports
    ADD COLUMN IF NOT EXISTS report_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS format VARCHAR(20) DEFAULT 'pdf',
    ADD COLUMN IF NOT EXISTS status VARCHAR(40) DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS project_id UUID,
    ADD COLUMN IF NOT EXISTS project_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS file_path TEXT,
    ADD COLUMN IF NOT EXISTS evidence_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by UUID;

CREATE INDEX IF NOT EXISTS automated_reports_org_created_idx
    ON executive.automated_reports (organization_id, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS automated_reports_org_status_idx
    ON executive.automated_reports (organization_id, status)
    WHERE is_deleted = false;

ALTER TABLE executive.automated_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE executive.automated_reports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Automated reports service role only" ON executive.automated_reports;
CREATE POLICY "Automated reports service role only"
    ON executive.automated_reports
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

INSERT INTO core.permissions (key, description)
VALUES
    ('automated_reports.read', 'View automated reporting runs'),
    ('automated_reports.create', 'Generate automated reporting runs'),
    ('automated_reports.approve', 'Approve and publish automated reporting runs')
ON CONFLICT (key) DO NOTHING;
