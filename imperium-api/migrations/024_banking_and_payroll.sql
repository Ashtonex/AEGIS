-- ============================================================================
-- AEGIS MIGRATION 024 — BANKING AND PAYROLL DOMAIN
-- Adds manual banking, cash management, and payroll features.
-- ============================================================================

-- 1. BANKING & CASH MANAGEMENT

CREATE TABLE IF NOT EXISTS finance.bank_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    bank_name           VARCHAR(255),
    account_number      VARCHAR(100),
    currency            VARCHAR(3) NOT NULL DEFAULT 'ZAR',
    current_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
    status              VARCHAR(24) NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'frozen')),
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, account_number)
);

CREATE INDEX IF NOT EXISTS bank_accounts_org_idx
    ON finance.bank_accounts (organization_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS finance.bank_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    bank_account_id     UUID NOT NULL REFERENCES finance.bank_accounts(id) ON DELETE RESTRICT,
    transaction_date    DATE NOT NULL,
    type                VARCHAR(24) NOT NULL 
        CHECK (type IN ('deposit', 'withdrawal', 'transfer', 'fee', 'interest')),
    amount              NUMERIC(15,2) NOT NULL, -- positive for deposit, negative for withdrawal
    reference           VARCHAR(255),
    description         TEXT,
    reconciled          BOOLEAN NOT NULL DEFAULT false,
    recorded_by         UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS bank_transactions_account_date_idx
    ON finance.bank_transactions (organization_id, bank_account_id, transaction_date DESC)
    WHERE is_deleted = false;

-- Trigger to update bank account balance automatically
CREATE OR REPLACE FUNCTION finance.update_bank_balance()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE finance.bank_accounts
        SET current_balance = current_balance + NEW.amount
        WHERE id = NEW.bank_account_id;
    ELSIF TG_OP = 'UPDATE' THEN
        UPDATE finance.bank_accounts
        SET current_balance = current_balance - OLD.amount + NEW.amount
        WHERE id = NEW.bank_account_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE finance.bank_accounts
        SET current_balance = current_balance - OLD.amount
        WHERE id = OLD.bank_account_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_bank_balance ON finance.bank_transactions;
CREATE TRIGGER trg_update_bank_balance
    AFTER INSERT OR UPDATE OF amount OR DELETE ON finance.bank_transactions
    FOR EACH ROW EXECUTE FUNCTION finance.update_bank_balance();


CREATE TABLE IF NOT EXISTS finance.payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    bank_transaction_id UUID NOT NULL REFERENCES finance.bank_transactions(id) ON DELETE CASCADE,
    source_type         VARCHAR(40) NOT NULL CHECK (source_type IN ('commitment', 'progress_claim')),
    source_id           UUID NOT NULL, -- References finance.commitments(id) or finance.progress_claims(id)
    allocated_amount    NUMERIC(15,2) NOT NULL CHECK (allocated_amount > 0),
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_source_idx
    ON finance.payments (organization_id, source_type, source_id);

-- 2. PAYROLL MANAGEMENT

CREATE TABLE IF NOT EXISTS hr.payroll_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
    total_gross         NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_net           NUMERIC(15,2) NOT NULL DEFAULT 0,
    payment_date        DATE,
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS payroll_runs_org_idx
    ON hr.payroll_runs (organization_id, period_start DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS hr.payslips (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    payroll_run_id      UUID NOT NULL REFERENCES hr.payroll_runs(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    regular_hours       NUMERIC(5,2) NOT NULL DEFAULT 0,
    overtime_hours      NUMERIC(5,2) NOT NULL DEFAULT 0,
    hourly_rate         NUMERIC(15,4) NOT NULL DEFAULT 0,
    gross_pay           NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
    deductions          NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_pay             NUMERIC(15,2) GENERATED ALWAYS AS (gross_pay - tax_amount - deductions) STORED,
    status              VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'paid')),
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS payslips_run_idx
    ON hr.payslips (organization_id, payroll_run_id);

-- 3. RLS AND POLICIES

ALTER TABLE finance.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.payslips ENABLE ROW LEVEL SECURITY;

ALTER TABLE finance.bank_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.payments FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.payroll_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE hr.payslips FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.bank_accounts, finance.bank_transactions, finance.payments FROM anon, authenticated;
REVOKE ALL ON hr.payroll_runs, hr.payslips FROM anon, authenticated;

CREATE POLICY "Bank Accounts service role only" ON finance.bank_accounts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Bank Transactions service role only" ON finance.bank_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Payments service role only" ON finance.payments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Payroll Runs service role only" ON hr.payroll_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Payslips service role only" ON hr.payslips FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4. PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.bank.read',               'View bank accounts and balances'),
    ('finance.bank.manage',             'Manage bank accounts and record transactions'),
    ('finance.payment.create',          'Allocate payments against commitments or claims'),
    ('hr.payroll.read',                 'View payroll runs and payslips'),
    ('hr.payroll.manage',               'Create and manage payroll runs'),
    ('hr.payroll.approve',              'Approve and pay payroll runs')
ON CONFLICT (key) DO NOTHING;

-- 5. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'bank_accounts'
        UNION ALL VALUES
        ('finance', 'bank_transactions'),
        ('finance', 'payments'),
        ('hr', 'payroll_runs'),
        ('hr', 'payslips')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
