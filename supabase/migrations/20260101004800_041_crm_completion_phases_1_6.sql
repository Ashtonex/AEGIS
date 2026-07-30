-- CRM completion phases 1-6: lifecycle schema hardening, marketing, pipeline,
-- quotation handoff, and Customer 360 relationships. No seed/demo records.

ALTER TABLE crm.organizations
    ADD COLUMN IF NOT EXISTS sector VARCHAR(100),
    ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tax_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS total_contract_value NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS risk_rating VARCHAR(50),
    ADD COLUMN IF NOT EXISTS parent_org_id UUID REFERENCES crm.organizations(id);

ALTER TABLE crm.contacts
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS whatsapp_preference BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS linkedin VARCHAR(255);

ALTER TABLE crm.leads
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm.contacts(id),
    ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES crm.opportunities(id),
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS labels TEXT[] NOT NULL DEFAULT '{}'::text[],
    ADD COLUMN IF NOT EXISTS disqualification_reason TEXT,
    ADD COLUMN IF NOT EXISTS expected_close_date DATE,
    ADD COLUMN IF NOT EXISTS campaign_id UUID,
    ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;

ALTER TABLE crm.opportunities
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm.contacts(id),
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS sales_owner_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS expected_close_date DATE,
    ADD COLUMN IF NOT EXISTS deal_value NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS weighted_value NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS next_activity_due_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quote_id UUID,
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects.projects(id),
    ADD COLUMN IF NOT EXISTS win_loss_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS win_loss_reason TEXT,
    ADD COLUMN IF NOT EXISTS competitor VARCHAR(255),
    ADD COLUMN IF NOT EXISTS margin_approval_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS risk_approval_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS approval_status VARCHAR(40) NOT NULL DEFAULT 'not_required',
    ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE finance.quotations
    ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES crm.opportunities(id),
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES crm.contacts(id),
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id);

ALTER TABLE projects.projects
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES crm.opportunities(id),
    ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES finance.quotations(id);

ALTER TABLE crm.activities
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id);

ALTER TABLE crm.communication_events
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS ticket_id UUID;

CREATE TABLE IF NOT EXISTS crm.pipeline_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    name VARCHAR(80) NOT NULL,
    stage_order INTEGER NOT NULL,
    default_probability INTEGER NOT NULL DEFAULT 0 CHECK (default_probability BETWEEN 0 AND 100),
    is_won_stage BOOLEAN NOT NULL DEFAULT false,
    is_lost_stage BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS crm.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    owner_user_id UUID REFERENCES core.users(id),
    name VARCHAR(255) NOT NULL,
    channel VARCHAR(80),
    source VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    budget NUMERIC(15,2),
    starts_on DATE,
    ends_on DATE,
    target_segment_id UUID,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

ALTER TABLE crm.campaigns
    ADD COLUMN IF NOT EXISTS campaign_type VARCHAR(80),
    ADD COLUMN IF NOT EXISTS source_channel VARCHAR(80),
    ADD COLUMN IF NOT EXISTS start_date DATE,
    ADD COLUMN IF NOT EXISTS end_date DATE,
    ADD COLUMN IF NOT EXISTS goals JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS crm.segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    owner_user_id UUID REFERENCES core.users(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    criteria JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'campaigns_target_segment_fk'
          AND conrelid = 'crm.campaigns'::regclass
    ) THEN
        ALTER TABLE crm.campaigns
            ADD CONSTRAINT campaigns_target_segment_fk
            FOREIGN KEY (target_segment_id) REFERENCES crm.segments(id) NOT VALID;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS crm.campaign_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    campaign_id UUID NOT NULL REFERENCES crm.campaigns(id) ON DELETE CASCADE,
    lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
    contact_id UUID REFERENCES crm.contacts(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES crm.opportunities(id) ON DELETE SET NULL,
    member_status VARCHAR(40) NOT NULL DEFAULT 'targeted',
    source VARCHAR(120),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    CHECK (lead_id IS NOT NULL OR contact_id IS NOT NULL OR opportunity_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS crm.message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    owner_user_id UUID REFERENCES core.users(id),
    name VARCHAR(255) NOT NULL,
    channel VARCHAR(40) NOT NULL DEFAULT 'email',
    subject VARCHAR(255),
    body TEXT NOT NULL,
    variables JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.nurture_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    campaign_id UUID REFERENCES crm.campaigns(id) ON DELETE SET NULL,
    segment_id UUID REFERENCES crm.segments(id) ON DELETE SET NULL,
    owner_user_id UUID REFERENCES core.users(id),
    name VARCHAR(255) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'draft',
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    sequence_id UUID NOT NULL REFERENCES crm.nurture_sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    delay_days INTEGER NOT NULL DEFAULT 0 CHECK (delay_days >= 0),
    template_id UUID REFERENCES crm.message_templates(id) ON DELETE SET NULL,
    action_type VARCHAR(80) NOT NULL DEFAULT 'log_message',
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (organization_id, sequence_id, step_order)
);

CREATE TABLE IF NOT EXISTS crm.win_loss_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    reason_type VARCHAR(10) NOT NULL CHECK (reason_type IN ('won', 'lost')),
    label VARCHAR(160) NOT NULL,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    owner_user_id UUID REFERENCES core.users(id),
    client_org_id UUID REFERENCES crm.organizations(id),
    contact_id UUID REFERENCES crm.contacts(id),
    project_id UUID REFERENCES projects.projects(id),
    opportunity_id UUID REFERENCES crm.opportunities(id),
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(40) NOT NULL DEFAULT 'new',
    priority VARCHAR(30) NOT NULL DEFAULT 'normal',
    category VARCHAR(80),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    ticket_id UUID NOT NULL REFERENCES crm.support_tickets(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    visibility VARCHAR(20) NOT NULL DEFAULT 'internal',
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.ticket_sla_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    ticket_id UUID NOT NULL REFERENCES crm.support_tickets(id) ON DELETE CASCADE,
    event_type VARCHAR(60) NOT NULL,
    due_at TIMESTAMPTZ,
    occurred_at TIMESTAMPTZ,
    breached BOOLEAN NOT NULL DEFAULT false,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.automation_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    owner_user_id UUID REFERENCES core.users(id),
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(100) NOT NULL,
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    retry_policy JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS crm.automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id),
    rule_id UUID REFERENCES crm.automation_rules(id) ON DELETE SET NULL,
    trigger_type VARCHAR(100) NOT NULL,
    status VARCHAR(40) NOT NULL DEFAULT 'queued',
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    failure_reason TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS leads_duplicate_email_idx
    ON crm.leads (organization_id, lower(contact_email))
    WHERE contact_email IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS leads_duplicate_phone_idx
    ON crm.leads (organization_id, regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'))
    WHERE contact_phone IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS leads_duplicate_company_idx
    ON crm.leads (organization_id, lower(company_name))
    WHERE company_name IS NOT NULL AND is_deleted = false;
CREATE INDEX IF NOT EXISTS opportunities_client_org_idx
    ON crm.opportunities (organization_id, client_org_id, stage, updated_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS quotations_opportunity_idx
    ON finance.quotations (organization_id, opportunity_id, created_at DESC)
    WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS projects_opportunity_idx
    ON projects.projects (organization_id, opportunity_id)
    WHERE is_deleted = false;

DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'pipeline_stages',
        'campaigns',
        'campaign_members',
        'segments',
        'message_templates',
        'nurture_sequences',
        'sequence_steps',
        'win_loss_reasons',
        'support_tickets',
        'ticket_comments',
        'ticket_sla_events',
        'automation_rules',
        'automation_runs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', table_name);
        EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', table_name);
        EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', 'CRM tenant service role', table_name);
        EXECUTE format(
            'CREATE POLICY %I ON crm.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
            'CRM tenant service role',
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
    ('crm.customer360.read', 'View CRM Customer 360 relationship history'),
    ('crm.marketing.read', 'View CRM campaigns, segments, templates, and attribution'),
    ('crm.marketing.create', 'Create CRM campaigns, campaign members, segments, and templates'),
    ('crm.marketing.update', 'Update CRM campaigns, campaign members, segments, and templates'),
    ('crm.opportunities.close', 'Mark CRM opportunities won or lost'),
    ('crm.opportunities.quote', 'Create CRM quotations from opportunities')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM core.roles r
CROSS JOIN core.permissions p
WHERE r.name = 'SUPERADMIN'
  AND p.key IN (
    'crm.customer360.read',
    'crm.marketing.read',
    'crm.marketing.create',
    'crm.marketing.update',
    'crm.opportunities.close',
    'crm.opportunities.quote'
  )
ON CONFLICT (role_id, permission_id) DO NOTHING;
