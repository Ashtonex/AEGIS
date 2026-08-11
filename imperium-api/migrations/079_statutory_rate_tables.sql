-- ============================================================================
-- AEGIS MIGRATION 079 — STATUTORY TAX RATE TABLES (PHASE 3a)
-- ============================================================================
-- Foundation for real ZIMRA/VAT/PAYE/NSSA tracking: rate/bracket data lives
-- as editable, effective-dated rows (not code constants), so a rate change
-- never requires a deploy. Ships completely EMPTY - zero rows, zero
-- behaviour change on deploy. Payroll/VAT computation continues exactly as
-- today until the user enters real rates through the Rate Tables UI
-- (built in a later migration alongside the liability ledger that
-- consumes this data).
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.tax_rate_tables (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    tax_type            VARCHAR(30) NOT NULL
        CHECK (tax_type IN ('paye', 'nssa_employee', 'nssa_employer', 'vat_output', 'vat_input', 'aids_levy', 'withholding_tax', 'other')),
    currency            VARCHAR(3) NOT NULL,
    period_basis        VARCHAR(20) NOT NULL
        CHECK (period_basis IN ('monthly', 'annual', 'per_transaction')),
    effective_from      DATE NOT NULL,
    effective_to        DATE,
    name                VARCHAR(255),
    source_reference    TEXT,
    is_active           BOOLEAN NOT NULL DEFAULT true,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, tax_type, currency, period_basis, effective_from),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS tax_rate_tables_lookup_idx
    ON finance.tax_rate_tables (organization_id, tax_type, currency, effective_from DESC)
    WHERE is_deleted = false AND is_active = true;

-- One row per bracket/band. A flat rate (VAT, NSSA) is expressed as a
-- single band with lower_bound=0, upper_bound=NULL; a marginal bracket
-- table (PAYE) is expressed as several ordered bands.
CREATE TABLE IF NOT EXISTS finance.tax_rate_bands (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    rate_table_id       UUID NOT NULL REFERENCES finance.tax_rate_tables(id) ON DELETE CASCADE,
    band_order          SMALLINT NOT NULL,
    lower_bound         NUMERIC(15,2) NOT NULL DEFAULT 0,
    upper_bound         NUMERIC(15,2),
    rate_pct            NUMERIC(9,4) NOT NULL,
    fixed_deduction     NUMERIC(15,2) NOT NULL DEFAULT 0,
    band_cap_amount     NUMERIC(15,2),
    notes               TEXT,
    UNIQUE (organization_id, rate_table_id, band_order),
    CHECK (upper_bound IS NULL OR upper_bound > lower_bound)
);

CREATE INDEX IF NOT EXISTS tax_rate_bands_table_idx
    ON finance.tax_rate_bands (organization_id, rate_table_id, band_order);

-- RLS

ALTER TABLE finance.tax_rate_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.tax_rate_tables FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.tax_rate_bands ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.tax_rate_bands FORCE ROW LEVEL SECURITY;

REVOKE ALL ON finance.tax_rate_tables, finance.tax_rate_bands FROM anon, authenticated;

DROP POLICY IF EXISTS "Finance service role only" ON finance.tax_rate_tables;
CREATE POLICY "Finance service role only" ON finance.tax_rate_tables FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Finance service role only" ON finance.tax_rate_bands;
CREATE POLICY "Finance service role only" ON finance.tax_rate_bands FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Live-push
DROP TRIGGER IF EXISTS live_change_notify ON finance.tax_rate_tables;
CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON finance.tax_rate_tables
    FOR EACH ROW EXECUTE FUNCTION core.notify_table_change();

-- PERMISSIONS

INSERT INTO core.permissions (key, description) VALUES
    ('finance.tax_rate.read',   'View statutory tax rate tables (PAYE/NSSA/VAT bands)'),
    ('finance.tax_rate.manage', 'Create and edit statutory tax rate tables')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.tax_rate.read'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Finance Manager', 'Project Manager')
ON CONFLICT DO NOTHING;

-- Changing a tax rate is a high-trust action - grant narrowly.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'finance.tax_rate.manage'
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Finance Manager')
ON CONFLICT DO NOTHING;

-- AUDIT TRIGGERS

DO $$
DECLARE t_name text; s_name text;
BEGIN
    FOR s_name, t_name IN
        SELECT 'finance', 'tax_rate_tables'
        UNION ALL VALUES
        ('finance', 'tax_rate_bands')
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;
             CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON %I.%I
             FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();',
            t_name, s_name, t_name, t_name, s_name, t_name
        );
    END LOOP;
END $$;
