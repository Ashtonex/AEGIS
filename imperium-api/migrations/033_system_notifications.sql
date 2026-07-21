-- System-wide notification center.
-- Notifications remain backend-mediated; no browser grants are added here.

ALTER TABLE core.notifications
    ADD COLUMN IF NOT EXISTS notification_type VARCHAR(80) NOT NULL DEFAULT 'system',
    ADD COLUMN IF NOT EXISTS priority VARCHAR(24) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN IF NOT EXISTS action_url TEXT,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE core.notifications
SET read_at = COALESCE(read_at, created_at)
WHERE is_read = true AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON core.notifications (organization_id, user_id, is_read, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
    ON core.notifications (organization_id, user_id, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS notifications_type_recent_idx
    ON core.notifications (organization_id, notification_type, created_at DESC)
    WHERE is_deleted = false;

ALTER TABLE core.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.notifications FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notifications service role only" ON core.notifications;
CREATE POLICY "Notifications service role only" ON core.notifications
    FOR ALL TO service_role USING (true) WITH CHECK (true);
