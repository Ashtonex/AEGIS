-- ============================================================================
-- AEGIS MIGRATION 185 — FINANCE GL BRIDGE: JOURNAL ORIGIN COLUMNS (PHASE 2)
-- ============================================================================
-- Adds the ability to distinguish a system-proposed journal (created by the
-- Phase 2 bridge from an operational event, pending human review) from a
-- manually-authored one (Phase 1), and to record a proposal's review outcome
-- without touching the existing status/immutability/balance trigger logic
-- from migration 182 at all.
--
-- This ALTERs finance.journal_entries, a table this same initiative created
-- in Phase 1 (migration 182) - not a pre-existing operational table, so this
-- is a normal in-place extension of the GL's own schema, not a breach of the
-- "don't touch pre-existing tables" rule that governed Phase 1.
--
-- A rejected proposal keeps status='draft' forever (excluded from the review
-- queue via proposal_status='rejected', never auto-deleted) so the
-- interpretation stays on record for audit rather than being discarded.
-- ============================================================================

ALTER TABLE finance.journal_entries
    ADD COLUMN IF NOT EXISTS origination VARCHAR(20) NOT NULL DEFAULT 'manual'
        CHECK (origination IN ('manual', 'system_proposed'));

ALTER TABLE finance.journal_entries
    ADD COLUMN IF NOT EXISTS proposal_status VARCHAR(20)
        CHECK (proposal_status IN ('pending_review', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS journal_entries_pending_review_idx
    ON finance.journal_entries (organization_id, proposal_status)
    WHERE origination = 'system_proposed' AND proposal_status = 'pending_review';
