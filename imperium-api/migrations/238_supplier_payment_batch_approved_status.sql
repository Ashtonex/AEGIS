-- ============================================================================
-- AEGIS MIGRATION 238 — SUPPLIER PAYMENT BATCH 'APPROVED' STATUS
-- ============================================================================
-- POST /api/v1/payments/{batch_id}/decision moves a batch
-- draft -> approved (approve) -> posted (post), but 034 created
-- finance.supplier_payment_batches.status with
-- CHECK (status IN ('draft', 'posted', 'cancelled')). The approve action
-- therefore failed with a check-constraint violation, and since post
-- requires 'approved', no batch could ever be posted through that endpoint.
--
-- The CHECK now also allows 'approved', and the batch records who approved
-- it and when (the endpoint already refuses approval by the batch's creator;
-- without these columns the approver was not recorded anywhere but the
-- audit log).
-- ============================================================================

ALTER TABLE finance.supplier_payment_batches
    DROP CONSTRAINT IF EXISTS supplier_payment_batches_status_check;

ALTER TABLE finance.supplier_payment_batches
    ADD CONSTRAINT supplier_payment_batches_status_check
    CHECK (status IN ('draft', 'approved', 'posted', 'cancelled'));

ALTER TABLE finance.supplier_payment_batches
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
