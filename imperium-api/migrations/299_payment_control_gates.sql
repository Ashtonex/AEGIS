-- ============================================================================
-- AEGIS MIGRATION 299 - PAYMENT CONTROL GATES
-- ============================================================================
--   1. Supplier bank details need a second person. Whoever adds or changes a
--      supplier's bank details can't also confirm them; until someone else
--      with supplier-payment rights confirms, the supplier can't be paid.
--      Suppliers whose bank details haven't changed since the change stamp
--      was introduced (bank_updated_at IS NULL) count as confirmed.
--   2. Paying a supplier invoice that isn't approved for payment (no
--      completed PO / GRN / invoice match) no longer posts straight away. The
--      payment is held - a draft batch carrying the override reason - until
--      a different person releases it.
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE procurement.suppliers
    ADD COLUMN IF NOT EXISTS bank_confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bank_confirmed_by UUID;

COMMENT ON COLUMN procurement.suppliers.bank_confirmed_at IS
    'When someone other than the editor confirmed the current bank details. Unconfirmed while bank_updated_at is later.';

ALTER TABLE finance.supplier_payment_batches
    ADD COLUMN IF NOT EXISTS held_reason TEXT;

COMMENT ON COLUMN finance.supplier_payment_batches.held_reason IS
    'Set on a payment of invoices not yet approved for payment: the payer''s override reason. The batch stays draft until another person releases it.';

-- The payables trail records a held payment and a cancelled hold too.
ALTER TABLE finance.payable_events DROP CONSTRAINT IF EXISTS payable_events_action_check;
ALTER TABLE finance.payable_events ADD CONSTRAINT payable_events_action_check CHECK (
    action IN ('paid', 'rejected', 'invoice_requested', 'match_override', 'payment_held', 'payment_hold_cancelled')
);
