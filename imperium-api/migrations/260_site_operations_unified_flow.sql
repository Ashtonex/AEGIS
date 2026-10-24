-- ============================================================================
-- AEGIS MIGRATION 260 — SITE OPERATIONS UNIFIED WORKFLOW & FREE-TEXT MATERIALS
-- ============================================================================
-- Connects Labour Register Start directly to Daily Site Report Drafts and
-- enables free-text material requests with catalogue matching and candidate tracking.
-- Additive only.
-- ============================================================================

-- 1. Link Site Day Briefings <-> Daily Site Reports
ALTER TABLE projects.daily_site_reports
    ADD COLUMN IF NOT EXISTS briefing_id   UUID REFERENCES projects.site_day_briefings(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS auto_created  BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS source_freshness TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS revision      INTEGER NOT NULL DEFAULT 1;

ALTER TABLE projects.site_day_briefings
    ADD COLUMN IF NOT EXISTS daily_report_id UUID REFERENCES projects.daily_site_reports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS daily_site_reports_briefing_idx
    ON projects.daily_site_reports (organization_id, briefing_id)
    WHERE briefing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS site_day_briefings_report_idx
    ON projects.site_day_briefings (organization_id, daily_report_id)
    WHERE daily_report_id IS NOT NULL;

-- 2. Material Candidates for Free-Text Material Requests
CREATE TABLE IF NOT EXISTS procurement.material_candidates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    request_id          UUID, -- References procurement.material_requests(id)
    raw_description     TEXT NOT NULL,
    specifications      TEXT,
    unit_of_measure     VARCHAR(40) NOT NULL DEFAULT 'each',
    normalized_key      VARCHAR(255) NOT NULL,
    proposed_category   VARCHAR(80) DEFAULT 'General Building Materials',
    status              VARCHAR(32) NOT NULL DEFAULT 'provisional'
        CHECK (status IN ('provisional', 'promoted', 'mapped_existing', 'rejected')),
    canonical_item_id   UUID REFERENCES procurement.inventory_items(id) ON DELETE SET NULL,
    resolved_by         UUID REFERENCES core.users(id),
    resolved_at         TIMESTAMPTZ,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS material_candidates_norm_idx
    ON procurement.material_candidates (organization_id, normalized_key, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS material_candidates_canonical_idx
    ON procurement.material_candidates (organization_id, canonical_item_id)
    WHERE canonical_item_id IS NOT NULL;

ALTER TABLE procurement.material_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.material_candidates FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.material_candidates FROM anon, authenticated;

DROP POLICY IF EXISTS "Material candidates service role only" ON procurement.material_candidates;
CREATE POLICY "Material candidates service role only" ON procurement.material_candidates
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3. Extend Material Requests for Free-Text Descriptions & Candidate Lineage
ALTER TABLE procurement.material_requests
    ALTER COLUMN item_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS material_description TEXT,
    ADD COLUMN IF NOT EXISTS specifications       TEXT,
    ADD COLUMN IF NOT EXISTS unit_of_measure      VARCHAR(40) NOT NULL DEFAULT 'each',
    ADD COLUMN IF NOT EXISTS candidate_id         UUID REFERENCES procurement.material_candidates(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS match_type           VARCHAR(32) NOT NULL DEFAULT 'catalogue_match'
        CHECK (match_type IN ('catalogue_match', 'new_description', 'manual_unlisted'));

CREATE INDEX IF NOT EXISTS material_requests_candidate_idx
    ON procurement.material_requests (organization_id, candidate_id)
    WHERE candidate_id IS NOT NULL;

-- 4. Extend Daily Report Labour to support Project Hires and Attendance Sync
ALTER TABLE projects.daily_report_labour
    ALTER COLUMN employee_id DROP NOT NULL,
    ADD COLUMN IF NOT EXISTS site_worker_id UUID REFERENCES finance.site_workers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS attendance_id  UUID REFERENCES projects.site_day_attendance(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS worker_name    VARCHAR(160),
    ADD COLUMN IF NOT EXISTS worker_kind    VARCHAR(20) NOT NULL DEFAULT 'employee'
        CHECK (worker_kind IN ('employee', 'project_hire'));

CREATE INDEX IF NOT EXISTS daily_report_labour_attendance_idx
    ON projects.daily_report_labour (organization_id, attendance_id)
    WHERE attendance_id IS NOT NULL;
