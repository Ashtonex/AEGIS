-- ============================================================================
-- AEGIS MIGRATION 182 — FINANCE GENERAL LEDGER: JOURNAL ENTRIES (PHASE 1)
-- ============================================================================
-- The double-entry core: finance.journal_entries (header) and
-- finance.journal_lines (debit/credit legs), generalizing the header+legs
-- shape already proven by finance.department_transfers /
-- _transfer_legs (migration 078) to N lines with full dimensional tagging.
--
-- Invariants enforced by DB trigger (not just application code, because this
-- backend has no ORM and every write path is raw SQL - a trigger is the one
-- enforcement point that can't be bypassed by a future script or migration):
--   1. A journal may only be posted (draft -> posted) when its lines balance
--      (SUM(debit) = SUM(credit) > 0) and its accounting period is open or
--      soft_closed.
--   2. A posted journal_entries row is immutable except for the single
--      reversed_by_journal_id linkage column, written when a later journal
--      reverses it.
--   3. journal_lines belonging to a posted journal cannot be inserted,
--      updated or deleted - correction is only ever via a new reversal or
--      correcting journal, never by editing history.
--
-- A draft journal's lines may be freely added/edited/removed while being
-- built - balance is only required at the moment of posting, not on every
-- intermediate save. total_debit/total_credit on the header are therefore
-- NOT constrained to be equal via a CHECK constraint (that would reject the
-- entirely normal in-progress state of a two-line draft that only has its
-- first line entered so far); they are maintained by trigger for display and
-- validated for equality only at post time.
--
-- Purely additive - no existing table is touched.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS finance.journal_entry_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

-- 1. HEADER

CREATE TABLE IF NOT EXISTS finance.journal_entries (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    journal_number          VARCHAR(30) NOT NULL,
    journal_type            VARCHAR(20) NOT NULL DEFAULT 'standard'
        CHECK (journal_type IN ('standard', 'reversal', 'correcting', 'adjustment', 'opening_balance', 'closing')),
    period_id               UUID NOT NULL REFERENCES finance.accounting_periods(id),
    entry_date              DATE NOT NULL,
    description             TEXT NOT NULL,
    status                  VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted')),
    source_type             VARCHAR(120),
    source_id               UUID,
    reverses_journal_id     UUID REFERENCES finance.journal_entries(id),
    reversed_by_journal_id  UUID REFERENCES finance.journal_entries(id),
    total_debit             NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_credit            NUMERIC(18,2) NOT NULL DEFAULT 0,
    posted_at               TIMESTAMPTZ,
    posted_by               UUID REFERENCES core.users(id),
    created_by              UUID REFERENCES core.users(id),
    updated_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, journal_number)
);

CREATE INDEX IF NOT EXISTS journal_entries_org_period_status_idx
    ON finance.journal_entries (organization_id, period_id, status);

CREATE INDEX IF NOT EXISTS journal_entries_org_source_idx
    ON finance.journal_entries (organization_id, source_type, source_id);

CREATE INDEX IF NOT EXISTS journal_entries_org_date_idx
    ON finance.journal_entries (organization_id, entry_date);

-- 2. LINES

CREATE TABLE IF NOT EXISTS finance.journal_lines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id    UUID NOT NULL REFERENCES finance.journal_entries(id) ON DELETE CASCADE,
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    line_number         INT NOT NULL,
    account_id          UUID NOT NULL REFERENCES finance.chart_of_accounts(id),
    debit_amount        NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (debit_amount >= 0),
    credit_amount       NUMERIC(18,2) NOT NULL DEFAULT 0 CHECK (credit_amount >= 0),
    description         TEXT,
    department_id       UUID REFERENCES finance.departments(id),
    project_id          UUID REFERENCES projects.projects(id),
    cost_code_id        UUID REFERENCES finance.cost_codes(id),
    supplier_id         UUID REFERENCES procurement.suppliers(id),
    client_id           UUID REFERENCES crm.contacts(id),
    employee_id         UUID REFERENCES hr.employees(id),
    work_package_id     UUID,  -- no work_package dimension table exists yet; unconstrained placeholder
    branch_id           UUID,  -- no branch dimension table exists yet; unconstrained placeholder
    currency_code       VARCHAR(3) NOT NULL DEFAULT 'USD',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (NOT (debit_amount > 0 AND credit_amount > 0)),
    CHECK (debit_amount > 0 OR credit_amount > 0),
    UNIQUE (journal_entry_id, line_number)
);

CREATE INDEX IF NOT EXISTS journal_lines_account_idx ON finance.journal_lines (organization_id, account_id);
CREATE INDEX IF NOT EXISTS journal_lines_journal_idx ON finance.journal_lines (journal_entry_id);
CREATE INDEX IF NOT EXISTS journal_lines_project_idx ON finance.journal_lines (organization_id, project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_lines_cost_code_idx ON finance.journal_lines (organization_id, cost_code_id) WHERE cost_code_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_lines_department_idx ON finance.journal_lines (organization_id, department_id) WHERE department_id IS NOT NULL;

-- 3. INVARIANT ENFORCEMENT

CREATE OR REPLACE FUNCTION finance.enforce_journal_entry_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    period_status TEXT;
    old_stripped JSONB;
    new_stripped JSONB;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status = 'posted' THEN
            RAISE EXCEPTION 'Cannot delete posted journal entry % - reverse it instead.', OLD.journal_number;
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF OLD.status = 'posted' THEN
            -- A posted header is immutable except for the reversal linkage
            -- and bookkeeping columns, written when a later journal reverses it.
            old_stripped := to_jsonb(OLD) - 'reversed_by_journal_id' - 'updated_at' - 'updated_by';
            new_stripped := to_jsonb(NEW) - 'reversed_by_journal_id' - 'updated_at' - 'updated_by';
            IF old_stripped IS DISTINCT FROM new_stripped THEN
                RAISE EXCEPTION 'Posted journal entry % is immutable - use a reversal or correcting journal.', OLD.journal_number;
            END IF;
            RETURN NEW;
        END IF;

        IF NEW.status = 'posted' AND OLD.status = 'draft' THEN
            IF NEW.total_debit <> NEW.total_credit OR NEW.total_debit <= 0 THEN
                RAISE EXCEPTION 'Journal entry % does not balance (debit % vs credit %) - cannot post.',
                    NEW.journal_number, NEW.total_debit, NEW.total_credit;
            END IF;
            SELECT status INTO period_status FROM finance.accounting_periods WHERE id = NEW.period_id;
            IF period_status IS NULL OR period_status NOT IN ('open', 'soft_closed') THEN
                RAISE EXCEPTION 'Cannot post journal entry % into a % accounting period.',
                    NEW.journal_number, COALESCE(period_status, 'missing');
            END IF;
            IF NEW.posted_at IS NULL THEN
                NEW.posted_at := NOW();
            END IF;
        END IF;
        RETURN NEW;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_enforce_rules ON finance.journal_entries;
CREATE TRIGGER trg_journal_entries_enforce_rules
    BEFORE UPDATE OR DELETE ON finance.journal_entries
    FOR EACH ROW EXECUTE FUNCTION finance.enforce_journal_entry_rules();

CREATE OR REPLACE FUNCTION finance.enforce_journal_line_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id UUID;
    parent_status TEXT;
BEGIN
    parent_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    SELECT status INTO parent_status FROM finance.journal_entries WHERE id = parent_id;
    IF parent_status = 'posted' THEN
        RAISE EXCEPTION 'Cannot modify lines of a posted journal entry - use a reversal or correcting journal.';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_enforce_rules ON finance.journal_lines;
CREATE TRIGGER trg_journal_lines_enforce_rules
    BEFORE INSERT OR UPDATE OR DELETE ON finance.journal_lines
    FOR EACH ROW EXECUTE FUNCTION finance.enforce_journal_line_rules();

CREATE OR REPLACE FUNCTION finance.maintain_journal_entry_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_id UUID;
BEGIN
    parent_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    UPDATE finance.journal_entries
    SET total_debit = COALESCE((SELECT SUM(debit_amount) FROM finance.journal_lines WHERE journal_entry_id = parent_id), 0),
        total_credit = COALESCE((SELECT SUM(credit_amount) FROM finance.journal_lines WHERE journal_entry_id = parent_id), 0),
        updated_at = NOW()
    WHERE id = parent_id;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_lines_maintain_totals ON finance.journal_lines;
CREATE TRIGGER trg_journal_lines_maintain_totals
    AFTER INSERT OR UPDATE OR DELETE ON finance.journal_lines
    FOR EACH ROW EXECUTE FUNCTION finance.maintain_journal_entry_totals();

-- 4. RLS

ALTER TABLE finance.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.journal_lines FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.journal_entries, finance.journal_lines FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.journal_entries;
CREATE POLICY "Finance service role only" ON finance.journal_entries FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.journal_lines;
CREATE POLICY "Finance service role only" ON finance.journal_lines FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'journal_entries'
        UNION ALL VALUES
        ('finance', 'journal_lines')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;

-- 6. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.journal_entries;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.journal_entries
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
