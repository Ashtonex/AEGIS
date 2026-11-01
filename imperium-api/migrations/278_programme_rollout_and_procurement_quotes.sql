-- ============================================================================
-- Migration 278: programme rollout on mobilisation, requisition amendments,
-- supplier quotation files
-- ============================================================================
-- Schedule activities can now point at the BOQ line they deliver. When a
-- project's mobilisation is authorised, app/services/programme_rollout.py
-- re-baselines the programme to the mobilisation date and turns each week of
-- linked activities into a submitted weekly budget plus Mon-Fri daily targets
-- (generated_by_rollout marks those weeks, so a re-run never duplicates them).
--
-- Requisitions can be amended after they are raised, so the record shows what
-- actually happened; each amendment is counted, stamped and kept in the event
-- trail. A captured supplier quotation can carry the uploaded quote file.

ALTER TABLE projects.project_milestones
    ADD COLUMN IF NOT EXISTS boq_line_item_id uuid REFERENCES finance.boq_line_items(id),
    ADD COLUMN IF NOT EXISTS work_package varchar(40);

CREATE INDEX IF NOT EXISTS idx_project_milestones_boq_line
    ON projects.project_milestones (boq_line_item_id)
    WHERE boq_line_item_id IS NOT NULL;

ALTER TABLE projects.weekly_budgets
    ADD COLUMN IF NOT EXISTS generated_by_rollout boolean NOT NULL DEFAULT false;

ALTER TABLE procurement.purchase_requisitions
    ADD COLUMN IF NOT EXISTS amendment_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_amended_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_amended_by uuid REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS last_amendment_reason text;

ALTER TABLE procurement.rfq_responses
    ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES core.documents(id);
