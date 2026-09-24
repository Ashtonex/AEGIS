-- ============================================================================
-- AEGIS MIGRATION 230 — BANK & PROJECT MONEY WORKBOOK: EDITS FLOW BACK (PHASE 2)
-- ============================================================================
-- The Teams workbook's Category / Project / Who / Note columns become
-- editable. A sync cycle reads the file when SharePoint says it changed,
-- applies edits through the normal tagging path, then republishes with a
-- Sync status column - uploading only if the file is still the version it
-- read (If-Match on the eTag), so a concurrent Excel edit is never
-- overwritten.
--
--   published_etag     eTag of the version AEGIS last uploaded (or last
--                      read with nothing to apply) - equal eTag = no edits
--   published_snapshot what AEGIS last put in the editable columns, per line
--                      - the baseline an Excel edit is detected against
--   sync_lease_until   one sync at a time per organisation (cron + the
--                      debounced after-change job can overlap)
--
-- finance.bank_workbook_changes is the audit trail of every edit read back
-- from Excel (applied / rejected / conflict) and feeds the Sync status column.
--
-- Additive only (plus widening one CHECK constraint).
-- ============================================================================

ALTER TABLE finance.bank_workbook_publications
    ADD COLUMN IF NOT EXISTS published_etag     TEXT,
    ADD COLUMN IF NOT EXISTS published_snapshot JSONB,
    ADD COLUMN IF NOT EXISTS sync_lease_until   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_read_at       TIMESTAMPTZ;

ALTER TABLE finance.bank_workbook_publications DROP CONSTRAINT IF EXISTS bank_workbook_publications_last_status_check;
ALTER TABLE finance.bank_workbook_publications ADD CONSTRAINT bank_workbook_publications_last_status_check
    CHECK (last_status IN ('never', 'published', 'unchanged', 'failed', 'retry'));

CREATE TABLE IF NOT EXISTS finance.bank_workbook_changes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    line_id             UUID NOT NULL REFERENCES finance.bank_statement_lines(id) ON DELETE CASCADE,
    field               VARCHAR(40) NOT NULL,
    old_value           TEXT,
    new_value           TEXT,
    outcome             VARCHAR(20) NOT NULL CHECK (outcome IN ('applied', 'rejected', 'conflict')),
    message             TEXT,
    edited_by_name      TEXT,
    edited_by_user_id   UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS bank_workbook_changes_org_created_idx
    ON finance.bank_workbook_changes (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bank_workbook_changes_line_idx
    ON finance.bank_workbook_changes (line_id, created_at DESC);

ALTER TABLE finance.bank_workbook_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_workbook_changes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_workbook_changes FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_workbook_changes;
CREATE POLICY "Finance service role only" ON finance.bank_workbook_changes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
