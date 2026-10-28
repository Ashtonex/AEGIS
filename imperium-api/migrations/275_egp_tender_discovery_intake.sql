-- ============================================================================
-- Migration 275: e-GP tender discovery and intake
-- ============================================================================
-- Discovers notices on the official PRAZ e-GP portal (https://egp.praz.org.zw,
-- linked from https://www.praz.org.zw), stages them for review, and imports
-- the selected ones into the existing tender pipeline (crm.tenders). There is
-- no second tender system: an imported notice IS a crm.tenders row, carrying
-- its source identity so a re-import or a retry links instead of duplicating.
--
--   crm.tender_sources            connector config + last verified state
--   crm.tender_discovery_profiles editable search/scoring profile
--   crm.tender_discovery_runs     one discovery run: filters, checkpoint,
--                                 coverage, failures, completion state
--   crm.tender_candidates         staged notices awaiting review
--   crm.tender_source_snapshots   every distinct version of a notice seen
--   crm.tender_source_changes     field-level differences between versions,
--                                 reviewed before anything touches a tender
--   crm.tender_candidate_documents official attachments and where they are
--
-- No credentials, cookies or session tokens are stored anywhere here.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Canonical tender: source identity
-- ----------------------------------------------------------------------------
ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS source_key VARCHAR(32),
    ADD COLUMN IF NOT EXISTS source_notice_id VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS source_reference VARCHAR(255),
    ADD COLUMN IF NOT EXISTS procuring_entity VARCHAR(255),
    ADD COLUMN IF NOT EXISTS procurement_method VARCHAR(120),
    ADD COLUMN IF NOT EXISTS source_status VARCHAR(60),
    ADD COLUMN IF NOT EXISTS source_timezone VARCHAR(64),
    ADD COLUMN IF NOT EXISTS source_first_seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_last_checked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_candidate_id UUID,
    ADD COLUMN IF NOT EXISTS imported_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS imported_at TIMESTAMPTZ;

-- One live tender per official notice per organisation. The import path
-- inserts with ON CONFLICT against this predicate, so a double-click, a
-- retry or two people importing at once all land on the same row.
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_tenders_source_notice
    ON crm.tenders (organization_id, source_key, source_notice_id)
    WHERE is_deleted = false AND source_notice_id IS NOT NULL;

-- Published requirements vs SNC's own checklist are told apart by source.
ALTER TABLE crm.tender_requirements
    ADD COLUMN IF NOT EXISTS source_url TEXT,
    ADD COLUMN IF NOT EXISTS source_excerpt TEXT,
    ADD COLUMN IF NOT EXISTS source_section VARCHAR(255),
    ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(160);

ALTER TABLE crm.tender_requirements
    DROP CONSTRAINT IF EXISTS tender_requirements_source_check,
    ADD CONSTRAINT tender_requirements_source_check
        CHECK (source IN ('MANUAL', 'TEMPLATE_SEEDED', 'AI_EXTRACTED_UNVERIFIED', 'EGP_PUBLISHED', 'SNC_INTERNAL'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_requirements_dedupe
    ON crm.tender_requirements (organization_id, tender_id, dedupe_key)
    WHERE is_deleted = false AND dedupe_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 2. Source connector
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_sources (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id            UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    source_key                 VARCHAR(32) NOT NULL,
    display_name               VARCHAR(120) NOT NULL,
    base_url                   TEXT NOT NULL,
    verified_from              TEXT,
    enabled                    BOOLEAN NOT NULL DEFAULT true,
    connection_state           VARCHAR(32) NOT NULL DEFAULT 'not_connected',
    state_reason               TEXT,
    last_verified_at           TIMESTAMPTZ,
    last_probe_at              TIMESTAMPTZ,
    last_probe                 JSONB NOT NULL DEFAULT '{}'::jsonb,
    min_request_interval_ms    INTEGER NOT NULL DEFAULT 3000,
    max_pages_per_run          INTEGER NOT NULL DEFAULT 60,
    max_details_per_run        INTEGER NOT NULL DEFAULT 60,
    scheduled_recheck_enabled  BOOLEAN NOT NULL DEFAULT false,
    updated_by                 UUID REFERENCES core.users(id),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_sources_state_check CHECK (connection_state IN (
        'not_connected', 'awaiting_user_login', 'connected_verified',
        'session_expired', 'access_restricted', 'connection_error'
    )),
    CONSTRAINT tender_sources_interval_check CHECK (min_request_interval_ms >= 1500),
    CONSTRAINT tender_sources_pages_check CHECK (max_pages_per_run BETWEEN 1 AND 200),
    CONSTRAINT tender_sources_details_check CHECK (max_details_per_run BETWEEN 0 AND 300),
    CONSTRAINT tender_sources_unique UNIQUE (organization_id, source_key)
);

-- ----------------------------------------------------------------------------
-- 3. Discovery profile
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_discovery_profiles (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id      UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    name                 VARCHAR(120) NOT NULL,
    description          TEXT,
    work_types           JSONB NOT NULL DEFAULT '[]'::jsonb,
    category_terms       JSONB NOT NULL DEFAULT '[]'::jsonb,
    category_codes       JSONB NOT NULL DEFAULT '[]'::jsonb,
    preferred_locations  JSONB NOT NULL DEFAULT '[]'::jsonb,
    nearby_locations     JSONB NOT NULL DEFAULT '[]'::jsonb,
    exclude_terms        JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_filters      JSONB NOT NULL DEFAULT '{}'::jsonb,
    scoring              JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    created_by           UUID REFERENCES core.users(id),
    updated_by           UUID REFERENCES core.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted           BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_discovery_profiles_name
    ON crm.tender_discovery_profiles (organization_id, lower(name)) WHERE is_deleted = false;

-- ----------------------------------------------------------------------------
-- 4. Discovery runs
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_discovery_runs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id        UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    source_key             VARCHAR(32) NOT NULL,
    profile_id             UUID REFERENCES crm.tender_discovery_profiles(id),
    profile_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
    filters                JSONB NOT NULL DEFAULT '{}'::jsonb,
    status                 VARCHAR(24) NOT NULL DEFAULT 'queued',
    outcome                VARCHAR(32),
    executor               VARCHAR(24),
    started_by             UUID REFERENCES core.users(id),
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at             TIMESTAMPTZ,
    finished_at            TIMESTAMPTZ,
    heartbeat_at           TIMESTAMPTZ,
    cancel_requested       BOOLEAN NOT NULL DEFAULT false,
    resumed_from_run_id    UUID REFERENCES crm.tender_discovery_runs(id),
    pages_total            INTEGER,
    records_total          INTEGER,
    page_limit             INTEGER,
    last_page_completed    INTEGER NOT NULL DEFAULT 0,
    pages_fetched          INTEGER NOT NULL DEFAULT 0,
    pages_failed           INTEGER NOT NULL DEFAULT 0,
    notices_seen           INTEGER NOT NULL DEFAULT 0,
    notices_matched        INTEGER NOT NULL DEFAULT 0,
    details_attempted      INTEGER NOT NULL DEFAULT 0,
    details_fetched        INTEGER NOT NULL DEFAULT 0,
    details_failed         INTEGER NOT NULL DEFAULT 0,
    details_skipped        INTEGER NOT NULL DEFAULT 0,
    candidates_new         INTEGER NOT NULL DEFAULT 0,
    candidates_updated     INTEGER NOT NULL DEFAULT 0,
    changes_detected       INTEGER NOT NULL DEFAULT 0,
    failures               JSONB NOT NULL DEFAULT '[]'::jsonb,
    coverage               JSONB NOT NULL DEFAULT '{}'::jsonb,
    summary                TEXT,
    CONSTRAINT tender_discovery_runs_status_check CHECK (status IN (
        'queued', 'running', 'completed', 'partial', 'failed', 'cancelled'
    )),
    CONSTRAINT tender_discovery_runs_outcome_check CHECK (outcome IS NULL OR outcome IN (
        'matches_found', 'no_matches', 'no_notices_listed', 'access_failed',
        'extraction_failed', 'interrupted', 'cancelled', 'restricted'
    ))
);

-- At most one active run per organisation and source.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_discovery_runs_one_active
    ON crm.tender_discovery_runs (organization_id, source_key)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_tender_discovery_runs_recent
    ON crm.tender_discovery_runs (organization_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 5. Staged candidates
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_candidates (
    id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id            UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    source_key                 VARCHAR(32) NOT NULL,
    source_notice_id           VARCHAR(64) NOT NULL,
    notice_url                 TEXT NOT NULL,
    official_reference         VARCHAR(255),
    title                      TEXT,
    procuring_entity           VARCHAR(255),
    notice_status              VARCHAR(60),
    published_at               TIMESTAMPTZ,
    closing_at                 TIMESTAMPTZ,
    closing_time_specified     BOOLEAN,
    source_timezone            VARCHAR(64),
    category_codes             JSONB NOT NULL DEFAULT '[]'::jsonb,
    category_names             JSONB NOT NULL DEFAULT '[]'::jsonb,
    location_text              TEXT,
    fields                     JSONB NOT NULL DEFAULT '{}'::jsonb,
    corrections                JSONB NOT NULL DEFAULT '{}'::jsonb,
    conflicts                  JSONB NOT NULL DEFAULT '[]'::jsonb,
    unresolved_questions       JSONB NOT NULL DEFAULT '[]'::jsonb,
    extraction_confidence      VARCHAR(16) NOT NULL DEFAULT 'low',
    detail_status              VARCHAR(24) NOT NULL DEFAULT 'not_fetched',
    detail_error               TEXT,
    relevance_score            INTEGER,
    relevance_band             VARCHAR(16),
    match_reasons              JSONB NOT NULL DEFAULT '[]'::jsonb,
    missing_evidence           JSONB NOT NULL DEFAULT '[]'::jsonb,
    readiness                  VARCHAR(32) NOT NULL DEFAULT 'unverified',
    review_status              VARCHAR(24) NOT NULL DEFAULT 'new',
    review_note                TEXT,
    reviewed_by                UUID REFERENCES core.users(id),
    reviewed_at                TIMESTAMPTZ,
    responsible_user_id        UUID REFERENCES core.users(id),
    internal_review_date       DATE,
    possible_duplicate_tender_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    tender_id                  UUID REFERENCES crm.tenders(id),
    content_hash               VARCHAR(64),
    first_seen_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_checked_at            TIMESTAMPTZ,
    first_run_id               UUID REFERENCES crm.tender_discovery_runs(id),
    last_run_id                UUID REFERENCES crm.tender_discovery_runs(id),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_candidates_unique UNIQUE (organization_id, source_key, source_notice_id),
    CONSTRAINT tender_candidates_band_check CHECK (relevance_band IS NULL OR relevance_band IN ('strong', 'possible', 'weak')),
    CONSTRAINT tender_candidates_readiness_check CHECK (readiness IN (
        'unverified', 'requirements_missing', 'ready_for_internal_decision'
    )),
    CONSTRAINT tender_candidates_review_check CHECK (review_status IN (
        'new', 'deferred', 'rejected', 'imported', 'needs_dedupe_review'
    )),
    CONSTRAINT tender_candidates_detail_check CHECK (detail_status IN (
        'not_fetched', 'fetched', 'failed', 'restricted', 'unavailable'
    )),
    CONSTRAINT tender_candidates_confidence_check CHECK (extraction_confidence IN ('high', 'medium', 'low'))
);

CREATE INDEX IF NOT EXISTS idx_tender_candidates_queue
    ON crm.tender_candidates (organization_id, review_status, relevance_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_tender_candidates_reference
    ON crm.tender_candidates (organization_id, lower(official_reference)) WHERE official_reference IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tender_candidates_tender
    ON crm.tender_candidates (tender_id) WHERE tender_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Version history and changes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_source_snapshots (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    candidate_id     UUID NOT NULL REFERENCES crm.tender_candidates(id) ON DELETE CASCADE,
    run_id           UUID REFERENCES crm.tender_discovery_runs(id),
    captured_by      UUID REFERENCES core.users(id),
    captured_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    capture_kind     VARCHAR(16) NOT NULL DEFAULT 'discovery',
    content_hash     VARCHAR(64) NOT NULL,
    fields           JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_text      TEXT,
    CONSTRAINT tender_source_snapshots_kind_check CHECK (capture_kind IN ('discovery', 'recheck', 'summary'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_source_snapshots_hash
    ON crm.tender_source_snapshots (candidate_id, content_hash);

CREATE TABLE IF NOT EXISTS crm.tender_source_changes (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    candidate_id       UUID NOT NULL REFERENCES crm.tender_candidates(id) ON DELETE CASCADE,
    tender_id          UUID REFERENCES crm.tenders(id),
    from_snapshot_id   UUID REFERENCES crm.tender_source_snapshots(id),
    to_snapshot_id     UUID REFERENCES crm.tender_source_snapshots(id),
    field_key          VARCHAR(64) NOT NULL,
    change_kind        VARCHAR(32) NOT NULL,
    is_material        BOOLEAN NOT NULL DEFAULT true,
    old_value          JSONB,
    new_value          JSONB,
    old_evidence       JSONB,
    new_evidence       JSONB,
    review_status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    reviewed_by        UUID REFERENCES core.users(id),
    reviewed_at        TIMESTAMPTZ,
    review_note        TEXT,
    applied_to_tender  BOOLEAN NOT NULL DEFAULT false,
    detected_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_source_changes_review_check CHECK (review_status IN ('pending', 'applied', 'acknowledged')),
    CONSTRAINT tender_source_changes_kind_check CHECK (change_kind IN (
        'closing_date_changed', 'site_visit_changed', 'attachments_changed', 'addenda_changed',
        'eligibility_changed', 'status_changed', 'withdrawn_or_unavailable', 'other_amendment'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_source_changes_unique
    ON crm.tender_source_changes (candidate_id, to_snapshot_id, field_key);
CREATE INDEX IF NOT EXISTS idx_tender_source_changes_pending
    ON crm.tender_source_changes (organization_id, review_status, detected_at DESC);

-- ----------------------------------------------------------------------------
-- 7. Official attachments
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_candidate_documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    candidate_id       UUID NOT NULL REFERENCES crm.tender_candidates(id) ON DELETE CASCADE,
    tender_id          UUID REFERENCES crm.tenders(id),
    label              VARCHAR(255) NOT NULL,
    official_url       TEXT,
    access             VARCHAR(24) NOT NULL DEFAULT 'login_required',
    document_id        UUID REFERENCES core.documents(id),
    attached_by        UUID REFERENCES core.users(id),
    attached_at        TIMESTAMPTZ,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_candidate_documents_access_check CHECK (access IN (
        'public', 'login_required', 'unavailable', 'manual_upload'
    ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_candidate_documents_url
    ON crm.tender_candidate_documents (candidate_id, official_url) WHERE official_url IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. Security: backend-only access, audited
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tender_sources', 'tender_discovery_profiles', 'tender_discovery_runs', 'tender_candidates',
        'tender_source_snapshots', 'tender_source_changes', 'tender_candidate_documents'
    ] LOOP
        EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON crm.%I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON crm.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON crm.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON crm.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_audit_tender_sources ON crm.tender_sources;
CREATE TRIGGER trg_audit_tender_sources AFTER INSERT OR UPDATE OR DELETE ON crm.tender_sources
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
DROP TRIGGER IF EXISTS trg_audit_tender_discovery_profiles ON crm.tender_discovery_profiles;
CREATE TRIGGER trg_audit_tender_discovery_profiles AFTER INSERT OR UPDATE OR DELETE ON crm.tender_discovery_profiles
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
DROP TRIGGER IF EXISTS trg_audit_tender_source_changes ON crm.tender_source_changes;
CREATE TRIGGER trg_audit_tender_source_changes AFTER INSERT OR UPDATE OR DELETE ON crm.tender_source_changes
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- ----------------------------------------------------------------------------
-- 9. Permissions
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('tender_discovery.read',      'View e-GP tender discovery runs, staged candidates and source evidence'),
    ('tender_discovery.run',       'Verify the e-GP connection, start discovery runs and recheck notices'),
    ('tender_discovery.import',    'Review staged e-GP notices: correct, reject, defer and import into the tender pipeline'),
    ('tender_discovery.configure', 'Edit e-GP discovery profiles and connector settings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Executive (Admin)', 'tender_discovery.read'),
    ('Executive (Admin)', 'tender_discovery.run'),
    ('Executive (Admin)', 'tender_discovery.import'),
    ('Executive (Admin)', 'tender_discovery.configure'),
    ('Tender / Bid Manager', 'tender_discovery.read'),
    ('Tender / Bid Manager', 'tender_discovery.run'),
    ('Tender / Bid Manager', 'tender_discovery.import'),
    ('Tender / Bid Manager', 'tender_discovery.configure'),
    ('CRM Associate', 'tender_discovery.read'),
    ('CRM Associate', 'tender_discovery.run'),
    ('CRM Associate', 'tender_discovery.import'),
    ('Commercial Manager', 'tender_discovery.read'),
    ('Commercial Manager', 'tender_discovery.run'),
    ('Commercial Manager', 'tender_discovery.import'),
    ('Executive Read Only', 'tender_discovery.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
