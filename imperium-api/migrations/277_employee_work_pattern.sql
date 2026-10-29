-- ============================================================================
-- Migration 277: office / site working hours per employee
-- ============================================================================
-- The standard week the business set on 2026-10-29 (from 08:00):
--
--   office  Mon-Thu 8.5 h, Fri 8 h, Sat 5 h
--   site    Mon-Thu 9 h,   Fri 8 h, Sat 5 h
--
-- app/services/hr/time_tracking.py holds the hours; this column says which
-- pattern a person works. Signing in on time earns the day's standard hours;
-- signing in 30 minutes or more late counts only check-in to the day's end.
--
-- Initial split: anyone based away from head office, or in a field trade
-- (foreman, operator, artisan, driver, general hand), is site staff;
-- everyone else, and anyone without a base recorded, is office staff.
-- HR adjusts individuals on the person card.

ALTER TABLE hr.employees
    ADD COLUMN IF NOT EXISTS work_pattern varchar(16) NOT NULL DEFAULT 'office';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employees_work_pattern_check') THEN
        ALTER TABLE hr.employees
            ADD CONSTRAINT employees_work_pattern_check CHECK (work_pattern IN ('office', 'site'));
    END IF;
END $$;

UPDATE hr.employees
SET work_pattern = 'site'
WHERE work_pattern = 'office'
  AND (
        (work_location IS NOT NULL AND btrim(work_location) <> ''
         AND work_location !~* '(^|[^a-z])(hq|head office)([^a-z]|$)')
     OR job_title ~* '(foreman|operator|artisan|driver|general hand|builder|carpenter|plumber|electrician)'
  );
