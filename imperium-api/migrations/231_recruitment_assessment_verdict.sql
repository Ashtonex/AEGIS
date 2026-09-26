-- ============================================================================
-- AEGIS MIGRATION 231 — RECRUITMENT ASSESSMENT VERDICT
-- ============================================================================
-- The 100-mark Accountant assessment is banded by the assessor guide
-- (Strong / Suitable subject to interview / Borderline / Do not progress,
-- plus section minimums) or "Awaiting marking" until the written answers are
-- marked in Forms. Stored per submission alongside the section scores.
--
-- Additive only.
-- ============================================================================

ALTER TABLE hr.recruitment_assessments ADD COLUMN IF NOT EXISTS verdict VARCHAR(160);
