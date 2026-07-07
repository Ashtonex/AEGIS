-- ============================================================================
-- PROJECT IMPERIUM - MIGRATION 004
-- Leads Ownership & Additional Telemetry
-- ============================================================================

ALTER TABLE crm.leads 
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS labels VARCHAR(255),
    ADD COLUMN IF NOT EXISTS expected_close_date DATE;
