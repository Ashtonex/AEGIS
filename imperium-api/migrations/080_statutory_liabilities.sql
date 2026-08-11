-- ============================================================================
-- AEGIS MIGRATION 080 — STATUTORY LIABILITY LEDGER (PHASE 3b)
-- ============================================================================
-- A real accruing/settling ledger for ZIMRA/NSSA obligations (VAT, PAYE,
-- NSSA employee/employer, AIDS levy), replacing "computed once and
-- discarded" with "tracked as money actually owed for a period."
--
-- Purely additive: every new column on existing tables is nullable/
-- defaulted, and the legacy finance.payroll_items.tax_deduction /
-- statutory_deduction columns are left in place and still populated (see
-- migration 081) so every existing reader keeps working unchanged.
-- ============================================================================

-- 1. LIABILITY LEDGER

CREATE TABLE IF NOT EXISTS finance.statutory_liabilities (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    authority           VARCHAR(20) NOT NULL CHECK (authority IN ('zimra', 'nssa', 'other')),
    liability_type      VARCHAR(30) NOT NULL
        CHECK (liability_type IN ('vat', 'paye', 'nssa_employee', 'nssa_employer', 'aids_levy', 'withholding_tax', 'other')),
    currency            VARCHAR(3) NOT NULL,
    period_type         VARCHAR(10) NOT NULL CHECK (period_type IN ('month', 'quarter', 'year')),
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    due_date            DATE,
    gross_accrued       NUMERIC(15,2) NOT NULL DEFAULT 0,
    offset_amount       NUMERIC(15,2) NOT NULL DEFAULT 0,
    settled_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_due             NUMERIC(15,2) GENERATED ALWAYS AS (gross_accrued - offset_amount) STORED,
    outstanding_amount  NUMERIC(15,2) GENERATED ALWAYS AS (gross_accrued - offset_amount - settled_amount) STORED,
    status              VARCHAR(20) NOT NULL DEFAULT 'accruing'
        CHECK (status IN ('accruing', 'due', 'filed', 'part_paid', 'paid', 'refund_due', 'waived')),
    filed_at            TIMESTAMPTZ,
    filed_by            UUID REFERENCES core.users(id),
    filing_reference    VARCHAR(120),
    compliance_item_id  UUID,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, authority, liability_type, currency, period_start, period_end),
    CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS statutory_liabilities_status_idx
    ON finance.statutory_liabilities (organization_id, status, due_date)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.statutory_liability_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    liability_id        UUID NOT NULL REFERENCES finance.statutory_liabilities(id) ON DELETE CASCADE,
    direction           VARCHAR(12) NOT NULL CHECK (direction IN ('output', 'input', 'adjustment')),
    source_type         VARCHAR(120),
    source_id           UUID,
    project_id          UUID REFERENCES projects.projects(id),
    department_id       UUID REFERENCES finance.departments(id),
    employee_id         UUID REFERENCES hr.employees(id),
    taxable_base        NUMERIC(15,2),
    rate_table_id       UUID REFERENCES finance.tax_rate_tables(id),
    computed_amount     NUMERIC(15,2) NOT NULL,
    basis               JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, liability_id, source_type, source_id, direction)
);

CREATE INDEX IF NOT EXISTS statutory_liability_lines_liability_idx
    ON finance.statutory_liability_lines (organization_id, liability_id);
CREATE INDEX IF NOT EXISTS statutory_liability_lines_department_idx
    ON finance.statutory_liability_lines (organization_id, department_id)
    WHERE department_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS finance.statutory_settlements (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    liability_id            UUID NOT NULL REFERENCES finance.statutory_liabilities(id),
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    payment_date            DATE NOT NULL,
    amount                  NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    reference               VARCHAR(160),
    notes                   TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS statutory_settlements_liability_idx
    ON finance.statutory_settlements (organization_id, liability_id);

CREATE TABLE IF NOT EXISTS finance.statutory_profile (
    organization_id             UUID PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
    vat_registration_number     VARCHAR(60),
    zimra_bp_number             VARCHAR(60),
    nssa_employer_number        VARCHAR(60),
    vat_filing_frequency        VARCHAR(20),
    vat_filing_day              SMALLINT,
    paye_filing_day             SMALLINT,
    nssa_filing_day             SMALLINT,
    vat_basis                   VARCHAR(10) NOT NULL DEFAULT 'invoice' CHECK (vat_basis IN ('invoice', 'payments')),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ADDITIVE COLUMNS ON EXISTING TABLES

-- Granular statutory figures on payroll_items. The legacy tax_deduction/
-- statutory_deduction columns (migration 034) stay and stay populated
-- (tax_deduction = paye + aids_levy, statutory_deduction = nssa_employee)
-- so every existing reader - payslip YTD view, run-total rollups - keeps
-- working unchanged. See migration 081 for the write-path change.
ALTER TABLE finance.payroll_items
    ADD COLUMN IF NOT EXISTS paye_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS nssa_employee_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS nssa_employer_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aids_levy_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS taxable_gross NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS rate_table_id UUID REFERENCES finance.tax_rate_tables(id);

ALTER TABLE finance.payroll_runs
    ADD COLUMN IF NOT EXISTS statutory_liability_id UUID REFERENCES finance.statutory_liabilities(id);

ALTER TABLE finance.progress_claims
    ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS vat_rate_table_id UUID REFERENCES finance.tax_rate_tables(id),
    ADD COLUMN IF NOT EXISTS is_vat_inclusive BOOLEAN NOT NULL DEFAULT false;

-- Not all supplier VAT is legally claimable as input VAT (needs a valid
-- fiscal tax invoice from a VAT-registered supplier) - the flag lets the
-- recompute step only net genuinely claimable amounts.
ALTER TABLE procurement.supplier_invoices
    ADD COLUMN IF NOT EXISTS input_vat_claimable BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS vat_liability_line_id UUID REFERENCES finance.statutory_liability_lines(id);

ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS vat_registration_number VARCHAR(60),
    ADD COLUMN IF NOT EXISTS is_vat_registered BOOLEAN NOT NULL DEFAULT false;

-- Minimum honest fix to core.compliance_items: the real table (migration
-- 001) only ever had certificate_name/expiry_date - the router fabricates
-- authority/category/responsible_person/status as hardcoded literals
-- regardless of the actual row. Add the genuinely-missing columns so new
-- rows can tell the truth; existing rows stay NULL and the router falls
-- back to the same literals it already used (COALESCE), so nothing visible
-- changes for old rows.
ALTER TABLE core.compliance_items
    ADD COLUMN IF NOT EXISTS authority VARCHAR(120),
    ADD COLUMN IF NOT EXISTS category VARCHAR(60),
    ADD COLUMN IF NOT EXISTS responsible_person VARCHAR(255),
    ADD COLUMN IF NOT EXISTS status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS notes TEXT,
    ADD COLUMN IF NOT EXISTS issue_date DATE,
    ADD COLUMN IF NOT EXISTS reference VARCHAR(160);

ALTER TABLE finance.statutory_liabilities
    ADD CONSTRAINT statutory_liabilities_compliance_item_fk
    FOREIGN KEY (compliance_item_id) REFERENCES core.compliance_items(id)
    ON DELETE SET NULL NOT VALID;

-- 3. RLS

ALTER TABLE finance.statutory_liabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_liabilities FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_liability_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_liability_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_settlements FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.statutory_profile FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.statutory_liabilities, finance.statutory_liability_lines,
    finance.statutory_settlements, finance.statutory_profile FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.statutory_liabilities;
CREATE POLICY "Finance service role only" ON finance.statutory_liabilities FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Finance service role only" ON finance.statutory_liability_lines;
CREATE POLICY "Finance service role only" ON finance.statutory_liability_lines FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Finance service role only" ON finance.statutory_settlements;
CREATE POLICY "Finance service role only" ON finance.statutory_settlements FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Finance service role only" ON finance.statutory_profile;
CREATE POLICY "Finance service role only" ON finance.statutory_profile FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Live-push
DROP TRIGGER IF EXISTS live_change_notify ON finance.statutory_liabilities;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.statutory_liabilities
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

-- 4. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.statutory.read',   'View statutory (ZIMRA/NSSA) liability ledger'),
    ('finance.statutory.manage', 'Recompute statutory liabilities from source records'),
    ('finance.statutory.file',   'Mark statutory liabilities as filed'),
    ('finance.statutory.settle', 'Record statutory liability settlements/payments')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.statutory.read', 'finance.statutory.manage', 'finance.statutory.file', 'finance.statutory.settle'
)
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Finance Manager')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.statutory.read'
WHERE r.is_deleted = false
  AND r.name IN ('Managing Director', 'Project Manager')
ON CONFLICT DO NOTHING;

-- 5. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'statutory_liabilities'
        UNION ALL VALUES
        ('finance', 'statutory_liability_lines'),
        ('finance', 'statutory_settlements'),
        ('finance', 'statutory_profile')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
