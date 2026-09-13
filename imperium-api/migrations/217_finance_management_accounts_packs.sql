-- ============================================================================
-- AEGIS MIGRATION 217 — MANAGEMENT ACCOUNTS PACKS (PHASE 11B)
-- ============================================================================
-- A monthly Management Accounts pack: freezes Phase 11A's GL-sourced
-- statements (Income Statement, Balance Sheet, Cash Movement, AR/AP
-- aging) as JSONB snapshots at creation time, then carries them through a
-- Draft -> Reviewed -> Approved -> Locked lifecycle. Mirrors
-- finance.accounting_periods' own lifecycle shape (per-transition
-- actor/timestamp columns, a reopen_reason for the one authorized
-- reverse transition) - see app/services/finance/management_accounts_pack.py.
--
-- The snapshot is computed once (at creation, or on-demand while still
-- draft via a recompute action) and never re-derived once Reviewed or
-- beyond - a Locked pack's numbers must never silently change just
-- because new journals posted afterward.
--
-- Purely additive - new table and new permission keys only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.management_accounts_packs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    period_start        DATE NOT NULL,
    period_end          DATE NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'reviewed', 'approved', 'locked')),
    income_statement    JSONB,
    balance_sheet       JSONB,
    cash_movement       JSONB,
    ar_aging            JSONB,
    ap_aging            JSONB,
    reviewed_at         TIMESTAMPTZ,
    reviewed_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES core.users(id),
    locked_at           TIMESTAMPTZ,
    locked_by           UUID REFERENCES core.users(id),
    reopened_at         TIMESTAMPTZ,
    reopened_by         UUID REFERENCES core.users(id),
    reopen_reason       TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    CHECK (period_end > period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS management_accounts_packs_org_period_idx
    ON finance.management_accounts_packs (organization_id, period_start, period_end)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS management_accounts_packs_org_status_idx
    ON finance.management_accounts_packs (organization_id, status)
    WHERE is_deleted = false;

-- 1. RLS

ALTER TABLE finance.management_accounts_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.management_accounts_packs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.management_accounts_packs FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.management_accounts_packs;
CREATE POLICY "Finance service role only" ON finance.management_accounts_packs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'management_accounts_packs', 'finance', 'management_accounts_packs',
        'management_accounts_packs', 'finance', 'management_accounts_packs'
    );
END $$;

-- 3. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.management_accounts_packs;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.management_accounts_packs
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
