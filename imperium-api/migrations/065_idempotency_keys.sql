-- ============================================================================
-- AEGIS MIGRATION 065 — IDEMPOTENCY KEY SUPPORT
-- Generic table backing a reusable Idempotency-Key mechanism
-- (core/idempotency.py): a client-supplied key on a write request is
-- claimed once per (organization, key, endpoint); a retried request with
-- the same key returns the original response instead of re-running side
-- effects. Applied first to quotation create and quotation decision
-- (mark won/lost) - a duplicate "won" decision would double-seed the
-- linked project's execution budget.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.idempotency_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    idempotency_key     VARCHAR(255) NOT NULL,
    endpoint            VARCHAR(255) NOT NULL,
    request_hash        VARCHAR(64) NOT NULL,
    status              VARCHAR(24) NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed')),
    response_status     INTEGER,
    response_body       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ,
    CONSTRAINT idempotency_keys_unique UNIQUE (organization_id, idempotency_key, endpoint)
);

CREATE INDEX IF NOT EXISTS idempotency_keys_lookup_idx
    ON core.idempotency_keys (organization_id, idempotency_key, endpoint);

-- Stale in_progress rows (the original request's process died before
-- completing/failing it) shouldn't permanently block retries - nothing
-- automated needs to run this, but it's here as the documented cleanup
-- query for the runbook.
-- DELETE FROM core.idempotency_keys WHERE status = 'in_progress' AND created_at < NOW() - INTERVAL '1 hour';

ALTER TABLE core.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.idempotency_keys FORCE ROW LEVEL SECURITY;

REVOKE ALL ON core.idempotency_keys FROM anon, authenticated;

DROP POLICY IF EXISTS "Idempotency keys service role only" ON core.idempotency_keys;
CREATE POLICY "Idempotency keys service role only" ON core.idempotency_keys
    FOR ALL TO service_role USING (true) WITH CHECK (true);
