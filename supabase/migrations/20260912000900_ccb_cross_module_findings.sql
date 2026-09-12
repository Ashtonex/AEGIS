-- ============================================================================
-- AEGIS MIGRATION 214 — CROSS-MODULE ANOMALY FINDINGS (PHASE 10A)
-- ============================================================================
-- Widens finance.ccb_monitor_findings.check_type to accept 4 new
-- cross-module checks added to app/services/finance/ccb_monitor.py:
--   - gl_proposal_stale_review  (GL bridge proposals stuck in review)
--   - labour_headcount_mismatch (payroll vs. approved timesheets)
--   - fuel_hours_variance       (fleet fuel consumption vs. expectation)
--   - stock_consumption_variance (stock issues vs. reported site usage)
-- Reuses the same proven anomaly table (natural_key upsert-dedup,
-- severity, status, evidence JSONB) rather than fragmenting anomaly
-- storage across a new parallel table - exact pattern as migrations
-- 190 (Phase 3A) and 206 (Phase 8A). Backward-compatible widening only -
-- every existing check_type value remains valid.
-- ============================================================================

ALTER TABLE finance.ccb_monitor_findings
    DROP CONSTRAINT IF EXISTS ccb_monitor_findings_check_type_check;

ALTER TABLE finance.ccb_monitor_findings
    ADD CONSTRAINT ccb_monitor_findings_check_type_check
    CHECK (check_type IN (
        'budget_boq_overrun',
        'requisition_budget_breach',
        'variance_stale_approval',
        'weekly_boq_pace_variance',
        'invoice_line_price_variance',
        'invoice_line_quantity_variance',
        'invoice_missing_po_or_grn',
        'duplicate_invoice_suspected',
        'invoice_unapproved_supplier',
        'supplier_bank_changed',
        'input_vat_rate_mismatch',
        'gl_proposal_stale_review',
        'labour_headcount_mismatch',
        'fuel_hours_variance',
        'stock_consumption_variance'
    ));
