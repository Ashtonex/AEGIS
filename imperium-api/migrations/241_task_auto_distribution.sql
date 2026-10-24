-- ============================================================================
-- AEGIS MIGRATION 241 — TASK AUTO-DISTRIBUTION
-- ============================================================================
-- Generated task stacks land with a responsible_role at best and no person
-- or deadline at all, so they pile up unassigned. This adds:
--
--   crm.task_routing_rules    - work categories (follow-ups, QS/figures,
--                               finance, project delivery...) each with the
--                               keywords/entity types that route into it and
--                               the pool of people who take that work.
--   crm.task_routing_settings - per-org switches: auto-distribute new tasks,
--                               the Teams Workflows webhook used to DM
--                               assignees, and the deadline windows.
--   crm.tasks.routing_category / auto_assigned_at - which rule placed a task
--                               and when, so re-runs never reshuffle work a
--                               person already holds.
--
-- Rules themselves are seeded by the API on first read (per org, with empty
-- pools) - pools name real people, which a migration can't know.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.task_routing_rules (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id   UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    category_key      VARCHAR(40) NOT NULL,
    label             VARCHAR(120) NOT NULL,
    keywords          TEXT[] NOT NULL DEFAULT '{}',
    entity_types      TEXT[] NOT NULL DEFAULT '{}',
    assignee_user_ids UUID[] NOT NULL DEFAULT '{}',
    sort_order        INTEGER NOT NULL DEFAULT 0,
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, category_key)
);

CREATE TABLE IF NOT EXISTS crm.task_routing_settings (
    organization_id    UUID PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
    auto_distribute    BOOLEAN NOT NULL DEFAULT false,
    teams_webhook_url  TEXT,
    fallback_category  VARCHAR(40),
    due_days_urgent    INTEGER NOT NULL DEFAULT 2  CHECK (due_days_urgent BETWEEN 1 AND 90),
    due_days_high      INTEGER NOT NULL DEFAULT 5  CHECK (due_days_high BETWEEN 1 AND 90),
    due_days_normal    INTEGER NOT NULL DEFAULT 10 CHECK (due_days_normal BETWEEN 1 AND 180),
    due_days_low       INTEGER NOT NULL DEFAULT 20 CHECK (due_days_low BETWEEN 1 AND 365),
    daily_capacity     INTEGER NOT NULL DEFAULT 4  CHECK (daily_capacity BETWEEN 1 AND 50),
    last_auto_run_at   TIMESTAMPTZ,
    updated_by         UUID REFERENCES core.users(id),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS routing_category VARCHAR(40),
    ADD COLUMN IF NOT EXISTS auto_assigned_at TIMESTAMPTZ;

-- The distributor's sweep: open, unowned work per org.
CREATE INDEX IF NOT EXISTS idx_crm_tasks_unassigned_open
    ON crm.tasks (organization_id)
    WHERE is_deleted = false
      AND assigned_to_user_id IS NULL
      AND status NOT IN ('completed', 'cancelled', 'superseded', 'not_applicable');

INSERT INTO core.permissions (key, description) VALUES
    ('crm_tasks.distribute', 'Bulk-assign tasks, run auto-distribution and edit routing rules')
ON CONFLICT (key) DO NOTHING;

-- Same holders as task-template management (who already shape the stacks),
-- narrowed to management roles - bulk-moving everyone's work is a manager's
-- call, not every task creator's. SUPERADMIN gets it implicitly.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'crm_tasks.distribute'
WHERE r.is_deleted = false
  AND upper(r.name) IN ('EXECUTIVE (ADMIN)', 'SYSTEM ADMINISTRATOR', 'COMMERCIAL MANAGER')
ON CONFLICT (role_id, permission_id) DO NOTHING;
