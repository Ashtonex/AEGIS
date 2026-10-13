-- ============================================================================
-- AEGIS MIGRATION 259 — PLANT & EQUIPMENT UNIFIED OPERATING SYSTEM CONTROLS
-- ============================================================================
-- Additive controls to support full operations:
--   1. Daily Shift Logs (Daily Plant Sheets): start/end meters, category downtimes,
--      approval lifecycle (draft, submitted, approved, rejected, invoiced), and engineer sign-off.
--   2. Commercial Hire: Rate snapshots, invoice tracking, and debtor status.
--   3. Fuel & Workshop: Telematics status, PM intervals, and consumption benchmarks.
-- ============================================================================

-- --- 1. Daily Plant Sheet fields on utilization_logs ---
ALTER TABLE fleet.utilization_logs
    ADD COLUMN IF NOT EXISTS start_engine_hours NUMERIC(14,2) CHECK (start_engine_hours IS NULL OR start_engine_hours >= 0),
    ADD COLUMN IF NOT EXISTS end_engine_hours NUMERIC(14,2) CHECK (end_engine_hours IS NULL OR end_engine_hours >= 0),
    ADD COLUMN IF NOT EXISTS weather_downtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (weather_downtime_hours >= 0 AND weather_downtime_hours <= 24),
    ADD COLUMN IF NOT EXISTS breakdown_downtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (breakdown_downtime_hours >= 0 AND breakdown_downtime_hours <= 24),
    ADD COLUMN IF NOT EXISTS standing_downtime_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (standing_downtime_hours >= 0 AND standing_downtime_hours <= 24),
    ADD COLUMN IF NOT EXISTS output_quantity NUMERIC(14,2) CHECK (output_quantity IS NULL OR output_quantity >= 0),
    ADD COLUMN IF NOT EXISTS output_unit VARCHAR(30),
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(24) NOT NULL DEFAULT 'submitted',
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS client_signoff_name VARCHAR(160),
    ADD COLUMN IF NOT EXISTS client_signoff_title VARCHAR(120),
    ADD COLUMN IF NOT EXISTS client_signoff_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS invoice_id UUID;

ALTER TABLE fleet.utilization_logs
    DROP CONSTRAINT IF EXISTS fleet_utilization_approval_status_check;

ALTER TABLE fleet.utilization_logs
    ADD CONSTRAINT fleet_utilization_approval_status_check
        CHECK (approval_status IN ('draft', 'submitted', 'approved', 'rejected', 'invoiced')) NOT VALID;

ALTER TABLE fleet.utilization_logs VALIDATE CONSTRAINT fleet_utilization_approval_status_check;

-- --- 2. Commercial Hire Agreement enhancements ---
ALTER TABLE fleet.external_hire_agreements
    ADD COLUMN IF NOT EXISTS invoiced_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (invoiced_amount >= 0),
    ADD COLUMN IF NOT EXISTS invoice_reference VARCHAR(120),
    ADD COLUMN IF NOT EXISTS invoice_generated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS min_guaranteed_hours_day NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (min_guaranteed_hours_day >= 0),
    ADD COLUMN IF NOT EXISTS sunday_premium_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.0 CHECK (sunday_premium_multiplier >= 1.0);

-- --- 3. Asset register telematics & maintenance fields ---
ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS telematics_provider VARCHAR(60),
    ADD COLUMN IF NOT EXISTS telematics_device_id VARCHAR(120),
    ADD COLUMN IF NOT EXISTS telematics_last_sync TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS telematics_status VARCHAR(30) NOT NULL DEFAULT 'unconfigured',
    ADD COLUMN IF NOT EXISTS pm_interval_hours INTEGER NOT NULL DEFAULT 250 CHECK (pm_interval_hours > 0),
    ADD COLUMN IF NOT EXISTS last_service_meter NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (last_service_meter >= 0),
    ADD COLUMN IF NOT EXISTS next_service_meter NUMERIC(14,2) NOT NULL DEFAULT 250 CHECK (next_service_meter >= 0),
    ADD COLUMN IF NOT EXISTS benchmark_litres_per_hour NUMERIC(10,2) CHECK (benchmark_litres_per_hour IS NULL OR benchmark_litres_per_hour >= 0),
    ADD COLUMN IF NOT EXISTS benchmark_litres_per_km NUMERIC(10,2) CHECK (benchmark_litres_per_km IS NULL OR benchmark_litres_per_km >= 0),
    ADD COLUMN IF NOT EXISTS depreciation_method VARCHAR(30) NOT NULL DEFAULT 'straight_line',
    ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (salvage_value >= 0);

-- --- 4. Permissions ---
INSERT INTO core.permissions (key, description) VALUES
    ('fleet.utilization.approve', 'Approve or reject daily plant sheets and shift logs'),
    ('fleet.hire.invoice', 'Generate commercial plant hire draft invoices')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'fleet.utilization.approve',
    'fleet.hire.invoice'
)
WHERE r.name IN ('Executive (Admin)', 'Fleet Supervisor', 'Equipment Manager', 'Finance Manager')
ON CONFLICT DO NOTHING;

-- --- 5. Indexes ---
CREATE INDEX IF NOT EXISTS fleet_utilization_approval_idx
    ON fleet.utilization_logs (organization_id, approval_status, occurred_on DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS fleet_next_service_idx
    ON fleet.fleet (organization_id, next_service_meter, current_meter_reading)
    WHERE is_deleted = false;
