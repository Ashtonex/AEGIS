-- ============================================================================
-- CCB weekly BOQ pace-variance check (Phase 5) — extends
-- finance.ccb_monitor_findings with a new automated check_type that compares
-- a weekly_budget_item's planned quantity against BOQ measurements actually
-- approved during that same week, and against whether any daily site report
-- exists as supporting evidence. Closes the gap flagged in the Executive
-- Command Centre review: weekly plans (projects.weekly_budget_items) and
-- measured BOQ progress (finance.boq_measurement_entries) both already exist
-- and are both dated, but nothing cross-checked one against the other.
-- ============================================================================

ALTER TABLE finance.ccb_monitor_findings
    DROP CONSTRAINT IF EXISTS ccb_monitor_findings_check_type_check;

ALTER TABLE finance.ccb_monitor_findings
    ADD CONSTRAINT ccb_monitor_findings_check_type_check
    CHECK (check_type IN (
        'budget_boq_overrun',
        'requisition_budget_breach',
        'variance_stale_approval',
        'weekly_boq_pace_variance'
    ));
