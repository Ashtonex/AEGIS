-- ============================================================================
-- Teams + universal assignment (person or team) for leads/opportunities/
-- tenders/projects/fleet/machinery
-- ============================================================================
-- crm.leads already has `assigned_to` (a single user); nothing else does.
-- This adds a lightweight org-scoped Team concept (hybrid per user request:
-- assignment can target either an individual or a named team, no separate
-- permission system for teams themselves) plus the assignee columns needed
-- on every other assignable entity. assigned_to_team_id is added to
-- crm.leads too, alongside its existing assigned_to, so leads can be
-- assigned to a team the same way as everything else.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.teams (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    name            VARCHAR(160) NOT NULL,
    created_by      UUID REFERENCES core.users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted      BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS core.team_members (
    team_id    UUID NOT NULL REFERENCES core.teams(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    added_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (team_id, user_id)
);

ALTER TABLE crm.leads
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

ALTER TABLE fleet.fleet
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

ALTER TABLE fleet.equipment_assets
    ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS assigned_to_team_id UUID REFERENCES core.teams(id);

-- fleet.fleet gained assigned_to_user_id via 018_fleet_delivery_controls.sql already.

-- ----------------------------------------------------------------------------
-- Permissions
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('users.read_assignable', 'List org users for assignment pickers (id/name/email only, not full user management)'),
    ('teams.read', 'View teams and their membership'),
    ('teams.manage', 'Create teams and manage their membership'),
    ('assignments.manage', 'Assign a lead/opportunity/tender/project/fleet/machinery record to a person or team')
ON CONFLICT (key) DO NOTHING;

-- Granted broadly (same holder set as documents.create) - assigning work and
-- picking who to assign it to are both routine operational actions, not
-- admin-only ones.
INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('users.read_assignable', 'teams.read', 'teams.manage', 'assignments.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
