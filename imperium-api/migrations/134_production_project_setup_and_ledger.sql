-- ============================================================================
-- Production project setup duration
-- ============================================================================
-- Company-initiated projects (see migration 133) don't have a client deadline
-- to hit - what matters is how long it takes to stand the project up before
-- production/sale can begin. This captures that instead of reusing
-- planned_completion_date, which reads as a contract deadline.
-- ============================================================================

ALTER TABLE projects.project_profiles
    ADD COLUMN IF NOT EXISTS setup_duration_weeks INTEGER
        CHECK (setup_duration_weeks IS NULL OR setup_duration_weeks > 0);
