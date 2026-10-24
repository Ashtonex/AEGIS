-- ============================================================================
-- Migration 272: core.documents.status
-- ============================================================================
-- PATCH /api/v1/documents/{id}/status (routers/documents.py) and the frontend's
-- updateDocumentStatus() write core.documents.status, but the column was never
-- created, so every status change failed with "column status does not exist"
-- (found by scripts/sql_explain_check.py). Free text up to 40 chars, matching
-- the endpoint's StatusUpdate model.
-- ============================================================================

ALTER TABLE core.documents
    ADD COLUMN IF NOT EXISTS status VARCHAR(40);
