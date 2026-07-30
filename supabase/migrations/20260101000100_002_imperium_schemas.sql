-- ============================================================================
-- PROJECT IMPERIUM - MULTI-SCHEMA ARCHITECTURE & MODULES 07/08
-- Migration: 002_imperium_schemas.sql
-- ============================================================================

-- 1. CREATE SCHEMAS
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS crm;
CREATE SCHEMA IF NOT EXISTS projects;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS procurement;
CREATE SCHEMA IF NOT EXISTS fleet;
CREATE SCHEMA IF NOT EXISTS hr;
CREATE SCHEMA IF NOT EXISTS executive;

-- 2. MOVE EXISTING TABLES TO SCHEMAS
-- Core
ALTER TABLE public.organizations SET SCHEMA core;
ALTER TABLE public.users SET SCHEMA core;
ALTER TABLE public.roles SET SCHEMA core;
ALTER TABLE public.permissions SET SCHEMA core;
ALTER TABLE public.role_permissions SET SCHEMA core;
ALTER TABLE public.user_roles SET SCHEMA core;
ALTER TABLE public.audit_log SET SCHEMA core;
ALTER TABLE public.system_modules SET SCHEMA core;
ALTER TABLE public.notifications SET SCHEMA core;
ALTER TABLE public.file_attachments SET SCHEMA core;
ALTER TABLE public.compliance_items SET SCHEMA core;
ALTER TABLE public.documents SET SCHEMA core;
ALTER TABLE public.internal_messages SET SCHEMA core;

-- Projects
ALTER TABLE public.projects SET SCHEMA projects;
ALTER TABLE public.site_operations SET SCHEMA projects;
ALTER TABLE public.hse_incidents SET SCHEMA projects;

-- HR
ALTER TABLE public.workforce SET SCHEMA hr;
ALTER TABLE hr.workforce RENAME TO employees;
ALTER TABLE public.hr_records SET SCHEMA hr;
ALTER TABLE hr.hr_records RENAME TO records;

-- Fleet & Equipment
ALTER TABLE public.fleet SET SCHEMA fleet;
ALTER TABLE public.equipment_assets SET SCHEMA fleet;
ALTER TABLE public.maintenance_schedules SET SCHEMA fleet;

-- Procurement
ALTER TABLE public.procurement_orders SET SCHEMA procurement;
ALTER TABLE public.inventory_items SET SCHEMA procurement;
ALTER TABLE public.supplier_records SET SCHEMA procurement;
ALTER TABLE procurement.supplier_records RENAME TO suppliers;

-- Finance
ALTER TABLE public.budgets SET SCHEMA finance;
ALTER TABLE public.financial_performance SET SCHEMA finance;
ALTER TABLE public.quotations SET SCHEMA finance;

-- Executive
ALTER TABLE public.kpi_metrics SET SCHEMA executive;
ALTER TABLE public.bi_reports SET SCHEMA executive;
ALTER TABLE public.risk_register SET SCHEMA executive;
ALTER TABLE public.automated_reports SET SCHEMA executive;

-- CRM
ALTER TABLE public.crm_contacts SET SCHEMA crm;
ALTER TABLE crm.crm_contacts RENAME TO contacts;
ALTER TABLE public.crm_leads SET SCHEMA crm;
ALTER TABLE crm.crm_leads RENAME TO leads;
ALTER TABLE public.client_portal_tickets SET SCHEMA crm;
ALTER TABLE crm.client_portal_tickets RENAME TO tickets;
ALTER TABLE public.tender_bids SET SCHEMA crm;
ALTER TABLE crm.tender_bids RENAME TO tenders;
ALTER TABLE public.website_enquiries SET SCHEMA crm;

-- 3. UPDATE AUDIT LOG TRIGGER
-- Drop the old trigger function from public and recreate in core
DROP FUNCTION IF EXISTS public.process_audit_log CASCADE;

CREATE OR REPLACE FUNCTION core.process_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    current_user_id UUID;
BEGIN
    BEGIN
        current_user_id := (current_setting('request.jwt.claim.sub', true))::uuid;
    EXCEPTION WHEN OTHERS THEN
        current_user_id := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, OLD.id, 'DELETE', row_to_json(OLD)::jsonb, current_user_id);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, old_data, new_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'UPDATE', row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    ELSIF (TG_OP = 'INSERT') THEN
        INSERT INTO core.audit_log (table_name, record_id, action, new_data, created_by)
        VALUES (TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME, NEW.id, 'INSERT', row_to_json(NEW)::jsonb, current_user_id);
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Reapply triggers for all tables across all relevant schemas
DO $$ 
DECLARE
    t_name text;
    s_name text;
BEGIN
    FOR s_name, t_name IN 
        SELECT table_schema, table_name FROM information_schema.tables 
        WHERE table_schema IN ('core', 'crm', 'projects', 'finance', 'procurement', 'fleet', 'hr', 'executive')
        AND table_name != 'audit_log'
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_audit_%I
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
        ', t_name, s_name, t_name);
    END LOOP;
END $$;

-- 4. NEW CRM TABLES

CREATE TABLE crm.opportunities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    client_id UUID REFERENCES crm.contacts(id),
    name VARCHAR(255) NOT NULL,
    stage VARCHAR(50) DEFAULT 'Inquiry', -- Inquiry, Qualification, Site Visit, Quotation, Negotiation, Contract
    budget NUMERIC(15,2),
    probability INTEGER DEFAULT 0,
    expected_margin NUMERIC(5,2),
    risk_level VARCHAR(50),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE crm.subcontractors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    name VARCHAR(255) NOT NULL,
    capability_tags TEXT[], -- array of trades/scopes
    compliance_status VARCHAR(50), -- Compliant, Non-Compliant, Pending
    nssa_number VARCHAR(100),
    praz_number VARCHAR(100),
    reliability_score INTEGER DEFAULT 0,
    authorization_tier INTEGER DEFAULT 1, -- Tier required to engage
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE crm.interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    contact_id UUID REFERENCES crm.contacts(id),
    opportunity_id UUID REFERENCES crm.opportunities(id),
    type VARCHAR(50) NOT NULL, -- Call, Meeting, WhatsApp, Email, Site Visit
    notes TEXT,
    interaction_date TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES core.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT FALSE
);

CREATE TABLE crm.accountability_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    metric_name VARCHAR(100) NOT NULL, -- LVR, Bid-to-Win, Client Diversification, PRAZ Conversion
    target_value NUMERIC(15,2) NOT NULL,
    current_value NUMERIC(15,2) DEFAULT 0,
    period VARCHAR(50) DEFAULT 'monthly',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Note: We renamed tender_bids to crm.tenders above. Let's add columns to support the new lifecycle.
ALTER TABLE crm.tenders
ADD COLUMN stage VARCHAR(50) DEFAULT 'Tender Identified', -- IDD, Bid Prep, Submitted, Adjudication, Awarded/Lost
ADD COLUMN submission_deadline TIMESTAMPTZ,
ADD COLUMN bid_bond_secured BOOLEAN DEFAULT FALSE;

-- 5. NEW EXECUTIVE TABLES

CREATE TABLE executive.dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    user_id UUID REFERENCES core.users(id),
    layout JSONB, -- stores widget configuration
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE executive.kpi_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core.organizations(id),
    cash_survival_days INTEGER,
    revenue_concentration_percent NUMERIC(5,2),
    active_projects_count INTEGER,
    documented_workflow_percent NUMERIC(5,2),
    snapshot_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. APPLY RLS AND AUDIT TRIGGERS TO NEW TABLES

DO $$ 
DECLARE
    t_name text;
    s_name text;
BEGIN
    FOR s_name, t_name IN 
        SELECT table_schema, table_name FROM information_schema.tables 
        WHERE table_schema IN ('crm', 'executive')
        AND table_name IN ('opportunities', 'subcontractors', 'interactions', 'accountability_targets', 'dashboards', 'kpi_snapshots')
    LOOP
        EXECUTE format('
            CREATE TRIGGER trg_audit_%I
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
        ', t_name, s_name, t_name);
        
        EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY;', s_name, t_name);
    END LOOP;
END $$;

-- 7. REAPPLY TENANT ISOLATION POLICY TO ALL MOVED AND NEW TABLES
-- Since schema moved, RLS policies stay with the table, but let's ensure new tables have them.
DO $$ 
DECLARE
    t_name text;
    s_name text;
BEGIN
    FOR s_name, t_name IN 
        SELECT table_schema, table_name FROM information_schema.columns 
        WHERE table_schema IN ('core', 'crm', 'projects', 'finance', 'procurement', 'fleet', 'hr', 'executive')
        AND column_name = 'organization_id'
        AND table_name IN ('opportunities', 'subcontractors', 'interactions', 'accountability_targets', 'dashboards', 'kpi_snapshots')
    LOOP
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
