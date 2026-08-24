-- ============================================================================
-- Site Engineer portal controls
-- ============================================================================
-- Keeps Clerk, Foreman, Engineer and Site Agent as controlled views over the
-- same Site Operations records. Engineer verification is additive so existing
-- reports, GRNs and material requests remain valid.

CREATE TABLE IF NOT EXISTS projects.site_role_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    site_id         UUID REFERENCES projects.sites(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    role_name       VARCHAR(80) NOT NULL,
    starts_on       DATE,
    ends_on         DATE,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    assigned_by     UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, site_id, user_id, role_name)
);

CREATE INDEX IF NOT EXISTS idx_site_role_assignments_user
    ON projects.site_role_assignments (organization_id, user_id, role_name, is_active)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_site_role_assignments_project
    ON projects.site_role_assignments (organization_id, project_id, role_name, is_active)
    WHERE is_deleted = false;

ALTER TABLE projects.site_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.site_role_assignments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON projects.site_role_assignments FROM anon, authenticated;

DROP POLICY IF EXISTS "Site role assignments service role only" ON projects.site_role_assignments;
CREATE POLICY "Site role assignments service role only" ON projects.site_role_assignments
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE projects.weekly_budgets
    ADD COLUMN IF NOT EXISTS work_plan TEXT,
    ADD COLUMN IF NOT EXISTS labour_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS material_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS plant_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS risk_plan JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS engineer_notes TEXT,
    ADD COLUMN IF NOT EXISTS site_agent_notes TEXT;

ALTER TABLE projects.daily_site_reports
    ADD COLUMN IF NOT EXISTS engineer_review_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS engineer_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS engineer_reviewed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS engineer_review_reason TEXT,
    ADD COLUMN IF NOT EXISTS site_agent_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS site_agent_approved_by UUID REFERENCES core.users(id);

ALTER TABLE procurement.material_requests
    ADD COLUMN IF NOT EXISTS weekly_budget_id UUID REFERENCES projects.weekly_budgets(id),
    ADD COLUMN IF NOT EXISTS engineer_review_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS engineer_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS engineer_reviewed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS engineer_review_reason TEXT;

ALTER TABLE procurement.goods_received_notes
    ADD COLUMN IF NOT EXISTS engineer_review_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS engineer_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS engineer_reviewed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS engineer_review_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'daily_site_reports_engineer_review_status_chk'
    ) THEN
        ALTER TABLE projects.daily_site_reports
            ADD CONSTRAINT daily_site_reports_engineer_review_status_chk
            CHECK (engineer_review_status IN ('pending', 'verified', 'rejected', 'not_required'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'material_requests_engineer_review_status_chk'
    ) THEN
        ALTER TABLE procurement.material_requests
            ADD CONSTRAINT material_requests_engineer_review_status_chk
            CHECK (engineer_review_status IN ('pending', 'verified', 'rejected', 'not_required'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'goods_received_notes_engineer_review_status_chk'
    ) THEN
        ALTER TABLE procurement.goods_received_notes
            ADD CONSTRAINT goods_received_notes_engineer_review_status_chk
            CHECK (engineer_review_status IN ('pending', 'verified', 'rejected', 'not_required'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_reports_engineer_review
    ON projects.daily_site_reports (organization_id, project_id, engineer_review_status, report_date DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_material_requests_engineer_review
    ON procurement.material_requests (organization_id, project_id, engineer_review_status, created_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_grn_engineer_review
    ON procurement.goods_received_notes (organization_id, project_id, engineer_review_status, created_at DESC)
    WHERE is_deleted = false;

INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.engineer_portal.read', 'Use the Site Engineer portal and assigned project control view'),
    ('site_operations.engineer_verify', 'Technically verify or reject site reports, toolbox talks, material requests and GRNs'),
    ('site_operations.site_agent_authorize', 'Authorise engineer-verified site records and lock daily reports'),
    ('projects.site_assignment.read', 'View site role assignments'),
    ('projects.site_assignment.manage', 'Manage site role assignments')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id,
       'Site Engineer',
       'Technical site control: inspections, measurements, material checks, GRN verification and weekly budget preparation.',
       '/portal/site-engineer'
FROM core.organizations o
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id
        AND r.name = 'Site Engineer'
        AND r.is_deleted = false
  );

UPDATE core.roles
SET default_landing_path = '/portal/site-engineer',
    description = COALESCE(NULLIF(description, ''), 'Technical site control and verification.')
WHERE name = 'Site Engineer'
  AND is_deleted = false;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Site Engineer', 'site_operations.read'),
    ('Site Engineer', 'site_operations.create'),
    ('Site Engineer', 'site_operations.update'),
    ('Site Engineer', 'site_operations.daily_report.read'),
    ('Site Engineer', 'site_operations.daily_report.create'),
    ('Site Engineer', 'site_operations.daily_report.update'),
    ('Site Engineer', 'site_operations.daily_report.submit'),
    ('Site Engineer', 'site_operations.labour.record'),
    ('Site Engineer', 'site_operations.equipment.record'),
    ('Site Engineer', 'site_operations.material.record'),
    ('Site Engineer', 'site_operations.material.request'),
    ('Site Engineer', 'site_operations.engineer_portal.read'),
    ('Site Engineer', 'site_operations.engineer_verify'),
    ('Site Engineer', 'projects.read'),
    ('Site Engineer', 'projects.weekly_budget.read'),
    ('Site Engineer', 'projects.weekly_budget.submit'),
    ('Site Engineer', 'projects.site_assignment.read'),
    ('Site Engineer', 'inventory_items.read'),
    ('Site Engineer', 'inventory.item.read'),
    ('Site Engineer', 'procurement.requisition.read'),
    ('Site Engineer', 'procurement.grn.read'),
    ('Site Engineer', 'documents.read'),
    ('Site Engineer', 'documents.create'),
    ('Site Engineer', 'documents.link'),
    ('Site Agent', 'site_operations.site_agent_authorize'),
    ('Site Agent', 'projects.site_assignment.read'),
    ('Project Manager', 'site_operations.site_agent_authorize'),
    ('Executive (Admin)', 'site_operations.site_agent_authorize'),
    ('Project Manager', 'projects.site_assignment.manage'),
    ('Executive (Admin)', 'projects.site_assignment.manage')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
