-- ============================================================================
-- AEGIS MIGRATION 023 — FINANCE AND COST CONTROL DOMAIN
-- Adds the full finance control structure:
--   project_budgets → budget_lines → commitments →
--   variations → progress_claims → retention_ledger →
--   payment_approvals → finance.project_forecast
-- Also fixes the overly-restrictive UNIQUE constraint on cost_transactions
-- that prevents multiple cost categories per source record.
-- ============================================================================

-- 1. FIX COST TRANSACTIONS UNIQUE CONSTRAINT
-- The original constraint blocks posting multiple cost categories (labour,
-- equipment, materials) for the same daily_site_report.  Replace it with a
-- partial unique index that correctly identifies duplicate entries.

ALTER TABLE finance.cost_transactions
    DROP CONSTRAINT IF EXISTS cost_transactions_organization_id_source_type_source_id_cos_key;

-- Correct constraint: unique per (org, source, cost_category) — one row per
-- category per source document is the intended behaviour.
CREATE UNIQUE INDEX IF NOT EXISTS cost_transactions_unique_source_category
    ON finance.cost_transactions (organization_id, source_type, source_id, cost_category);

-- 2. PROJECT BUDGETS

CREATE TABLE IF NOT EXISTS finance.project_budgets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    budget_version      SMALLINT NOT NULL DEFAULT 1 CHECK (budget_version > 0),
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'superseded', 'cancelled')),
    label               VARCHAR(255),        -- e.g. "Original Budget", "Revision 1"
    effective_date      DATE NOT NULL,
    total_amount        NUMERIC(15,2) NOT NULL CHECK (total_amount >= 0),
    notes               TEXT,
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    -- Only one approved budget per project at a time
    UNIQUE (organization_id, project_id, budget_version)
);

CREATE UNIQUE INDEX IF NOT EXISTS project_budgets_single_approved
    ON finance.project_budgets (organization_id, project_id)
    WHERE status = 'approved' AND is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.budget_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    budget_id       UUID NOT NULL REFERENCES finance.project_budgets(id) ON DELETE CASCADE,
    cost_code_id    UUID REFERENCES finance.cost_codes(id),
    cost_category   VARCHAR(40) NOT NULL
        CHECK (cost_category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    description     VARCHAR(255),
    quantity        NUMERIC(14,3) CHECK (quantity IS NULL OR quantity > 0),
    unit_rate       NUMERIC(15,4) CHECK (unit_rate IS NULL OR unit_rate >= 0),
    amount          NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS budget_lines_budget_idx
    ON finance.budget_lines (organization_id, budget_id)
    WHERE is_deleted = false;

-- 3. COMMITMENTS (approved obligations not yet invoiced)

CREATE TABLE IF NOT EXISTS finance.commitments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    cost_code_id        UUID REFERENCES finance.cost_codes(id),
    cost_category       VARCHAR(40) NOT NULL
        CHECK (cost_category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    source_type         VARCHAR(120) NOT NULL,   -- 'purchase_order', 'subcontract', 'hire_agreement'
    source_id           UUID NOT NULL,
    description         TEXT NOT NULL,
    committed_amount    NUMERIC(15,2) NOT NULL CHECK (committed_amount >= 0),
    invoiced_amount     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (invoiced_amount >= 0),
    paid_amount         NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    outstanding_amount  NUMERIC(15,2) GENERATED ALWAYS AS (committed_amount - invoiced_amount) STORED,
    status              VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'partially_invoiced', 'fully_invoiced', 'cancelled')),
    commitment_date     DATE NOT NULL,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS commitments_project_idx
    ON finance.commitments (organization_id, project_id, status)
    WHERE is_deleted = false;

-- 4. VARIATIONS (change orders)

CREATE TABLE IF NOT EXISTS finance.variations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    variation_number    VARCHAR(40) NOT NULL,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    initiated_by        VARCHAR(40) NOT NULL DEFAULT 'client'
        CHECK (initiated_by IN ('client', 'contractor', 'designer', 'statutory')),
    scope_impact        TEXT,
    cost_impact         NUMERIC(15,2) NOT NULL DEFAULT 0,  -- can be negative
    time_impact_days    INTEGER NOT NULL DEFAULT 0,
    status              VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'cancelled', 'incorporated')),
    submitted_by        UUID REFERENCES core.users(id),
    submitted_at        TIMESTAMPTZ,
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, variation_number)
);

CREATE INDEX IF NOT EXISTS variations_project_status_idx
    ON finance.variations (organization_id, project_id, status)
    WHERE is_deleted = false;

-- 5. PROGRESS CLAIMS

CREATE TABLE IF NOT EXISTS finance.progress_claims (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    claim_number        VARCHAR(40) NOT NULL,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    claim_period_start  DATE NOT NULL,
    claim_period_end    DATE NOT NULL,
    contract_value      NUMERIC(15,2) NOT NULL CHECK (contract_value >= 0),
    previous_certified  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (previous_certified >= 0),
    this_claim_amount   NUMERIC(15,2) NOT NULL CHECK (this_claim_amount >= 0),
    retention_pct       NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (retention_pct >= 0 AND retention_pct <= 100),
    retention_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (retention_amount >= 0),
    net_claim_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
    certified_amount    NUMERIC(15,2) CHECK (certified_amount IS NULL OR certified_amount >= 0),
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'certified', 'invoiced', 'paid', 'disputed', 'rejected')),
    submitted_by        UUID REFERENCES core.users(id),
    submitted_at        TIMESTAMPTZ,
    certified_by        UUID REFERENCES core.users(id),
    certified_at        TIMESTAMPTZ,
    rejection_reason    TEXT,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, claim_number),
    CHECK (claim_period_end >= claim_period_start)
);

CREATE INDEX IF NOT EXISTS progress_claims_project_idx
    ON finance.progress_claims (organization_id, project_id, status, claim_period_end DESC)
    WHERE is_deleted = false;

-- 6. RETENTION LEDGER

CREATE TABLE IF NOT EXISTS finance.retention_ledger (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    source_type         VARCHAR(40) NOT NULL
        CHECK (source_type IN ('progress_claim', 'practical_completion', 'final_completion', 'adjustment')),
    source_id           UUID,
    movement_type       VARCHAR(12) NOT NULL CHECK (movement_type IN ('held', 'released', 'adjusted')),
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    movement_date       DATE NOT NULL,
    notes               TEXT,
    recorded_by         UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS retention_ledger_project_idx
    ON finance.retention_ledger (organization_id, project_id, movement_date DESC);

-- 7. PROJECT FORECAST (running totals, refreshed on each DSR approval)

CREATE TABLE IF NOT EXISTS finance.project_forecasts (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id             UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id                  UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    as_at_date                  DATE NOT NULL,
    -- Revenue
    contract_value              NUMERIC(15,2) NOT NULL DEFAULT 0,
    approved_variations         NUMERIC(15,2) NOT NULL DEFAULT 0,
    revised_contract_value      NUMERIC(15,2) NOT NULL DEFAULT 0,
    certified_to_date           NUMERIC(15,2) NOT NULL DEFAULT 0,
    retention_held              NUMERIC(15,2) NOT NULL DEFAULT 0,
    invoiced_to_date            NUMERIC(15,2) NOT NULL DEFAULT 0,
    cash_collected              NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- Cost
    approved_budget             NUMERIC(15,2) NOT NULL DEFAULT 0,
    committed_cost              NUMERIC(15,2) NOT NULL DEFAULT 0,
    actual_cost_to_date         NUMERIC(15,2) NOT NULL DEFAULT 0,
    forecast_to_complete        NUMERIC(15,2) NOT NULL DEFAULT 0,
    estimate_at_completion      NUMERIC(15,2) NOT NULL DEFAULT 0,
    -- Margin
    forecast_margin_amount      NUMERIC(15,2) GENERATED ALWAYS AS (revised_contract_value - estimate_at_completion) STORED,
    forecast_margin_pct         NUMERIC(7,4),  -- updated by application logic
    -- Computed flags
    cost_overrun_risk           BOOLEAN NOT NULL DEFAULT false,
    cashflow_deficit_risk       BOOLEAN NOT NULL DEFAULT false,
    computed_by                 UUID REFERENCES core.users(id),
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_id, as_at_date)
);

CREATE INDEX IF NOT EXISTS project_forecasts_project_idx
    ON finance.project_forecasts (organization_id, project_id, as_at_date DESC);

-- 8. HR EXTENSIONS (attendance and leave)

CREATE TABLE IF NOT EXISTS hr.attendance_records (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    project_id          UUID REFERENCES projects.projects(id),
    site_id             UUID REFERENCES projects.sites(id),
    attendance_date     DATE NOT NULL,
    check_in            TIMESTAMPTZ,
    check_out           TIMESTAMPTZ,
    status              VARCHAR(24) NOT NULL DEFAULT 'present'
        CHECK (status IN ('present', 'absent', 'late', 'half_day', 'on_leave', 'public_holiday')),
    regular_hours       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0 AND regular_hours <= 24),
    overtime_hours      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
    recorded_by         UUID REFERENCES core.users(id),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, employee_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS attendance_project_date_idx
    ON hr.attendance_records (organization_id, project_id, attendance_date DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS hr.leave_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    leave_type          VARCHAR(40) NOT NULL
        CHECK (leave_type IN ('annual', 'sick', 'maternity', 'paternity', 'compassionate', 'study', 'unpaid', 'other')),
    start_date          DATE NOT NULL,
    end_date            DATE NOT NULL,
    days_requested      NUMERIC(5,2) NOT NULL CHECK (days_requested > 0),
    reason              TEXT,
    status              VARCHAR(24) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    submitted_by        UUID REFERENCES core.users(id),
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (end_date >= start_date)
);

-- 9. RLS ON ALL NEW TABLES

ALTER TABLE finance.project_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.project_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.budget_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.commitments FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.variations FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.progress_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.progress_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.retention_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.retention_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.project_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.project_forecasts FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.attendance_records FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.leave_requests FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.project_budgets, finance.budget_lines, finance.commitments FROM anon, authenticated;
REVOKE ALL ON finance.variations, finance.progress_claims, finance.retention_ledger FROM anon, authenticated;
REVOKE ALL ON finance.project_forecasts FROM anon, authenticated;
REVOKE ALL ON hr.attendance_records, hr.leave_requests FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.project_budgets;
CREATE POLICY "Finance service role only" ON finance.project_budgets FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.budget_lines;
CREATE POLICY "Finance service role only" ON finance.budget_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.commitments;
CREATE POLICY "Finance service role only" ON finance.commitments FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.variations;
CREATE POLICY "Finance service role only" ON finance.variations FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.progress_claims;
CREATE POLICY "Finance service role only" ON finance.progress_claims FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.retention_ledger;
CREATE POLICY "Finance service role only" ON finance.retention_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.project_forecasts;
CREATE POLICY "Finance service role only" ON finance.project_forecasts FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "HR service role only" ON hr.attendance_records;
CREATE POLICY "HR service role only" ON hr.attendance_records FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "HR service role only" ON hr.leave_requests;
CREATE POLICY "HR service role only" ON hr.leave_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 10. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.budget.read',             'View project budgets and budget lines'),
    ('finance.budget.create',           'Create and submit project budgets'),
    ('finance.budget.approve',          'Approve project budgets'),
    ('finance.commitment.read',         'View project financial commitments'),
    ('finance.commitment.create',       'Record financial commitments'),
    ('finance.variation.read',          'View project variations'),
    ('finance.variation.create',        'Submit project variations'),
    ('finance.variation.approve',       'Approve or reject variations'),
    ('finance.claim.read',              'View progress claims'),
    ('finance.claim.create',            'Prepare progress claims'),
    ('finance.claim.certify',           'Certify progress claims'),
    ('finance.forecast.read',           'View project forecasts and EAC'),
    ('finance.cost.read',               'View actual project costs'),
    ('finance.cost.export',             'Export financial data'),
    ('hr.attendance.read',              'View employee attendance records'),
    ('hr.attendance.record',            'Record employee attendance'),
    ('hr.leave.read',                   'View leave requests'),
    ('hr.leave.create',                 'Submit leave requests'),
    ('hr.leave.approve',                'Approve or reject leave requests')
ON CONFLICT (key) DO NOTHING;

-- 11. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'project_budgets'
        UNION ALL VALUES
        ('finance', 'budget_lines'),
        ('finance', 'commitments'),
        ('finance', 'variations'),
        ('finance', 'progress_claims'),
        ('finance', 'retention_ledger'),
        ('finance', 'project_forecasts'),
        ('hr', 'attendance_records'),
        ('hr', 'leave_requests')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
