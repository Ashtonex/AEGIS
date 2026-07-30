-- ============================================================================
-- CRM lifecycle compatibility completion
-- Additive only: preserves legacy crm.tickets/crm.automations and extends the
-- crm.support_tickets/crm.automation_rules completion layer.
-- ============================================================================

ALTER TABLE crm.campaigns
    ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS source_channel VARCHAR(80),
    ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS metrics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE crm.campaigns
SET campaign_type = COALESCE(campaign_type, type, channel, 'general'),
    source_channel = COALESCE(source_channel, source, channel)
WHERE campaign_type IS NULL OR source_channel IS NULL;

ALTER TABLE crm.segments
    ADD COLUMN IF NOT EXISTS criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS member_count INTEGER NOT NULL DEFAULT 0;

UPDATE crm.segments
SET criteria = COALESCE(criteria, rules, '{}'::jsonb)
WHERE criteria = '{}'::jsonb AND rules IS NOT NULL;

ALTER TABLE crm.campaign_members
    ADD COLUMN IF NOT EXISTS segment_id UUID REFERENCES crm.segments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS engagement_score INTEGER CHECK (engagement_score IS NULL OR (engagement_score >= 0 AND engagement_score <= 100)),
    ADD COLUMN IF NOT EXISTS added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE crm.campaign_members
SET status = COALESCE(status, member_status, 'targeted')
WHERE status IS NULL;

ALTER TABLE crm.message_templates
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE crm.sequence_steps
    ADD COLUMN IF NOT EXISTS action_config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE crm.win_loss_reasons
    ADD COLUMN IF NOT EXISTS name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS description TEXT,
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE crm.win_loss_reasons
SET name = COALESCE(name, label)
WHERE name IS NULL;

ALTER TABLE crm.support_tickets
    ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS organization_account_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS first_response_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolution_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS first_responded_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS satisfaction_score NUMERIC(5,2),
    ADD COLUMN IF NOT EXISTS satisfaction_comment TEXT;

UPDATE crm.support_tickets
SET organization_account_id = COALESCE(organization_account_id, client_org_id),
    assigned_to = COALESCE(assigned_to, owner_user_id)
WHERE organization_account_id IS NULL OR assigned_to IS NULL;

ALTER TABLE crm.ticket_sla_events
    ADD COLUMN IF NOT EXISTS details JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE crm.automation_runs
    ADD COLUMN IF NOT EXISTS trigger_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS action_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS automation_id UUID REFERENCES crm.automation_rules(id) ON DELETE SET NULL;

UPDATE crm.automation_runs
SET trigger_payload = COALESCE(trigger_payload, input_payload, '{}'::jsonb),
    action_result = COALESCE(action_result, output_payload, '{}'::jsonb),
    automation_id = COALESCE(automation_id, rule_id)
WHERE trigger_payload = '{}'::jsonb
   OR action_result = '{}'::jsonb
   OR automation_id IS NULL;

ALTER TABLE crm.communication_events
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES crm.message_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS crm_support_tickets_lifecycle_idx
    ON crm.support_tickets (organization_id, status, priority, resolution_due_at)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS crm_campaigns_lifecycle_idx
    ON crm.campaigns (organization_id, status, updated_at DESC)
    WHERE is_deleted = false;

INSERT INTO core.permissions (key, description)
VALUES
    ('crm.campaigns.read', 'Read CRM marketing campaigns'),
    ('crm.campaigns.create', 'Create CRM marketing campaigns'),
    ('crm.campaigns.update', 'Update CRM marketing campaigns'),
    ('crm.campaigns.delete', 'Delete CRM marketing campaigns'),
    ('crm.segments.read', 'Read CRM marketing segments'),
    ('crm.segments.create', 'Create CRM marketing segments'),
    ('crm.segments.update', 'Update CRM marketing segments'),
    ('crm.templates.read', 'Read CRM message templates'),
    ('crm.templates.create', 'Create CRM message templates'),
    ('crm.templates.update', 'Update CRM message templates'),
    ('crm.support.read', 'Read CRM support tickets and comments'),
    ('crm.support.create', 'Create CRM support tickets and comments'),
    ('crm.support.update', 'Update CRM support ticket lifecycle'),
    ('crm.automations.execute', 'Execute CRM automation rules'),
    ('crm.reports.read', 'Read CRM lifecycle reports'),
    ('crm.customer360.read', 'View CRM Customer 360 relationship history'),
    ('crm.opportunities.read', 'Read CRM opportunities'),
    ('crm.opportunities.update', 'Update CRM opportunities'),
    ('crm.import', 'Import CRM data'),
    ('crm.export', 'Export CRM data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.name = 'SUPERADMIN'
  AND p.key IN (
    'crm.campaigns.read',
    'crm.campaigns.create',
    'crm.campaigns.update',
    'crm.campaigns.delete',
    'crm.segments.read',
    'crm.segments.create',
    'crm.segments.update',
    'crm.templates.read',
    'crm.templates.create',
    'crm.templates.update',
    'crm.support.read',
    'crm.support.create',
    'crm.support.update',
    'crm.automations.execute',
    'crm.reports.read',
    'crm.customer360.read',
    'crm.opportunities.read',
    'crm.opportunities.update',
    'crm.import',
    'crm.export'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
