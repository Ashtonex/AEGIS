-- ============================================================================
-- AEGIS MIGRATION 034 - FINANCE TREASURY AND PAYROLL FOUNDATION
-- Adds bank/cash accounts, cashbook movements, receipt allocation, supplier
-- payment batches, and payroll run ledgers for source-backed finance operations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.cash_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    account_code        VARCHAR(40) NOT NULL,
    account_name        VARCHAR(255) NOT NULL,
    account_type        VARCHAR(24) NOT NULL CHECK (account_type IN ('bank', 'cash', 'mobile_money')),
    bank_name           VARCHAR(160),
    branch_name         VARCHAR(160),
    account_number      VARCHAR(120),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    opening_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
    current_balance     NUMERIC(15,2) NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, account_code)
);

CREATE TABLE IF NOT EXISTS finance.cashbook_transactions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    cash_account_id     UUID NOT NULL REFERENCES finance.cash_accounts(id) ON DELETE RESTRICT,
    transaction_number  VARCHAR(40) NOT NULL,
    transaction_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    transaction_type    VARCHAR(24) NOT NULL CHECK (transaction_type IN ('receipt', 'payment', 'transfer_in', 'transfer_out', 'bank_charge', 'adjustment')),
    direction           VARCHAR(8) NOT NULL CHECK (direction IN ('inflow', 'outflow')),
    source_type         VARCHAR(80),
    source_id           UUID,
    project_id          UUID REFERENCES projects.projects(id),
    counterparty_type   VARCHAR(40),
    counterparty_name   VARCHAR(255),
    payment_method      VARCHAR(40) NOT NULL DEFAULT 'bank_transfer',
    reference           VARCHAR(160),
    description         TEXT NOT NULL,
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    reconciliation_status VARCHAR(24) NOT NULL DEFAULT 'unreconciled' CHECK (reconciliation_status IN ('unreconciled', 'matched', 'reconciled', 'disputed')),
    reconciled_at       TIMESTAMPTZ,
    reconciled_by       UUID REFERENCES core.users(id),
    posted_by           UUID REFERENCES core.users(id),
    posted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, transaction_number)
);

CREATE TABLE IF NOT EXISTS finance.receipt_allocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    cashbook_transaction_id UUID NOT NULL REFERENCES finance.cashbook_transactions(id) ON DELETE CASCADE,
    progress_claim_id   UUID NOT NULL REFERENCES finance.progress_claims(id) ON DELETE RESTRICT,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    allocated_amount    NUMERIC(15,2) NOT NULL CHECK (allocated_amount > 0),
    allocated_by        UUID REFERENCES core.users(id),
    allocated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, cashbook_transaction_id, progress_claim_id)
);

CREATE TABLE IF NOT EXISTS finance.supplier_payment_batches (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    batch_number        VARCHAR(40) NOT NULL,
    cash_account_id     UUID NOT NULL REFERENCES finance.cash_accounts(id) ON DELETE RESTRICT,
    payment_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    status              VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    payment_method      VARCHAR(40) NOT NULL DEFAULT 'bank_transfer',
    reference           VARCHAR(160),
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    posted_by           UUID REFERENCES core.users(id),
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, batch_number)
);

CREATE TABLE IF NOT EXISTS finance.supplier_payment_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    batch_id            UUID NOT NULL REFERENCES finance.supplier_payment_batches(id) ON DELETE CASCADE,
    supplier_invoice_id UUID NOT NULL REFERENCES procurement.supplier_invoices(id) ON DELETE RESTRICT,
    supplier_id         UUID NOT NULL REFERENCES procurement.suppliers(id) ON DELETE RESTRICT,
    project_id          UUID REFERENCES projects.projects(id),
    amount              NUMERIC(15,2) NOT NULL CHECK (amount > 0),
    payment_reference   VARCHAR(160),
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, batch_id, supplier_invoice_id)
);

CREATE TABLE IF NOT EXISTS finance.employee_pay_profiles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    pay_type            VARCHAR(24) NOT NULL CHECK (pay_type IN ('monthly_salary', 'hourly', 'daily')),
    base_rate           NUMERIC(15,2) NOT NULL CHECK (base_rate >= 0),
    overtime_rate       NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (overtime_rate >= 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    bank_name           VARCHAR(160),
    bank_account_number VARCHAR(120),
    tax_number          VARCHAR(80),
    nssa_number         VARCHAR(80),
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, employee_id)
);

CREATE TABLE IF NOT EXISTS finance.payroll_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    run_number          VARCHAR(40) NOT NULL,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    payment_date        DATE NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'posted', 'cancelled')),
    cash_account_id     UUID REFERENCES finance.cash_accounts(id),
    gross_pay           NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions    NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_pay             NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES core.users(id),
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    posted_by           UUID REFERENCES core.users(id),
    posted_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, run_number),
    CHECK (period_end >= period_start)
);

CREATE TABLE IF NOT EXISTS finance.payroll_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    payroll_run_id      UUID NOT NULL REFERENCES finance.payroll_runs(id) ON DELETE CASCADE,
    employee_id         UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    project_id          UUID REFERENCES projects.projects(id),
    regular_hours       NUMERIC(8,2) NOT NULL DEFAULT 0,
    overtime_hours      NUMERIC(8,2) NOT NULL DEFAULT 0,
    gross_pay           NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_deduction       NUMERIC(15,2) NOT NULL DEFAULT 0,
    statutory_deduction NUMERIC(15,2) NOT NULL DEFAULT 0,
    other_deduction     NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_pay             NUMERIC(15,2) NOT NULL DEFAULT 0,
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, payroll_run_id, employee_id)
);

CREATE INDEX IF NOT EXISTS cashbook_account_date_idx ON finance.cashbook_transactions (organization_id, cash_account_id, transaction_date DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS receipt_allocations_claim_idx ON finance.receipt_allocations (organization_id, progress_claim_id);
CREATE INDEX IF NOT EXISTS supplier_payment_batches_status_idx ON finance.supplier_payment_batches (organization_id, status, payment_date DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS payroll_runs_status_idx ON finance.payroll_runs (organization_id, status, payment_date DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS payroll_items_run_idx ON finance.payroll_items (organization_id, payroll_run_id);

ALTER TABLE finance.cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cash_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.cashbook_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cashbook_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.receipt_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.receipt_allocations FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.supplier_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.supplier_payment_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.supplier_payment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.supplier_payment_items FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.employee_pay_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.employee_pay_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payroll_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.payroll_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payroll_items FORCE ROW LEVEL SECURITY;

INSERT INTO core.permissions (key, description)
VALUES
    ('finance.cash.read', 'Read bank, cash and cashbook ledgers'),
    ('finance.cash.manage', 'Create and manage bank or cash accounts'),
    ('finance.cash.post', 'Post receipts, payments and transfers to the cashbook'),
    ('finance.receipt.allocate', 'Allocate client receipts to progress claims'),
    ('finance.supplier_payment.post', 'Post supplier payment batches'),
    ('finance.payroll.read', 'Read payroll profiles and runs'),
    ('finance.payroll.manage', 'Create and manage payroll profiles and runs'),
    ('finance.payroll.post', 'Approve and post payroll runs')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'finance.cash.read', 'finance.cash.manage', 'finance.cash.post',
    'finance.receipt.allocate', 'finance.supplier_payment.post',
    'finance.payroll.read', 'finance.payroll.manage', 'finance.payroll.post'
)
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Finance Manager')
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.cash.read', 'finance.payroll.read')
WHERE r.is_deleted = false
  AND r.name IN ('Project Manager')
ON CONFLICT DO NOTHING;
