-- ============================================================================
-- Project intake classification: company-initiated production projects
-- ============================================================================
-- Today every project is implicitly "client-initiated" - task stacks
-- generate the instant the project row is created (see create_project in
-- routers/projects.py). RMC is the first of a different kind: a project the
-- Company itself initiates to produce something it will sell (internal or
-- external), with no client and no contract value, that sits dormant while
-- its investment case and funding are still being worked out. It needs its
-- own structured intake (category, investment required, funding sources)
-- completed and explicitly committed before its task stack should generate.
--
-- initiated_by defaults to 'client' so every existing project (which already
-- got its task stack at creation) is left exactly as-is - this column only
-- changes behavior for newly-created company-initiated projects.
-- ============================================================================

ALTER TABLE projects.project_profiles
    ADD COLUMN IF NOT EXISTS initiated_by VARCHAR(20) NOT NULL DEFAULT 'client'
        CHECK (initiated_by IN ('client', 'company')),
    ADD COLUMN IF NOT EXISTS project_category VARCHAR(20)
        CHECK (project_category IS NULL OR project_category IN ('construction', 'plant', 'commercial')),
    ADD COLUMN IF NOT EXISTS investment_required NUMERIC(15, 2) CHECK (investment_required IS NULL OR investment_required >= 0),
    ADD COLUMN IF NOT EXISTS funding_internal NUMERIC(15, 2) CHECK (funding_internal IS NULL OR funding_internal >= 0),
    ADD COLUMN IF NOT EXISTS funding_external NUMERIC(15, 2) CHECK (funding_external IS NULL OR funding_external >= 0),
    ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ;
