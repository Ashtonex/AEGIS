-- ============================================================================
-- AEGIS MIGRATION 225 — CCB BASELINE REVIEW-BEFORE-COMMIT
-- ============================================================================
-- POST /quotations/intelligence/evaluate (and the autonomous draft-quote
-- generator) used to persist a finance.project_commercial_baselines row on
-- every single call, with no review step - re-selecting a quotation in the
-- CCB portal, or just re-running an evaluation while tuning inputs, silently
-- wrote a new "official" baseline every time (see migration 224's sibling
-- fix in routers/quotations.py, which also stopped one of those baselines
-- from clobbering projects.projects.contract_value).
--
-- This migration adds the columns the new explicit commit step needs:
--   - calculated_target_selling_price: what QuotationBrain actually computed,
--     preserved even when a human overrides the figure - never silently lost.
--   - is_overridden / override_reason: whether a human adjusted the figure
--     before committing, and why. This is the "CCB keeps learning" trail -
--     a real, auditable record of where the algorithm's number and a human's
--     judgment diverged, and by how much, for later review/tuning.
--   - committed_by / committed_at: who actually approved this baseline as
--     official, not just whoever happened to trigger a preview calculation.
--
-- target_selling_price itself keeps its existing meaning (the FINAL, in-
-- effect figure - the override when one was given, otherwise the calculated
-- value) so every existing reader of this table keeps working unchanged.
-- ============================================================================

ALTER TABLE finance.project_commercial_baselines
    ADD COLUMN IF NOT EXISTS calculated_target_selling_price NUMERIC(14, 2),
    ADD COLUMN IF NOT EXISTS is_overridden BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS override_reason TEXT,
    ADD COLUMN IF NOT EXISTS committed_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ;

-- Backfill existing rows (all auto-persisted, pre-review-gate) so the new
-- "calculated vs final" columns are never blank for historical data.
UPDATE finance.project_commercial_baselines
SET calculated_target_selling_price = target_selling_price,
    committed_at = created_at
WHERE calculated_target_selling_price IS NULL;

ALTER TABLE finance.project_commercial_baselines
    ALTER COLUMN committed_at SET DEFAULT NOW(),
    ALTER COLUMN committed_at SET NOT NULL;

INSERT INTO core.permissions (key, description) VALUES
    ('quotations.commit_baseline', 'Commit a reviewed (optionally human-overridden) CCB commercial baseline as the official record for a quotation')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('Executive (Admin)',    'quotations.commit_baseline'),
    ('Finance Manager',      'quotations.commit_baseline'),
    ('Quantity Surveyor',    'quotations.commit_baseline')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
