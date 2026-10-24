-- ============================================================================
-- Migration 268: Controlled Drawing Register & Site Progress Photo Diary
-- ============================================================================
-- Establishes:
-- 1. Controlled Drawing Register: Drawings categorized by engineering discipline,
--    revision tracking, IFC (Issued for Construction) status, and superseded audit.
-- 2. Progress Photo Diary: Element/milestone-tagged site progress photos with capture
--    date, weather observations, and geographic location tags.
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects.controlled_drawings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    drawing_number VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    discipline VARCHAR(60) NOT NULL
        CHECK (discipline IN (
            'architectural',
            'structural',
            'mep_mechanical',
            'mep_electrical',
            'mep_plumbing',
            'civil_infrastructure',
            'landscape_external',
            'geotechnical'
        )),
    current_revision VARCHAR(20) NOT NULL DEFAULT 'Rev A',
    ifc_status VARCHAR(40) NOT NULL DEFAULT 'issued_for_construction'
        CHECK (ifc_status IN (
            'issued_for_construction',
            'for_review_approval',
            'preliminary_tender',
            'for_information_only',
            'as_built',
            'superseded'
        )),
    date_received DATE NOT NULL,
    file_url TEXT,
    superseded_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    distribution_list JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, drawing_number)
);

CREATE TABLE IF NOT EXISTS projects.progress_photo_diary (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    photo_url TEXT NOT NULL,
    caption VARCHAR(255) NOT NULL,
    element_tag VARCHAR(100) NOT NULL,
    captured_date DATE NOT NULL,
    weather_condition VARCHAR(60) DEFAULT 'clear_sunny'
        CHECK (weather_condition IN (
            'clear_sunny',
            'overcast',
            'light_rain',
            'heavy_rain',
            'windy'
        )),
    gps_lat NUMERIC(10, 7),
    gps_lng NUMERIC(10, 7),
    uploaded_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_controlled_drawings_proj
    ON projects.controlled_drawings(organization_id, project_id, discipline, ifc_status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ix_progress_photo_diary_proj
    ON projects.progress_photo_diary(organization_id, project_id, captured_date DESC)
    WHERE is_deleted = false;

-- Row Level Security
ALTER TABLE projects.controlled_drawings ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.progress_photo_diary ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'controlled_drawings_tenant_isolation' AND tablename = 'controlled_drawings'
    ) THEN
        CREATE POLICY controlled_drawings_tenant_isolation ON projects.controlled_drawings
            FOR ALL USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE policyname = 'progress_photo_diary_tenant_isolation' AND tablename = 'progress_photo_diary'
    ) THEN
        CREATE POLICY progress_photo_diary_tenant_isolation ON projects.progress_photo_diary
            FOR ALL USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    END IF;
END $$;
