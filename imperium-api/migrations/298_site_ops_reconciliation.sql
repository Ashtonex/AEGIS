-- ============================================================================
-- AEGIS MIGRATION 298 - SITE OPERATIONS: HOURS OVERRIDES, DAY-CLOSE USAGE
-- RECONCILIATION, WEEKLY STORES / MATERIAL RECONCILIATION
-- ============================================================================
--   1. Hours a clerk or foreman sets on a daily report labour line (or on the
--      register) are flagged so the register sync and clock-out never put the
--      calculated hours back over them.
--   2. Material lines say whether they draw down store stock. Usage of stock
--      already issued to the project (the issue moved it out of the store) or
--      lines copied from store issues must not take it out a second time.
--   3. A site day records when its material and plant usage were reconciled;
--      the day can't be closed until both are done (nil usage is an answer).
--   4. Every Saturday each active project counts its site stores and confirms
--      the week's material usage. One reconciliation per project-week, with
--      its count / usage lines.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE projects.daily_report_labour
    ADD COLUMN IF NOT EXISTS hours_overridden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects.site_day_attendance
    ADD COLUMN IF NOT EXISTS hours_overridden BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE projects.daily_report_materials
    ADD COLUMN IF NOT EXISTS consumes_stock BOOLEAN NOT NULL DEFAULT true;

-- Lines the sync copied from store issues: the issue already took the stock out.
UPDATE projects.daily_report_materials
SET consumes_stock = false
WHERE notes = 'Auto-synced from store issues' AND consumes_stock = true;

ALTER TABLE projects.site_day_briefings
    ADD COLUMN IF NOT EXISTS materials_reconciled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS materials_reconciled_by UUID,
    ADD COLUMN IF NOT EXISTS materials_nil_usage BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS plant_reconciled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS plant_reconciled_by UUID,
    ADD COLUMN IF NOT EXISTS plant_nil_usage BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS projects.weekly_site_reconciliations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id               UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    week_ending              DATE NOT NULL,
    status                   VARCHAR(20) NOT NULL DEFAULT 'in_progress',
    materials_completed_at   TIMESTAMPTZ,
    materials_completed_by   UUID,
    stores_completed_at      TIMESTAMPTZ,
    stores_completed_by      UUID,
    completed_at             TIMESTAMPTZ,
    notes                    TEXT,
    created_by               UUID,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT weekly_site_recon_status_chk CHECK (status IN ('in_progress', 'completed')),
    CONSTRAINT weekly_site_recon_saturday_chk CHECK (EXTRACT(ISODOW FROM week_ending) = 6),
    CONSTRAINT weekly_site_recon_unique UNIQUE (organization_id, project_id, week_ending)
);

CREATE TABLE IF NOT EXISTS projects.weekly_site_reconciliation_lines (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id       UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    reconciliation_id     UUID NOT NULL REFERENCES projects.weekly_site_reconciliations(id) ON DELETE CASCADE,
    kind                  VARCHAR(20) NOT NULL,
    item_id               UUID NOT NULL,
    store_id              UUID,
    received_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
    issued_qty            NUMERIC(14,3) NOT NULL DEFAULT 0,
    recorded_usage_qty    NUMERIC(14,3) NOT NULL DEFAULT 0,
    unrecorded_usage_qty  NUMERIC(14,3) NOT NULL DEFAULT 0,
    system_qty            NUMERIC(14,3) NOT NULL DEFAULT 0,
    counted_qty           NUMERIC(14,3),
    variance_qty          NUMERIC(14,3) NOT NULL DEFAULT 0,
    unit_cost             NUMERIC(15,4) NOT NULL DEFAULT 0,
    stock_movement_id     UUID,
    notes                 TEXT,
    created_by            UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT weekly_site_recon_line_kind_chk CHECK (kind IN ('material_usage', 'store_count'))
);

CREATE INDEX IF NOT EXISTS idx_weekly_site_recon_lines_recon
    ON projects.weekly_site_reconciliation_lines (reconciliation_id, kind);

CREATE INDEX IF NOT EXISTS idx_weekly_site_recon_project
    ON projects.weekly_site_reconciliations (organization_id, project_id, week_ending DESC);

-- RLS (service role only) and audit, as for other API-owned tables.
DO $$
DECLARE t_name text;
BEGIN
    FOREACH t_name IN ARRAY ARRAY['weekly_site_reconciliations', 'weekly_site_reconciliation_lines']
    LOOP
        EXECUTE format('ALTER TABLE projects.%I ENABLE ROW LEVEL SECURITY', t_name);
        EXECUTE format('ALTER TABLE projects.%I FORCE ROW LEVEL SECURITY', t_name);
        EXECUTE format('REVOKE ALL ON projects.%I FROM anon, authenticated', t_name);
        EXECUTE format('DROP POLICY IF EXISTS "Projects service role only" ON projects.%I', t_name);
        EXECUTE format('CREATE POLICY "Projects service role only" ON projects.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t_name);
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON projects.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON projects.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, t_name, t_name, t_name
        );
    END LOOP;
END $$;
