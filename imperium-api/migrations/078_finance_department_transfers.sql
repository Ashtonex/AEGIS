-- ============================================================================
-- AEGIS MIGRATION 078 — FINANCE DEPARTMENT TRANSFERS (PHASE 2)
-- ============================================================================
-- Adds real double-sided internal-transfer postings between departments:
-- an internal plant hire (Plant & Equipment -> Construction) posts a real
-- charge to the hiring department and a real credit to the owning
-- department, and a Commercial-sourced deal can (optionally, via a
-- configurable rule) credit the originating department on top of what the
-- delivering department already books.
--
-- Purely additive: every new column is nullable, the rules table ships with
-- zero rows (no rule -> no auto-posting -> zero behaviour change to the
-- existing CRM won-flow or fleet utilization-recording flow until the user
-- configures something), and no existing CHECK constraint is altered.
-- ============================================================================

-- 1. DEPARTMENT TRANSFERS (header + legs)

CREATE SEQUENCE IF NOT EXISTS finance.department_transfer_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS finance.department_transfers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    transfer_number     VARCHAR(40) NOT NULL,
    transfer_type       VARCHAR(40) NOT NULL
        CHECK (transfer_type IN ('internal_plant_hire', 'internal_referral', 'internal_service', 'manual_adjustment')),
    transfer_date       DATE NOT NULL,
    from_department_id  UUID REFERENCES finance.departments(id),
    to_department_id    UUID REFERENCES finance.departments(id),
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    project_id          UUID REFERENCES projects.projects(id),
    description         TEXT,
    source_type         VARCHAR(120),
    source_id           UUID,
    basis               JSONB,
    status              VARCHAR(20) NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft', 'posted', 'reversed')),
    reversal_of_id      UUID REFERENCES finance.department_transfers(id),
    posted_by           UUID REFERENCES core.users(id),
    posted_at           TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, transfer_number),
    CHECK (from_department_id IS DISTINCT FROM to_department_id)
);

-- Idempotency: re-posting for an edited source record (e.g. a corrected
-- utilization log) updates the existing transfer rather than duplicating it.
CREATE UNIQUE INDEX IF NOT EXISTS department_transfers_source_idx
    ON finance.department_transfers (organization_id, source_type, source_id, transfer_type)
    WHERE source_id IS NOT NULL AND status <> 'reversed';

CREATE INDEX IF NOT EXISTS department_transfers_project_idx
    ON finance.department_transfers (organization_id, project_id, transfer_date DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.department_transfer_legs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    transfer_id         UUID NOT NULL REFERENCES finance.department_transfers(id) ON DELETE CASCADE,
    department_id       UUID REFERENCES finance.departments(id),
    leg_type            VARCHAR(10) NOT NULL CHECK (leg_type IN ('charge', 'credit')),
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    project_id          UUID REFERENCES projects.projects(id),
    cost_category       VARCHAR(40),
    transfer_date       DATE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS department_transfer_legs_dept_idx
    ON finance.department_transfer_legs (organization_id, department_id, leg_type, transfer_date DESC);

CREATE INDEX IF NOT EXISTS department_transfer_legs_transfer_idx
    ON finance.department_transfer_legs (organization_id, transfer_id);

-- 2. TRANSFER RULES (pluggable business rule, shipped empty)

CREATE TABLE IF NOT EXISTS finance.department_transfer_rules (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    rule_code           VARCHAR(60) NOT NULL,
    transfer_type       VARCHAR(40) NOT NULL,
    from_department_id  UUID REFERENCES finance.departments(id),
    to_department_id    UUID REFERENCES finance.departments(id),
    basis               VARCHAR(30) NOT NULL
        CHECK (basis IN ('percent_of_contract_value', 'fixed_amount', 'percent_of_margin', 'manual')),
    rate                NUMERIC(9,4),
    fixed_amount        NUMERIC(15,2),
    trigger_event       VARCHAR(40) NOT NULL
        CHECK (trigger_event IN ('opportunity_won', 'progress_claim_certified', 'receipt_allocated')),
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, rule_code)
);

-- Deliberately no seed INSERT here - zero rows means zero auto-posting
-- until the user configures a rule through the UI.

-- 3. ADDITIVE COLUMNS

-- Which department "owns" a piece of equipment, for revenue-crediting
-- purposes - distinct from current_project_id (migration 024), which is
-- just wherever the asset is currently deployed.
ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS owning_department_id UUID REFERENCES finance.departments(id);

CREATE INDEX IF NOT EXISTS fleet_owning_department_idx
    ON fleet.fleet (organization_id, owning_department_id)
    WHERE is_deleted = false AND owning_department_id IS NOT NULL;

-- Which department sourced a deal - distinct from projects.projects.department_id
-- (which department delivers it), the same "two different questions" split
-- migration 077 already used to keep department_id separate from project_type.
ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS originating_department_id UUID REFERENCES finance.departments(id);

ALTER TABLE finance.quotations
    ADD COLUMN IF NOT EXISTS originating_department_id UUID REFERENCES finance.departments(id);

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS originating_department_id UUID REFERENCES finance.departments(id);

ALTER TABLE fleet.utilization_logs
    ADD COLUMN IF NOT EXISTS department_transfer_id UUID REFERENCES finance.department_transfers(id);

-- 4. RLS

ALTER TABLE finance.department_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.department_transfers FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.department_transfer_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.department_transfer_legs FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.department_transfer_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.department_transfer_rules FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.department_transfers, finance.department_transfer_legs, finance.department_transfer_rules
    FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.department_transfers;
CREATE POLICY "Finance service role only" ON finance.department_transfers FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.department_transfer_legs;
CREATE POLICY "Finance service role only" ON finance.department_transfer_legs FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.department_transfer_rules;
CREATE POLICY "Finance service role only" ON finance.department_transfer_rules FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.transfer.read',        'View internal department transfers and department P&L'),
    ('finance.transfer.create',      'Create manual internal department transfers'),
    ('finance.transfer.post',        'Post internal department transfers'),
    ('finance.transfer.reverse',     'Reverse posted internal department transfers'),
    ('finance.transfer.rule.manage', 'Configure automatic internal transfer / referral rules')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.transfer.read', 'finance.transfer.create', 'finance.transfer.post', 'finance.transfer.reverse'
)
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Finance Manager', 'Project Manager')
ON CONFLICT DO NOTHING;

-- Configuring a revenue-sharing rule is a higher-trust action than viewing
-- or posting transfers - grant narrowly.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.transfer.rule.manage'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Finance Manager')
ON CONFLICT DO NOTHING;

-- 6. LIVE-PUSH: extend migration 075's generic change-notify trigger to
-- the new transfers table (core.notify_table_change() already exists).

DROP TRIGGER IF EXISTS live_change_notify ON finance.department_transfers;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.department_transfers
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

-- 7. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'department_transfers'
        UNION ALL VALUES
        ('finance', 'department_transfer_legs'),
        ('finance', 'department_transfer_rules')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
