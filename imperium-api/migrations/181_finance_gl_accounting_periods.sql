-- ============================================================================
-- AEGIS MIGRATION 181 — FINANCE GENERAL LEDGER: ACCOUNTING PERIODS (PHASE 1)
-- ============================================================================
-- Introduces accounting periods with a formal lifecycle
-- (open -> soft_closed -> closed -> audited -> locked, with an authorized
-- reopen path back to open). The General Ledger (migration 182) refuses to
-- post a journal into any period that is not open (or soft_closed, for
-- elevated roles) - see finance.journal_entries.period_id.
--
-- Purely additive - no existing table is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.accounting_periods (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    period_code         VARCHAR(10) NOT NULL,          -- e.g. '2026-09'
    fiscal_year         INT NOT NULL,
    period_number       INT NOT NULL CHECK (period_number BETWEEN 1 AND 13),  -- 13 reserved for year-end adjustments
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'soft_closed', 'closed', 'audited', 'locked')),
    soft_closed_at      TIMESTAMPTZ,
    soft_closed_by      UUID REFERENCES core.users(id),
    closed_at           TIMESTAMPTZ,
    closed_by           UUID REFERENCES core.users(id),
    audited_at          TIMESTAMPTZ,
    audited_by          UUID REFERENCES core.users(id),
    locked_at           TIMESTAMPTZ,
    locked_by           UUID REFERENCES core.users(id),
    reopened_at         TIMESTAMPTZ,
    reopened_by         UUID REFERENCES core.users(id),
    reopen_reason       TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, period_code),
    CHECK (period_end > period_start)
);

CREATE INDEX IF NOT EXISTS accounting_periods_org_status_idx
    ON finance.accounting_periods (organization_id, status);

CREATE INDEX IF NOT EXISTS accounting_periods_org_dates_idx
    ON finance.accounting_periods (organization_id, period_start, period_end);

-- 1. RLS

ALTER TABLE finance.accounting_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.accounting_periods FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.accounting_periods FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.accounting_periods;
CREATE POLICY "Finance service role only" ON finance.accounting_periods
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. SEED — open the current and next 2 calendar months for every existing
-- organization so Phase 1 is immediately usable without a separate manual
-- setup step. Finance can create further periods via the API.

INSERT INTO finance.accounting_periods
    (organization_id, period_code, fiscal_year, period_number, period_start, period_end, status)
SELECT
    o.id,
    to_char(gs.period_start, 'YYYY-MM'),
    EXTRACT(YEAR FROM gs.period_start)::INT,
    EXTRACT(MONTH FROM gs.period_start)::INT,
    gs.period_start,
    (gs.period_start + INTERVAL '1 month - 1 day')::DATE,
    'open'
FROM core.organizations o
CROSS JOIN LATERAL (
    SELECT date_trunc('month', CURRENT_DATE)::DATE + (n || ' month')::INTERVAL AS period_start
    FROM generate_series(0, 2) AS n
) AS gs
WHERE o.is_deleted = false
ON CONFLICT (organization_id, period_code) DO NOTHING;

-- 3. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'accounting_periods', 'finance', 'accounting_periods', 'accounting_periods', 'finance', 'accounting_periods'
    );
END $$;

-- 4. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.accounting_periods;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.accounting_periods
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
