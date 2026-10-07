-- ============================================================================
-- AEGIS MIGRATION 252 — SITE DAY START, LABOUR TIMERS, DAILY TARGETS, PROJECT HIRES
-- ============================================================================
-- Site Operations becomes a structured day (decided 2026-10-07):
--   1. The engineer / agent / clerk opens the site day: registers who is on
--      site, ticks each person's PPE, gives the toolbox talk and records any
--      safety concern and what was done about it.
--   2. Starting the day stamps a clock-in for everyone present (their timers
--      start) and unlocks the Daily Report and Material Request tabs.
--   3. Closing the day clocks everyone out and sends the hours to HR. Only
--      HR-accepted hours become finance.site_time_entries, which feed the
--      existing site pay runs (migration 247).
--   4. An approved weekly budget is broken into daily targets that the
--      project's engineers receive on Teams.
--
-- People who are not in AEGIS can be registered on site. They become
-- finance.site_workers rows (hourly, semi-skilled, hired per project) that
-- HR verifies and can activate or deactivate at any time.
--
-- Additive only.
-- ============================================================================

-- --- project hires: who registered them, HR verification ---------------------
ALTER TABLE finance.site_workers
    ADD COLUMN IF NOT EXISTS registered_via   VARCHAR(20) NOT NULL DEFAULT 'finance'
        CHECK (registered_via IN ('finance', 'site_register', 'hr')),
    ADD COLUMN IF NOT EXISTS hr_verified      BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS hr_verified_by   UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS hr_verified_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS status_reason    TEXT,
    ADD COLUMN IF NOT EXISTS status_changed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Workers Finance already entered were vetted there.
UPDATE finance.site_workers SET hr_verified = true WHERE registered_via = 'finance' AND hr_verified = false;

-- --- the site day ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects.site_day_briefings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    site_id                 UUID REFERENCES projects.sites(id) ON DELETE SET NULL,
    briefing_date           DATE NOT NULL,
    shift                   VARCHAR(10) NOT NULL DEFAULT 'day' CHECK (shift IN ('day', 'night', 'double')),
    status                  VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'started', 'closed')),
    toolbox_topic           VARCHAR(200),
    toolbox_notes           TEXT,
    toolbox_talk_completed  BOOLEAN NOT NULL DEFAULT false,
    ppe_check_completed     BOOLEAN NOT NULL DEFAULT false,
    labour_count_completed  BOOLEAN NOT NULL DEFAULT false,
    safety_concern_raised   BOOLEAN NOT NULL DEFAULT false,
    safety_concerns         TEXT,
    safety_actions          TEXT,
    regular_hours_cap       NUMERIC(4,2) NOT NULL DEFAULT 8 CHECK (regular_hours_cap > 0 AND regular_hours_cap <= 12),
    break_minutes           INTEGER NOT NULL DEFAULT 60 CHECK (break_minutes >= 0 AND break_minutes <= 240),
    started_at              TIMESTAMPTZ,
    started_by              UUID REFERENCES core.users(id),
    closed_at               TIMESTAMPTZ,
    closed_by               UUID REFERENCES core.users(id),
    hr_status               VARCHAR(20) NOT NULL DEFAULT 'not_sent'
        CHECK (hr_status IN ('not_sent', 'pending', 'accepted', 'partially_accepted', 'rejected')),
    hr_reviewed_by          UUID REFERENCES core.users(id),
    hr_reviewed_at          TIMESTAMPTZ,
    hr_notes                TEXT,
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false,
    CHECK (NOT safety_concern_raised OR status = 'open' OR NULLIF(TRIM(safety_actions), '') IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS site_day_briefings_day_unique
    ON projects.site_day_briefings (organization_id, project_id, briefing_date, shift) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS site_day_briefings_hr_idx
    ON projects.site_day_briefings (organization_id, hr_status, briefing_date DESC) WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS projects.site_day_attendance (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    briefing_id         UUID NOT NULL REFERENCES projects.site_day_briefings(id) ON DELETE CASCADE,
    project_id          UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    worker_kind         VARCHAR(12) NOT NULL CHECK (worker_kind IN ('project_hire', 'employee')),
    site_worker_id      UUID REFERENCES finance.site_workers(id) ON DELETE RESTRICT,
    employee_id         UUID REFERENCES hr.employees(id) ON DELETE RESTRICT,
    worker_name         VARCHAR(160) NOT NULL,
    trade               VARCHAR(80),
    hourly_rate         NUMERIC(12,2),
    ppe_ok              BOOLEAN NOT NULL DEFAULT false,
    clock_in_at         TIMESTAMPTZ,
    clock_out_at        TIMESTAMPTZ,
    regular_hours       NUMERIC(5,2),
    overtime_hours      NUMERIC(5,2),
    hr_status           VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (hr_status IN ('open', 'pending', 'accepted', 'rejected')),
    hr_reason           VARCHAR(300),
    time_entry_id       UUID REFERENCES finance.site_time_entries(id) ON DELETE SET NULL,
    notes               VARCHAR(300),
    created_by          UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((worker_kind = 'project_hire' AND site_worker_id IS NOT NULL AND employee_id IS NULL)
        OR (worker_kind = 'employee' AND employee_id IS NOT NULL AND site_worker_id IS NULL)),
    CHECK (clock_out_at IS NULL OR clock_in_at IS NULL OR clock_out_at >= clock_in_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS site_day_attendance_hire_unique
    ON projects.site_day_attendance (briefing_id, site_worker_id) WHERE site_worker_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_day_attendance_employee_unique
    ON projects.site_day_attendance (briefing_id, employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_day_attendance_hr_idx
    ON projects.site_day_attendance (organization_id, hr_status);

-- --- weekly budget -> daily targets ----------------------------------------------
CREATE TABLE IF NOT EXISTS projects.site_daily_targets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL REFERENCES projects.projects(id) ON DELETE RESTRICT,
    weekly_budget_id        UUID NOT NULL REFERENCES projects.weekly_budgets(id) ON DELETE CASCADE,
    weekly_budget_item_id   UUID REFERENCES projects.weekly_budget_items(id) ON DELETE SET NULL,
    target_date             DATE NOT NULL,
    work_package            VARCHAR(160),
    description             TEXT NOT NULL,
    unit                    VARCHAR(30),
    target_qty              NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (target_qty >= 0),
    achieved_qty            NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (achieved_qty >= 0),
    planned_amount          NUMERIC(15,2) NOT NULL DEFAULT 0,
    status                  VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'partial', 'done', 'missed')),
    notes                   VARCHAR(500),
    notified_at             TIMESTAMPTZ,
    updated_by              UUID REFERENCES core.users(id),
    created_by              UUID REFERENCES core.users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted              BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS site_daily_targets_day_idx
    ON projects.site_daily_targets (organization_id, project_id, target_date) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS site_daily_targets_budget_idx
    ON projects.site_daily_targets (weekly_budget_id) WHERE NOT is_deleted;

-- --- security, audit, live updates ------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['site_day_briefings', 'site_day_attendance', 'site_daily_targets']
    LOOP
        EXECUTE format('ALTER TABLE projects.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE projects.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON projects.%I FROM anon, authenticated', t);
        EXECUTE format('DROP POLICY IF EXISTS "Site operations service role only" ON projects.%I', t);
        EXECUTE format('CREATE POLICY "Site operations service role only" ON projects.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%s ON projects.%I', t, t);
        EXECUTE format('CREATE TRIGGER trg_audit_%s AFTER INSERT OR UPDATE OR DELETE ON projects.%I FOR EACH ROW EXECUTE FUNCTION core.process_audit_log()', t, t);
        EXECUTE format('DROP TRIGGER IF EXISTS live_change_notify ON projects.%I', t);
        EXECUTE format('CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON projects.%I FOR EACH ROW EXECUTE FUNCTION core.notify_table_change()', t);
    END LOOP;
END $$;

-- --- permissions --------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('site_operations.labour_register.manage', 'Open the site day: register labour, PPE, toolbox talk, safety, clock in/out'),
    ('site_operations.daily_targets.manage',   'Break weekly budgets into daily targets and record progress against them'),
    ('workforce.project_hires.manage',         'Verify, activate and deactivate project hires and accept their site hours')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Site Agent',            'site_operations.labour_register.manage'),
    ('Site Clerk',            'site_operations.labour_register.manage'),
    ('Site Engineer',         'site_operations.labour_register.manage'),
    ('Site Manager',          'site_operations.labour_register.manage'),
    ('FOREMAN',               'site_operations.labour_register.manage'),
    ('HSE / Safety Officer',  'site_operations.labour_register.manage'),
    ('Project Manager',       'site_operations.labour_register.manage'),
    ('Executive (Admin)',     'site_operations.labour_register.manage'),
    ('SUPERADMIN',            'site_operations.labour_register.manage'),
    ('Site Engineer',         'site_operations.daily_targets.manage'),
    ('Site Agent',            'site_operations.daily_targets.manage'),
    ('Site Manager',          'site_operations.daily_targets.manage'),
    ('Project Manager',       'site_operations.daily_targets.manage'),
    ('Executive (Admin)',     'site_operations.daily_targets.manage'),
    ('SUPERADMIN',            'site_operations.daily_targets.manage'),
    ('HR Manager',            'workforce.project_hires.manage'),
    ('HR Officer',            'workforce.project_hires.manage'),
    ('Payroll Administrator', 'workforce.project_hires.manage'),
    ('Executive (Admin)',     'workforce.project_hires.manage'),
    ('SUPERADMIN',            'workforce.project_hires.manage')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
