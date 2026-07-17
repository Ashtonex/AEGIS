-- Equipment to Finance vertical-slice integration.
-- Adds project allocation, costing, event/audit hooks and profitability fields
-- to the existing fleet operational foundation. No seed data.

ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS hourly_charge_rate NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (hourly_charge_rate >= 0),
    ADD COLUMN IF NOT EXISTS hourly_operating_cost NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (hourly_operating_cost >= 0),
    ADD COLUMN IF NOT EXISTS idle_hour_cost NUMERIC(15,4) NOT NULL DEFAULT 0 CHECK (idle_hour_cost >= 0),
    ADD COLUMN IF NOT EXISTS monthly_ownership_cost NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (monthly_ownership_cost >= 0),
    ADD COLUMN IF NOT EXISTS current_project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS current_assignment_id UUID REFERENCES fleet.fleet_assignments(id);

ALTER TABLE fleet.fuel_transactions
    ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES fleet.fleet_assignments(id),
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS cost_transaction_id UUID REFERENCES finance.cost_transactions(id);

ALTER TABLE fleet.utilization_logs
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS revenue_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (revenue_amount >= 0),
    ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0),
    ADD COLUMN IF NOT EXISTS cost_transaction_id UUID REFERENCES finance.cost_transactions(id);

ALTER TABLE fleet.maintenance_work_orders
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS cost_transaction_id UUID REFERENCES finance.cost_transactions(id);

CREATE INDEX IF NOT EXISTS fleet_current_project_idx
    ON fleet.fleet (organization_id, current_project_id)
    WHERE is_deleted = false AND current_project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_fuel_project_idx
    ON fleet.fuel_transactions (organization_id, project_id, transaction_at DESC)
    WHERE is_deleted = false AND project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_utilization_project_idx
    ON fleet.utilization_logs (organization_id, project_id, occurred_on DESC)
    WHERE is_deleted = false AND project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fleet_work_orders_project_idx
    ON fleet.maintenance_work_orders (organization_id, project_id, completed_at DESC)
    WHERE is_deleted = false AND project_id IS NOT NULL;

INSERT INTO core.permissions (key, description) VALUES
    ('fleet.assignment.create', 'Create equipment assignments and deployments'),
    ('fleet.utilization.record', 'Record equipment utilization and operating hours'),
    ('fleet.fuel.record', 'Record equipment fuel transactions'),
    ('fleet.maintenance.complete', 'Complete equipment maintenance work orders'),
    ('fleet.profitability.view', 'View equipment utilization, operating cost and profitability')
ON CONFLICT (key) DO NOTHING;
