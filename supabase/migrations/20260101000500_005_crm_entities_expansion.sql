-- ============================================================================
-- PROJECT IMPERIUM - MIGRATION 005
-- CRM Entities Expansion (Organizations, Contacts, Activities, Automations)
-- ============================================================================

-- 1. CREATE crm.organizations TABLE
CREATE TABLE IF NOT EXISTS crm.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id) NOT NULL,
    name VARCHAR(255) NOT NULL,
    industry VARCHAR(100),
    website VARCHAR(255),
    phone VARCHAR(50),
    email VARCHAR(255),
    address TEXT,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 2. ALTER crm.contacts TABLE
ALTER TABLE crm.contacts 
    ADD COLUMN IF NOT EXISTS client_org_id UUID REFERENCES crm.organizations(id),
    ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS job_title VARCHAR(100);

-- 3. CREATE crm.activities TABLE
CREATE TABLE IF NOT EXISTS crm.activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id) NOT NULL,
    contact_id UUID REFERENCES crm.contacts(id),
    lead_id UUID REFERENCES crm.leads(id),
    opportunity_id UUID REFERENCES crm.opportunities(id),
    type VARCHAR(50) NOT NULL, -- Call, Meeting, Email, Task, Note
    subject VARCHAR(255) NOT NULL,
    description TEXT,
    activity_date TIMESTAMPTZ DEFAULT NOW(),
    status VARCHAR(50) DEFAULT 'Completed', -- Completed, Pending
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 4. CREATE crm.automations TABLE
CREATE TABLE IF NOT EXISTS crm.automations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id) NOT NULL,
    name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(100) NOT NULL, -- lead_score_above, bid_deadline_less_than
    trigger_conditions JSONB, -- { "field": "ai_score", "operator": ">", "value": 80 }
    action_type VARCHAR(100) NOT NULL, -- send_notification, create_opportunity, log_activity
    action_config JSONB, -- { "message": "...", "recipient": "..." }
    is_active BOOLEAN DEFAULT TRUE,
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

-- 5. ENABLE ROW LEVEL SECURITY
ALTER TABLE crm.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.automations ENABLE ROW LEVEL SECURITY;

-- 6. APPLY TENANT ISOLATION POLICY
CREATE POLICY "Tenant Isolation Policy" ON crm.organizations
FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');

CREATE POLICY "Tenant Isolation Policy" ON crm.activities
FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');

CREATE POLICY "Tenant Isolation Policy" ON crm.automations
FOR ALL USING (organization_id = get_jwt_org_id() OR current_setting('role') = 'service_role');

-- 7. REAPPLY AUDIT TRIGGERS
CREATE TRIGGER trg_audit_organizations
AFTER INSERT OR UPDATE OR DELETE ON crm.organizations
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

CREATE TRIGGER trg_audit_activities
AFTER INSERT OR UPDATE OR DELETE ON crm.activities
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();

CREATE TRIGGER trg_audit_automations
AFTER INSERT OR UPDATE OR DELETE ON crm.automations
FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
