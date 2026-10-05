-- ============================================================================
-- AEGIS MIGRATION 251 — AUTOMATIC ATTENDANCE AND WEEKLY HOURS CONFIRMATION
-- ============================================================================
-- HR & Workforce re-engineering, phase 3 (docs/HR_WORKFORCE_REENGINEERING_PLAN.md).
--
--  * The first AEGIS sign-in of the day checks the person in
--    (attendance_records.source = 'aegis_login'). The clock stops at 16:30 Harare.
--  * attendance_events accepts 'aegis_login' and 'teams' as sources, so a
--    Teams presence feed (and later a hardware clock) can be matched against AEGIS.
--  * hr.weekly_hours: each Saturday–Friday week the employee confirms (or
--    corrects, with a reason) their hours; the line manager / HR approves.
--    Payroll reads approved weeks.
--  * hr.public_holidays: Zimbabwe public holidays, editable by HR; they count
--    as neither worked nor absent.
--
-- Additive only.
-- ============================================================================

ALTER TABLE hr.attendance_records
  ADD COLUMN IF NOT EXISTS source varchar(30) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS auto_closed boolean NOT NULL DEFAULT false;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_records_source_check') THEN
    ALTER TABLE hr.attendance_records ADD CONSTRAINT attendance_records_source_check
      CHECK (source IN ('manual','aegis_login','teams','biometric','correction','import'));
  END IF;
END $$;

ALTER TABLE hr.attendance_events DROP CONSTRAINT IF EXISTS attendance_events_source_check;
ALTER TABLE hr.attendance_events ADD CONSTRAINT attendance_events_source_check
  CHECK (source IN ('manual','mobile','biometric','import','aegis_login','teams'));

CREATE TABLE IF NOT EXISTS hr.weekly_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  employee_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  recorded_hours numeric(6,2) NOT NULL DEFAULT 0,
  confirmed_hours numeric(6,2) NOT NULL DEFAULT 0,
  leave_days numeric(4,1) NOT NULL DEFAULT 0,
  corrections integer NOT NULL DEFAULT 0,
  status varchar(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','queried')),
  submitted_by uuid REFERENCES core.users(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES core.users(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (week_end = week_start + 6),
  FOREIGN KEY (organization_id, employee_id) REFERENCES hr.employees(organization_id, id),
  UNIQUE (organization_id, employee_id, week_end)
);
CREATE INDEX IF NOT EXISTS weekly_hours_week ON hr.weekly_hours(organization_id, week_end);

CREATE TABLE IF NOT EXISTS hr.public_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES core.organizations(id),
  holiday_date date NOT NULL,
  name varchar(120) NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  UNIQUE (organization_id, holiday_date)
);

-- Zimbabwe public holidays (a Sunday holiday moves to Monday). HR can edit.
WITH seed(d, n) AS (VALUES
  ('2026-01-01','New Year''s Day'), ('2026-02-21','Robert Gabriel Mugabe National Youth Day'),
  ('2026-04-03','Good Friday'), ('2026-04-04','Holy Saturday'), ('2026-04-06','Easter Monday'),
  ('2026-04-18','Independence Day'), ('2026-05-01','Workers'' Day'), ('2026-05-25','Africa Day'),
  ('2026-08-10','Heroes'' Day'), ('2026-08-11','Defence Forces Day'), ('2026-12-22','Unity Day'),
  ('2026-12-25','Christmas Day'), ('2026-12-26','Boxing Day'),
  ('2027-01-01','New Year''s Day'), ('2027-02-22','Robert Gabriel Mugabe National Youth Day (observed)'),
  ('2027-03-26','Good Friday'), ('2027-03-27','Holy Saturday'), ('2027-03-29','Easter Monday'),
  ('2027-04-19','Independence Day (observed)'), ('2027-05-01','Workers'' Day'), ('2027-05-25','Africa Day'),
  ('2027-08-09','Heroes'' Day'), ('2027-08-10','Defence Forces Day'), ('2027-12-22','Unity Day'),
  ('2027-12-25','Christmas Day'), ('2027-12-27','Boxing Day (observed)')
)
INSERT INTO hr.public_holidays (organization_id, holiday_date, name)
SELECT o.id, s.d::date, s.n FROM core.organizations o CROSS JOIN seed s
ON CONFLICT (organization_id, holiday_date) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hr.weekly_hours','hr.public_holidays'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %s FROM anon, authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS workforce_runtime_tenant ON %s', t);
    EXECUTE format('CREATE POLICY workforce_runtime_tenant ON %s FOR SELECT TO aegis_workforce_runtime USING (organization_id = NULLIF(current_setting(''app.organization_id'',true),'''')::uuid)', t);
    EXECUTE format('GRANT SELECT ON %s TO aegis_workforce_runtime', t);
  END LOOP;
END $$;
