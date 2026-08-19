-- ============================================================================
-- CRM Tasks: individually assignable tasks, optionally linked to a
-- lead/opportunity/tender/project/fleet/machinery record
-- ============================================================================
-- No generic assignable Task entity existed anywhere in the schema before
-- this - crm.interactions/crm.activities log what already happened, nothing
-- tracked "do this by this date, assigned to this person."
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    entity_type     VARCHAR(40),
    entity_id       UUID,
    assigned_to_user_id UUID REFERENCES core.users(id),
    due_date        DATE,
    status          VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    priority        VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_org ON crm.tasks (organization_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_assignee ON crm.tasks (organization_id, assigned_to_user_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_crm_tasks_entity ON crm.tasks (organization_id, entity_type, entity_id) WHERE is_deleted = false;

INSERT INTO core.permissions (key, description) VALUES
    ('crm_tasks.read', 'View CRM tasks'),
    ('crm_tasks.create', 'Create CRM tasks and assign them'),
    ('crm_tasks.update', 'Update or reassign CRM tasks'),
    ('crm_tasks.delete', 'Delete CRM tasks')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('crm_tasks.read', 'crm_tasks.create', 'crm_tasks.update', 'crm_tasks.delete')
ON CONFLICT (role_id, permission_id) DO NOTHING;
