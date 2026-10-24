-- ============================================================================
-- Migration 270: Project Milestone Percent Complete
-- ============================================================================
-- Codifies projects.project_milestones.percent_complete, used by the schedule
-- site-sync endpoints (routers/projects.py). The column was applied to the live
-- database directly without a migration file; this brings the repo back in line.
-- Idempotent: matches the live definition exactly (NUMERIC(5,2), default 0,
-- constraint project_milestones_percent_complete_check).
-- ============================================================================

ALTER TABLE projects.project_milestones
    ADD COLUMN IF NOT EXISTS percent_complete NUMERIC(5, 2) DEFAULT 0
        CONSTRAINT project_milestones_percent_complete_check
        CHECK (percent_complete >= 0 AND percent_complete <= 100);
