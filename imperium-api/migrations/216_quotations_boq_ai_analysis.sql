-- ============================================================================
-- AEGIS MIGRATION 216 — QUOTATIONS BOQ AI ANALYSIS
-- ============================================================================
-- Adds a reviewable finding log for AI-assisted analysis of an already-
-- uploaded/imported BOQ (Perplexity as research/challenge engine — see
-- app/services/quotations/boq_ai_client.py and boq_ai_analysis.py). This is
-- deliberately separate from finance.commercial_guard_audits (single-request
-- audits) and finance.boq_line_items (measured quantities on a WON
-- quotation) — this table holds multi-finding scans of a draft/imported BOQ
-- that has not been priced or awarded yet.
--
-- The uploaded BOQ itself (finance.quotations.metadata->'items') is never
-- written to by this feature — findings are a separate, reviewable record.
-- Every finding carries a value_class so an AI proposal can never be
-- silently treated as an approved commercial value: deterministic checks
-- are tagged 'system_calculated_value', anything Perplexity proposes is
-- tagged 'ai_proposal', and reviewer_decision starts 'pending' and is only
-- ever advanced by an explicit reviewer action (never automatically).
--
-- Perplexity is optional at the infrastructure level (PERPLEXITY_API_KEY
-- unset ⇒ boq_analysis_runs.status = 'deterministic_only'); the deterministic
-- checks (duplicates, blank/zero rates, unit mismatches, rate-outlier reuse
-- via finance.rate_intelligence) always run regardless of AI availability.
--
-- Purely additive — two new tables and two new permission keys only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.boq_analysis_runs (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    quotation_id            UUID NOT NULL REFERENCES finance.quotations(id) ON DELETE CASCADE,
    project_id              UUID REFERENCES projects.projects(id),
    requested_by            UUID REFERENCES core.users(id),
    provider                VARCHAR(40) NOT NULL DEFAULT 'perplexity',
    model                   VARCHAR(80),
    prompt_version          VARCHAR(20) NOT NULL DEFAULT 'v1',
    status                  VARCHAR(30) NOT NULL,
    input_hash              VARCHAR(64) NOT NULL,
    latency_ms              INTEGER,
    token_usage             JSONB,
    estimated_cost_usd      NUMERIC(10,4),
    error                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT boq_analysis_runs_status_chk CHECK (
        status IN ('completed', 'deterministic_only', 'degraded', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS boq_analysis_runs_quotation_idx
    ON finance.boq_analysis_runs (quotation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS boq_analysis_runs_input_hash_idx
    ON finance.boq_analysis_runs (quotation_id, input_hash);

CREATE TABLE IF NOT EXISTS finance.boq_analysis_findings (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id                  UUID NOT NULL REFERENCES finance.boq_analysis_runs(id) ON DELETE CASCADE,
    organization_id         UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    finding_type            VARCHAR(60) NOT NULL,
    item_ref                JSONB,
    original_value          TEXT,
    proposed_value          TEXT,
    variance                TEXT,
    unit                    VARCHAR(30),
    reason                  TEXT NOT NULL,
    evidence_text           TEXT,
    citations               JSONB,
    confidence              NUMERIC(4,3),
    value_class             VARCHAR(40) NOT NULL,
    reviewer_decision       VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by             UUID REFERENCES core.users(id),
    reviewed_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT boq_analysis_findings_value_class_chk CHECK (
        value_class IN (
            'source_fact', 'extracted_value', 'system_calculated_value', 'historical_benchmark',
            'supplier_supported_rate', 'market_researched_rate', 'user_assumption', 'ai_proposal',
            'approved_commercial_value', 'actual_incurred_value', 'forecast_value'
        )
    ),
    CONSTRAINT boq_analysis_findings_reviewer_decision_chk CHECK (
        reviewer_decision IN ('pending', 'accepted', 'rejected')
    )
);

CREATE INDEX IF NOT EXISTS boq_analysis_findings_run_idx
    ON finance.boq_analysis_findings (run_id);

-- 1. RLS

ALTER TABLE finance.boq_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.boq_analysis_runs FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.boq_analysis_runs FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.boq_analysis_runs;
CREATE POLICY "Finance service role only" ON finance.boq_analysis_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE finance.boq_analysis_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.boq_analysis_findings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.boq_analysis_findings FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.boq_analysis_findings;
CREATE POLICY "Finance service role only" ON finance.boq_analysis_findings
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2. PERMISSIONS — granted in this same migration.

INSERT INTO core.permissions (key, description) VALUES
    ('quotations.ai_boq_analysis.use', 'Run AI-assisted analysis on an uploaded BOQ'),
    ('quotations.ai_boq_analysis.review', 'Accept or reject AI/deterministic BOQ analysis findings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key IN ('quotations.ai_boq_analysis.use', 'quotations.ai_boq_analysis.review')
WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'quotations.ai_boq_analysis.use'
WHERE r.is_deleted = false AND r.name = 'Quantity Surveyor'
ON CONFLICT DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN core.permissions p ON p.key = 'quotations.ai_boq_analysis.review'
WHERE r.is_deleted = false AND r.name = 'Commercial Manager'
ON CONFLICT DO NOTHING;

-- No audit trigger — boq_analysis_runs/findings are themselves an append-only
-- evidence trail for a specific run; reviewer_decision is updated in place by
-- the reviewer endpoint (PATCH .../findings/{id}), never by anything else.
