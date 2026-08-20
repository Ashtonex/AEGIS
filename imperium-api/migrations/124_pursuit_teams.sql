-- ============================================================================
-- AEGIS MIGRATION 124 — PURSUIT OPERATING SYSTEM (PHASE 1: PURSUIT TEAMS)
-- ============================================================================
-- core.teams (105) is a standing, org-wide group - useful for department
-- benches and generic assignment, but not what the pursuit model means by
-- "Team": a temporary, cross-functional unit stood up around ONE pursuit,
-- with a defined objective, a named lead, a start/close lifecycle and a
-- final result. crm.pursuit_teams is that object. core.teams is untouched
-- and keeps its existing call sites (fleet/machinery/project assignment).
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.pursuit_teams (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    pursuit_id          UUID NOT NULL REFERENCES crm.pursuits(id) ON DELETE CASCADE,
    name                VARCHAR(160) NOT NULL,
    objective           TEXT,
    team_lead_user_id   UUID REFERENCES core.users(id),
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ,
    result              TEXT,
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

-- One active pursuit team per pursuit at a time (a closed one can be
-- superseded by a new team - e.g. Tender Team hands off to a Clarification
-- and Negotiation Team - without the old row disappearing).
CREATE UNIQUE INDEX IF NOT EXISTS idx_pursuit_teams_one_active_per_pursuit
    ON crm.pursuit_teams (pursuit_id)
    WHERE is_deleted = false AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_pursuit_teams_org ON crm.pursuit_teams (organization_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_pursuit_teams_pursuit ON crm.pursuit_teams (pursuit_id) WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.pursuit_team_members (
    pursuit_team_id UUID NOT NULL REFERENCES crm.pursuit_teams(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    department_id   UUID REFERENCES finance.departments(id),
    role_label      VARCHAR(80),
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    removed_at      TIMESTAMPTZ,
    PRIMARY KEY (pursuit_team_id, user_id)
);

-- Link the pursuit back to whichever team is currently running it, so a
-- pursuit detail view can resolve "the team" in one join instead of a
-- reverse lookup on the active-team partial index above.
ALTER TABLE crm.pursuits
    ADD COLUMN IF NOT EXISTS pursuit_team_id UUID REFERENCES crm.pursuit_teams(id);

DROP TRIGGER IF EXISTS trg_audit_pursuit_teams ON crm.pursuit_teams;
CREATE TRIGGER trg_audit_pursuit_teams AFTER INSERT OR UPDATE OR DELETE ON crm.pursuit_teams
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- ----------------------------------------------------------------------------
-- Permissions - same shape as teams.read / teams.manage (105).
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('pursuit_teams.read', 'View pursuit teams and their membership'),
    ('pursuit_teams.manage', 'Form pursuit teams, set the team lead and manage membership')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT rp.organization_id, rp.role_id, new_p.id
FROM core.role_permissions rp
JOIN core.permissions existing_p ON existing_p.id = rp.permission_id AND existing_p.key = 'documents.create'
JOIN core.permissions new_p ON new_p.key IN ('pursuit_teams.read', 'pursuit_teams.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
