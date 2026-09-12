-- ============================================================================
-- AEGIS MIGRATION 213 — HISTORICAL RECONCILIATION BASELINES (PHASE 9)
-- ============================================================================
-- Lets Finance optionally record what the old paper/bank records say a
-- historical project's revenue or cost total should be, separate from what
-- has actually been entered into AEGIS so far via the historical-entry
-- tool. The reconciliation dashboard computes recorded - expected per
-- category and surfaces a real variance - honestly showing "no baseline
-- recorded yet" rather than a fabricated zero when nothing has been set.
--
-- Purely additive - new table only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.historical_reconciliation_baselines (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    category            VARCHAR(10) NOT NULL CHECK (category IN ('revenue', 'cost')),
    expected_amount     NUMERIC(15,2) NOT NULL,
    source_description  TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, project_id, category)
);

CREATE INDEX IF NOT EXISTS historical_reconciliation_baselines_project_idx
    ON finance.historical_reconciliation_baselines (organization_id, project_id);

-- 1. RLS

ALTER TABLE finance.historical_reconciliation_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.historical_reconciliation_baselines FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.historical_reconciliation_baselines FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.historical_reconciliation_baselines;
CREATE POLICY "Finance service role only" ON finance.historical_reconciliation_baselines
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. PERMISSIONS — granted in this same migration. finance.historical_entry.create
-- (migration 095) already covers writes (including this table's upsert);
-- this is the feature's first read-only surface, so it needs its own key.

INSERT INTO core.permissions (key, description) VALUES
    ('finance.historical_entry.read', 'View historical-entry reconciliation dashboard and evidence-quality summaries')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.historical_entry.read'
WHERE r.is_deleted = false AND r.name IN ('SUPERADMIN', 'Finance Manager', 'Executive (Admin)', 'Managing Director')
ON CONFLICT DO NOTHING;

-- 3. AUDIT TRIGGER

DO $$
BEGIN
    EXECUTE format(
        'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
         CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
         FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
        'historical_reconciliation_baselines', 'finance', 'historical_reconciliation_baselines',
        'historical_reconciliation_baselines', 'finance', 'historical_reconciliation_baselines'
    );
END $$;

-- 4. LIVE-PUSH

DROP TRIGGER IF EXISTS live_change_notify ON finance.historical_reconciliation_baselines;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.historical_reconciliation_baselines
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();
