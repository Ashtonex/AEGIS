-- ============================================================================
-- QS master budget -> Site Engineer weekly execution budgets -> variance gate
-- ============================================================================
-- Site Engineers do not need the full QS master budget. They receive execution
-- allowances by BOQ line/work package, submit weekly quantities, and any
-- out-of-baseline item links to a controlled variation before execution.

CREATE TABLE IF NOT EXISTS projects.weekly_budget_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    weekly_budget_id    UUID NOT NULL REFERENCES projects.weekly_budgets(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    boq_line_item_id    UUID REFERENCES finance.boq_line_items(id) ON DELETE SET NULL,
    work_package        VARCHAR(160),
    description         TEXT NOT NULL,
    unit                VARCHAR(20) NOT NULL DEFAULT 'item',
    planned_qty         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (planned_qty >= 0),
    available_qty       NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
    planned_amount      NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (planned_amount >= 0),
    cost_category       VARCHAR(40)
        CHECK (cost_category IS NULL OR cost_category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    variance_required   BOOLEAN NOT NULL DEFAULT false,
    variance_id         UUID REFERENCES finance.variations(id),
    proceed_at_risk     BOOLEAN NOT NULL DEFAULT false,
    status              VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'variance_pending', 'approved', 'rejected', 'cancelled')),
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_weekly_budget_items_budget
    ON projects.weekly_budget_items (organization_id, weekly_budget_id, status)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_weekly_budget_items_boq
    ON projects.weekly_budget_items (organization_id, boq_line_item_id)
    WHERE boq_line_item_id IS NOT NULL AND is_deleted = false;

ALTER TABLE projects.weekly_budget_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.weekly_budget_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON projects.weekly_budget_items FROM anon, authenticated;

DROP POLICY IF EXISTS "Weekly budget items service role only" ON projects.weekly_budget_items;
CREATE POLICY "Weekly budget items service role only" ON projects.weekly_budget_items
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE projects.weekly_budgets
    ADD COLUMN IF NOT EXISTS source_budget_id UUID REFERENCES finance.project_budgets(id),
    ADD COLUMN IF NOT EXISTS total_planned_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_planned_amount >= 0),
    ADD COLUMN IF NOT EXISTS variance_count INTEGER NOT NULL DEFAULT 0 CHECK (variance_count >= 0);

ALTER TABLE finance.variations
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS source_id UUID,
    ADD COLUMN IF NOT EXISTS boq_line_item_id UUID REFERENCES finance.boq_line_items(id),
    ADD COLUMN IF NOT EXISTS weekly_budget_id UUID REFERENCES projects.weekly_budgets(id),
    ADD COLUMN IF NOT EXISTS weekly_budget_item_id UUID REFERENCES projects.weekly_budget_items(id),
    ADD COLUMN IF NOT EXISTS variance_origin VARCHAR(40) NOT NULL DEFAULT 'site_initiated',
    ADD COLUMN IF NOT EXISTS approval_route VARCHAR(40) NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS client_approval_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS client_approval_status VARCHAR(24) NOT NULL DEFAULT 'not_required',
    ADD COLUMN IF NOT EXISTS client_approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS client_approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS qs_review_status VARCHAR(24) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS qs_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS qs_reviewed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS proceed_at_risk BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS execution_blocked BOOLEAN NOT NULL DEFAULT true;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_variance_origin_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_variance_origin_chk
            CHECK (variance_origin IN ('client_initiated', 'site_initiated', 'designer_initiated', 'statutory', 'internal_loss'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_approval_route_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_approval_route_chk
            CHECK (approval_route IN ('client', 'internal', 'client_and_internal'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_client_approval_status_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_client_approval_status_chk
            CHECK (client_approval_status IN ('not_required', 'pending', 'approved', 'rejected'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'variations_qs_review_status_chk') THEN
        ALTER TABLE finance.variations
            ADD CONSTRAINT variations_qs_review_status_chk
            CHECK (qs_review_status IN ('pending', 'reviewed', 'rejected'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_variations_source
    ON finance.variations (organization_id, source_type, source_id)
    WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_variations_weekly_budget
    ON finance.variations (organization_id, weekly_budget_id, status)
    WHERE weekly_budget_id IS NOT NULL AND is_deleted = false;

INSERT INTO core.permissions (key, description) VALUES
    ('projects.execution_budget.read', 'View execution-safe BOQ allowances for weekly site budget planning'),
    ('projects.weekly_budget.line_submit', 'Submit weekly budget line items against execution allowances'),
    ('finance.variation.initiate_site', 'Initiate site-originated variations from weekly budget planning'),
    ('finance.variation.qs_review', 'QS commercial review of site-originated variations'),
    ('finance.variation.client_approval', 'Record client approval or rejection on client-impacting variations')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Site Engineer', 'projects.execution_budget.read'),
    ('Site Engineer', 'projects.weekly_budget.line_submit'),
    ('Site Engineer', 'finance.variation.initiate_site'),
    ('Site Agent', 'projects.execution_budget.read'),
    ('Site Agent', 'finance.variation.initiate_site'),
    ('Quantity Surveyor', 'projects.execution_budget.read'),
    ('Quantity Surveyor', 'finance.budget.read'),
    ('Quantity Surveyor', 'finance.boq_progress.read'),
    ('Quantity Surveyor', 'finance.variation.read'),
    ('Quantity Surveyor', 'finance.variation.create'),
    ('Quantity Surveyor', 'finance.variation.qs_review'),
    ('Commercial Manager', 'finance.variation.qs_review'),
    ('Commercial Manager', 'finance.variation.client_approval'),
    ('Contracts Manager', 'finance.variation.client_approval'),
    ('Project Manager', 'finance.variation.client_approval'),
    ('Executive (Admin)', 'finance.variation.client_approval')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
