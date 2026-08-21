-- ============================================================================
-- Link tender requirements to a real, assignable crm.tasks row
-- ============================================================================
-- crm.tender_requirements (099) is a freeform checklist with no assignee, no
-- due date, and no visibility on the Tasks page - it only tracks "is this
-- ticked." This adds an explicit, user-triggered conversion: a requirement
-- can be turned into a crm.tasks row (entity_type='tender') that carries an
-- owner and a due date and shows up grouped under its tender on the Tasks
-- page, same as any other tender task. linked_task_id is the pointer back;
-- NULL means "still just a checklist line," matching satisfied_document_id's
-- (103) same nullable-pointer shape for the document-auto-match case.
-- ============================================================================

ALTER TABLE crm.tender_requirements
    ADD COLUMN IF NOT EXISTS linked_task_id UUID REFERENCES crm.tasks(id);

CREATE INDEX IF NOT EXISTS idx_tender_requirements_linked_task
    ON crm.tender_requirements (linked_task_id) WHERE linked_task_id IS NOT NULL;
