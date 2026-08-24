-- ============================================================================
-- Task completion becomes a submit-for-verification workflow.
-- ============================================================================
-- Assignees attach proof and submit work for review. The task remains
-- under_review until a team lead / configured approver verifies it.
-- ============================================================================

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS review_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS review_submitted_by_user_id UUID REFERENCES core.users(id);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_under_review_team
    ON crm.tasks (organization_id, assigned_to_team_id, review_submitted_at DESC)
    WHERE is_deleted = false AND status = 'under_review';

CREATE INDEX IF NOT EXISTS idx_crm_tasks_under_review_approver
    ON crm.tasks (organization_id, approver_user_id, review_submitted_at DESC)
    WHERE is_deleted = false AND status = 'under_review' AND approver_user_id IS NOT NULL;
