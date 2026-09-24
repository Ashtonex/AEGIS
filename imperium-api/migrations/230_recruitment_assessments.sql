-- ============================================================================
-- AEGIS MIGRATION 230 — RECRUITMENT ASSESSMENTS (MICROSOFT FORMS SCORING)
-- ============================================================================
-- Candidates sit the SNC Accounting / Front Desk assessments in Microsoft
-- Forms. HR uploads the Forms "Open in Excel" export; AEGIS scores each
-- response against the answer key held in
-- app/services/hr/recruitment_assessments.py and links it to a candidate
-- in hr.recruitment_candidates (matched by email, created if new).
--
-- One row per Forms response. (organization_id, assessment_code,
-- response_ref) is unique so re-uploading the same export is idempotent.
--
-- Additive only.
-- ============================================================================

ALTER TABLE hr.recruitment_candidates ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE hr.recruitment_candidates ADD COLUMN IF NOT EXISTS phone VARCHAR(60);

CREATE INDEX IF NOT EXISTS recruitment_candidates_email_idx
    ON hr.recruitment_candidates (organization_id, lower(email))
    WHERE is_deleted = false AND email IS NOT NULL;

CREATE TABLE IF NOT EXISTS hr.recruitment_assessments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     UUID NOT NULL REFERENCES core.organizations(id) ON DELETE CASCADE,
    candidate_id        UUID NOT NULL REFERENCES hr.recruitment_candidates(id) ON DELETE CASCADE,
    assessment_code     VARCHAR(60) NOT NULL,
    role_applied_for    VARCHAR(160) NOT NULL,
    response_ref        VARCHAR(120) NOT NULL,
    candidate_name      VARCHAR(255) NOT NULL,
    email               VARCHAR(255),
    phone               VARCHAR(60),
    submitted_at        TIMESTAMPTZ,
    answers             JSONB NOT NULL DEFAULT '{}'::jsonb,
    question_points     JSONB NOT NULL DEFAULT '{}'::jsonb,
    objective_score     NUMERIC(6,2) NOT NULL,
    objective_max       NUMERIC(6,2) NOT NULL,
    dimension_scores    JSONB NOT NULL DEFAULT '{}'::jsonb,
    overall_score       NUMERIC(5,1) NOT NULL,
    unanswered_count    INT NOT NULL DEFAULT 0,
    source_file_name    VARCHAR(255),
    imported_by         UUID REFERENCES core.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_deleted          BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS recruitment_assessments_response_uidx
    ON hr.recruitment_assessments (organization_id, assessment_code, response_ref);
CREATE INDEX IF NOT EXISTS recruitment_assessments_candidate_idx
    ON hr.recruitment_assessments (organization_id, candidate_id, submitted_at DESC)
    WHERE is_deleted = false;

ALTER TABLE hr.recruitment_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.recruitment_assessments FORCE ROW LEVEL SECURITY;
REVOKE ALL ON hr.recruitment_assessments FROM anon, authenticated;
DROP POLICY IF EXISTS "HR operations service role only" ON hr.recruitment_assessments;
CREATE POLICY "HR operations service role only" ON hr.recruitment_assessments
    FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP TRIGGER IF EXISTS trg_audit_recruitment_assessments ON hr.recruitment_assessments;
CREATE TRIGGER trg_audit_recruitment_assessments
    AFTER INSERT OR UPDATE OR DELETE ON hr.recruitment_assessments
    FOR EACH ROW EXECUTE FUNCTION core.process_audit_log();
