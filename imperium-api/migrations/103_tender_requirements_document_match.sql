-- ============================================================================
-- Link tender requirements to the document that satisfied them
-- ============================================================================
-- crm.tender_requirements (099) is a freeform per-tender checklist, satisfied
-- by manual tick-off only. This adds a pointer to the document that actually
-- satisfied a requirement, so uploads matching a requirement's label can
-- auto-tick it instead of requiring a separate manual step, while still
-- leaving satisfied_document_id null for anything ticked off by hand.
-- ============================================================================

ALTER TABLE crm.tender_requirements
    ADD COLUMN IF NOT EXISTS satisfied_document_id UUID REFERENCES core.documents(id);
