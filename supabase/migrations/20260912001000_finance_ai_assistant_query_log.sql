-- ============================================================================
-- AEGIS MIGRATION 215 — AI FINANCIAL CONTROL ASSISTANT QUERY LOG (PHASE 10B)
-- ============================================================================
-- Append-only log of every question asked of the new AI Financial Control
-- Assistant, the tool calls it made to answer, and its final answer -
-- mirrors core.audit_log's own immutable-log shape (no updated_at/
-- is_deleted, no audit trigger on itself - it IS the audit trail) rather
-- than the standard mutable-row convention. The assistant is read/explain
-- only (no write tools exist for it to call - see
-- app/services/finance/ai_assistant_tools.py); this table exists so what
-- it was asked and what it surfaced is reviewable, feeding forward into
-- Phase 12's planned Auditor read-only workspace.
--
-- Purely additive - new table and two new permission keys only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.ai_assistant_query_log (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    asked_by                UUID REFERENCES core.users(id),
    question                TEXT NOT NULL,
    tool_calls              JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer                  TEXT,
    model                   VARCHAR(60),
    hit_tool_call_limit     BOOLEAN NOT NULL DEFAULT false,
    error                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_assistant_query_log_org_created_idx
    ON finance.ai_assistant_query_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_assistant_query_log_asked_by_idx
    ON finance.ai_assistant_query_log (organization_id, asked_by);

-- 1. RLS

ALTER TABLE finance.ai_assistant_query_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.ai_assistant_query_log FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.ai_assistant_query_log FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.ai_assistant_query_log;
CREATE POLICY "Finance service role only" ON finance.ai_assistant_query_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. PERMISSIONS — granted in this same migration.

INSERT INTO core.permissions (key, description) VALUES
    ('finance.ai_assistant.use', 'Ask the AI Financial Control Assistant read-only questions about finance data'),
    ('finance.ai_assistant.audit_log.read', 'Review what has been asked of the AI Financial Control Assistant and what it answered')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.ai_assistant.use', 'finance.ai_assistant.audit_log.read')
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('finance.ai_assistant.use', 'finance.ai_assistant.audit_log.read')
WHERE r.is_deleted = false AND r.name IN ('Finance Manager', 'Executive (Admin)', 'Managing Director')
ON CONFLICT DO NOTHING;

-- No audit trigger on this table - it is itself an append-only audit log,
-- not a mutable domain row. No live-push trigger - not a UI-reactive table.
