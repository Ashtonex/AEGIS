-- ============================================================================
-- Department tagging for CRM leads
-- ============================================================================
-- crm.opportunities/finance.quotations/projects.projects already carry
-- originating_department_id (077/078_finance_department_transfers.sql) - leads
-- never got the same column, so Plant & Equipment (or any department) has no
-- way to be attributed as the source of a lead before it's qualified into an
-- opportunity. Nullable, same as every other department_id/originating_
-- department_id column in this schema - untagged leads are unaffected.
-- ============================================================================

ALTER TABLE crm.leads
    ADD COLUMN IF NOT EXISTS originating_department_id UUID REFERENCES finance.departments(id);
