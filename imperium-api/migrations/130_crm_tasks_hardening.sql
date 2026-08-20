-- ============================================================================
-- AEGIS MIGRATION 130 — PURSUIT OPERATING SYSTEM (PHASE 2: TASK ENGINE HARDENING)
-- ============================================================================
-- crm.tasks (106) is flat CRUD today: one owner, 4 statuses, "done" is a
-- single-actor toggle with no verification. The pursuit model requires a
-- Task to carry contributors (beyond its one accountable owner), a single
-- predecessor dependency, required evidence, an approver who verifies
-- completion, a risk flag, and an outcome/next-action pair. This migration
-- adds all of that without touching any existing column or call site that
-- doesn't opt in - every new column is nullable/defaulted.
--
-- Status is widened from 4 to 7 values (7, not 8 - "overdue" is deliberately
-- NOT a stored status: it's derived from due_date < now() AND status NOT IN
-- (completed, cancelled) at query time, so a task can't drift into being
-- simultaneously "overdue" and, say, "blocked" the way a single competing
-- enum value would force). All 66 existing rows are 'open' today (verified
-- before writing this migration), so the open->not_started / done->completed
-- data migration is a no-op in practice but is included for correctness.
-- ============================================================================

ALTER TABLE crm.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

UPDATE crm.tasks SET status = 'not_started' WHERE status = 'open';
UPDATE crm.tasks SET status = 'completed' WHERE status = 'done';

ALTER TABLE crm.tasks
    ADD CONSTRAINT tasks_status_check CHECK (status IN (
        'not_started', 'in_progress', 'waiting_on_third_party', 'blocked',
        'under_review', 'completed', 'cancelled'
    ));

ALTER TABLE crm.tasks ALTER COLUMN status SET DEFAULT 'not_started';

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS depends_on_task_id UUID REFERENCES crm.tasks(id),
    ADD COLUMN IF NOT EXISTS evidence_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS evidence_ref TEXT,
    ADD COLUMN IF NOT EXISTS approver_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS verified_by_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS risk_flag BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS outcome TEXT,
    ADD COLUMN IF NOT EXISTS next_action TEXT;

CREATE INDEX IF NOT EXISTS idx_crm_tasks_depends_on ON crm.tasks (depends_on_task_id) WHERE is_deleted = false;

-- "Several contributors may assist" - separate from the one accountable
-- assigned_to_user_id owner (crm.tasks unchanged there).
CREATE TABLE IF NOT EXISTS crm.task_contributors (
    task_id    UUID NOT NULL REFERENCES crm.tasks(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, user_id)
);
