-- ============================================================================
-- AEGIS MIGRATION 229 — BANK & PROJECT MONEY WORKBOOK (EXCEL IN TEAMS, PHASE 1)
-- ============================================================================
-- AEGIS publishes a read-only Excel mirror of the bank statement, its splits
-- / cash uses, per-project money and the books check into the Financial
-- Data Room's SharePoint folder, so it can be pinned as a tab in Teams.
--
-- One row per organisation remembers where the file lives and what was last
-- published (content_signature lets a publish skip the upload when nothing
-- changed). Phase 2 (edits flowing back) will build on the same row.
--
-- Additive only.
-- ============================================================================

CREATE TABLE IF NOT EXISTS finance.bank_workbook_publications (
    organization_id     UUID PRIMARY KEY REFERENCES core.organizations(id) ON DELETE CASCADE,
    file_name           VARCHAR(255) NOT NULL,
    drive_id            TEXT,
    item_id             TEXT,
    web_url             TEXT,
    content_signature   TEXT,
    last_published_at   TIMESTAMPTZ,
    last_attempt_at     TIMESTAMPTZ,
    last_status         VARCHAR(20) NOT NULL DEFAULT 'never'
        CHECK (last_status IN ('never', 'published', 'unchanged', 'failed')),
    last_error          TEXT,
    rows_published      INT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE finance.bank_workbook_publications ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.bank_workbook_publications FORCE ROW LEVEL SECURITY;
REVOKE ALL ON finance.bank_workbook_publications FROM anon, authenticated;
DROP POLICY IF EXISTS "Finance service role only" ON finance.bank_workbook_publications;
CREATE POLICY "Finance service role only" ON finance.bank_workbook_publications
    FOR ALL TO service_role USING (true) WITH CHECK (true);
