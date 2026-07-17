-- ============================================================================
-- PROJECT IMPERIUM - MIGRATION 006
-- Documents Expansion for CRM tagging and linking
-- ============================================================================

ALTER TABLE core.documents 
    ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'Quotations',
    ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES crm.opportunities(id),
    ADD COLUMN IF NOT EXISTS tender_id UUID REFERENCES crm.tenders(id),
    ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
