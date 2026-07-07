-- ============================================================================
-- PROJECT IMPERIUM - MIGRATION 003
-- AI-Driven CRM Leads Engine Expansion
-- ============================================================================

-- Expand crm.leads to hold ML telemetry and contact data
ALTER TABLE crm.leads 
    ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50),
    ADD COLUMN IF NOT EXISTS sector VARCHAR(100),
    ADD COLUMN IF NOT EXISTS estimated_budget NUMERIC(15,2),
    ADD COLUMN IF NOT EXISTS ai_score INTEGER CHECK (ai_score >= 0 AND ai_score <= 100),
    ADD COLUMN IF NOT EXISTS ai_rationale TEXT;

-- Drop and recreate the audit trigger for the renamed table if necessary, 
-- but since it uses the same table ID, Supabase handles it.

-- Insert some dummy leads for testing the Intelligence Grid
INSERT INTO crm.leads (organization_id, lead_source, status, company_name, contact_name, sector, estimated_budget, ai_score, ai_rationale)
SELECT 
    (SELECT id FROM core.organizations LIMIT 1),
    'Government Gazette', 'New', 'Ministry of Transport', 'Dir. of Roads', 'Government', 15000000.00, 92, 'High historical win-rate in Government sector. Budget matches heavy-equipment capability.'
WHERE EXISTS (SELECT 1 FROM core.organizations);

INSERT INTO crm.leads (organization_id, lead_source, status, company_name, contact_name, sector, estimated_budget, ai_score, ai_rationale)
SELECT 
    (SELECT id FROM core.organizations LIMIT 1),
    'Website Enquiry', 'New', 'Zimplats', 'Procurement Manager', 'Mining', 450000.00, 85, 'Mining sector has fast payment terms. High propensity to convert.'
WHERE EXISTS (SELECT 1 FROM core.organizations);

INSERT INTO crm.leads (organization_id, lead_source, status, company_name, contact_name, sector, estimated_budget, ai_score, ai_rationale)
SELECT 
    (SELECT id FROM core.organizations LIMIT 1),
    'Manual Entry', 'New', 'Local Supermarket Chain', 'Facilities Manager', 'Commercial', 25000.00, 31, 'Low margin, low budget. Deprioritized based on opportunity cost.'
WHERE EXISTS (SELECT 1 FROM core.organizations);
