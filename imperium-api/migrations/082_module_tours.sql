-- ============================================================================
-- Per-module onboarding tour tracking
-- ============================================================================
-- The existing onboarding_completed_at column (migration 032) tracks exactly
-- one thing: has this user ever seen the global dashboard-shell tour
-- (search bar / sidebar nav / profile menu). It has no way to represent
-- "has this user seen the Finance tour" separately from "has this user seen
-- the CRM tour" - each module now gets its own first-visit walkthrough, so
-- completion needs to be tracked per module, not as a single flag.
--
-- A JSONB map keyed by module_key ("finance", "crm", "quotations", ...) to
-- an ISO timestamp is additive (existing onboarding_completed_at is
-- untouched) and needs no schema change to add a fourth/fifth module later -
-- just a new key in the JSON, not a new column.

ALTER TABLE hr.employee_profiles
    ADD COLUMN IF NOT EXISTS module_tours_completed JSONB NOT NULL DEFAULT '{}'::jsonb;
