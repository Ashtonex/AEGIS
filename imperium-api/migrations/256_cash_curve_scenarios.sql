-- ============================================================================
-- AEGIS MIGRATION 256 — TENDER CASH CURVE SCENARIOS
-- ============================================================================
-- The cash curve on a quotation (app/services/finance/project_cash_curve.py)
-- is computed live from editable assumptions and needs no storage. This table
-- only keeps the scenarios a bid team chooses to save ("Client's terms",
-- "No deposit, 90-day payment"...) so the assumptions the bid was priced on,
-- and the peak funding they gave, stay on record against the quotation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.cash_curve_scenarios (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    quotation_id    UUID NOT NULL REFERENCES finance.quotations(id) ON DELETE CASCADE,
    name            VARCHAR(80) NOT NULL,
    assumptions     JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_cash_curve_scenarios_quotation
    ON finance.cash_curve_scenarios (organization_id, quotation_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS idx_cash_curve_scenarios_created_by
    ON finance.cash_curve_scenarios (created_by);

ALTER TABLE finance.cash_curve_scenarios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.cash_curve_scenarios FROM anon, authenticated;
DROP POLICY IF EXISTS "Cash curve scenarios service role only" ON finance.cash_curve_scenarios;
CREATE POLICY "Cash curve scenarios service role only" ON finance.cash_curve_scenarios
    FOR ALL TO service_role USING (true) WITH CHECK (true);
