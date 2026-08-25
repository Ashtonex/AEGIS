-- ============================================================================
-- CRM sales operating system foundation:
-- connected apps, provider sync jobs, email/calendar event mapping, and
-- explainable AI scoring recommendations.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm.connected_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    provider VARCHAR(40) NOT NULL CHECK (provider IN (
        'gmail', 'outlook', 'google_calendar', 'microsoft_calendar',
        'whatsapp', 'maps', 'documents', 'accounting'
    )),
    provider_account_id VARCHAR(255),
    account_label VARCHAR(255),
    account_email VARCHAR(255),
    status VARCHAR(40) NOT NULL DEFAULT 'pending_setup'
        CHECK (status IN ('pending_setup', 'connected', 'syncing', 'error', 'disconnected')),
    auth_type VARCHAR(40) NOT NULL DEFAULT 'oauth2'
        CHECK (auth_type IN ('oauth2', 'api_key', 'webhook', 'system')),
    scopes TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    token_status VARCHAR(40) NOT NULL DEFAULT 'not_configured'
        CHECK (token_status IN ('not_configured', 'valid', 'expired', 'revoked', 'error')),
    access_token_ciphertext TEXT,
    refresh_token_ciphertext TEXT,
    token_expires_at TIMESTAMPTZ,
    sync_cursor TEXT,
    last_sync_at TIMESTAMPTZ,
    last_error_at TIMESTAMPTZ,
    last_error TEXT,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS connected_accounts_unique_active
    ON crm.connected_accounts (
        organization_id,
        owner_user_id,
        provider,
        lower(COALESCE(account_email, provider_account_id, account_label, 'default'))
    )
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS connected_accounts_org_provider_idx
    ON crm.connected_accounts (organization_id, provider, status)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.integration_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES crm.connected_accounts(id) ON DELETE SET NULL,
    provider VARCHAR(40) NOT NULL,
    sync_type VARCHAR(40) NOT NULL CHECK (sync_type IN ('email', 'calendar', 'contacts', 'documents', 'messages', 'accounting')),
    direction VARCHAR(20) NOT NULL DEFAULT 'pull' CHECK (direction IN ('pull', 'push', 'bidirectional')),
    status VARCHAR(40) NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'running', 'completed', 'blocked', 'failed')),
    cursor_before TEXT,
    cursor_after TEXT,
    records_read INTEGER NOT NULL DEFAULT 0 CHECK (records_read >= 0),
    records_written INTEGER NOT NULL DEFAULT 0 CHECK (records_written >= 0),
    error_summary TEXT,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS integration_sync_jobs_account_created_idx
    ON crm.integration_sync_jobs (organization_id, account_id, created_at DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.integration_sync_errors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    job_id UUID REFERENCES crm.integration_sync_jobs(id) ON DELETE CASCADE,
    account_id UUID REFERENCES crm.connected_accounts(id) ON DELETE SET NULL,
    provider VARCHAR(40) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    error_code VARCHAR(120),
    message TEXT NOT NULL,
    external_id VARCHAR(255),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS integration_sync_errors_account_created_idx
    ON crm.integration_sync_errors (organization_id, account_id, created_at DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.synced_email_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES crm.connected_accounts(id) ON DELETE SET NULL,
    communication_event_id UUID REFERENCES crm.communication_events(id) ON DELETE SET NULL,
    provider VARCHAR(40) NOT NULL,
    external_message_id VARCHAR(255) NOT NULL,
    external_thread_id VARCHAR(255),
    message_date TIMESTAMPTZ,
    from_address VARCHAR(255),
    to_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    cc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    bcc_addresses TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    subject VARCHAR(255),
    snippet TEXT,
    sync_status VARCHAR(40) NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'ignored', 'error')),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS synced_email_events_provider_message_uidx
    ON crm.synced_email_events (organization_id, provider, external_message_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS synced_email_events_account_date_idx
    ON crm.synced_email_events (organization_id, account_id, message_date DESC)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.synced_calendar_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    account_id UUID REFERENCES crm.connected_accounts(id) ON DELETE SET NULL,
    communication_event_id UUID REFERENCES crm.communication_events(id) ON DELETE SET NULL,
    provider VARCHAR(40) NOT NULL,
    external_event_id VARCHAR(255) NOT NULL,
    calendar_id VARCHAR(255),
    subject VARCHAR(255) NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ,
    location TEXT,
    attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
    sync_status VARCHAR(40) NOT NULL DEFAULT 'synced'
        CHECK (sync_status IN ('synced', 'ignored', 'error')),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS synced_calendar_events_provider_event_uidx
    ON crm.synced_calendar_events (organization_id, provider, external_event_id)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS synced_calendar_events_account_start_idx
    ON crm.synced_calendar_events (organization_id, account_id, starts_at)
    WHERE is_deleted = false;

CREATE TABLE IF NOT EXISTS crm.ai_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    entity_type VARCHAR(40) NOT NULL CHECK (entity_type IN ('lead', 'opportunity')),
    entity_id UUID NOT NULL,
    score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    recommendation TEXT NOT NULL,
    rationale TEXT NOT NULL,
    risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
    suggested_action_type VARCHAR(80),
    due_at TIMESTAMPTZ,
    model_version VARCHAR(40) NOT NULL DEFAULT 'crm_rules_v1',
    source_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(30) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'accepted', 'dismissed', 'completed')),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_recommendations_entity_model_uidx
    ON crm.ai_recommendations (organization_id, entity_type, entity_id, model_version)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS ai_recommendations_org_score_idx
    ON crm.ai_recommendations (organization_id, score DESC, created_at DESC)
    WHERE is_deleted = false AND status = 'open';

ALTER TABLE crm.leads
    ADD COLUMN IF NOT EXISTS ai_next_action TEXT,
    ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMPTZ;

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS ai_score INTEGER CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)),
    ADD COLUMN IF NOT EXISTS ai_rationale TEXT,
    ADD COLUMN IF NOT EXISTS ai_next_action TEXT,
    ADD COLUMN IF NOT EXISTS ai_scored_at TIMESTAMPTZ;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'connected_accounts',
        'integration_sync_jobs',
        'integration_sync_errors',
        'synced_email_events',
        'synced_calendar_events',
        'ai_recommendations'
    ]
    LOOP
        EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', 'CRM integration service role', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON crm.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            'CRM integration service role',
            table_name
        );
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON crm.%I', table_name, table_name);
        EXECUTE format(
            'CREATE TRIGGER trg_audit_%I AFTER INSERT OR UPDATE OR DELETE ON crm.%I FOR EACH ROW EXECUTE FUNCTION core.process_audit_log()',
            table_name,
            table_name
        );
    END LOOP;
END $$;

INSERT INTO core.permissions (key, description) VALUES
    ('crm.integrations.read', 'View CRM connected apps, sync status, and provider health'),
    ('crm.integrations.manage', 'Connect, disconnect, and run CRM integration sync jobs'),
    ('crm.ai.read', 'View CRM AI scores and next-best-action recommendations'),
    ('crm.ai.manage', 'Run CRM AI scoring and update recommendation status')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Commercial Manager', 'Sales Executive', 'CRM Associate')
  AND p.key IN ('crm.integrations.read', 'crm.ai.read')
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.is_deleted = false
  AND r.name IN ('SUPERADMIN', 'Executive (Admin)', 'Managing Director', 'Commercial Manager')
  AND p.key IN ('crm.integrations.manage', 'crm.ai.manage')
ON CONFLICT (role_id, permission_id) DO NOTHING;
