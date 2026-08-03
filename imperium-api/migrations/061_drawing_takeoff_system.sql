-- ============================================================================
-- AEGIS MIGRATION 061 — DRAWING TAKEOFF & CHANGE-CONTROL SYSTEM
-- Adds a dedicated schema for reading construction drawings into draft BOQ
-- measurements (AI vision, CAD/DXF parsing, or plain human reference-viewer
-- entry), committing a revision as the current baseline, and gating any
-- later change to a committed revision behind a checklist sign-off.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS takeoff;

-- 1. DRAWING REVISIONS
-- One row per uploaded/committed revision of a named drawing. A drawing
-- (identified by drawing_name) can have many revisions over time; only one
-- may be 'committed' at a time - the rest are 'draft' or 'superseded'.

CREATE TABLE IF NOT EXISTS takeoff.drawing_revisions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id              UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    quotation_id            UUID REFERENCES finance.quotations(id) ON DELETE SET NULL,
    drawing_name            VARCHAR(255) NOT NULL,
    revision_label          VARCHAR(20) NOT NULL DEFAULT 'R1',
    source_mode             VARCHAR(24) NOT NULL
        CHECK (source_mode IN ('ai_vision', 'cad_dxf', 'manual_reference')),
    file_url                TEXT,               -- Supabase Storage public URL, if a file was attached
    file_name               VARCHAR(255),
    mime_type               VARCHAR(120),
    extraction_status       VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (extraction_status IN ('pending', 'extracted', 'manual', 'not_configured', 'failed')),
    extraction_confidence_pct  SMALLINT CHECK (extraction_confidence_pct IS NULL OR (extraction_confidence_pct BETWEEN 0 AND 100)),
    extraction_notes        TEXT,
    status                  VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'committed', 'superseded')),
    supersedes_revision_id  UUID REFERENCES takeoff.drawing_revisions(id),
    committed_by            UUID REFERENCES core.users(id),
    committed_at            TIMESTAMPTZ,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS drawing_revisions_org_idx
    ON takeoff.drawing_revisions (organization_id, drawing_name)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS drawing_revisions_project_idx
    ON takeoff.drawing_revisions (organization_id, project_id)
    WHERE is_deleted = false;

-- Only one committed revision per drawing name at a time.
CREATE UNIQUE INDEX IF NOT EXISTS drawing_revisions_single_committed
    ON takeoff.drawing_revisions (organization_id, drawing_name)
    WHERE status = 'committed' AND is_deleted = false;

-- 2. DRAWING MEASUREMENTS
-- The captured BOQ-shaped rows for a revision - whether AI-extracted,
-- CAD-extracted, or manually keyed in while looking at the drawing. Every
-- row remembers exactly where it came from and who last touched it.

CREATE TABLE IF NOT EXISTS takeoff.drawing_measurements (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    drawing_revision_id UUID NOT NULL REFERENCES takeoff.drawing_revisions(id) ON DELETE CASCADE,
    description         VARCHAR(500) NOT NULL,
    unit                VARCHAR(40) NOT NULL DEFAULT 'unit',
    quantity            NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    source              VARCHAR(24) NOT NULL
        CHECK (source IN ('ai_vision', 'cad_dxf', 'manual')),
    confidence_pct      SMALLINT CHECK (confidence_pct IS NULL OR (confidence_pct BETWEEN 0 AND 100)),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    entered_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS drawing_measurements_revision_idx
    ON takeoff.drawing_measurements (organization_id, drawing_revision_id)
    WHERE is_deleted = false;

-- 3. REVISION CHECKLIST ITEMS
-- Gate before a revision can be committed (i.e. before a change to a
-- drawing's measurements becomes the new baseline). Seeded automatically
-- when a revision is created; the revision cannot commit until every item
-- for it is checked.

CREATE TABLE IF NOT EXISTS takeoff.drawing_revision_checklist_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    drawing_revision_id UUID NOT NULL REFERENCES takeoff.drawing_revisions(id) ON DELETE CASCADE,
    item_label          VARCHAR(255) NOT NULL,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_checked          BOOLEAN NOT NULL DEFAULT false,
    checked_by          UUID REFERENCES core.users(id),
    checked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS drawing_checklist_revision_idx
    ON takeoff.drawing_revision_checklist_items (organization_id, drawing_revision_id);

-- 4. RLS

ALTER TABLE takeoff.drawing_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff.drawing_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE takeoff.drawing_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff.drawing_measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE takeoff.drawing_revision_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE takeoff.drawing_revision_checklist_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON takeoff.drawing_revisions, takeoff.drawing_measurements, takeoff.drawing_revision_checklist_items
    FROM anon, authenticated;

DROP POLICY IF EXISTS "Takeoff service role only" ON takeoff.drawing_revisions;
CREATE POLICY "Takeoff service role only" ON takeoff.drawing_revisions FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Takeoff service role only" ON takeoff.drawing_measurements;
CREATE POLICY "Takeoff service role only" ON takeoff.drawing_measurements FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Takeoff service role only" ON takeoff.drawing_revision_checklist_items;
CREATE POLICY "Takeoff service role only" ON takeoff.drawing_revision_checklist_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. PERMISSIONS
-- The router is registered with require_resource_permission("drawings"),
-- which auto-derives drawings.read/create/update/delete from the HTTP verb
-- (GET/POST/PUT/DELETE) - those four MUST exist or every request 403s.
-- takeoff.drawing.commit is an additional fine-grained gate layered on top
-- of the commit endpoint specifically, the same pattern quotations.py uses
-- for quotations.approve_ccb_override on top of its router-level gate.

INSERT INTO core.permissions (key, description) VALUES
    ('drawings.read',           'View drawing revisions, measurements, and checklists'),
    ('drawings.create',         'Upload drawings, create draft revisions, add measurements, check off checklist items'),
    ('drawings.update',         'Edit drawing revision records'),
    ('drawings.delete',         'Delete drawing revisions'),
    ('takeoff.drawing.commit',  'Commit a drawing revision as the current baseline')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',    'drawings.read'),
    ('Executive (Admin)',    'drawings.create'),
    ('Executive (Admin)',    'drawings.update'),
    ('Executive (Admin)',    'drawings.delete'),
    ('Executive (Admin)',    'takeoff.drawing.commit'),
    ('Quantity Surveyor',    'drawings.read'),
    ('Quantity Surveyor',    'drawings.create'),
    ('Quantity Surveyor',    'drawings.update'),
    ('Quantity Surveyor',    'drawings.delete'),
    ('Quantity Surveyor',    'takeoff.drawing.commit'),
    ('Project Manager',      'drawings.read'),
    ('Project Manager',      'drawings.create'),
    ('Project Manager',      'drawings.update'),
    ('Site Agent',           'drawings.read'),
    ('Site Agent',           'drawings.create')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- 6. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'takeoff', 'drawing_revisions'
        UNION ALL VALUES
        ('takeoff', 'drawing_measurements'),
        ('takeoff', 'drawing_revision_checklist_items')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;

-- 7. STORAGE BUCKET RLS for drawing uploads (bucket itself created via
-- Storage Admin API / dashboard, matching the existing broadcast-feeds
-- pattern - see migration 057).

DROP POLICY IF EXISTS "Authenticated users can upload drawings" ON storage.objects;
CREATE POLICY "Authenticated users can upload drawings" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'construction-drawings');

DROP POLICY IF EXISTS "Authenticated users can read drawings" ON storage.objects;
CREATE POLICY "Authenticated users can read drawings" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'construction-drawings');

DROP POLICY IF EXISTS "Authenticated users can update their drawing uploads" ON storage.objects;
CREATE POLICY "Authenticated users can update their drawing uploads" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'construction-drawings')
    WITH CHECK (bucket_id = 'construction-drawings');
