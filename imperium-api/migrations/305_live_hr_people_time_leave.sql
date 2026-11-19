-- Live updates, wave 4: HR, the non-confidential parts.
--
-- People register (employees, positions, reporting lines), attendance
-- (check-in events, daily records, weekly hours) and leave. Events carry ids
-- only, never row content. Pay, scorecards, recruitment assessments and HR
-- files stay off the feed. hr.leave_requests got its trigger in migration 304
-- (approvals queue); its HR readers are added in core/realtime.py.

DO $$
DECLARE
  target text;
  targets text[] := ARRAY[
    'hr.employees',
    'hr.positions',
    'hr.reporting_lines',
    'hr.attendance_events',
    'hr.attendance_records',
    'hr.weekly_hours'
  ];
BEGIN
  FOREACH target IN ARRAY targets LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS live_change_notify ON %s', target);
    EXECUTE format(
      'CREATE TRIGGER live_change_notify AFTER INSERT OR UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION core.notify_table_change()',
      target
    );
  END LOOP;
END $$;
