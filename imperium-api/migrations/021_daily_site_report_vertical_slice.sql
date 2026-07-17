-- Approved Daily Site Report vertical slice.
-- This migration adds the minimum shared foundations required to connect
-- site operations, labour, plant, materials, documents, finance, reporting,
-- and executive intelligence without depending on Redis/Arq.

CREATE TABLE IF NOT EXISTS core.domain_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    event_type VARCHAR(160) NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version > 0),
    aggregate_type VARCHAR(120) NOT NULL,
    aggregate_id UUID NOT NULL,
    project_id UUID REFERENCES projects.projects(id),
    actor_id UUID REFERENCES core.users(id),
    idempotency_key VARCHAR(240) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(24) NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'processing', 'processed', 'failed')),
    error_message TEXT,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS domain_events_org_type_idx
    ON core.domain_events (organization_id, event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS domain_events_aggregate_idx
    ON core.domain_events (organization_id, aggregate_type, aggregate_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS core.approval_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    workflow_key VARCHAR(120) NOT NULL,
    target_type VARCHAR(120) NOT NULL,
    target_id UUID NOT NULL,
    project_id UUID REFERENCES projects.projects(id),
    status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    submitted_by UUID REFERENCES core.users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_by UUID REFERENCES core.users(id),
    decided_at TIMESTAMPTZ,
    decision_reason TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS approval_instances_active_target_unique
    ON core.approval_instances (organization_id, workflow_key, target_type, target_id)
    WHERE is_deleted = false AND status = 'pending';
CREATE INDEX IF NOT EXISTS approval_instances_queue_idx
    ON core.approval_instances (organization_id, status, submitted_at DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS core.approval_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    approval_instance_id UUID NOT NULL REFERENCES core.approval_instances(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL CHECK (step_number > 0),
    role_name VARCHAR(120),
    approver_id UUID REFERENCES core.users(id),
    status VARCHAR(24) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'skipped')),
    decided_by UUID REFERENCES core.users(id),
    decided_at TIMESTAMPTZ,
    reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, approval_instance_id, step_number)
);

CREATE TABLE IF NOT EXISTS core.document_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES core.documents(id) ON DELETE CASCADE,
    entity_type VARCHAR(120) NOT NULL,
    entity_id UUID NOT NULL,
    project_id UUID REFERENCES projects.projects(id),
    link_role VARCHAR(80) NOT NULL DEFAULT 'evidence',
    linked_by UUID REFERENCES core.users(id),
    linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, document_id, entity_type, entity_id, link_role)
);

CREATE INDEX IF NOT EXISTS document_links_entity_idx
    ON core.document_links (organization_id, entity_type, entity_id)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS projects.sites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE CASCADE,
    site_code VARCHAR(80),
    name VARCHAR(255) NOT NULL,
    location_label VARCHAR(255),
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('planned', 'active', 'suspended', 'closed')),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, site_code)
);

CREATE TABLE IF NOT EXISTS projects.daily_site_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    site_id UUID REFERENCES projects.sites(id) ON DELETE RESTRICT,
    report_date DATE NOT NULL,
    shift VARCHAR(32) NOT NULL DEFAULT 'day' CHECK (shift IN ('day', 'night', 'double')),
    status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'cancelled')),
    weather JSONB NOT NULL DEFAULT '{}'::jsonb,
    planned_work TEXT,
    actual_work TEXT,
    delays TEXT,
    safety_notes TEXT,
    cost_exposure NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost_exposure >= 0),
    submitted_at TIMESTAMPTZ,
    submitted_by UUID REFERENCES core.users(id),
    approved_at TIMESTAMPTZ,
    approved_by UUID REFERENCES core.users(id),
    rejection_reason TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, project_id, report_date, shift)
);

CREATE INDEX IF NOT EXISTS daily_site_reports_project_status_idx
    ON projects.daily_site_reports (organization_id, project_id, status, report_date DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS projects.daily_report_labour (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES projects.daily_site_reports(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES hr.employees(id) ON DELETE RESTRICT,
    role_on_site VARCHAR(120),
    regular_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (regular_hours >= 0 AND regular_hours <= 24),
    overtime_hours NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overtime_hours >= 0 AND overtime_hours <= 24),
    cost_rate NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (regular_hours + overtime_hours > 0)
);

CREATE TABLE IF NOT EXISTS projects.daily_report_equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES projects.daily_site_reports(id) ON DELETE CASCADE,
    fleet_id UUID NOT NULL REFERENCES fleet.fleet(id) ON DELETE RESTRICT,
    operator_employee_id UUID REFERENCES hr.employees(id) ON DELETE RESTRICT,
    operating_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (operating_hours >= 0 AND operating_hours <= 24),
    idle_hours NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (idle_hours >= 0 AND idle_hours <= 24),
    fuel_litres NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (fuel_litres >= 0),
    cost_rate NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost_rate >= 0),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (idle_hours <= operating_hours),
    CHECK (operating_hours > 0 OR fuel_litres > 0)
);

CREATE TABLE IF NOT EXISTS procurement.stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES projects.projects(id),
    site_id UUID REFERENCES projects.sites(id),
    store_code VARCHAR(80),
    name VARCHAR(255) NOT NULL,
    store_type VARCHAR(32) NOT NULL DEFAULT 'site' CHECK (store_type IN ('warehouse', 'site', 'yard', 'vehicle')),
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'closed')),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, store_code)
);

CREATE TABLE IF NOT EXISTS procurement.stock_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES procurement.inventory_items(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES procurement.stores(id) ON DELETE RESTRICT,
    project_id UUID REFERENCES projects.projects(id) ON DELETE RESTRICT,
    movement_type VARCHAR(32) NOT NULL CHECK (movement_type IN ('receipt', 'issue', 'return', 'transfer_in', 'transfer_out', 'adjustment', 'consumption')),
    quantity NUMERIC(14,3) NOT NULL CHECK (quantity <> 0),
    unit_cost NUMERIC(15,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
    total_cost NUMERIC(15,2) CHECK (total_cost IS NULL OR total_cost >= 0),
    source_type VARCHAR(120),
    source_id UUID,
    reference VARCHAR(160),
    movement_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    recorded_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, source_type, source_id, item_id, movement_type)
);

CREATE INDEX IF NOT EXISTS stock_ledger_item_store_idx
    ON procurement.stock_ledger (organization_id, item_id, store_id, movement_at DESC);

CREATE TABLE IF NOT EXISTS projects.daily_report_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    report_id UUID NOT NULL REFERENCES projects.daily_site_reports(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES procurement.inventory_items(id) ON DELETE RESTRICT,
    store_id UUID REFERENCES procurement.stores(id) ON DELETE RESTRICT,
    quantity_used NUMERIC(14,3) NOT NULL CHECK (quantity_used > 0),
    unit_cost NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    wastage_quantity NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (wastage_quantity >= 0),
    work_package VARCHAR(160),
    notes TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS finance.cost_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(40) NOT NULL CHECK (category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS finance.cost_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    cost_code_id UUID REFERENCES finance.cost_codes(id),
    source_type VARCHAR(120) NOT NULL,
    source_id UUID NOT NULL,
    cost_category VARCHAR(40) NOT NULL CHECK (cost_category IN ('labour', 'equipment', 'materials', 'subcontract', 'overhead', 'other')),
    description TEXT,
    quantity NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (quantity >= 0),
    unit_cost NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    amount NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
    transaction_date DATE NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'reversed')),
    posted_by UUID REFERENCES core.users(id),
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, source_type, source_id, cost_category)
);

CREATE INDEX IF NOT EXISTS cost_transactions_project_idx
    ON finance.cost_transactions (organization_id, project_id, transaction_date DESC, cost_category);

ALTER TABLE core.domain_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.approval_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.approval_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_site_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_labour ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.stock_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cost_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.cost_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE core.domain_events FORCE ROW LEVEL SECURITY;
ALTER TABLE core.approval_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE core.approval_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE core.document_links FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.sites FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_site_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_labour FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_equipment FORCE ROW LEVEL SECURITY;
ALTER TABLE projects.daily_report_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.stores FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.stock_ledger FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.cost_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE finance.cost_transactions FORCE ROW LEVEL SECURITY;

REVOKE ALL ON core.domain_events, core.approval_instances, core.approval_steps, core.document_links FROM anon, authenticated;
REVOKE ALL ON projects.sites, projects.daily_site_reports, projects.daily_report_labour,
    projects.daily_report_equipment, projects.daily_report_materials FROM anon, authenticated;
REVOKE ALL ON procurement.stores, procurement.stock_ledger FROM anon, authenticated;
REVOKE ALL ON finance.cost_codes, finance.cost_transactions FROM anon, authenticated;

CREATE POLICY "Operational foundation service role only" ON core.domain_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Operational foundation service role only" ON core.approval_instances FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Operational foundation service role only" ON core.approval_steps FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Operational foundation service role only" ON core.document_links FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Site reporting service role only" ON projects.sites FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Site reporting service role only" ON projects.daily_site_reports FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Site reporting service role only" ON projects.daily_report_labour FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Site reporting service role only" ON projects.daily_report_equipment FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Site reporting service role only" ON projects.daily_report_materials FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Inventory operational service role only" ON procurement.stores FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Inventory operational service role only" ON procurement.stock_ledger FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Finance operational service role only" ON finance.cost_codes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Finance operational service role only" ON finance.cost_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.daily_report.read', 'View daily site reports and connected evidence'),
    ('site_operations.daily_report.create', 'Create daily site reports'),
    ('site_operations.daily_report.update', 'Edit draft or rejected daily site reports'),
    ('site_operations.daily_report.submit', 'Submit daily site reports for approval'),
    ('site_operations.daily_report.approve', 'Approve or reject submitted daily site reports'),
    ('site_operations.labour.record', 'Record labour on daily site reports'),
    ('site_operations.equipment.record', 'Record equipment usage on daily site reports'),
    ('site_operations.material.record', 'Record material consumption on daily site reports'),
    ('documents.link', 'Link documents to operational business records'),
    ('finance.cost.post', 'Post project cost transactions from approved operational records'),
    ('finance.cost.view', 'View project operational cost impact'),
    ('analytics.exceptions.read', 'View analytics exceptions generated from operational events')
ON CONFLICT (key) DO NOTHING;
