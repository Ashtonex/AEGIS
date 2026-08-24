-- ============================================================================
-- Plant & Equipment lifecycle spine
-- ============================================================================
-- Additive workflow layer over the signed-off fleet/equipment operational
-- controls. Existing asset, assignment, inspection, fuel, utilization,
-- maintenance, compliance and finance records remain the source records; these
-- tables orchestrate the demand-to-closure lifecycle around them.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS fleet.plant_request_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS fleet.plant_allocation_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS fleet.dispatch_note_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS fleet.off_hire_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS fleet.damage_claim_seq
    START WITH 1 INCREMENT BY 1 NO CYCLE;

CREATE TABLE IF NOT EXISTS fleet.plant_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    request_number          VARCHAR(40) NOT NULL,
    request_type            VARCHAR(24) NOT NULL
        CHECK (request_type IN ('internal_project', 'external_hire', 'maintenance', 'emergency', 'mobilisation', 'department_transfer', 'tender_capacity')),
    status                  VARCHAR(32) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'submitted', 'under_validation', 'returned_for_correction', 'rejected', 'availability_check', 'awaiting_cost_review', 'awaiting_risk_review', 'awaiting_approval', 'approved', 'reserved', 'ready_for_dispatch', 'dispatched', 'active', 'off_hire_requested', 'returned', 'under_reconciliation', 'closed', 'cancelled')),
    requesting_department_id UUID REFERENCES finance.departments(id),
    project_id              UUID REFERENCES projects.projects(id),
    client_id               UUID REFERENCES crm.contacts(id),
    client_name             VARCHAR(255),
    requested_by_user_id    UUID REFERENCES core.users(id),
    approver_user_id        UUID REFERENCES core.users(id),
    required_asset_type     VARCHAR(120) NOT NULL,
    specification           TEXT,
    attachments_required    TEXT,
    quantity                INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    work_location           VARCHAR(255) NOT NULL,
    start_date              DATE NOT NULL,
    end_date                DATE,
    operating_hours_mode    VARCHAR(24) NOT NULL DEFAULT 'normal'
        CHECK (operating_hours_mode IN ('normal', 'extended', 'continuous')),
    operator_required       BOOLEAN NOT NULL DEFAULT false,
    fuel_responsibility     VARCHAR(24) NOT NULL DEFAULT 'snc'
        CHECK (fuel_responsibility IN ('snc', 'project', 'client')),
    transport_requirement   VARCHAR(24) NOT NULL DEFAULT 'drive'
        CHECK (transport_requirement IN ('low_bed', 'tow', 'drive', 'collection', 'none')),
    work_description        TEXT NOT NULL,
    cost_centre             VARCHAR(120),
    priority                VARCHAR(16) NOT NULL DEFAULT 'routine'
        CHECK (priority IN ('routine', 'urgent', 'emergency')),
    commercial_terms        JSONB NOT NULL DEFAULT '{}'::jsonb,
    risk_assessment         JSONB NOT NULL DEFAULT '{}'::jsonb,
    validation_notes        TEXT,
    correction_notes        TEXT,
    rejection_reason        TEXT,
    expected_revenue        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (expected_revenue >= 0),
    estimated_cost          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_cost >= 0),
    contribution_margin     NUMERIC(15,2) NOT NULL DEFAULT 0,
    risk_level              VARCHAR(16) NOT NULL DEFAULT 'normal'
        CHECK (risk_level IN ('low', 'normal', 'high', 'critical')),
    approved_at             TIMESTAMPTZ,
    approved_by             UUID REFERENCES core.users(id),
    closed_at               TIMESTAMPTZ,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, request_number),
    CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS fleet.plant_request_items (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id) ON DELETE CASCADE,
    fleet_id                UUID REFERENCES fleet.fleet(id),
    required_asset_type     VARCHAR(120) NOT NULL,
    specification           TEXT,
    quantity                INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    hire_rate               NUMERIC(15,4) CHECK (hire_rate IS NULL OR hire_rate >= 0),
    estimated_hours         NUMERIC(10,2) CHECK (estimated_hours IS NULL OR estimated_hours >= 0),
    estimated_cost          NUMERIC(15,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
    status                  VARCHAR(24) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'available', 'reserved', 'allocated', 'substituted', 'hire_in_required', 'cancelled')),
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS fleet.plant_reservations (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id) ON DELETE CASCADE,
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    reservation_number      VARCHAR(40) NOT NULL,
    status                  VARCHAR(24) NOT NULL DEFAULT 'provisional'
        CHECK (status IN ('provisional', 'confirmed', 'released', 'expired', 'cancelled')),
    reserved_from           TIMESTAMPTZ NOT NULL,
    reserved_until          TIMESTAMPTZ,
    conditions              TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, reservation_number),
    CHECK (reserved_until IS NULL OR reserved_until >= reserved_from)
);

CREATE TABLE IF NOT EXISTS fleet.dispatch_notes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    dispatch_number         VARCHAR(40) NOT NULL,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id),
    reservation_id          UUID REFERENCES fleet.plant_reservations(id),
    assignment_id           UUID REFERENCES fleet.fleet_assignments(id),
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    pre_dispatch_inspection_id UUID REFERENCES fleet.fleet_inspections(id),
    status                  VARCHAR(24) NOT NULL DEFAULT 'ready'
        CHECK (status IN ('ready', 'dispatched', 'received', 'cancelled')),
    dispatch_at             TIMESTAMPTZ,
    origin_location         VARCHAR(255),
    destination_location    VARCHAR(255) NOT NULL,
    transport_instructions  TEXT,
    operator_employee_id    UUID REFERENCES hr.employees(id),
    issuing_officer_id      UUID REFERENCES core.users(id),
    receiving_party         VARCHAR(255),
    handover_signatures     JSONB NOT NULL DEFAULT '{}'::jsonb,
    dispatch_pack           JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes                   TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, dispatch_number)
);

CREATE TABLE IF NOT EXISTS fleet.plant_incidents (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id        UUID REFERENCES fleet.plant_requests(id),
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    assignment_id           UUID REFERENCES fleet.fleet_assignments(id),
    work_order_id           UUID REFERENCES fleet.maintenance_work_orders(id),
    incident_type           VARCHAR(32) NOT NULL
        CHECK (incident_type IN ('breakdown', 'injury', 'property_damage', 'theft', 'fire', 'overturn', 'environmental', 'third_party_claim', 'operator_misconduct', 'fuel_variance', 'parts_fraud', 'downtime', 'other')),
    severity                VARCHAR(16) NOT NULL DEFAULT 'medium'
        CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status                  VARCHAR(24) NOT NULL DEFAULT 'reported'
        CHECK (status IN ('reported', 'under_review', 'work_order_opened', 'resolved', 'closed', 'cancelled')),
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    location                VARCHAR(255),
    meter_reading           NUMERIC(14,2) CHECK (meter_reading IS NULL OR meter_reading >= 0),
    description             TEXT NOT NULL,
    escalation_required     BOOLEAN NOT NULL DEFAULT false,
    reported_by             UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS fleet.off_hire_records (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    off_hire_number         VARCHAR(40) NOT NULL,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id),
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    assignment_id           UUID REFERENCES fleet.fleet_assignments(id),
    status                  VARCHAR(24) NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'collection_arranged', 'returned', 'cancelled')),
    final_working_at        TIMESTAMPTZ NOT NULL,
    final_meter_reading     NUMERIC(14,2) CHECK (final_meter_reading IS NULL OR final_meter_reading >= 0),
    final_fuel_level        VARCHAR(80),
    release_reason          VARCHAR(40) NOT NULL
        CHECK (release_reason IN ('work_completed', 'hire_expired', 'client_terminated', 'project_released', 'asset_recalled', 'unsafe', 'payment_breach', 'contract_breach', 'other')),
    transport_required      BOOLEAN NOT NULL DEFAULT false,
    confirmation_party      VARCHAR(255),
    notes                   TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, off_hire_number)
);

CREATE TABLE IF NOT EXISTS fleet.return_inspections (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id),
    off_hire_id             UUID REFERENCES fleet.off_hire_records(id),
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    pre_dispatch_inspection_id UUID REFERENCES fleet.fleet_inspections(id),
    inspection_id           UUID REFERENCES fleet.fleet_inspections(id),
    outcome                 VARCHAR(32) NOT NULL
        CHECK (outcome IN ('good_condition', 'minor_maintenance', 'major_repair', 'client_damage', 'missing_items', 'service_due', 'safety_block')),
    final_meter_reading     NUMERIC(14,2) CHECK (final_meter_reading IS NULL OR final_meter_reading >= 0),
    final_fuel_level        VARCHAR(80),
    damage_notes            TEXT,
    missing_items           TEXT,
    cleaning_required       BOOLEAN NOT NULL DEFAULT false,
    quarantine_required     BOOLEAN NOT NULL DEFAULT false,
    inspected_by            UUID REFERENCES core.users(id),
    inspected_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS fleet.damage_claims (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    claim_number            VARCHAR(40) NOT NULL,
    plant_request_id        UUID REFERENCES fleet.plant_requests(id),
    return_inspection_id    UUID REFERENCES fleet.return_inspections(id),
    fleet_id                UUID NOT NULL REFERENCES fleet.fleet(id),
    claim_type              VARCHAR(32) NOT NULL
        CHECK (claim_type IN ('damage', 'missing_items', 'fuel_variance', 'cleaning', 'excess_wear', 'other')),
    status                  VARCHAR(24) NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'submitted', 'accepted', 'disputed', 'recovered', 'written_off', 'cancelled')),
    liable_party            VARCHAR(255),
    estimated_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (estimated_amount >= 0),
    approved_amount         NUMERIC(15,2) CHECK (approved_amount IS NULL OR approved_amount >= 0),
    description             TEXT NOT NULL,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, claim_number)
);

CREATE TABLE IF NOT EXISTS fleet.plant_financial_closures (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plant_request_id        UUID NOT NULL REFERENCES fleet.plant_requests(id),
    status                  VARCHAR(24) NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'under_review', 'posted', 'disputed', 'closed', 'cancelled')),
    internal_charge_amount  NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (internal_charge_amount >= 0),
    external_invoice_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (external_invoice_amount >= 0),
    operator_cost_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (operator_cost_amount >= 0),
    fuel_cost_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (fuel_cost_amount >= 0),
    transport_cost_amount   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (transport_cost_amount >= 0),
    maintenance_cost_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (maintenance_cost_amount >= 0),
    damage_charge_amount    NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (damage_charge_amount >= 0),
    discount_amount         NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    tax_amount              NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    outstanding_balance     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (outstanding_balance >= 0),
    contribution_margin     NUMERIC(15,2) NOT NULL DEFAULT 0,
    invoice_reference       VARCHAR(120),
    finance_notes           TEXT,
    operational_confirmed_by UUID REFERENCES core.users(id),
    commercial_confirmed_by UUID REFERENCES core.users(id),
    finance_confirmed_by   UUID REFERENCES core.users(id),
    closed_at               TIMESTAMPTZ,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, plant_request_id)
);

ALTER TABLE fleet.fleet_assignments
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES fleet.plant_reservations(id),
    ADD COLUMN IF NOT EXISTS dispatch_note_id UUID REFERENCES fleet.dispatch_notes(id);

ALTER TABLE fleet.fleet_inspections
    DROP CONSTRAINT IF EXISTS fleet_fleet_inspections_inspection_type_check,
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS dispatch_note_id UUID REFERENCES fleet.dispatch_notes(id),
    ADD COLUMN IF NOT EXISTS return_inspection_id UUID;

ALTER TABLE fleet.fuel_transactions
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS expected_consumption_litres NUMERIC(14,3) CHECK (expected_consumption_litres IS NULL OR expected_consumption_litres >= 0),
    ADD COLUMN IF NOT EXISTS variance_litres NUMERIC(14,3),
    ADD COLUMN IF NOT EXISTS variance_task_id UUID REFERENCES crm.tasks(id);

ALTER TABLE fleet.utilization_logs
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS productive_hours NUMERIC(10,2) CHECK (productive_hours IS NULL OR productive_hours >= 0 AND productive_hours <= 24),
    ADD COLUMN IF NOT EXISTS downtime_hours NUMERIC(10,2) CHECK (downtime_hours IS NULL OR downtime_hours >= 0 AND downtime_hours <= 24),
    ADD COLUMN IF NOT EXISTS work_performed TEXT,
    ADD COLUMN IF NOT EXISTS supervisor_approval VARCHAR(255);

ALTER TABLE fleet.maintenance_work_orders
    ADD COLUMN IF NOT EXISTS plant_request_id UUID REFERENCES fleet.plant_requests(id),
    ADD COLUMN IF NOT EXISTS incident_id UUID REFERENCES fleet.plant_incidents(id);

CREATE INDEX IF NOT EXISTS plant_requests_org_status_idx
    ON fleet.plant_requests (organization_id, status, priority, start_date)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS plant_requests_project_idx
    ON fleet.plant_requests (organization_id, project_id, start_date DESC)
    WHERE is_deleted = false AND project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS plant_request_items_request_idx
    ON fleet.plant_request_items (organization_id, plant_request_id)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS plant_reservations_asset_window_idx
    ON fleet.plant_reservations (organization_id, fleet_id, reserved_from, reserved_until)
    WHERE is_deleted = false AND status IN ('provisional', 'confirmed');
CREATE INDEX IF NOT EXISTS dispatch_notes_request_idx
    ON fleet.dispatch_notes (organization_id, plant_request_id, dispatch_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS plant_incidents_org_status_idx
    ON fleet.plant_incidents (organization_id, status, severity, occurred_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS off_hire_request_idx
    ON fleet.off_hire_records (organization_id, plant_request_id, final_working_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS return_inspections_request_idx
    ON fleet.return_inspections (organization_id, plant_request_id, inspected_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS damage_claims_request_idx
    ON fleet.damage_claims (organization_id, plant_request_id, status)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS plant_financial_closures_status_idx
    ON fleet.plant_financial_closures (organization_id, status, closed_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS fleet_assignments_plant_request_idx
    ON fleet.fleet_assignments (organization_id, plant_request_id)
    WHERE is_deleted = false AND plant_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_utilization_plant_request_idx
    ON fleet.utilization_logs (organization_id, plant_request_id, occurred_on DESC)
    WHERE is_deleted = false AND plant_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_fuel_plant_request_idx
    ON fleet.fuel_transactions (organization_id, plant_request_id, transaction_at DESC)
    WHERE is_deleted = false AND plant_request_id IS NOT NULL;

ALTER TABLE fleet.plant_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.dispatch_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.off_hire_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.return_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.damage_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_financial_closures ENABLE ROW LEVEL SECURITY;

ALTER TABLE fleet.plant_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_request_items FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.dispatch_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.off_hire_records FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.return_inspections FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.damage_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE fleet.plant_financial_closures FORCE ROW LEVEL SECURITY;

REVOKE ALL ON fleet.plant_requests, fleet.plant_request_items, fleet.plant_reservations,
    fleet.dispatch_notes, fleet.plant_incidents, fleet.off_hire_records,
    fleet.return_inspections, fleet.damage_claims, fleet.plant_financial_closures
FROM anon, authenticated;

CREATE POLICY "Plant requests service role only" ON fleet.plant_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Plant request items service role only" ON fleet.plant_request_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Plant reservations service role only" ON fleet.plant_reservations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Dispatch notes service role only" ON fleet.dispatch_notes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Plant incidents service role only" ON fleet.plant_incidents FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Off hire records service role only" ON fleet.off_hire_records FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Return inspections service role only" ON fleet.return_inspections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Damage claims service role only" ON fleet.damage_claims FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Plant financial closures service role only" ON fleet.plant_financial_closures FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('fleet.plant_requests.read', 'View Plant & Equipment lifecycle requests'),
    ('fleet.plant_requests.create', 'Create Plant & Equipment requests'),
    ('fleet.plant_requests.update', 'Validate, reserve, dispatch and return Plant & Equipment requests'),
    ('fleet.plant_requests.approve', 'Approve Plant & Equipment allocations and commercial terms'),
    ('fleet.plant_requests.close', 'Close Plant & Equipment financial reconciliation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'fleet.plant_requests.read',
    'fleet.plant_requests.create',
    'fleet.plant_requests.update',
    'fleet.plant_requests.approve',
    'fleet.plant_requests.close'
)
WHERE r.name IN ('Executive (Admin)', 'Fleet Supervisor', 'Equipment Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'fleet.plant_requests.read',
    'fleet.plant_requests.create',
    'fleet.plant_requests.update'
)
WHERE r.name IN ('Project Manager', 'Site Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN (
    'fleet.plant_requests.read',
    'fleet.plant_requests.create'
)
WHERE r.name IN ('Fleet Clerk', 'Commercial Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, t.entity_type, t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('plant_request', 'Validate Plant Request', 'Check specification, dates, site, operator, fuel, cost centre, commercial terms and safety/access requirements.', 1),
    ('plant_request', 'Availability and Capacity Check', 'Confirm asset, operator, service, licence, attachment and transport availability before approval.', 2),
    ('plant_request', 'Cost and Risk Review', 'Confirm plant rate, operator, fuel, transport, maintenance allowance, risk and approval authority.', 3),
    ('plant_request', 'Approval and Reservation', 'Approve the request and convert the provisional reservation into a controlled allocation.', 4),
    ('plant_dispatch', 'Pre-Dispatch Inspection', 'Complete inspection, photos, fuel level, meter reading and dispatch pack before handover.', 1),
    ('plant_dispatch', 'Dispatch and Handover', 'Issue the approved dispatch pack and capture issuing, transport and receiving confirmations.', 2),
    ('plant_breakdown', 'Breakdown Response', 'Secure machine, record evidence, notify Plant Manager, open work order and track downtime.', 1),
    ('plant_return', 'Off-Hire Confirmation', 'Confirm final working time, meter, fuel, transport, attachments and charge stop condition.', 1),
    ('plant_return', 'Return Inspection', 'Compare against pre-dispatch record and raise work order, quarantine, claim or release actions.', 2),
    ('plant_closure', 'Financial Reconciliation', 'Confirm hire/internal charges, fuel, maintenance, damage, invoice/payment and close the Plant Request.', 1)
) AS t(entity_type, title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id
        AND existing.entity_type = t.entity_type
        AND existing.title = t.title
  );
