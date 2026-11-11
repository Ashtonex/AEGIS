-- ============================================================================
-- AEGIS MIGRATION 297 - PAYROLL PHASE 2: RETURNS AND BANK FILES
-- ============================================================================
-- What a payroll needs after the run is calculated (Belina-style):
--
--   1. Where each employee is paid, per currency (USD and ZiG usually go to
--      different accounts): bank, mobile money or cash. Changes are never
--      edited in place - the old record is ended and a new one starts - so the
--      history of an employee's bank details is kept for audit.
--   2. Employee tax number (ZIMRA) and NSSA number on the pay profile, for
--      the monthly PAYE and NSSA schedules.
--   3. Export layouts. ZIMRA (TaRMS), NSSA and each bank publish their own
--      upload templates and change them, so the column list, order, headers,
--      separator and date format are org data, not code. Built-in default
--      layouts live in code; rows here are the org's own.
--   4. A log of every file produced (who, when, what it covered, totals,
--      checksum). File contents are not stored: they hold bank details.
--
-- Nothing is back-filled: production had no payroll runs when this was written.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Employee payment accounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.employee_payment_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    currency            VARCHAR(3) NOT NULL,
    method              VARCHAR(16) NOT NULL CHECK (method IN ('bank', 'mobile_money', 'cash')),
    bank_name           VARCHAR(120),
    branch_code         VARCHAR(40),
    branch_name         VARCHAR(120),
    account_number      VARCHAR(60),
    account_name        VARCHAR(160),
    mobile_number       VARCHAR(40),
    effective_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    ended_at            TIMESTAMPTZ,
    ended_by            UUID REFERENCES core.users(id),
    end_reason          TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT employee_payment_accounts_bank_ck
        CHECK (method <> 'bank' OR (bank_name IS NOT NULL AND account_number IS NOT NULL)),
    CONSTRAINT employee_payment_accounts_mobile_ck
        CHECK (method <> 'mobile_money' OR mobile_number IS NOT NULL),
    CONSTRAINT employee_payment_accounts_currency_ck
        CHECK (currency ~ '^[A-Z]{3}$')
);

-- One live account per employee per currency.
CREATE UNIQUE INDEX IF NOT EXISTS employee_payment_accounts_live_uidx
    ON finance.employee_payment_accounts (organization_id, employee_id, currency)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS employee_payment_accounts_employee_idx
    ON finance.employee_payment_accounts (organization_id, employee_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. Carry over bank details already on pay profiles
-- ---------------------------------------------------------------------------
-- employee_pay_profiles has had one bank_name / bank_account_number pair
-- since migration 034, editable by anyone with finance.payroll.manage. From
-- here on payment accounts live in the table above (per currency, history
-- kept, narrower permission). Existing pairs become the employee's account
-- in the profile's currency. tax_number / nssa_number stay on the profile.

INSERT INTO finance.employee_payment_accounts (
    organization_id, employee_id, currency, method, bank_name, account_number, effective_from
)
SELECT p.organization_id, p.employee_id, UPPER(p.currency), 'bank',
       BTRIM(p.bank_name), BTRIM(p.bank_account_number), CURRENT_DATE
FROM finance.employee_pay_profiles p
WHERE p.is_deleted = false
  AND NULLIF(BTRIM(p.bank_name), '') IS NOT NULL
  AND NULLIF(BTRIM(p.bank_account_number), '') IS NOT NULL
  AND UPPER(p.currency) ~ '^[A-Z]{3}$'
  AND NOT EXISTS (
      SELECT 1 FROM finance.employee_payment_accounts a
      WHERE a.organization_id = p.organization_id AND a.employee_id = p.employee_id
  );

-- ---------------------------------------------------------------------------
-- 3. Export layouts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.payroll_export_layouts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    kind                VARCHAR(12) NOT NULL CHECK (kind IN ('bank', 'paye', 'nssa')),
    name                VARCHAR(120) NOT NULL,
    description         TEXT,
    delimiter           VARCHAR(4) NOT NULL DEFAULT ',' CHECK (delimiter IN (',', ';', '|', 'tab')),
    include_header      BOOLEAN NOT NULL DEFAULT true,
    date_format         VARCHAR(12) NOT NULL DEFAULT 'YYYY-MM-DD'
        CHECK (date_format IN ('YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'MM/DD/YYYY', 'YYYYMMDD', 'DDMMYYYY')),
    -- [{"field": "<key>", "header": "<column title>"}, {"field": "constant", "value": "SAL", "header": "Type"}]
    columns             JSONB NOT NULL CHECK (jsonb_typeof(columns) = 'array' AND jsonb_array_length(columns) > 0),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    updated_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, kind, name)
);

-- ---------------------------------------------------------------------------
-- 4. Export log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS finance.payroll_exports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    kind                VARCHAR(12) NOT NULL CHECK (kind IN ('bank', 'paye', 'nssa')),
    layout_id           UUID REFERENCES finance.payroll_export_layouts(id) ON DELETE SET NULL,
    layout_name         VARCHAR(120) NOT NULL,
    payroll_run_id      UUID REFERENCES finance.payroll_runs(id) ON DELETE SET NULL,
    period_month        DATE CHECK (period_month IS NULL OR EXTRACT(DAY FROM period_month) = 1),
    currency            VARCHAR(3) NOT NULL,
    file_name           VARCHAR(200) NOT NULL,
    row_count           INTEGER NOT NULL,
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0,
    content_sha256      VARCHAR(64) NOT NULL,
    warnings            JSONB,
    generated_by        UUID REFERENCES core.users(id),
    generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Returns cover a month; a bank file covers a run (payroll_run_id may go
    -- NULL only if that run is ever hard-deleted).
    CHECK (kind = 'bank' OR period_month IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS payroll_exports_org_idx
    ON finance.payroll_exports (organization_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS payroll_exports_run_idx
    ON finance.payroll_exports (payroll_run_id, currency) WHERE payroll_run_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS (service role only) and audit
-- ---------------------------------------------------------------------------

DO $$
DECLARE t_name text;
BEGIN
    FOREACH t_name IN ARRAY ARRAY['employee_payment_accounts', 'payroll_export_layouts', 'payroll_exports']
    LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t_name);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t_name);
        EXECUTE format('REVOKE ALL ON finance.%I FROM anon, authenticated', t_name);
        EXECUTE format('DROP POLICY IF EXISTS "Finance service role only" ON finance.%I', t_name);
        EXECUTE format('CREATE POLICY "Finance service role only" ON finance.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t_name);
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON finance.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON finance.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, t_name, t_name, t_name
        );
    END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

INSERT INTO core.permissions (key, description) VALUES
    ('finance.payroll.export',               'Produce payroll bank files and PAYE / NSSA return schedules'),
    ('finance.payroll.payment_details.manage', 'Add or change where employees are paid (bank, mobile money, cash)')
ON CONFLICT (key) DO NOTHING;

-- Exporting follows whoever can post payroll.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT DISTINCT rp.organization_id, rp.role_id, p_new.id
FROM core.role_permissions rp
JOIN core.permissions p_old ON p_old.id = rp.permission_id AND p_old.key = 'finance.payroll.post'
JOIN core.permissions p_new ON p_new.key = 'finance.payroll.export'
ON CONFLICT DO NOTHING;

-- Changing bank details is the classic payroll fraud route: grant narrowly.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.payroll.payment_details.manage'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Finance Manager')
ON CONFLICT DO NOTHING;
