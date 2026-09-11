-- ============================================================================
-- AEGIS MIGRATION 196 — COMPANY BUDGET LINES (PHASE 5A)
-- ============================================================================
-- Department + month bucketed lines, so "Annual Budget" (12 rows spanning a
-- fiscal year) and "Monthly Budget"/variance-by-month reporting are the
-- same underlying shape rather than two separate table families. Supports
-- both revenue and cost lines, since a budget covering only cost can't
-- produce a real net-margin variance against the department P&L
-- (routers/financial_performance.py::_compute_department_pnl), which
-- already tracks both sides.
--
-- category is CHECK-constrained per line_type: cost categories reuse the
-- exact vocabulary already shared by finance.cost_codes/budget_lines/
-- commitments/cost_transactions (labour/equipment/materials/subcontract/
-- overhead/other); revenue categories are contract_revenue/other_income.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.company_budget_lines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    budget_id       UUID NOT NULL REFERENCES finance.company_budgets(id) ON DELETE CASCADE,
    department_id   UUID REFERENCES finance.departments(id),
    line_type       VARCHAR(10) NOT NULL CHECK (line_type IN ('revenue', 'cost')),
    category        VARCHAR(40) NOT NULL,
    period_month    DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
    notes           TEXT,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    CHECK (
        (line_type = 'cost' AND category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other'))
        OR
        (line_type = 'revenue' AND category IN ('contract_revenue', 'other_income'))
    ),
    CHECK (period_month = date_trunc('month', period_month)::date)
);

CREATE INDEX IF NOT EXISTS company_budget_lines_query_idx
    ON finance.company_budget_lines (organization_id, budget_id, department_id, period_month);

-- 1. RLS

ALTER TABLE finance.company_budget_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.company_budget_lines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.company_budget_lines FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.company_budget_lines;
CREATE POLICY "Finance service role only" ON finance.company_budget_lines
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. AUDIT TRIGGER

DROP TRIGGER IF EXISTS trg_audit_company_budget_lines ON finance.company_budget_lines;
CREATE TRIGGER trg_audit_company_budget_lines AFTER INSERT OR UPDATE OR DELETE ON finance.company_budget_lines
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- 3. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.company_budget_lines;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.company_budget_lines
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
