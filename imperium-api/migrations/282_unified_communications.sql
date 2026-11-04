-- ============================================================================
-- Migration 282: unified staff communications (in-app, email, Teams, WhatsApp)
-- ============================================================================
-- One message from AEGIS fans out to each recipient over the channels the
-- sender picks, as far as each person can be reached on them:
--   core.communication_dispatches   one row per message sent
--   core.communication_deliveries   one row per recipient per channel, with the
--                                   outcome (sent / delivered / read / failed /
--                                   skipped and why)
-- WhatsApp reaches a person only once they have given their own number AND
-- opted in on their profile; the opt-in time is kept as the consent record.
-- Additive only.

ALTER TABLE hr.employee_profiles
    ADD COLUMN IF NOT EXISTS whatsapp_number VARCHAR(40),
    ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS whatsapp_opt_in_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS core.communication_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    sender_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    subject VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    action_url TEXT,
    channels TEXT[] NOT NULL,
    -- What raised it: 'manual' from the API, or a feature key such as
    -- 'meeting' / 'director_digest' with source_id pointing at its record.
    source VARCHAR(40) NOT NULL DEFAULT 'manual',
    source_id TEXT,
    whatsapp_content_sid VARCHAR(40),
    whatsapp_content_variables JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (channels <@ ARRAY['in_app', 'email', 'teams', 'whatsapp']::text[] AND cardinality(channels) > 0)
);

CREATE INDEX IF NOT EXISTS communication_dispatches_org_created_idx
    ON core.communication_dispatches (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS core.communication_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    dispatch_id UUID NOT NULL REFERENCES core.communication_dispatches(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
    channel VARCHAR(16) NOT NULL CHECK (channel IN ('in_app', 'email', 'teams', 'whatsapp')),
    -- pending until the external send runs after commit; WhatsApp then moves
    -- through Twilio's statuses (queued/sent/delivered/read/failed/undelivered).
    status VARCHAR(24) NOT NULL,
    detail TEXT,
    address VARCHAR(255),
    external_message_id VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (dispatch_id, recipient_user_id, channel)
);

CREATE INDEX IF NOT EXISTS communication_deliveries_dispatch_idx
    ON core.communication_deliveries (dispatch_id);

CREATE INDEX IF NOT EXISTS communication_deliveries_recipient_idx
    ON core.communication_deliveries (organization_id, recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS communication_deliveries_external_idx
    ON core.communication_deliveries (organization_id, channel, external_message_id)
    WHERE external_message_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['communication_dispatches', 'communication_deliveries'] LOOP
        EXECUTE format('ALTER TABLE core.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE core.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS "%s service role only" ON core.%I', t, t);
        EXECUTE format('CREATE POLICY "%s service role only" ON core.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
    END LOOP;
END $$;

INSERT INTO core.permissions (key, description) VALUES
    ('communications.send', 'Send a message to staff over in-app, email, Teams and WhatsApp, and see what was sent and whether it arrived')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.roles r
JOIN (VALUES
    ('Executive (Admin)', 'communications.send'),
    ('Managing Director', 'communications.send'),
    ('HR Manager', 'communications.send'),
    ('Project Manager', 'communications.send')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE r.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
