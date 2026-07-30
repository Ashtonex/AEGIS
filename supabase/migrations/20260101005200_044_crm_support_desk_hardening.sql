-- ============================================================================
-- CRM Phase 7: support/help desk hardening
-- Escalation tracking and reopen counting on top of the consolidated
-- crm.support_tickets schema. Attachments reuse the existing generic
-- core.document_links (entity_type/entity_id) polymorphic link table rather
-- than adding a new column, so no core.documents change is required.
-- ============================================================================

ALTER TABLE crm.support_tickets
    ADD COLUMN IF NOT EXISTS reopen_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS escalated_to UUID REFERENCES core.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS escalation_reason TEXT;

CREATE INDEX IF NOT EXISTS crm_support_tickets_escalated_idx
    ON crm.support_tickets (organization_id, escalated_at DESC)
    WHERE escalated_at IS NOT NULL AND is_deleted = false;
