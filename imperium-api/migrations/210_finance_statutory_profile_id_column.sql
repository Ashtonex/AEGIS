-- ============================================================================
-- AEGIS MIGRATION 210 — STATUTORY PROFILE: ADD id COLUMN (PHASE 8B FIX)
-- ============================================================================
-- finance.statutory_profile (migration 080) is the only table in the whole
-- schema using organization_id as its literal primary key instead of the
-- standard id + unique(organization_id) shape every other table follows.
-- That's exactly why writing to it has never worked: the generic audit
-- trigger (core.process_audit_log(), migration 031) hardcodes NEW.id/OLD.id
-- for every table it's attached to, and this table has no id column at all
-- - it raised "record "new" has no field "id"" the moment Phase 8B's first
-- ever INSERT/UPDATE against this table ran.
--
-- Safe to reshape today: the table has zero rows (confirmed - nothing has
-- ever written to it) and nothing references organization_id as a foreign
-- key, so there is no data to migrate and no dependent constraint to
-- rewire. This does not touch core.process_audit_log() itself, which
-- remains correct and unmodified for every other table that already relies
-- on it.
-- ============================================================================

ALTER TABLE finance.statutory_profile
    ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE finance.statutory_profile
    DROP CONSTRAINT IF EXISTS statutory_profile_pkey;

ALTER TABLE finance.statutory_profile
    ADD CONSTRAINT statutory_profile_pkey PRIMARY KEY (id);

ALTER TABLE finance.statutory_profile
    ADD CONSTRAINT statutory_profile_organization_id_key UNIQUE (organization_id);
