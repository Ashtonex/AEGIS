-- ============================================================================
-- AEGIS MIGRATION 175 - RATE INTELLIGENCE SCOPE AND SUPPLY MODE
-- ============================================================================
-- Rates are reused across BOQs, budgets, quotation intelligence, and project
-- controls, but a rate can also be valid only for a specific job or package.
-- This extends finance.rate_intelligence so saved rates can carry:
--   - scope: global, project/job, tender, opportunity, task, or custom
--   - grouping: a reusable package/category label
--   - supply mode: full supply vs labour-only where the client supplies materials
--   - material reference: full material build-up retained for margin discipline
--   - material contribution: percentage of client-supplied material value charged
-- ============================================================================

ALTER TABLE finance.rate_intelligence
    ADD COLUMN IF NOT EXISTS source_type VARCHAR(40) NOT NULL DEFAULT 'global',
    ADD COLUMN IF NOT EXISTS source_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS rate_group VARCHAR(120),
    ADD COLUMN IF NOT EXISTS supply_mode VARCHAR(50) NOT NULL DEFAULT 'full_supply',
    ADD COLUMN IF NOT EXISTS material_contribution_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS material_reference_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS materials_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE finance.rate_intelligence
SET material_reference_rate = supplier_rate
WHERE material_reference_rate = 0
  AND supplier_rate > 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rate_intelligence_source_type_chk'
          AND conrelid = 'finance.rate_intelligence'::regclass
    ) THEN
        ALTER TABLE finance.rate_intelligence
            ADD CONSTRAINT rate_intelligence_source_type_chk
            CHECK (source_type IN ('global', 'project', 'tender', 'opportunity', 'task', 'custom'));
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'rate_intelligence_supply_mode_chk'
          AND conrelid = 'finance.rate_intelligence'::regclass
    ) THEN
        ALTER TABLE finance.rate_intelligence
            ADD CONSTRAINT rate_intelligence_supply_mode_chk
            CHECK (supply_mode IN ('full_supply', 'labour_only_client_materials'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS rate_intelligence_scope_idx
    ON finance.rate_intelligence (organization_id, source_type, source_id, rate_group, item_code)
    WHERE is_deleted = false;
