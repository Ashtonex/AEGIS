-- Fleet operational controls. This migration intentionally contains no seed data.

ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS asset_code VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ownership_type VARCHAR(24) NOT NULL DEFAULT 'owned'
        CHECK (ownership_type IN ('owned', 'leased', 'rented', 'subcontracted')),
    ADD COLUMN IF NOT EXISTS operational_status VARCHAR(32) NOT NULL DEFAULT 'available'
        CHECK (operational_status IN ('available', 'assigned', 'in_service', 'out_of_service', 'retired')),
    ADD COLUMN IF NOT EXISTS make VARCHAR(100),
    ADD COLUMN IF NOT EXISTS model VARCHAR(100),
    ADD COLUMN IF NOT EXISTS model_year SMALLINT CHECK (model_year IS NULL OR model_year BETWEEN 1900 AND 2200),
    ADD COLUMN IF NOT EXISTS vin VARCHAR(80),
    ADD COLUMN IF NOT EXISTS odometer_km NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (odometer_km >= 0),
    ADD COLUMN IF NOT EXISTS engine_hours NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (engine_hours >= 0),
    ADD COLUMN IF NOT EXISTS capacity_description VARCHAR(160),
    ADD COLUMN IF NOT EXISTS home_location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS acquired_on DATE,
    ADD COLUMN IF NOT EXISTS retired_on DATE,
    ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE fleet.fleet
    ADD CONSTRAINT fleet_retirement_date_check
    CHECK (retired_on IS NULL OR acquired_on IS NULL OR retired_on >= acquired_on) NOT VALID;
ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_retirement_date_check;

CREATE UNIQUE INDEX IF NOT EXISTS fleet_org_asset_code_unique
    ON fleet.fleet (organization_id, asset_code)
    WHERE asset_code IS NOT NULL AND is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS fleet_org_registration_unique
    ON fleet.fleet (organization_id, vehicle_registration)
    WHERE vehicle_registration IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_org_status_idx
    ON fleet.fleet (organization_id, operational_status)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS fleet.fleet_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    project_id UUID REFERENCES projects.projects(id),
    assigned_to_user_id UUID REFERENCES core.users(id),
    dispatch_reference VARCHAR(100),
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'dispatched', 'active', 'completed', 'cancelled')),
    origin_location VARCHAR(255),
    destination_location VARCHAR(255),
    purpose TEXT,
    odometer_out NUMERIC(14,2) CHECK (odometer_out IS NULL OR odometer_out >= 0),
    odometer_in NUMERIC(14,2) CHECK (odometer_in IS NULL OR odometer_in >= 0),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (ends_at IS NULL OR ends_at >= starts_at),
    CHECK (odometer_in IS NULL OR odometer_out IS NULL OR odometer_in >= odometer_out)
);

CREATE TABLE IF NOT EXISTS fleet.fleet_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    inspection_type VARCHAR(40) NOT NULL CHECK (inspection_type IN ('pre_start', 'post_trip', 'scheduled', 'compliance')),
    inspected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    inspector_id UUID REFERENCES core.users(id),
    outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('pass', 'conditional', 'fail')),
    odometer_km NUMERIC(14,2) CHECK (odometer_km IS NULL OR odometer_km >= 0),
    engine_hours NUMERIC(14,2) CHECK (engine_hours IS NULL OR engine_hours >= 0),
    checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS fleet.fleet_defects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    inspection_id UUID REFERENCES fleet.fleet_inspections(id),
    defect_reference VARCHAR(100),
    title VARCHAR(255) NOT NULL,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'in_repair', 'resolved', 'deferred')),
    reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    description TEXT,
    resolution_notes TEXT,
    reported_by UUID REFERENCES core.users(id),
    resolved_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (resolved_at IS NULL OR resolved_at >= reported_at)
);

CREATE TABLE IF NOT EXISTS fleet.maintenance_work_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    defect_id UUID REFERENCES fleet.fleet_defects(id),
    work_order_number VARCHAR(100) NOT NULL,
    maintenance_type VARCHAR(32) NOT NULL CHECK (maintenance_type IN ('preventive', 'corrective', 'inspection', 'compliance')),
    priority VARCHAR(20) NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
    status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'in_progress', 'completed', 'cancelled')),
    vendor_name VARCHAR(255),
    scheduled_for TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    estimated_cost NUMERIC(15,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
    actual_cost NUMERIC(15,2) CHECK (actual_cost IS NULL OR actual_cost >= 0),
    odometer_km NUMERIC(14,2) CHECK (odometer_km IS NULL OR odometer_km >= 0),
    description TEXT NOT NULL,
    completion_notes TEXT,
    created_by UUID REFERENCES core.users(id),
    completed_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, work_order_number),
    CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
);

CREATE TABLE IF NOT EXISTS fleet.fuel_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    transaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fuel_type VARCHAR(32) NOT NULL,
    quantity_litres NUMERIC(14,3) NOT NULL CHECK (quantity_litres > 0),
    unit_cost NUMERIC(15,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
    total_cost NUMERIC(15,2) CHECK (total_cost IS NULL OR total_cost >= 0),
    odometer_km NUMERIC(14,2) CHECK (odometer_km IS NULL OR odometer_km >= 0),
    supplier_name VARCHAR(255),
    receipt_reference VARCHAR(120),
    recorded_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS fleet.utilization_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id),
    assignment_id UUID REFERENCES fleet.fleet_assignments(id),
    occurred_on DATE NOT NULL,
    operating_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (operating_hours >= 0 AND operating_hours <= 24),
    distance_km NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (distance_km >= 0),
    idle_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (idle_hours >= 0 AND idle_hours <= 24),
    odometer_km NUMERIC(14,2) CHECK (odometer_km IS NULL OR odometer_km >= 0),
    engine_hours NUMERIC(14,2) CHECK (engine_hours IS NULL OR engine_hours >= 0),
    notes TEXT,
    recorded_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (idle_hours <= operating_hours)
);

CREATE INDEX IF NOT EXISTS fleet_assignments_operational_idx ON fleet.fleet_assignments (organization_id, fleet_id, starts_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_inspections_operational_idx ON fleet.fleet_inspections (organization_id, fleet_id, inspected_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_defects_operational_idx ON fleet.fleet_defects (organization_id, fleet_id, status, severity) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_work_orders_operational_idx ON fleet.maintenance_work_orders (organization_id, fleet_id, status, scheduled_for) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_fuel_operational_idx ON fleet.fuel_transactions (organization_id, fleet_id, transaction_at DESC) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_utilization_operational_idx ON fleet.utilization_logs (organization_id, fleet_id, occurred_on DESC) WHERE is_deleted = false;

ALTER TABLE fleet.fleet_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_defects ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.fuel_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.utilization_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_assignments FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_inspections FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.fleet_defects FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.maintenance_work_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.fuel_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.utilization_logs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fleet.fleet_assignments, fleet.fleet_inspections, fleet.fleet_defects, fleet.maintenance_work_orders, fleet.fuel_transactions, fleet.utilization_logs FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fleet FROM anon, authenticated;
CREATE POLICY "Fleet service role only" ON fleet.fleet_assignments FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Fleet service role only" ON fleet.fleet_inspections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Fleet service role only" ON fleet.fleet_defects FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Fleet service role only" ON fleet.maintenance_work_orders FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Fleet service role only" ON fleet.fuel_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Fleet service role only" ON fleet.utilization_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
