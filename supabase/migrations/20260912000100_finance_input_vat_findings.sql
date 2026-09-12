-- ============================================================================
-- AEGIS MIGRATION 206 — INPUT VAT COMPLIANCE FINDINGS (PHASE 8A)
-- ============================================================================
-- Widens finance.ccb_monitor_findings.check_type to accept an input-VAT
-- compliance finding, reusing the same proven anomaly table (natural_key
-- upsert-dedup, severity, status, evidence JSONB) and its existing
-- router/permissions/frontend rather than fragmenting anomaly storage
-- across a new parallel table - exact pattern as migration 190 (Phase 3A).
-- Backward-compatible widening only - every existing check_type value
-- remains valid.
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
        'input_vat_rate_mismatch'
    ));
