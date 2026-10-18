-- Migration: 265_quality_pour_cards_and_site_snags.sql
-- Description: Concrete Pour Cards, QA pre-pour sign-off gate, cube crushing strength tests, and site defect/snag management.

CREATE TABLE IF NOT EXISTS projects.concrete_pour_cards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    pour_number VARCHAR(80) NOT NULL,
    element_name VARCHAR(255) NOT NULL,
    structure_level VARCHAR(80),
    concrete_grade VARCHAR(40) NOT NULL,
    design_volume_m3 NUMERIC(10, 2) NOT NULL DEFAULT 0 CHECK (design_volume_m3 >= 0),
    actual_volume_m3 NUMERIC(10, 2) DEFAULT 0 CHECK (actual_volume_m3 >= 0),
    target_slump_mm INTEGER DEFAULT 100,
    measured_slump_mm INTEGER,
    supplier_name VARCHAR(255),
    status VARCHAR(40) NOT NULL DEFAULT 'pre_pour_check'
        CHECK (status IN ('pre_pour_check', 'approved_for_pour', 'poured', 'curing_and_testing', 'compliant', 'condemned', 'cancelled')),
    
    -- Pre-pour checks (Site Engineer Gate)
    rebar_inspected BOOLEAN NOT NULL DEFAULT false,
    formwork_inspected BOOLEAN NOT NULL DEFAULT false,
    cleanliness_inspected BOOLEAN NOT NULL DEFAULT false,
    embedded_mep_inspected BOOLEAN NOT NULL DEFAULT false,
    cover_blocks_verified BOOLEAN NOT NULL DEFAULT false,
    pre_pour_approved_by UUID REFERENCES core.users(id),
    pre_pour_approved_at TIMESTAMPTZ,
    
    -- Pour execution
    pour_started_at TIMESTAMPTZ,
    pour_completed_at TIMESTAMPTZ,
    cubes_sampled_count INTEGER DEFAULT 6,
    cube_sample_ids VARCHAR(255),
    
    -- Cube testing results
    strength_7d_mpa NUMERIC(6, 2),
    strength_28d_mpa NUMERIC(6, 2),
    test_result_verdict VARCHAR(40) DEFAULT 'pending'
        CHECK (test_result_verdict IN ('pending', 'pass', 'marginal', 'fail')),
    test_certificate_ref VARCHAR(255),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, pour_number)
);

CREATE TABLE IF NOT EXISTS projects.site_snags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    snag_number VARCHAR(80) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    location_zone VARCHAR(255) NOT NULL,
    severity VARCHAR(30) NOT NULL DEFAULT 'minor'
        CHECK (severity IN ('cosmetic', 'minor', 'major', 'critical_safety')),
    status VARCHAR(30) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'rectified', 'reinspected', 'closed', 'disputed')),
    subcontractor_id UUID REFERENCES crm.subcontractors(id) ON DELETE SET NULL,
    trade VARCHAR(80),
    due_date DATE,
    photo_url TEXT,
    rectified_photo_url TEXT,
    rectified_at TIMESTAMPTZ,
    rectified_by UUID REFERENCES core.users(id),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES core.users(id),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, snag_number)
);

CREATE INDEX IF NOT EXISTS ix_concrete_pour_cards_project_status
    ON projects.concrete_pour_cards (organization_id, project_id, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_site_snags_project_status
    ON projects.site_snags (organization_id, project_id, status)
    WHERE is_deleted = false;

ALTER TABLE projects.concrete_pour_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.concrete_pour_cards FORCE ROW LEVEL SECURITY;

ALTER TABLE projects.site_snags ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.site_snags FORCE ROW LEVEL SECURITY;

REVOKE ALL ON projects.concrete_pour_cards FROM anon, authenticated;
REVOKE ALL ON projects.site_snags FROM anon, authenticated;

DROP POLICY IF EXISTS "Concrete pour cards service role only" ON projects.concrete_pour_cards;
CREATE POLICY "Concrete pour cards service role only" ON projects.concrete_pour_cards
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Site snags service role only" ON projects.site_snags;
CREATE POLICY "Site snags service role only" ON projects.site_snags
    FOR ALL TO service_role USING (true) WITH CHECK (true);
