-- Two migrations both numbered 041 (041_crm_completion_phases_1_6.sql and
-- 041_crm_schema_stabilization_and_hardening.sql) each did
-- `CREATE TABLE IF NOT EXISTS crm.automation_runs` with a different column
-- set. Whichever ran first won; the second's CREATE TABLE was a no-op since
-- the table already existed, so its columns (triggering_record_id,
-- error_message) were silently never added - even though the ledger marked
-- both migrations as applied. app/services/crm/automation_engine.py writes
-- to both columns on every automation run, so every run's audit-log insert
-- failed with UndefinedColumnError, aborting the whole call (fire_trigger
-- swallows the exception, so this failed silently with no visible error).
ALTER TABLE crm.automation_runs
    ADD COLUMN IF NOT EXISTS triggering_record_id UUID,
    ADD COLUMN IF NOT EXISTS error_message TEXT;
