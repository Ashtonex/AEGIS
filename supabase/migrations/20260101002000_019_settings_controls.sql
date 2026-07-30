-- Tenant-scoped settings controls. This migration creates no default configuration,
-- integration, preference, or audit records.

CREATE SCHEMA IF NOT EXISTS settings;

CREATE TABLE IF NOT EXISTS settings.organization_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES core.organizations(id) ON DELETE CASCADE,
    trading_name VARCHAR(255),
    legal_name VARCHAR(255),
    timezone VARCHAR(64),
    currency_code VARCHAR(3),
    fiscal_year_start_month SMALLINT CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
    country_code VARCHAR(2),
    primary_contact_email VARCHAR(320),
    primary_contact_phone VARCHAR(40),
    address JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    updated_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT organization_settings_currency_format CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT organization_settings_country_format CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT organization_settings_address_object CHECK (jsonb_typeof(address) = 'object')
);

CREATE TABLE IF NOT EXISTS settings.notification_preferences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL UNIQUE REFERENCES core.organizations(id) ON DELETE CASCADE,
    email_enabled BOOLEAN NOT NULL DEFAULT true,
    in_app_enabled BOOLEAN NOT NULL DEFAULT true,
    daily_digest_enabled BOOLEAN NOT NULL DEFAULT false,
    incident_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
    approval_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
    updated_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings.integration_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    provider VARCHAR(80) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'not_configured'
        CHECK (status IN ('not_configured', 'pending', 'connected', 'disabled', 'error')),
    account_label VARCHAR(255),
    endpoint_url TEXT,
    external_reference VARCHAR(255),
    scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
    sync_status VARCHAR(24) NOT NULL DEFAULT 'not_started'
        CHECK (sync_status IN ('not_started', 'healthy', 'delayed', 'failed')),
    last_synced_at TIMESTAMPTZ,
    created_by UUID REFERENCES core.users(id),
    updated_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT integration_connections_provider_unique UNIQUE (organization_id, provider),
    CONSTRAINT integration_connections_endpoint_https CHECK (endpoint_url IS NULL OR endpoint_url ~* '^https://'),
    CONSTRAINT integration_connections_scopes_array CHECK (jsonb_typeof(scopes) = 'array')
);

CREATE TABLE IF NOT EXISTS settings.audit_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES core.users(id),
    event_type VARCHAR(80) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id UUID,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT settings_audit_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX IF NOT EXISTS settings_integration_org_status_idx
    ON settings.integration_connections (organization_id, status, updated_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS settings_audit_org_occurred_idx
    ON settings.audit_events (organization_id, occurred_at DESC);

ALTER TABLE settings.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.integration_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings.organization_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.notification_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.integration_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE settings.audit_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA settings FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA settings FROM anon, authenticated;

CREATE POLICY "Settings service role only" ON settings.organization_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Settings service role only" ON settings.notification_preferences FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Settings service role only" ON settings.integration_connections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Settings service role only" ON settings.audit_events FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO core.permissions (key, description) VALUES
    ('settings.read', 'View tenant configuration and audit evidence'),
    ('settings.update', 'Modify tenant configuration and integration metadata'),
    ('settings.audit.read', 'View tenant settings audit evidence')
ON CONFLICT (key) DO NOTHING;
