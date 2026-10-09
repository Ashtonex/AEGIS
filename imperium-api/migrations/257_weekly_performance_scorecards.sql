-- ============================================================================
-- AEGIS MIGRATION 257 — WEEKLY PERFORMANCE SCORECARDS
-- ============================================================================
-- Every Friday morning each employee gets a graded scorecard of their week
-- (Friday to Thursday) built from what AEGIS recorded: tasks delivered on
-- time, attendance, records kept, how fast new work is picked up and how much
-- work they recorded. Scoring lives in app/services/hr/performance.py.
--
--   hr.performance_settings      - per organisation: par score, shadow/live
--                                  mode, who gets the management digest.
--   hr.weekly_scorecards          - one frozen row per employee per week. A
--                                  manager may override the score (reason
--                                  required); the employee may dispute it.
--   hr.assisted_working_periods   - two weeks below par in a row (live weeks
--                                  only) opens a two-week assisted working
--                                  period supervised by the line manager.
--                                  Failing it escalates to HR - a person
--                                  decides what happens next, never the system.
--
-- crm.tasks gains first_actioned_at, stamped the first time a task leaves
-- not_started/ready, so "picked up within 48h" can be measured. Existing
-- tasks are backfilled from review/completion times where known.
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS hr.performance_settings (
    organization_id   UUID PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
    par_score         NUMERIC(5,2) NOT NULL DEFAULT 60,
    mode              VARCHAR(20) NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow', 'live')),
    live_from         DATE,
    digest_recipients TEXT NOT NULL DEFAULT '',
    updated_by        UUID REFERENCES core.users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hr.weekly_scorecards (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id           UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id               UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    user_id                   UUID REFERENCES core.users(id),
    line_manager_employee_id  UUID REFERENCES hr.employees(id),
    week_start                DATE NOT NULL,
    week_end                  DATE NOT NULL,
    mode                      VARCHAR(20) NOT NULL CHECK (mode IN ('shadow', 'live')),
    score                     NUMERIC(5,2),
    grade                     VARCHAR(2),
    components                JSONB NOT NULL DEFAULT '{}'::jsonb,
    went_well                 JSONB NOT NULL DEFAULT '[]'::jsonb,
    to_improve                JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_focus                JSONB NOT NULL DEFAULT '[]'::jsonb,
    standing                  VARCHAR(30) NOT NULL DEFAULT 'good',
    assisted_period_id        UUID,
    computed_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    emailed_at                TIMESTAMPTZ,
    email_status              VARCHAR(30),
    override_score            NUMERIC(5,2),
    override_reason           TEXT,
    override_by               UUID REFERENCES core.users(id),
    override_at               TIMESTAMPTZ,
    dispute_note              TEXT,
    disputed_at               TIMESTAMPTZ,
    dispute_status            VARCHAR(20) CHECK (dispute_status IN ('open', 'upheld', 'rejected')),
    dispute_resolution        TEXT,
    dispute_resolved_by       UUID REFERENCES core.users(id),
    dispute_resolved_at       TIMESTAMPTZ,
    UNIQUE (organization_id, employee_id, week_end)
);

CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_week ON hr.weekly_scorecards (organization_id, week_end);
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_employee ON hr.weekly_scorecards (employee_id, week_end DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_manager ON hr.weekly_scorecards (line_manager_employee_id);
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_user ON hr.weekly_scorecards (user_id);

CREATE TABLE IF NOT EXISTS hr.assisted_working_periods (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id          UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    employee_id              UUID NOT NULL REFERENCES hr.employees(id) ON DELETE CASCADE,
    supervisor_employee_id   UUID REFERENCES hr.employees(id),
    opened_week_end          DATE NOT NULL,
    first_week_end           DATE NOT NULL,
    last_week_end            DATE NOT NULL,
    status                   VARCHAR(20) NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'passed', 'escalated', 'cancelled')),
    targets                  TEXT,
    supervisor_notes         TEXT,
    outcome_note             TEXT,
    decided_by               UUID REFERENCES core.users(id),
    decided_at               TIMESTAMPTZ,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assisted_working_employee ON hr.assisted_working_periods (organization_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_assisted_working_supervisor ON hr.assisted_working_periods (supervisor_employee_id);
CREATE INDEX IF NOT EXISTS idx_assisted_working_decided_by ON hr.assisted_working_periods (decided_by);

DO $$ BEGIN
    ALTER TABLE hr.weekly_scorecards
        ADD CONSTRAINT weekly_scorecards_assisted_period_fk
        FOREIGN KEY (assisted_period_id) REFERENCES hr.assisted_working_periods(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_assisted ON hr.weekly_scorecards (assisted_period_id);
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_override_by ON hr.weekly_scorecards (override_by);
CREATE INDEX IF NOT EXISTS idx_weekly_scorecards_dispute_by ON hr.weekly_scorecards (dispute_resolved_by);
CREATE INDEX IF NOT EXISTS idx_performance_settings_updated_by ON hr.performance_settings (updated_by);

ALTER TABLE hr.performance_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.weekly_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.assisted_working_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON hr.performance_settings, hr.weekly_scorecards, hr.assisted_working_periods FROM anon, authenticated;
DROP POLICY IF EXISTS "Performance settings service role only" ON hr.performance_settings;
CREATE POLICY "Performance settings service role only" ON hr.performance_settings
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Weekly scorecards service role only" ON hr.weekly_scorecards;
CREATE POLICY "Weekly scorecards service role only" ON hr.weekly_scorecards
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Assisted working service role only" ON hr.assisted_working_periods;
CREATE POLICY "Assisted working service role only" ON hr.assisted_working_periods
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- When a task was first picked up
-- ---------------------------------------------------------------------------
ALTER TABLE crm.tasks ADD COLUMN IF NOT EXISTS first_actioned_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION crm.stamp_task_first_actioned()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
    IF NEW.first_actioned_at IS NULL
       AND NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('not_started', 'ready') THEN
        NEW.first_actioned_at := NOW();
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_task_first_actioned ON crm.tasks;
CREATE TRIGGER trg_task_first_actioned BEFORE UPDATE OF status ON crm.tasks
    FOR EACH ROW EXECUTE FUNCTION crm.stamp_task_first_actioned();

UPDATE crm.tasks
SET first_actioned_at = LEAST(review_submitted_at, completed_at)
WHERE first_actioned_at IS NULL
  AND COALESCE(review_submitted_at, completed_at) IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Who can run it. Everyone sees their own scorecards and line managers see
-- their direct reports without any of these keys.
-- ---------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('hr.performance.read',   'See every employee''s weekly performance scorecards'),
    ('hr.performance.manage', 'Override scores, resolve disputes, run assisted working periods and switch scorecards live')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('HR Manager',        'hr.performance.read'),
    ('HR Manager',        'hr.performance.manage'),
    ('HR Officer',        'hr.performance.read'),
    ('Executive (Admin)', 'hr.performance.read'),
    ('Executive (Admin)', 'hr.performance.manage'),
    ('SUPERADMIN',        'hr.performance.read'),
    ('SUPERADMIN',        'hr.performance.manage')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
