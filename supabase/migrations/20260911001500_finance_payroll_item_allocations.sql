-- ============================================================================
-- AEGIS MIGRATION 202 — PAYROLL ITEM ALLOCATIONS (PHASE 7A)
-- ============================================================================
-- finance.payroll_items has exactly one nullable project_id/department_id
-- per row - no way to split one employee's pay across multiple projects by
-- percentage (the master spec's "Project A 60% / Project B 30% / HQ 10%"
-- example). This table adds that split as an optional child of a payroll
-- item; an item with zero allocation rows keeps behaving exactly as today
-- (its own single project_id/department_id, effectively 100%).
--
-- Purely additive - finance.payroll_items itself is untouched.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.payroll_item_allocations (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    payroll_item_id     UUID NOT NULL REFERENCES finance.payroll_items(id) ON DELETE CASCADE,
    project_id          UUID REFERENCES projects.projects(id),
    department_id       UUID REFERENCES finance.departments(id),
    allocation_pct      NUMERIC(5,2) NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100),
    allocated_gross     NUMERIC(15,2) NOT NULL DEFAULT 0,
    allocated_net       NUMERIC(15,2) NOT NULL DEFAULT 0,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payroll_item_allocations_item_idx
    ON finance.payroll_item_allocations (organization_id, payroll_item_id);

-- 1. RLS

ALTER TABLE finance.payroll_item_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.payroll_item_allocations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.payroll_item_allocations FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.payroll_item_allocations;
CREATE POLICY "Finance service role only" ON finance.payroll_item_allocations
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'payroll_item_allocations', 'finance', 'payroll_item_allocations', 'payroll_item_allocations', 'finance', 'payroll_item_allocations'
    );
END $$;

-- 3. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.payroll_item_allocations;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.payroll_item_allocations
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
