-- Unified CRM communication ledger for WhatsApp, phone calls, email, meetings,
-- site visits, and manual outreach records.

CREATE TABLE IF NOT EXISTS crm.communication_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    created_by UUID REFERENCES core.users(id),
    actor_user_id UUID REFERENCES core.users(id),
    recipient_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES crm.contacts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES crm.opportunities(id) ON DELETE SET NULL,
    channel VARCHAR(32) NOT NULL CHECK (channel IN (
        'whatsapp_message',
        'whatsapp_call',
        'phone_call',
        'email',
        'meeting',
        'site_visit',
        'portal_message',
        'manual_note'
    )),
    direction VARCHAR(16) NOT NULL DEFAULT 'outbound'
        CHECK (direction IN ('inbound', 'outbound', 'internal')),
    subject VARCHAR(255),
    body TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'completed',
    outcome VARCHAR(80),
    response_summary TEXT,
    next_action TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
    external_provider VARCHAR(80),
    external_message_id VARCHAR(255),
    external_call_id VARCHAR(255),
    from_address VARCHAR(255),
    to_address VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS communication_events_provider_message_unique
    ON crm.communication_events (organization_id, external_provider, external_message_id)
    WHERE external_message_id IS NOT NULL AND is_deleted = false;

CREATE UNIQUE INDEX IF NOT EXISTS communication_events_provider_call_unique
    ON crm.communication_events (organization_id, external_provider, external_call_id)
    WHERE external_call_id IS NOT NULL AND is_deleted = false;

CREATE INDEX IF NOT EXISTS communication_events_contact_timeline_idx
    ON crm.communication_events (organization_id, contact_id, started_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS communication_events_lead_timeline_idx
    ON crm.communication_events (organization_id, lead_id, started_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS communication_events_actor_reporting_idx
    ON crm.communication_events (organization_id, actor_user_id, started_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS communication_events_recipient_inbox_idx
    ON crm.communication_events (organization_id, recipient_user_id, started_at DESC)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS communication_events_channel_reporting_idx
    ON crm.communication_events (organization_id, channel, direction, status, started_at DESC)
    WHERE is_deleted = false;

ALTER TABLE crm.communication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.communication_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "CRM communication service role only" ON crm.communication_events;
CREATE POLICY "CRM communication service role only" ON crm.communication_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS trg_audit_communication_events ON crm.communication_events;
CREATE TRIGGER trg_audit_communication_events
AFTER INSERT OR UPDATE OR DELETE ON crm.communication_events
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

INSERT INTO core.permissions (key, description) VALUES
    ('crm_communications.read', 'View CRM communication ledger and outreach analytics'),
    ('crm_communications.create', 'Create CRM communication records and outbound messages'),
    ('crm_communications.update', 'Update CRM communication outcomes and statuses')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.name = 'SUPERADMIN'
  AND p.key IN ('crm_communications.read', 'crm_communications.create', 'crm_communications.update')
ON CONFLICT (role_id, permission_id) DO NOTHING;
