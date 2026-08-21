-- ============================================================================
-- Link a CRM task to the quotation it produced
-- ============================================================================
-- Building a BOQ/quotation for a tender/opportunity/lead today means
-- re-finding and re-selecting that record from scratch in the quotation
-- builder, with no record afterward that a given task is what the
-- quotation came from. quotation_id closes that loop: quotations.py writes
-- it once a quotation is saved with a task_id in its create/update payload
-- (task_id itself is never a finance.quotations column - it's popped out of
-- the payload and used only to perform this write), and the Tasks page can
-- then show a direct link to the resulting quotation instead of the task
-- just going quiet.
-- ============================================================================

ALTER TABLE crm.tasks
    ADD COLUMN IF NOT EXISTS quotation_id UUID REFERENCES finance.quotations(id);

CREATE INDEX IF NOT EXISTS idx_crm_tasks_quotation
    ON crm.tasks (quotation_id) WHERE quotation_id IS NOT NULL;
