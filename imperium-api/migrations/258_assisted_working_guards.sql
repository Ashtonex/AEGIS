-- ============================================================================
-- AEGIS MIGRATION 258 — ASSISTED WORKING PERIOD GUARDS
-- ============================================================================
-- From the stability checks on migration 257:
--   - hr.assisted_working_periods.employee_id had no covering index (the
--     composite index leads with organization_id); Supabase's advisor flagged it.
--   - Nothing stopped two overlapping worker runs from opening two assisted
--     working periods for the same person in the same week. One live period
--     per person per opening week is now enforced by the database.
-- Additive only.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_assisted_working_employee_id
    ON hr.assisted_working_periods (employee_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assisted_working_one_per_week
    ON hr.assisted_working_periods (organization_id, employee_id, opened_week_end)
    WHERE status <> 'cancelled';
