-- ============================================================================
-- AEGIS MIGRATION 195 — COMPANY & DEPARTMENT BUDGETS (PHASE 5A)
-- ============================================================================
-- Introduces a genuinely new planning layer above the project level, which
-- did not exist in any form before this migration (finance.departments is
-- pure dimension-tagging with no amount column; no annual/company/
-- department budget table exists anywhere in the schema).
--
-- Deliberately NOT an upgrade to finance.project_budgets - that table keeps
-- its existing, working, tested draft/approved/superseded/cancelled
-- supersede pattern (migration 023) untouched, used by two live call sites.
-- This is a fresh, richer state machine for company/department budgets
-- only, matching the master spec's own versioning vocabulary literally:
-- Draft, Submitted, Under Review, Approved Baseline, Revision, Superseded,
-- Frozen (plus a practical Cancelled escape hatch for abandoning a draft/
-- revision before approval).
--
-- Purely additive - no existing table is touched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.company_budgets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    fiscal_year         INT NOT NULL,
    label               VARCHAR(200) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'under_review', 'approved_baseline', 'revision', 'superseded', 'frozen', 'cancelled')),
    revises_budget_id   UUID REFERENCES finance.company_budgets(id),
    submitted_by        UUID REFERENCES core.users(id),
    submitted_at        TIMESTAMPTZ,
    reviewed_by         UUID REFERENCES core.users(id),
    reviewed_at         TIMESTAMPTZ,
    approved_by         UUID REFERENCES core.users(id),
    approved_at         TIMESTAMPTZ,
    frozen_by           UUID REFERENCES core.users(id),
    frozen_at           TIMESTAMPTZ,
    cancelled_by        UUID REFERENCES core.users(id),
    cancelled_at        TIMESTAMPTZ,
    rejection_reason    TEXT,
    freeze_reason       TEXT,
    reopen_reason        TEXT,
    notes               TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- Only one live approved baseline per fiscal year - mirrors
-- project_budgets_single_approved exactly (migration 023).
CREATE UNIQUE INDEX IF NOT EXISTS company_budgets_single_baseline
    ON finance.company_budgets (organization_id, fiscal_year)
    WHERE status = 'approved_baseline' AND is_deleted = false;

CREATE INDEX IF NOT EXISTS company_budgets_org_year_idx
    ON finance.company_budgets (organization_id, fiscal_year, status);

-- 1. RLS

ALTER TABLE finance.company_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.company_budgets FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.company_budgets FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.company_budgets;
CREATE POLICY "Finance service role only" ON finance.company_budgets
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. AUDIT TRIGGER

DROP TRIGGER IF EXISTS trg_audit_company_budgets ON finance.company_budgets;
CREATE TRIGGER trg_audit_company_budgets AFTER INSERT OR UPDATE OR DELETE ON finance.company_budgets
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- 3. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.company_budgets;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.company_budgets
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
