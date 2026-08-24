-- ============================================================================
-- Task-linked BOQ flow, estimations associate role, weekly site budgets and
-- start-of-day controls.
-- ============================================================================

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS boq_imported_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS boq_document_id UUID REFERENCES core.documents(id);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_boq_document
    ON crm.tasks (boq_document_id)
    WHERE boq_document_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS projects.weekly_budgets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id      UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    site_id         UUID REFERENCES projects.sites(id) ON DELETE SET NULL,
    week_start      DATE NOT NULL,
    status          VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
    labour_budget   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (labour_budget >= 0),
    materials_budget NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (materials_budget >= 0),
    equipment_budget NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (equipment_budget >= 0),
    subcontract_budget NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (subcontract_budget >= 0),
    notes           TEXT,
    submitted_at    TIMESTAMPTZ,
    submitted_by    UUID REFERENCES core.users(id),
    approved_at     TIMESTAMPTZ,
    approved_by     UUID REFERENCES core.users(id),
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, site_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_budgets_current_gate
    ON projects.weekly_budgets (organization_id, project_id, site_id, week_start, status)
    WHERE is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_budgets_project_week_unique
    ON projects.weekly_budgets (organization_id, project_id, week_start)
    WHERE site_id IS NULL AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_budgets_site_week_unique
    ON projects.weekly_budgets (organization_id, project_id, site_id, week_start)
    WHERE site_id IS NOT NULL AND is_deleted = false;

ALTER TABLE projects.daily_site_reports
    ADD COLUMN IF NOT EXISTS labour_count_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS toolbox_talk_completed BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS ppe_check_completed BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE procurement.purchase_requisitions
    ADD COLUMN IF NOT EXISTS weekly_budget_id UUID REFERENCES projects.weekly_budgets(id);

ALTER TABLE procurement.rfqs
    ADD COLUMN IF NOT EXISTS weekly_budget_id UUID REFERENCES projects.weekly_budgets(id);

ALTER TABLE projects.weekly_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.weekly_budgets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON projects.weekly_budgets FROM anon, authenticated;

DROP POLICY IF EXISTS "Weekly budgets service role only" ON projects.weekly_budgets;
CREATE POLICY "Weekly budgets service role only" ON projects.weekly_budgets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('projects.weekly_budget.read', 'View weekly project/site budgets'),
    ('projects.weekly_budget.submit', 'Submit weekly project/site budgets'),
    ('projects.weekly_budget.approve', 'Approve weekly project/site budgets'),
    ('quotations.boq_builder.use', 'Use the manual BOQ builder and BOQ import/export tools')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.roles (organization_id, name, description, default_landing_path)
SELECT o.id,
       'Estimations & Quotations Associate',
       'Partial quotations access: assigned tasks, team visibility, manual BOQ builder, BOQ import and export only',
       '/dashboard/crm/tasks'
FROM core.organizations o
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM core.roles r
      WHERE r.organization_id = o.id
        AND r.name = 'Estimations & Quotations Associate'
        AND r.is_deleted = false
  );

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('crm_tasks.read'),
    ('crm_tasks.update'),
    ('teams.read'),
    ('users.read_assignable'),
    ('quotations.read'),
    ('quotations.create'),
    ('quotations.update'),
    ('quotations.boq_builder.use'),
    ('documents.read'),
    ('documents.create'),
    ('documents.link')
) AS grant_def(permission_key) ON true
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.name = 'Estimations & Quotations Associate'
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'projects.weekly_budget.read',
    'projects.weekly_budget.submit',
    'site_operations.daily_report.create',
    'site_operations.daily_report.submit',
    'site_operations.material.request'
)
WHERE r.name IN ('Site Engineer', 'Foreman', 'Site Clerk', 'Project Manager', 'Site Manager')
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'projects.weekly_budget.read',
    'projects.weekly_budget.approve'
)
WHERE r.name IN ('Project Manager', 'Finance Manager', 'Executive (Admin)')
  AND r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
