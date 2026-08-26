-- Full Plant & Equipment operating department controls.
-- Additive hardening over the existing fleet register and plant lifecycle spine.

ALTER TABLE fleet.fleet
    DROP CONSTRAINT IF EXISTS fleet_ownership_type_check,
    DROP CONSTRAINT IF EXISTS fleet_operational_status_check;

ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS asset_category VARCHAR(80),
    ADD COLUMN IF NOT EXISTS asset_type VARCHAR(120),
    ADD COLUMN IF NOT EXISTS serial_number VARCHAR(120),
    ADD COLUMN IF NOT EXISTS chassis_number VARCHAR(120),
    ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES procurement.suppliers(id),
    ADD COLUMN IF NOT EXISTS supplier_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS purchase_date DATE,
    ADD COLUMN IF NOT EXISTS acquisition_cost NUMERIC(15,2) CHECK (acquisition_cost IS NULL OR acquisition_cost >= 0),
    ADD COLUMN IF NOT EXISTS current_book_value NUMERIC(15,2) CHECK (current_book_value IS NULL OR current_book_value >= 0),
    ADD COLUMN IF NOT EXISTS useful_life_months INTEGER CHECK (useful_life_months IS NULL OR useful_life_months > 0),
    ADD COLUMN IF NOT EXISTS current_location VARCHAR(255),
    ADD COLUMN IF NOT EXISTS responsible_custodian VARCHAR(255),
    ADD COLUMN IF NOT EXISTS meter_type VARCHAR(24) DEFAULT 'engine_hours',
    ADD COLUMN IF NOT EXISTS current_meter_reading NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (current_meter_reading >= 0),
    ADD COLUMN IF NOT EXISTS insurance_provider VARCHAR(160),
    ADD COLUMN IF NOT EXISTS insurance_policy_number VARCHAR(160),
    ADD COLUMN IF NOT EXISTS insurance_expiry_date DATE,
    ADD COLUMN IF NOT EXISTS licence_number VARCHAR(160),
    ADD COLUMN IF NOT EXISTS licence_expiry_date DATE,
    ADD COLUMN IF NOT EXISTS warranty_provider VARCHAR(160),
    ADD COLUMN IF NOT EXISTS warranty_expiry_date DATE,
    ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS qr_code_value VARCHAR(255),
    ADD COLUMN IF NOT EXISTS barcode_value VARCHAR(255),
    ADD COLUMN IF NOT EXISTS disposal_status VARCHAR(32) NOT NULL DEFAULT 'in_service',
    ADD COLUMN IF NOT EXISTS disposal_date DATE,
    ADD COLUMN IF NOT EXISTS finance_provider VARCHAR(160),
    ADD COLUMN IF NOT EXISTS lease_contract_reference VARCHAR(160),
    ADD COLUMN IF NOT EXISTS expected_replacement_date DATE,
    ADD COLUMN IF NOT EXISTS replacement_reason TEXT;

ALTER TABLE fleet.fleet
    ADD CONSTRAINT fleet_ownership_type_check
        CHECK (ownership_type IN ('owned', 'leased', 'hired_in', 'financed', 'rented', 'subcontracted')) NOT VALID,
    ADD CONSTRAINT fleet_operational_status_check
        CHECK (operational_status IN (
            'available', 'reserved', 'mobilisation_pending', 'deployed', 'operating',
            'idle_on_site', 'under_inspection', 'scheduled_maintenance', 'breakdown',
            'under_repair', 'awaiting_parts', 'hired_out', 'hired_in', 'quarantined',
            'decommissioned', 'disposed', 'assigned', 'in_service', 'out_of_service', 'retired'
        )) NOT VALID,
    ADD CONSTRAINT fleet_meter_type_check
        CHECK (meter_type IN ('kilometres', 'engine_hours', 'cycles')) NOT VALID,
    ADD CONSTRAINT fleet_disposal_status_check
        CHECK (disposal_status IN ('in_service', 'marked_for_disposal', 'under_disposal', 'disposed')) NOT VALID,
    ADD CONSTRAINT fleet_disposal_date_check
        CHECK (disposal_date IS NULL OR acquired_on IS NULL OR disposal_date >= acquired_on) NOT VALID;

ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_ownership_type_check;
ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_operational_status_check;
ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_meter_type_check;
ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_disposal_status_check;
ALTER TABLE fleet.fleet VALIDATE CONSTRAINT fleet_disposal_date_check;

ALTER TABLE fleet.fleet_inspections
    DROP CONSTRAINT IF EXISTS fleet_fleet_inspections_inspection_type_check;

ALTER TABLE fleet.fleet_inspections
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS dispatch_note_id UUID REFERENCES fleet.dispatch_notes(id),
    ADD COLUMN IF NOT EXISTS severity VARCHAR(24),
    ADD COLUMN IF NOT EXISTS corrective_task_id UUID REFERENCES crm.tasks(id),
    ADD COLUMN IF NOT EXISTS return_to_service_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS return_to_service_approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS return_to_service_approved_at TIMESTAMPTZ,
    ADD CONSTRAINT fleet_fleet_inspections_inspection_type_check
        CHECK (inspection_type IN (
            'pre_start', 'post_operation', 'post_trip', 'weekly', 'mobilisation',
            'demobilisation', 'maintenance', 'accident', 'hired_in', 'statutory',
            'scheduled', 'compliance'
        )) NOT VALID,
    ADD CONSTRAINT fleet_inspection_severity_check
        CHECK (severity IS NULL OR severity IN ('minor', 'moderate', 'critical', 'catastrophic')) NOT VALID;

ALTER TABLE fleet.fleet_inspections VALIDATE CONSTRAINT fleet_fleet_inspections_inspection_type_check;
ALTER TABLE fleet.fleet_inspections VALIDATE CONSTRAINT fleet_inspection_severity_check;

ALTER TABLE fleet.fleet_defects
    DROP CONSTRAINT IF EXISTS fleet_fleet_defects_severity_check,
    DROP CONSTRAINT IF EXISTS fleet_fleet_defects_status_check;

ALTER TABLE fleet.fleet_defects
    ADD COLUMN IF NOT EXISTS system_action VARCHAR(80),
    ADD COLUMN IF NOT EXISTS supervisor_approval_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS locked_asset BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT fleet_fleet_defects_severity_check
        CHECK (severity IN ('low', 'medium', 'high', 'minor', 'moderate', 'critical', 'catastrophic')) NOT VALID,
    ADD CONSTRAINT fleet_fleet_defects_status_check
        CHECK (status IN ('open', 'triaged', 'in_repair', 'resolved', 'deferred', 'supervisor_approval', 'asset_locked', 'escalated')) NOT VALID;

ALTER TABLE fleet.fleet_defects VALIDATE CONSTRAINT fleet_fleet_defects_severity_check;
ALTER TABLE fleet.fleet_defects VALIDATE CONSTRAINT fleet_fleet_defects_status_check;

ALTER TABLE fleet.maintenance_work_orders
    DROP CONSTRAINT IF EXISTS fleet_maintenance_work_orders_status_check;

ALTER TABLE fleet.maintenance_work_orders
    ADD COLUMN IF NOT EXISTS diagnosis TEXT,
    ADD COLUMN IF NOT EXISTS parts_request_reference VARCHAR(160),
    ADD COLUMN IF NOT EXISTS technician_employee_id UUID REFERENCES hr.employees(id),
    ADD COLUMN IF NOT EXISTS estimated_downtime_hours NUMERIC(10,2) CHECK (estimated_downtime_hours IS NULL OR estimated_downtime_hours >= 0),
    ADD COLUMN IF NOT EXISTS repair_approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS testing_notes TEXT,
    ADD COLUMN IF NOT EXISTS return_to_service_certified_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS return_to_service_certified_at TIMESTAMPTZ,
    ADD CONSTRAINT fleet_maintenance_work_orders_status_check
        CHECK (status IN (
            'reported', 'assessed', 'awaiting_approval', 'awaiting_parts',
            'scheduled', 'in_progress', 'testing', 'completed',
            'returned_to_service', 'closed', 'open', 'cancelled'
        )) NOT VALID;

ALTER TABLE fleet.maintenance_work_orders VALIDATE CONSTRAINT fleet_maintenance_work_orders_status_check;

ALTER TABLE fleet.fuel_transactions
    ADD COLUMN IF NOT EXISTS storage_tank VARCHAR(120),
    ADD COLUMN IF NOT EXISTS issued_to_operator_employee_id UUID REFERENCES hr.employees(id),
    ADD COLUMN IF NOT EXISTS cost_centre VARCHAR(120),
    ADD COLUMN IF NOT EXISTS issuer_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS receiver_signature TEXT,
    ADD COLUMN IF NOT EXISTS tank_balance_after NUMERIC(14,3) CHECK (tank_balance_after IS NULL OR tank_balance_after >= 0),
    ADD COLUMN IF NOT EXISTS actual_consumption_litres NUMERIC(14,3) CHECK (actual_consumption_litres IS NULL OR actual_consumption_litres >= 0),
    ADD COLUMN IF NOT EXISTS litres_per_hour NUMERIC(14,3) CHECK (litres_per_hour IS NULL OR litres_per_hour >= 0),
    ADD COLUMN IF NOT EXISTS duplicate_slip_hash VARCHAR(160);

CREATE UNIQUE INDEX IF NOT EXISTS fleet_fuel_duplicate_slip_hash_unique
    ON fleet.fuel_transactions (organization_id, duplicate_slip_hash)
    WHERE duplicate_slip_hash IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS fleet.operator_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id UUID REFERENCES hr.employees(id),
    contractor_name VARCHAR(255),
    assigned_asset_types TEXT[] NOT NULL DEFAULT '{}'::text[],
    licence_classes TEXT[] NOT NULL DEFAULT '{}'::text[],
    operator_certificates JSONB NOT NULL DEFAULT '[]'::jsonb,
    training_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    medical_clearance_expiry DATE,
    competency_status VARCHAR(32) NOT NULL DEFAULT 'pending'
        CHECK (competency_status IN ('pending', 'competent', 'restricted', 'expired', 'suspended')),
    current_assignment_id UUID REFERENCES fleet.fleet_assignments(id),
    incident_count INTEGER NOT NULL DEFAULT 0 CHECK (incident_count >= 0),
    performance_score NUMERIC(5,2) CHECK (performance_score IS NULL OR (performance_score >= 0 AND performance_score <= 100)),
    performance_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    incidents_and_violations JSONB NOT NULL DEFAULT '[]'::jsonb,
    suspended BOOLEAN NOT NULL DEFAULT false,
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS operator_profiles_employee_unique
    ON fleet.operator_profiles (organization_id, employee_id)
    WHERE employee_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS fleet.external_hire_agreements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id UUID REFERENCES fleet.plant_requests(id),
    customer_id UUID REFERENCES crm.contacts(id),
    customer_name VARCHAR(255),
    hire_agreement_number VARCHAR(120),
    status VARCHAR(32) NOT NULL DEFAULT 'enquiry'
        CHECK (status IN ('enquiry', 'quoted', 'approved', 'agreement_signed', 'deposit_pending', 'dispatched', 'active', 'off_hire_requested', 'returned', 'invoice_instruction', 'debtor_follow_up', 'closed', 'cancelled')),
    hire_type VARCHAR(24) NOT NULL DEFAULT 'wet_hire'
        CHECK (hire_type IN ('dry_hire', 'wet_hire', 'hourly', 'daily', 'weekly_monthly', 'output_based')),
    rate_card JSONB NOT NULL DEFAULT '{}'::jsonb,
    deposit_required NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (deposit_required >= 0),
    fuel_responsibility VARCHAR(24) NOT NULL DEFAULT 'client'
        CHECK (fuel_responsibility IN ('snc', 'project', 'client')),
    mobilisation_charge NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (mobilisation_charge >= 0),
    demobilisation_charge NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (demobilisation_charge >= 0),
    standing_time_rate NUMERIC(15,4) CHECK (standing_time_rate IS NULL OR standing_time_rate >= 0),
    overtime_rate NUMERIC(15,4) CHECK (overtime_rate IS NULL OR overtime_rate >= 0),
    damage_recovery_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (damage_recovery_amount >= 0),
    invoice_instruction TEXT,
    debtor_follow_up_status VARCHAR(32) NOT NULL DEFAULT 'not_started'
        CHECK (debtor_follow_up_status IN ('not_started', 'pending', 'contacted', 'disputed', 'paid', 'escalated', 'closed')),
    debtor_follow_up_notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS fleet_full_register_status_idx
    ON fleet.fleet (organization_id, operational_status, asset_category, current_location)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS operator_profiles_status_idx
    ON fleet.operator_profiles (organization_id, competency_status, suspended)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS external_hire_agreements_status_idx
    ON fleet.external_hire_agreements (organization_id, status, hire_type)
    WHERE is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS external_hire_agreements_number_unique
    ON fleet.external_hire_agreements (organization_id, hire_agreement_number)
    WHERE hire_agreement_number IS NOT NULL AND is_deleted = false;

ALTER TABLE fleet.operator_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.external_hire_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.operator_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.external_hire_agreements FORCE ROW LEVEL SECURITY;

REVOKE ALL ON fleet.operator_profiles, fleet.external_hire_agreements FROM anon, authenticated;

DROP POLICY IF EXISTS "Operator profiles service role only" ON fleet.operator_profiles;
CREATE POLICY "Operator profiles service role only"
    ON fleet.operator_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "External hire agreements service role only" ON fleet.external_hire_agreements;
CREATE POLICY "External hire agreements service role only"
    ON fleet.external_hire_agreements FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (permission_key, description)
VALUES
    ('fleet.operator_profiles.read', 'View Plant & Equipment operator profiles'),
    ('fleet.operator_profiles.create', 'Create Plant & Equipment operator profiles'),
    ('fleet.operator_profiles.update', 'Update Plant & Equipment operator profiles'),
    ('fleet.external_hire.read', 'View external Plant & Equipment hire records'),
    ('fleet.external_hire.create', 'Create external Plant & Equipment hire records'),
    ('fleet.external_hire.update', 'Update external Plant & Equipment hire records')
ON CONFLICT (permission_key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.permission_key IN (
    'fleet.operator_profiles.read',
    'fleet.operator_profiles.create',
    'fleet.operator_profiles.update',
    'fleet.external_hire.read',
    'fleet.external_hire.create',
    'fleet.external_hire.update'
)
WHERE r.name IN ('Executive (Admin)', 'Fleet Supervisor', 'Equipment Manager', 'Maintenance Planner')
ON CONFLICT DO NOTHING;
