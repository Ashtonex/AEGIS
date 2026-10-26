-- MANUAL DATA CORRECTION - NOT AUTO-APPLIED, NOT YET RUN.
-- Needs a Finance decision (DEC-002 in SYSTEM_REPAIR_REGISTER.md) on which
-- budget version each project should return to before it is executed.
--
-- Cause (REG-001): marking an unpriced quotation won/linked seeded an
-- approved $0.00 budget that superseded the project's real budget and its
-- active BOQ lines. Fixed in code; these four projects still carry the
-- result as of 2026-10-26:
--
--   project                               current approved (bad)        last non-zero version before it
--   Troutbeck - Timeshares Units 9-12     v15 $0 (602beea4, 2026-10-22)  v13 $180,560.36 seeded from fe46f2cf (1 line)
--   (TBTS4)                                                              v11 $204,686.57 "Protected master budget baseline" (7 lines)
--   Trout Beck entrance road Earth wall   v2  $0 (368f77c2, 2026-10-14)  v1  $6,185.50  "Execution budget review" (7 lines)
--   Berry Armstrong - Roofing Repairs     v2  $0 (b6510122, 2026-10-14)  v1  $11,607.79 "Protected master budget baseline" (0 lines)
--   Muchabayawi - Contract Opportunity    v1  $0 (97d1c1db, 2026-10-14)  none - needs a priced quotation or a Finance-set budget
--
-- History is kept: the $0 version is marked 'cancelled' (not deleted) and
-- the chosen earlier version is re-approved. The partial unique index
-- project_budgets_single_approved guarantees one approved budget per
-- project. Replace the :restore_* placeholders with the agreed versions.

BEGIN;

-- 1. Retire the $0 budgets created from unpriced quotations.
UPDATE finance.project_budgets b
SET status = 'cancelled',
    notes = COALESCE(b.notes || E'\n', '') || 'Cancelled 2026-10-26: $0 budget seeded from an unpriced quotation (REG-001).',
    updated_at = NOW()
WHERE b.status = 'approved' AND b.is_deleted = false AND b.total_amount = 0
  AND b.label LIKE 'Seeded from accepted quotation %';

-- 2. Re-approve the agreed earlier version per project (Finance to confirm).
-- UPDATE finance.project_budgets SET status = 'approved', updated_at = NOW()
-- WHERE project_id = '6c74b142-1204-4d49-a95c-43d760f043bf' AND budget_version = :restore_tbts4;      -- 11 or 13
-- UPDATE finance.project_budgets SET status = 'approved', updated_at = NOW()
-- WHERE project_id = (SELECT id FROM projects.projects WHERE name = 'Trout Beck entrance road Earth wall') AND budget_version = 1;
-- UPDATE finance.project_budgets SET status = 'approved', updated_at = NOW()
-- WHERE project_id = (SELECT id FROM projects.projects WHERE name = 'Berry Armstrong - Roofing Repairs') AND budget_version = 1;

-- 3. TBTS4's 100 BOQ lines from quotation fe46f2cf were superseded by the
--    602beea4 win (which had no lines). Reactivate the latest set if Finance
--    restores the fe46f2cf-based budget:
-- UPDATE finance.boq_line_items SET status = 'active', updated_at = NOW()
-- WHERE project_id = '6c74b142-1204-4d49-a95c-43d760f043bf'
--   AND source_quotation_id = 'fe46f2cf-b787-4fc5-bf15-428ff17c81e4'
--   AND status = 'superseded'
--   AND created_at = (SELECT max(created_at) FROM finance.boq_line_items
--                     WHERE project_id = '6c74b142-1204-4d49-a95c-43d760f043bf'
--                       AND source_quotation_id = 'fe46f2cf-b787-4fc5-bf15-428ff17c81e4');

-- Check before COMMIT: exactly one approved budget per affected project, none at $0.
SELECT p.name, b.budget_version, b.status, b.total_amount
FROM finance.project_budgets b JOIN projects.projects p ON p.id = b.project_id
WHERE b.status = 'approved' AND p.name IN (
  'Troutbeck - Timeshares Units 9-12', 'Trout Beck entrance road Earth wall',
  'Berry Armstrong - Roofing Repairs', 'Muchabayawi - Contract Opportunity');

ROLLBACK;  -- change to COMMIT only after Finance signs off the versions above
