-- ============================================================================
-- AEGIS MIGRATION 236 — AUDIT LOG ACTOR ACTIVITY INDEX
-- ============================================================================
-- core.audit_log had no index besides its primary key, so the Executive
-- dashboard's "Today → Activity" feed (GET /executive/today) scanned the
-- whole table (~30k rows / 45 MB and growing by thousands a week from bank
-- imports) on every load.
--
-- The feed only reads rows written by a person (created_by IS NOT NULL -
-- roughly a tenth of the table; the rest is trigger/system bookkeeping)
-- over the last 7 days, newest first, so a partial index on exactly that
-- stays small.
--
-- Additive only.
-- ============================================================================

CREATE INDEX IF NOT EXISTS audit_log_actor_recent_idx
    ON core.audit_log (created_at DESC, created_by)
    WHERE created_by IS NOT NULL;
