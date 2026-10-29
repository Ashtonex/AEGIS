-- ============================================================================
-- Migration 276: tender intake workflow (review -> QS) and new-tender email
-- ============================================================================
-- Builds on 275 (e-GP discovery and intake). A tender that enters AEGIS -
-- imported from e-GP (automatically or by a person) or entered by hand - runs
-- through:
--
--   captured -> pending_tender_review -> pending_qs_verification -> qs_preparation
--                         ^                        |
--                         +-- returned_for_correction (QS sends it back)
--
-- tracked in crm.tenders.review_workflow_status, separately from the bid
-- `stage` (Tender Identified / Bid Prep / ...), which only moves to Bid Prep
-- when QS preparation starts. NULL = a tender that predates the workflow and
-- has not been started on it.
--
--   crm.tender_automation_settings   per-org: schedule, auto-import, reviewers,
--                                    QS assignment rule, email recipients
--   crm.tender_review_items          the initial-review checklist (gate)
--   crm.tender_workflow_events       audit trail of every transition/edit
--   crm.tender_notification_deliveries  one row per tender x recipient address
--
-- No credentials are stored. A source that needs a login names the
-- environment variables that hold it (credential_env_prefix); values never
-- reach the database, logs or emails.
-- Idempotent: safe to re-run.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tender: workflow state, assignments and the facts the review confirms
-- ----------------------------------------------------------------------------
ALTER TABLE crm.tenders
    ADD COLUMN IF NOT EXISTS review_workflow_status    VARCHAR(32),
    ADD COLUMN IF NOT EXISTS review_round              INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS review_primary_user_id    UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS review_support_user_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS review_started_at         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS review_submitted_by       UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS review_submitted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS review_confirmation_note  TEXT,
    ADD COLUMN IF NOT EXISTS qs_assigned_user_id       UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS qs_assigned_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS qs_verified_by            UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS qs_verified_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS outstanding_notes         TEXT,
    ADD COLUMN IF NOT EXISTS source_published_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS submission_instructions   TEXT,
    ADD COLUMN IF NOT EXISTS clarification_deadline    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS site_visit_status         VARCHAR(24),
    ADD COLUMN IF NOT EXISTS site_visit_location       TEXT,
    ADD COLUMN IF NOT EXISTS site_visit_details        TEXT,
    ADD COLUMN IF NOT EXISTS site_visit_source         VARCHAR(32),
    ADD COLUMN IF NOT EXISTS bid_security_currency     VARCHAR(12),
    ADD COLUMN IF NOT EXISTS bid_security_form         TEXT,
    ADD COLUMN IF NOT EXISTS bid_security_validity     TEXT,
    ADD COLUMN IF NOT EXISTS bid_security_source       VARCHAR(32),
    ADD COLUMN IF NOT EXISTS source_material_status    JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE crm.tenders DROP CONSTRAINT IF EXISTS tenders_review_workflow_status_check;
ALTER TABLE crm.tenders ADD CONSTRAINT tenders_review_workflow_status_check CHECK (
    review_workflow_status IS NULL OR review_workflow_status IN (
        'captured', 'pending_tender_review', 'pending_qs_verification', 'returned_for_correction', 'qs_preparation'
    ));
-- 'required' / 'not_required' / 'unknown' - what the source says, before review.
ALTER TABLE crm.tenders DROP CONSTRAINT IF EXISTS tenders_site_visit_status_check;
ALTER TABLE crm.tenders ADD CONSTRAINT tenders_site_visit_status_check CHECK (
    site_visit_status IS NULL OR site_visit_status IN ('required', 'optional', 'not_required', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_crm_tenders_review_workflow
    ON crm.tenders (organization_id, review_workflow_status)
    WHERE is_deleted = false AND review_workflow_status IS NOT NULL;

-- Tenders entered by hand as "Tender ID: 123456" before 275 existed are the
-- same e-GP notices: give them their source identity so discovery links to
-- them instead of importing a duplicate. Only that explicit pattern - a bare
-- number is left for a person to link (import flags it as a possible match).
WITH manual AS (
    -- One tender per notice (the oldest) if the same id was typed twice.
    SELECT DISTINCT ON (organization_id, nid) id, organization_id, nid
    FROM (
        SELECT id, organization_id, created_at,
               substring(bid_number from '(?i)^\s*tender\s*id\s*:\s*(\d{4,9})\s*$') AS nid
        FROM crm.tenders
        WHERE is_deleted = false AND source_notice_id IS NULL
          AND bid_number ~* '^\s*tender\s*id\s*:\s*\d{4,9}\s*$'
    ) candidates
    ORDER BY organization_id, nid, created_at
)
UPDATE crm.tenders t
SET source_key = 'praz_egp', source_notice_id = m.nid
FROM manual m
WHERE t.id = m.id
  AND NOT EXISTS (
      SELECT 1 FROM crm.tenders o
      WHERE o.organization_id = m.organization_id AND o.is_deleted = false
        AND o.source_key = 'praz_egp' AND o.source_notice_id = m.nid
  );

-- ----------------------------------------------------------------------------
-- 2. Sources: public vs authenticated (credential *names*, never values)
-- ----------------------------------------------------------------------------
ALTER TABLE crm.tender_sources
    ADD COLUMN IF NOT EXISTS auth_mode               VARCHAR(24) NOT NULL DEFAULT 'public',
    ADD COLUMN IF NOT EXISTS credential_env_prefix   VARCHAR(40),
    ADD COLUMN IF NOT EXISTS manual_step_required    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS manual_step_note        TEXT,
    ADD COLUMN IF NOT EXISTS last_run_at             TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_run_status         VARCHAR(24),
    ADD COLUMN IF NOT EXISTS last_auth_problem       TEXT,
    ADD COLUMN IF NOT EXISTS last_auth_problem_at    TIMESTAMPTZ;

ALTER TABLE crm.tender_sources DROP CONSTRAINT IF EXISTS tender_sources_auth_mode_check;
ALTER TABLE crm.tender_sources ADD CONSTRAINT tender_sources_auth_mode_check
    CHECK (auth_mode IN ('public', 'credentials', 'manual_session'));
ALTER TABLE crm.tender_sources DROP CONSTRAINT IF EXISTS tender_sources_env_prefix_check;
ALTER TABLE crm.tender_sources ADD CONSTRAINT tender_sources_env_prefix_check
    CHECK (credential_env_prefix IS NULL OR credential_env_prefix ~ '^[A-Z][A-Z0-9_]{1,38}$');

-- Official attachments: what happened when AEGIS tried to download each one.
ALTER TABLE crm.tender_candidate_documents
    ADD COLUMN IF NOT EXISTS official_document_key  VARCHAR(64),
    ADD COLUMN IF NOT EXISTS published_label        TEXT,
    ADD COLUMN IF NOT EXISTS download_status        VARCHAR(24),
    ADD COLUMN IF NOT EXISTS download_error         TEXT,
    ADD COLUMN IF NOT EXISTS download_attempts      INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS downloaded_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS size_bytes             BIGINT;

ALTER TABLE crm.tender_candidate_documents DROP CONSTRAINT IF EXISTS tender_candidate_documents_download_check;
ALTER TABLE crm.tender_candidate_documents ADD CONSTRAINT tender_candidate_documents_download_check CHECK (
    download_status IS NULL OR download_status IN ('pending', 'downloaded', 'failed', 'rejected'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_candidate_documents_key
    ON crm.tender_candidate_documents (candidate_id, official_document_key) WHERE official_document_key IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Per-organisation automation settings
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_automation_settings (
    organization_id            UUID PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
    id                         UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,  -- core.process_audit_log keys on NEW.id
    schedule_enabled           BOOLEAN NOT NULL DEFAULT false,
    schedule_interval_minutes  INTEGER NOT NULL DEFAULT 360,
    last_scheduled_run_at      TIMESTAMPTZ,
    auto_import_enabled        BOOLEAN NOT NULL DEFAULT false,
    auto_import_bands          JSONB NOT NULL DEFAULT '["strong"]'::jsonb,
    collect_documents          BOOLEAN NOT NULL DEFAULT true,
    workflow_enabled           BOOLEAN NOT NULL DEFAULT true,
    review_user_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,
    review_cursor              INTEGER NOT NULL DEFAULT 0,
    review_due_days            INTEGER NOT NULL DEFAULT 1,
    qs_user_ids                JSONB NOT NULL DEFAULT '[]'::jsonb,
    qs_assignment_rule         VARCHAR(24) NOT NULL DEFAULT 'round_robin',
    qs_fixed_user_id           UUID REFERENCES core.users(id),
    qs_cursor                  INTEGER NOT NULL DEFAULT 0,
    notify_enabled             BOOLEAN NOT NULL DEFAULT true,
    -- [{"user_id": uuid, "company": bool, "private": bool}]
    notify_user_ids            JSONB NOT NULL DEFAULT '[]'::jsonb,
    notify_extra_emails        JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_by                 UUID REFERENCES core.users(id),
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_automation_interval_check CHECK (schedule_interval_minutes BETWEEN 60 AND 10080),
    CONSTRAINT tender_automation_review_due_check CHECK (review_due_days BETWEEN 0 AND 14),
    CONSTRAINT tender_automation_qs_rule_check CHECK (qs_assignment_rule IN ('round_robin', 'least_loaded', 'fixed'))
);
-- (for a table created before the id column existed)
ALTER TABLE crm.tender_automation_settings ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_automation_settings_id ON crm.tender_automation_settings (id);

-- Six Nine Construction's people, found by their AEGIS login - never by
-- guessed ids. A missing user simply isn't added; the admin view flags it.
INSERT INTO crm.tender_automation_settings (organization_id, review_user_ids, qs_user_ids, notify_user_ids)
SELECT o.id,
       COALESCE((SELECT jsonb_agg(u.id ORDER BY u.email) FROM core.users u
                 WHERE u.organization_id = o.id AND u.is_deleted = false AND u.is_active
                   AND lower(u.email) IN ('ekow@sixnineconstruction.com', 'marvellous@sixnineconstruction.com')), '[]'::jsonb),
       COALESCE((SELECT jsonb_agg(u.id ORDER BY u.email) FROM core.users u
                 WHERE u.organization_id = o.id AND u.is_deleted = false AND u.is_active
                   AND lower(u.email) IN ('takudzwa@sixnineconstruction.com', 'gamuchirai@sixnineconstruction.com')), '[]'::jsonb),
       -- Gloria (nyasha@) and Cosmas: company login AND the private mailbox
       -- behind their Teams account. The administrator: the admin login only
       -- (EMAIL_REDIRECTS delivers ashton@admin.com to admin@sixnineconstruction.com).
       COALESCE((SELECT jsonb_agg(jsonb_build_object(
                            'user_id', u.id, 'company', true,
                            'private', lower(u.email) <> 'ashton@admin.com') ORDER BY u.email)
                 FROM core.users u
                 WHERE u.organization_id = o.id AND u.is_deleted = false AND u.is_active
                   AND lower(u.email) IN ('nyasha@sixnineconstruction.com', 'cosmas@sixnineconstruction.com', 'ashton@admin.com')), '[]'::jsonb)
FROM core.organizations o
WHERE EXISTS (SELECT 1 FROM core.users u WHERE u.organization_id = o.id AND lower(u.email) LIKE '%@sixnineconstruction.com')
ON CONFLICT (organization_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Initial-review checklist (the gate to QS)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_review_items (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    tender_id        UUID NOT NULL REFERENCES crm.tenders(id) ON DELETE CASCADE,
    item_key         VARCHAR(40) NOT NULL,
    label            TEXT NOT NULL,
    guidance         TEXT,
    sort_order       INTEGER NOT NULL DEFAULT 0,
    required         BOOLEAN NOT NULL DEFAULT true,
    status           VARCHAR(16) NOT NULL DEFAULT 'pending',
    not_applicable_reason TEXT,
    notes            TEXT,
    completed_by     UUID REFERENCES core.users(id),
    completed_at     TIMESTAMPTZ,
    reopened_count   INTEGER NOT NULL DEFAULT 0,
    reopened_note    TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_review_items_status_check CHECK (status IN ('pending', 'done', 'not_applicable')),
    CONSTRAINT tender_review_items_na_reason_check CHECK (
        status <> 'not_applicable' OR length(trim(COALESCE(not_applicable_reason, ''))) >= 3),
    CONSTRAINT tender_review_items_unique UNIQUE (tender_id, item_key)
);

CREATE INDEX IF NOT EXISTS idx_tender_review_items_tender ON crm.tender_review_items (tender_id, sort_order);

-- ----------------------------------------------------------------------------
-- 5. Workflow audit trail
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_workflow_events (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    tender_id        UUID NOT NULL REFERENCES crm.tenders(id) ON DELETE CASCADE,
    action           VARCHAR(48) NOT NULL,
    from_status      VARCHAR(32),
    to_status        VARCHAR(32),
    actor_user_id    UUID REFERENCES core.users(id),
    automated        BOOLEAN NOT NULL DEFAULT false,
    round            INTEGER,
    note             TEXT,
    data             JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_workflow_events_tender ON crm.tender_workflow_events (tender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tender_workflow_events_recent ON crm.tender_workflow_events (organization_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- 6. New-tender email deliveries: one row per tender x address
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS crm.tender_notification_deliveries (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id    UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    tender_id          UUID NOT NULL REFERENCES crm.tenders(id) ON DELETE CASCADE,
    kind               VARCHAR(32) NOT NULL DEFAULT 'new_tender',
    recipient_key      VARCHAR(320) NOT NULL,
    recipient_email    VARCHAR(320),
    recipient_user_id  UUID REFERENCES core.users(id),
    recipient_label    VARCHAR(255),
    address_source     VARCHAR(40),
    status             VARCHAR(16) NOT NULL DEFAULT 'pending',
    attempts           INTEGER NOT NULL DEFAULT 0,
    last_error         TEXT,
    last_attempt_at    TIMESTAMPTZ,
    next_attempt_at    TIMESTAMPTZ,
    sent_at            TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT tender_notification_status_check CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'unresolved', 'skipped')),
    CONSTRAINT tender_notification_unique UNIQUE (tender_id, kind, recipient_key)
);

CREATE INDEX IF NOT EXISTS idx_tender_notification_retry
    ON crm.tender_notification_deliveries (status, next_attempt_at) WHERE status IN ('pending', 'failed');

-- ----------------------------------------------------------------------------
-- 7. Security: backend-only, audited
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'tender_automation_settings', 'tender_review_items', 'tender_workflow_events', 'tender_notification_deliveries'
    ] LOOP
        EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON crm.%I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON crm.%I TO service_role', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON crm.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON crm.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;

DROP TRIGGER IF EXISTS trg_audit_tender_automation_settings ON crm.tender_automation_settings;
CREATE TRIGGER trg_audit_tender_automation_settings AFTER INSERT OR UPDATE OR DELETE ON crm.tender_automation_settings
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
DROP TRIGGER IF EXISTS trg_audit_tender_review_items ON crm.tender_review_items;
CREATE TRIGGER trg_audit_tender_review_items AFTER INSERT OR UPDATE OR DELETE ON crm.tender_review_items
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

-- ----------------------------------------------------------------------------
-- 8. Permissions
-- ----------------------------------------------------------------------------
INSERT INTO core.permissions (key, description) VALUES
    ('tender_workflow.review', 'Carry out the initial tender review: verify the source, attach documents, confirm site visit and bid bond, submit to QS'),
    ('tender_workflow.qs',     'Verify a reviewed tender as QS, return it for correction, or start QS preparation'),
    ('tender_workflow.admin',  'Configure tender automation (schedule, reviewers, QS rule, email recipients), start or reassign the workflow')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Executive (Admin)', 'tender_workflow.review'),
    ('Executive (Admin)', 'tender_workflow.qs'),
    ('Executive (Admin)', 'tender_workflow.admin'),
    ('Tender / Bid Manager', 'tender_workflow.review'),
    ('Tender / Bid Manager', 'tender_workflow.qs'),
    ('Tender / Bid Manager', 'tender_workflow.admin'),
    ('CRM Associate', 'tender_workflow.review'),
    ('Document Controller', 'tender_workflow.review'),
    ('Quantity Surveyor', 'tender_workflow.qs'),
    ('Quantity Surveyor', 'tender_bids.read'),
    ('Quantity Surveyor', 'tender_discovery.read'),
    ('CRM Associate', 'tender_discovery.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
