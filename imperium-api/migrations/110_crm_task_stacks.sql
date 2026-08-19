-- ============================================================================
-- Task stacks: templates, team assignment, team leads
-- ============================================================================
-- Every lead/opportunity/tender/project should auto-generate its standard
-- stack of follow-up tasks (BOQ buildup, rate buildup, quotation prep,
-- subcontractor sourcing...) the moment it's created, so the work needed
-- to push it forward is visible and assignable from day one instead of
-- relying on someone remembering to create tasks manually.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.task_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    entity_type     VARCHAR(40) NOT NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_task_templates_entity
    ON crm.task_templates (organization_id, entity_type) WHERE is_active = true AND is_deleted = false;

-- assigned_to_team_id mirrors the assignment pattern already used on
-- leads/opportunities/tenders/projects/fleet/machinery (see
-- routers/assignments.py). source distinguishes an auto-generated stack
-- item from one a person typed themselves - and is the duplicate guard:
-- generate_task_stack() (app/shared/task_stacks.py) checks for an
-- existing source='template' task on the record before inserting anything,
-- so re-triggering generation for the same record is a safe no-op rather
-- than piling up a second copy of the stack.
ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id),
    ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'template')),
    ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES crm.task_templates(id);

ALTER TABLE core.team_members
    ADD COLUMN IF NOT EXISTS is_lead BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- Default templates, seeded per organization. Editable afterward via the
-- crm_tasks.templates.manage-gated CRUD endpoints - these are starting
-- points, not fixed.
-- ----------------------------------------------------------------------------
INSERT INTO crm.task_templates (organization_id, entity_type, title, description, sort_order)
SELECT o.id, t.entity_type, t.title, t.description, t.sort_order
FROM core.organizations o
CROSS JOIN (VALUES
    ('tender',      'BOQ Buildup',                     'Prepare the bill of quantities for this tender.', 1),
    ('tender',      'Rate Buildup',                     'Build unit rates for pricing the bid.', 2),
    ('tender',      'Quotation Preparation',            'Prepare the priced quotation / bid submission.', 3),
    ('tender',      'Subcontractor Sourcing',           'Source and qualify subcontractors needed for this bid.', 4),
    ('tender',      'Bid Bond Arrangement',              'Arrange the bid bond / security required for submission.', 5),
    ('tender',      'Compliance Documents Gathering',   'Gather NSSA/PRAZ/tax clearance and other compliance documents.', 6),
    ('opportunity', 'Rate Buildup',                      'Build unit rates for pricing this deal.', 1),
    ('opportunity', 'Quotation Preparation',             'Prepare the priced quotation for the client.', 2),
    ('lead',        'Initial Qualification Call',        'Contact the lead to qualify budget, timeline, and scope.', 1),
    ('lead',        'Compliance Check',                  'Check the lead''s compliance/registration status before proceeding.', 2),
    ('project',     'Mobilization Checklist',            'Confirm site mobilization readiness (access, welfare, plant).', 1),
    ('project',     'Site Handover',                     'Complete formal site handover documentation.', 2)
) AS t(entity_type, title, description, sort_order)
WHERE o.is_deleted = false
  AND NOT EXISTS (
      SELECT 1 FROM crm.task_templates existing
      WHERE existing.organization_id = o.id AND existing.entity_type = t.entity_type AND existing.title = t.title
  );

INSERT INTO core.permissions (key, description) VALUES
    ('crm_tasks.templates.manage', 'Create/edit the default task-stack templates per entity type')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'crm_tasks.create'
JOIN core.permissions new_p ON new_p.key = 'crm_tasks.templates.manage'
ON CONFLICT (role_id, permission_id) DO NOTHING;
