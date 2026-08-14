-- ============================================================================
-- Priority and reminder tracking for crm.activities, backing the navbar
-- calendar widget (replaces the static Google Calendar iframe) and its
-- role-scoped notifications.
-- ============================================================================
-- priority: lets an activity be flagged for management attention (Executive
-- (Admin) / CRM Associate get notified on create/escalation - see
-- routers/crm_activities.py).
-- reminder_sent_at: scripts/run_activity_reminders.py (system cron) marks
-- this the moment it fires an owner reminder, so re-running the scan never
-- double-sends for the same activity.
-- ============================================================================

ALTER TABLE crm.activities
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

-- Calendar widget's primary access pattern: "my activities in this date
-- range" (owner) plus the management full-org view, both ordered by date.
CREATE INDEX IF NOT EXISTS idx_crm_activities_owner_date
    ON crm.activities (organization_id, owner_user_id, activity_date)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_activities_org_date
    ON crm.activities (organization_id, activity_date)
    WHERE is_deleted = false;

-- Reminder scan's access pattern: pending activities coming up that haven't
-- been reminded yet, across all orgs.
CREATE INDEX IF NOT EXISTS idx_crm_activities_reminder_pending
    ON crm.activities (activity_date)
    WHERE is_deleted = false AND status = 'Pending' AND reminder_sent_at IS NULL;
