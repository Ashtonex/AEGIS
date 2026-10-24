-- Migration: 264_project_scheduling_cpm_and_dependencies.sql
-- Description: Interactive project scheduling with activity dependencies, durations, lag days, and Critical Path Method (CPM) calculation support.

ALTER TABLE projects.project_milestones
    ADD COLUMN IF NOT EXISTS duration_days INTEGER NOT NULL DEFAULT 1 CHECK (duration_days >= 0),
    ADD COLUMN IF NOT EXISTS predecessor_id UUID REFERENCES projects.project_milestones(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lag_days INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS' CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
    ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS total_float INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS early_start DATE,
    ADD COLUMN IF NOT EXISTS early_finish DATE,
    ADD COLUMN IF NOT EXISTS late_start DATE,
    ADD COLUMN IF NOT EXISTS late_finish DATE;

CREATE TABLE IF NOT EXISTS projects.milestone_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    milestone_id UUID NOT NULL REFERENCES projects.project_milestones(id) ON DELETE CASCADE,
    predecessor_id UUID NOT NULL REFERENCES projects.project_milestones(id) ON DELETE CASCADE,
    dependency_type VARCHAR(10) NOT NULL DEFAULT 'FS' CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
    lag_days INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT milestone_no_self_dependency CHECK (milestone_id <> predecessor_id),
    UNIQUE (organization_id, milestone_id, predecessor_id)
);

CREATE INDEX IF NOT EXISTS ix_milestone_dependencies_project
    ON projects.milestone_dependencies (organization_id, project_id);

CREATE INDEX IF NOT EXISTS ix_milestone_dependencies_pred
    ON projects.milestone_dependencies (predecessor_id);

CREATE INDEX IF NOT EXISTS ix_project_milestones_critical
    ON projects.project_milestones (organization_id, project_id, is_critical)
    WHERE is_deleted = false;

ALTER TABLE projects.milestone_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.milestone_dependencies FORCE ROW LEVEL SECURITY;

REVOKE ALL ON projects.milestone_dependencies FROM anon, authenticated;

DROP POLICY IF EXISTS "Milestone dependencies service role only" ON projects.milestone_dependencies;
CREATE POLICY "Milestone dependencies service role only" ON projects.milestone_dependencies
    FOR ALL TO service_role USING (true) WITH CHECK (true);
