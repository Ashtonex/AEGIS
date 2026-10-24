-- ============================================================================
-- Migration 267: Contractual Delay Events, Notices, and Extension of Time (EOT)
-- ============================================================================
-- Establishes legal & commercial delay administration for construction contracts
-- (FIDIC Red/Yellow, NEC4, JBCC):
-- 1. Contractual Delay Event Register: cause categories, contractual clauses,
--    statutory notice time-bar tracking, and mitigation records.
-- 2. Extension of Time (EOT) Claim Ledger: claimed days, linked CPM milestone,
--    critical path impact validation, prolongation costs, and determination audit.
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects.contractual_delay_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    event_number VARCHAR(60) NOT NULL,
    title VARCHAR(255) NOT NULL,
    cause_category VARCHAR(60) NOT NULL
        CHECK (cause_category IN (
            'employer_delay',
            'late_drawings_instructions',
            'differing_site_conditions',
            'adverse_weather',
            'force_majeure',
            'contractor_delay',
            'regulatory_or_statutory',
            'variations_scope_change'
        )),
    contract_clause_reference VARCHAR(120),
    event_occurred_date DATE NOT NULL,
    event_ended_date DATE,
    notice_required_days INTEGER NOT NULL DEFAULT 28 CHECK (notice_required_days > 0),
    notice_served_date DATE,
    notice_status VARCHAR(30) NOT NULL DEFAULT 'draft'
        CHECK (notice_status IN (
            'draft',
            'served_within_time',
            'time_barred',
            'acknowledged_by_client',
            'disputed'
        )),
    estimated_days_impact INTEGER NOT NULL DEFAULT 0 CHECK (estimated_days_impact >= 0),
    mitigation_actions TEXT,
    description TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, event_number),
    CHECK (event_ended_date IS NULL OR event_ended_date >= event_occurred_date)
);

CREATE TABLE IF NOT EXISTS projects.extension_of_time_claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    delay_event_id UUID REFERENCES projects.contractual_delay_events(id) ON DELETE SET NULL,
    claim_reference VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    days_requested INTEGER NOT NULL CHECK (days_requested > 0),
    impacted_milestone_id UUID REFERENCES projects.project_milestones(id) ON DELETE SET NULL,
    is_critical_path_impact BOOLEAN NOT NULL DEFAULT true,
    prolongation_cost_claimed NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (prolongation_cost_claimed >= 0),
    submission_date DATE NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'submitted'
        CHECK (status IN (
            'draft',
            'submitted',
            'under_review',
            'determined',
            'rejected',
            'disputed'
        )),
    days_granted INTEGER NOT NULL DEFAULT 0 CHECK (days_granted >= 0),
    prolongation_cost_approved NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (prolongation_cost_approved >= 0),
    determination_date DATE,
    determination_notes TEXT,
    engineer_representative_name VARCHAR(160),
    revised_contractual_completion_date DATE,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, claim_reference)
);

-- Indexes for efficient project query lookups
CREATE INDEX IF NOT EXISTS ix_contractual_delay_events_proj
    ON projects.contractual_delay_events(organization_id, project_id, event_occurred_date DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_extension_of_time_claims_proj
    ON projects.extension_of_time_claims(organization_id, project_id, status)
    WHERE is_deleted = false;

-- Row Level Security
ALTER TABLE projects.contractual_delay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.extension_of_time_claims ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'delay_events_tenant_isolation' AND tablename = 'contractual_delay_events'
    ) THEN
        CREATE POLICY delay_events_tenant_isolation ON projects.contractual_delay_events
            FOR ALL USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'eot_claims_tenant_isolation' AND tablename = 'extension_of_time_claims'
    ) THEN
        CREATE POLICY eot_claims_tenant_isolation ON projects.extension_of_time_claims
            FOR ALL USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    END IF;
END $$;
