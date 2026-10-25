-- ============================================================================
-- Migration 273: Procurement plans and lifecycle task packs
-- ============================================================================
-- A procurement plan is "what this job needs to buy": one per opportunity,
-- carried over to its project when the deal is won. It is created (and
-- pre-filled from the BOQ) when a BOQ is uploaded, and every lifecycle stage
-- issues the next pack of procurement tasks through the existing task engine
-- (crm.task_templates -> crm.tasks, routed by crm.task_routing_rules):
--
--   planning     BOQ uploaded           list what is needed, set budgets
--   sourcing     deal won               get quotes, pick suppliers
--   ordering     pending deposit        raise POs, finance sign-off
--   executing    deposit received       issue POs before mobilisation, deliveries
--   reconciling  project completed      verify PO / delivery / paid invoice, savings
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement.procurement_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES crm.opportunities(id) ON DELETE SET NULL,
    project_id UUID REFERENCES projects.projects(id) ON DELETE SET NULL,
    quotation_id UUID REFERENCES finance.quotations(id) ON DELETE SET NULL,
    requisition_id UUID REFERENCES procurement.purchase_requisitions(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    stage VARCHAR(30) NOT NULL DEFAULT 'planning'
        CHECK (stage IN ('planning', 'sourcing', 'ordering', 'executing', 'reconciling', 'closed')),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT procurement_plans_has_owner CHECK (opportunity_id IS NOT NULL OR project_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_plans_opportunity
    ON procurement.procurement_plans (organization_id, opportunity_id)
    WHERE opportunity_id IS NOT NULL AND is_deleted = false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_procurement_plans_project
    ON procurement.procurement_plans (organization_id, project_id)
    WHERE project_id IS NOT NULL AND is_deleted = false;

CREATE TABLE IF NOT EXISTS procurement.procurement_plan_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES procurement.procurement_plans(id) ON DELETE CASCADE,
    description VARCHAR(500) NOT NULL,
    quantity NUMERIC(14, 3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    unit_of_measure VARCHAR(40) NOT NULL DEFAULT 'each',
    budget_unit_cost NUMERIC(15, 4) NOT NULL DEFAULT 0 CHECK (budget_unit_cost >= 0),
    source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('boq', 'manual', 'import')),
    source_ref VARCHAR(120),
    notes TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS ix_procurement_plan_items_plan
    ON procurement.procurement_plan_items (plan_id) WHERE is_deleted = false;

ALTER TABLE procurement.procurement_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.procurement_plans FORCE ROW LEVEL SECURITY;
ALTER TABLE procurement.procurement_plan_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurement.procurement_plan_items FORCE ROW LEVEL SECURITY;
REVOKE ALL ON procurement.procurement_plans FROM anon, authenticated;
REVOKE ALL ON procurement.procurement_plan_items FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Stage task packs. Titles start with "Procurement:" so the procurement
-- routing category (below) claims them by title keyword; the finance sign-off
-- task deliberately does not, so it routes to the Finance pool.
-- ---------------------------------------------------------------------------
WITH templates(stage, sort_order, requirement_code, title, description, responsible_role, criticality, weight, gate_effect) AS (
    VALUES
    ('planning', 10, 'PROC_PLAN_LIST_NEEDS', 'Procurement: list the materials this job needs',
     'Open the procurement plan (pre-filled from the BOQ where possible) and turn it into the real materials list: item, quantity and unit. Add anything missing, remove work items that are not purchases.',
     'Procurement Manager', 'high', 7, 'non_blocking'),
    ('planning', 20, 'PROC_PLAN_SET_BUDGET', 'Procurement: set a budget price for each planned item',
     'Enter the expected unit cost per item so the plan carries a materials budget to measure savings against.',
     'Procurement Manager', 'medium', 5, 'non_blocking'),
    ('sourcing', 10, 'PROC_SOURCE_REQUEST_QUOTES', 'Procurement: request supplier quotes for the planned materials',
     'The deal is won and the plan is now an active purchase request. Ask suppliers to quote for the items (Get quotes on the purchase).',
     'Procurement Associate', 'high', 7, 'non_blocking'),
    ('sourcing', 20, 'PROC_SOURCE_PICK_SUPPLIERS', 'Procurement: record quotes and choose suppliers',
     'Capture each quote as it arrives, compare them against the plan budget and pick the supplier for each item.',
     'Procurement Manager', 'high', 7, 'non_blocking'),
    ('ordering', 10, 'PROC_ORDER_RAISE_POS', 'Procurement: raise purchase orders from the chosen quotes',
     'The project is waiting for its deposit. Prepare the purchase orders now so they are signed off and ready to issue the moment the deposit lands.',
     'Procurement Manager', 'critical', 8, 'blocking'),
    ('ordering', 20, 'PROC_ORDER_FINANCE_SIGNOFF', 'Finance sign-off: approve this project''s purchase orders',
     'Check the draft purchase orders for this project against the budget and approve them for issue.',
     'Finance Manager', 'critical', 8, 'blocking'),
    ('executing', 10, 'PROC_EXEC_ISSUE_POS', 'Procurement: issue the approved purchase orders before mobilisation',
     'The deposit is in. Send the approved POs to suppliers so materials arrive for mobilisation.',
     'Procurement Manager', 'critical', 9, 'blocking'),
    ('executing', 20, 'PROC_EXEC_CONFIRM_DELIVERIES', 'Procurement: confirm delivery dates with suppliers',
     'Get a delivery date from each supplier and chase anything that will be late for the programme.',
     'Procurement Associate', 'high', 6, 'non_blocking'),
    ('reconciling', 10, 'PROC_RECON_VERIFY', 'Procurement: verify every PO against its delivery and paid invoice',
     'For each purchase order, confirm the delivery received and the paid invoice or receipt agree. Flag anything that does not reconcile.',
     'Procurement Manager', 'high', 7, 'blocking'),
    ('reconciling', 20, 'PROC_RECON_SAVINGS', 'Procurement: record budget vs actual and the savings achieved',
     'Compare the materials budget with what was actually paid. Record the saving (or overrun) and explain any big differences.',
     'Procurement Manager', 'medium', 5, 'non_blocking')
)
INSERT INTO crm.task_templates (
    organization_id, entity_type, title, description, sort_order, is_active,
    template_key, template_version, requirement_code, task_type, stage,
    reuse_scope, responsible_role, criticality, weight, gate_effect
)
SELECT o.id, 'procurement_plan', t.title, t.description, t.sort_order, true,
       'procurement_plan.' || t.stage, 1, t.requirement_code, 'control', t.stage,
       'entity_specific', t.responsible_role, t.criticality, t.weight, t.gate_effect
FROM core.organizations o
CROSS JOIN templates t
WHERE NOT EXISTS (
    SELECT 1 FROM crm.task_templates existing
    WHERE existing.organization_id = o.id
      AND existing.entity_type = 'procurement_plan'
      AND existing.requirement_code = t.requirement_code
      AND existing.is_deleted = false
);

-- ---------------------------------------------------------------------------
-- Procurement routing category, ahead of Finance so "Procurement:" titles are
-- claimed here. Its pool starts with everyone holding a procurement role;
-- admins can change it on the Tasks routing settings.
-- ---------------------------------------------------------------------------
INSERT INTO crm.task_routing_rules (organization_id, category_key, label, keywords, entity_types, assignee_user_ids, sort_order)
SELECT o.id, 'procurement', 'Procurement', ARRAY['procurement:']::text[], ARRAY['procurement_plan']::text[],
       COALESCE((
           SELECT array_agg(DISTINCT ur.user_id)
           FROM core.user_roles ur
           JOIN core.roles r ON r.id = ur.role_id
           WHERE ur.organization_id = o.id
             AND r.name IN ('Procurement Manager', 'Procurement Associate', 'Stores & Procurement Manager', 'Stores and Procurement Manager')
       ), ARRAY[]::uuid[]),
       5
FROM core.organizations o
ON CONFLICT (organization_id, category_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- The stores-and-procurement roles are in the procurement pool above but
-- could not read or update tasks; give them the same task access as the
-- Procurement Manager role (crm_tasks.read, crm_tasks.update).
-- ---------------------------------------------------------------------------
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('crm_tasks.read', 'crm_tasks.update')
WHERE r.name IN ('Stores & Procurement Manager', 'Stores and Procurement Manager')
ON CONFLICT (role_id, permission_id) DO NOTHING;
