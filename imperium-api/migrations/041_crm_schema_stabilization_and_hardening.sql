-- ============================================================================
-- PROJECT IMPERIUM - MIGRATION 041
-- CRM Schema Stabilization & Hardening
-- ============================================================================

-- 1. CONDITIONAL RENAME OF EXISTING TABLES
DO $$
BEGIN
    -- Rename crm.tickets to crm.support_tickets if crm.tickets exists and crm.support_tickets does not
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'tickets') AND
       NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'support_tickets') THEN
        ALTER TABLE crm.tickets RENAME TO support_tickets;
    END IF;

    -- Rename crm.automations to crm.automation_rules if crm.automations exists and crm.automation_rules does not
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'automations') AND
       NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'crm' AND table_name = 'automation_rules') THEN
        ALTER TABLE crm.automations RENAME TO automation_rules;
    END IF;
END $$;

-- Clean up any existing trigger and policy names for renamed tables to avoid conflicts
DROP TRIGGER IF EXISTS trg_audit_tickets ON crm.support_tickets;
DROP TRIGGER IF EXISTS trg_audit_automations ON crm.automation_rules;
DROP POLICY IF EXISTS "Tenant Isolation Policy" ON crm.support_tickets;
DROP POLICY IF EXISTS "Tenant Isolation Policy" ON crm.automation_rules;

-- 2. ALTER EXISTING TABLES TO ENSURE CONSISTENT COLUMNS (owner_user_id and other required fields)
ALTER TABLE crm.organizations ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.contacts ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.leads ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.opportunities ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.activities ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.communication_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.support_tickets ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;
ALTER TABLE crm.automation_rules ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL;

-- Ensure columns exist for tables that might have been created by other steps
ALTER TABLE crm.campaigns ADD COLUMN IF NOT EXISTS type VARCHAR(100);
ALTER TABLE crm.campaigns ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(15,2);
ALTER TABLE crm.campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE crm.campaigns ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

ALTER TABLE crm.campaign_members ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Added';

ALTER TABLE crm.segments ADD COLUMN IF NOT EXISTS rules JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE crm.message_templates ADD COLUMN IF NOT EXISTS subject VARCHAR(255);

ALTER TABLE crm.win_loss_reasons ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES crm.opportunities(id) ON DELETE SET NULL;
ALTER TABLE crm.win_loss_reasons ADD COLUMN IF NOT EXISTS reason VARCHAR(255);
ALTER TABLE crm.win_loss_reasons ADD COLUMN IF NOT EXISTS category VARCHAR(100);
ALTER TABLE crm.win_loss_reasons ADD COLUMN IF NOT EXISTS notes TEXT;

-- Initialize owner_user_id where applicable
UPDATE crm.leads SET owner_user_id = assigned_to WHERE owner_user_id IS NULL AND assigned_to IS NOT NULL;
UPDATE crm.communication_events SET owner_user_id = actor_user_id WHERE owner_user_id IS NULL AND actor_user_id IS NOT NULL;

-- 3. CREATE MISSING CRM TABLES

-- crm.campaigns
CREATE TABLE IF NOT EXISTS crm.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100), -- Email, SMS, WhatsApp, Cold Call, Event
    status VARCHAR(50) DEFAULT 'Draft', -- Draft, Active, Completed, Cancelled
    budget NUMERIC(15,2),
    actual_cost NUMERIC(15,2),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.campaign_members
CREATE TABLE IF NOT EXISTS crm.campaign_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    campaign_id UUID NOT NULL REFERENCES crm.campaigns(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES crm.contacts(id) ON DELETE SET NULL,
    lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'Added', -- Added, Contacted, Responded, Bounced
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.ticket_comments
CREATE TABLE IF NOT EXISTS crm.ticket_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    ticket_id UUID NOT NULL REFERENCES crm.support_tickets(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    is_internal BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.ticket_sla_events
CREATE TABLE IF NOT EXISTS crm.ticket_sla_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    ticket_id UUID NOT NULL REFERENCES crm.support_tickets(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL, -- ResponseDeadline, ResolutionDeadline, Warning, Breached
    deadline TIMESTAMPTZ NOT NULL,
    triggered_at TIMESTAMPTZ,
    status VARCHAR(50) DEFAULT 'Active', -- Active, Completed, Breached
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.automation_runs
CREATE TABLE IF NOT EXISTS crm.automation_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    rule_id UUID NOT NULL REFERENCES crm.automation_rules(id) ON DELETE CASCADE,
    triggering_record_id UUID,
    status VARCHAR(50) NOT NULL DEFAULT 'Success', -- Success, Failed
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.segments
CREATE TABLE IF NOT EXISTS crm.segments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    rules JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.message_templates
CREATE TABLE IF NOT EXISTS crm.message_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    name VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    body TEXT NOT NULL,
    channel VARCHAR(32) NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- crm.win_loss_reasons
CREATE TABLE IF NOT EXISTS crm.win_loss_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    owner_user_id UUID REFERENCES core.users(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES crm.opportunities(id) ON DELETE SET NULL,
    reason VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- Price, Competitor, Capability, Relationship, Timing, Other
    notes TEXT,
    created_by UUID REFERENCES core.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

-- 4. APPLY ROW LEVEL SECURITY AND AUDIT TRIGGERS
DO $$ 
DECLARE
    t_name text;
    s_name text = 'crm';
BEGIN
    -- Enable RLS and bind audit trigger on all crm tables (both existing renamed/altered ones and new ones)
    FOR t_name IN 
        VALUES 
            ('organizations'),
            ('contacts'),
            ('leads'),
            ('opportunities'),
            ('activities'),
            ('communication_events'),
            ('support_tickets'),
            ('automation_rules'),
            ('campaigns'),
            ('campaign_members'),
            ('ticket_comments'),
            ('ticket_sla_events'),
            ('automation_runs'),
            ('segments'),
            ('message_templates'),
            ('win_loss_reasons')
    LOOP
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', s_name, t_name);
        EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY;', s_name, t_name);
        
        EXECUTE format('DROP TRIGGER IF EXISTS trg_audit_%I ON %I.%I;', t_name, s_name, t_name);
        EXECUTE format('
            CREATE TRIGGER trg_audit_%I
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
        ', t_name, s_name, t_name);

        EXECUTE format('DROP POLICY IF EXISTS "Tenant Isolation Policy" ON %I.%I;', s_name, t_name);
        EXECUTE format('
            CREATE POLICY "Tenant Isolation Policy" ON %I.%I
            FOR ALL
            USING (
                organization_id = get_jwt_org_id() 
                OR 
                current_setting(''role'') = ''service_role''
            );
        ', s_name, t_name);
    END LOOP;
END $$;
