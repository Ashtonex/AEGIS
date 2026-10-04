-- ============================================================================
-- AEGIS MIGRATION 247 — SITE PAYROLL + SUPPLIER PAYABLE ACTIONS
-- ============================================================================
-- Site payroll: people deployed to a project who are not AEGIS users or HR
-- employees (casual / hourly site labour). Finance or the site team logs
-- them against a project, records their hours, and pays them through a
-- per-project site pay run:
--
--   draft -> approved -> paid      (or cancelled before paid)
--
-- Paying a run writes one cashbook payment (outflow, tagged to the project)
-- and one labour finance.cost_transactions row against the project, so site
-- labour lands in project actual cost the same way every other cost does.
--
-- Payable events: an audit trail of what Finance did to a supplier invoice
-- from the Supplier Payments screen (paid, rejected, invoice requested,
-- paid without a 3-way match and why).
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.site_workers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    full_name           VARCHAR(160) NOT NULL,
    national_id         VARCHAR(40),
    phone               VARCHAR(40),
    trade               VARCHAR(80),
    hourly_rate         NUMERIC(12,2) NOT NULL CHECK (hourly_rate >= 0),
    overtime_rate       NUMERIC(12,2) CHECK (overtime_rate IS NULL OR overtime_rate >= 0),
    currency            VARCHAR(3) NOT NULL DEFAULT 'USD',
    payment_method      VARCHAR(20) NOT NULL DEFAULT 'cash'
        CHECK (payment_method IN ('cash', 'mobile_money', 'bank_transfer')),
    payment_details     VARCHAR(160),
    status              VARCHAR(12) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    start_date          DATE,
    end_date            DATE,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS site_workers_project_idx
    ON finance.site_workers (organization_id, project_id) WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS finance.site_pay_runs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    run_number          VARCHAR(40) NOT NULL,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL CHECK (period_end >= period_start),
    payment_date        DATE NOT NULL,
    cash_account_id     UUID REFERENCES finance.cash_accounts(id),
    status              VARCHAR(12) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'approved', 'paid', 'cancelled')),
    worker_count        INTEGER NOT NULL DEFAULT 0,
    total_hours         NUMERIC(12,2) NOT NULL DEFAULT 0,
    total_gross         NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_deductions    NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_net           NUMERIC(15,2) NOT NULL DEFAULT 0,
    notes               TEXT,
    cashbook_transaction_id UUID REFERENCES finance.cashbook_transactions(id) ON DELETE SET NULL,
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    paid_by             UUID REFERENCES core.users(id),
    paid_at             TIMESTAMPTZ,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, run_number)
);

CREATE INDEX IF NOT EXISTS site_pay_runs_project_idx
    ON finance.site_pay_runs (organization_id, project_id, period_start) WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS finance.site_time_entries (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    worker_id           UUID NOT NULL REFERENCES finance.site_workers(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    work_date           DATE NOT NULL,
    regular_hours       NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0 AND regular_hours <= 24),
    overtime_hours      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
    notes               VARCHAR(500),
    pay_run_id          UUID REFERENCES finance.site_pay_runs(id) ON DELETE SET NULL,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (worker_id, project_id, work_date)
);

CREATE INDEX IF NOT EXISTS site_time_entries_project_date_idx
    ON finance.site_time_entries (organization_id, project_id, work_date);

CREATE TABLE IF NOT EXISTS finance.site_pay_run_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    pay_run_id          UUID NOT NULL REFERENCES finance.site_pay_runs(id) ON DELETE CASCADE,
    worker_id           UUID NOT NULL REFERENCES finance.site_workers(id) ON DELETE RESTRICT,
    regular_hours       NUMERIC(8,2) NOT NULL DEFAULT 0,
    overtime_hours      NUMERIC(8,2) NOT NULL DEFAULT 0,
    hourly_rate         NUMERIC(12,2) NOT NULL,
    overtime_rate       NUMERIC(12,2) NOT NULL,
    gross_pay           NUMERIC(15,2) NOT NULL CHECK (gross_pay >= 0),
    deductions          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
    net_pay             NUMERIC(15,2) NOT NULL CHECK (net_pay >= 0),
    deduction_note      VARCHAR(200),
    UNIQUE (pay_run_id, worker_id)
);

CREATE TABLE IF NOT EXISTS finance.payable_events (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    supplier_invoice_id UUID NOT NULL REFERENCES procurement.supplier_invoices(id) ON DELETE CASCADE,
    action              VARCHAR(24) NOT NULL
        CHECK (action IN ('paid', 'rejected', 'invoice_requested', 'match_override')),
    amount              NUMERIC(15,2),
    reason              TEXT,
    email_sent          BOOLEAN,
    batch_id            UUID REFERENCES finance.supplier_payment_batches(id) ON DELETE SET NULL,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payable_events_invoice_idx
    ON finance.payable_events (organization_id, supplier_invoice_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['site_workers', 'site_pay_runs', 'site_time_entries', 'site_pay_run_lines', 'payable_events']
    LOOP
        EXECUTE format('ALTER TABLE finance.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE finance.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON finance.%I FROM anon, authenticated', t);
        EXECUTE format('DROP POLICY IF EXISTS "Finance service role only" ON finance.%I', t);
        EXECUTE format('CREATE POLICY "Finance service role only" ON finance.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON finance.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION core.process_audit_log()', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS live_change_notify ON finance.%I', t);
        EXECUTE format('CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION core.notify_table_change()', t);
    END LOOP;
END $$;
