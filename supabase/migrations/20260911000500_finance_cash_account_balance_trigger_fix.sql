-- ============================================================================
-- AEGIS MIGRATION 192 — CASH ACCOUNT BALANCE TRIGGER FIX (PHASE 4)
-- ============================================================================
-- Two independent bugs in finance.cash_accounts.current_balance, found while
-- building Phase 4 (Banking & Reconciliation) and fixed together since they
-- interact directly:
--
-- 1. The finance.cashbook_transactions_sync_balance trigger (migration 037)
--    only ever adjusted current_balance for transaction_type 'receipt'/
--    'payment' - 'transfer_in', 'transfer_out', and 'bank_charge' were silent
--    no-ops, even though the schema has always allowed those types.
--
-- 2. Separately (fixed in application code alongside this migration, see
--    routers/financial_performance.py and routers/finance_statutory.py),
--    four call sites ALSO manually ran
--    "UPDATE finance.cash_accounts SET current_balance = current_balance +/- :amount"
--    immediately after inserting a 'receipt'/'payment' row - meaning every
--    cashbook posting through the live UI double-counted its balance impact.
--    Verified empirically: posting one $100 receipt left current_balance at
--    $200.00, not $100.00. Those four manual updates are now removed, making
--    this trigger the single source of truth for current_balance everywhere.
--
-- 'adjustment' remains a deliberate no-op: its sign is inherently ambiguous
-- with the table's current single-amount, no-direction column - correcting
-- that would need a schema change, out of scope for a trigger bug-fix.
--
-- The existing receipt/payment branches are byte-for-byte unchanged.
-- ============================================================================

CREATE OR REPLACE FUNCTION finance.sync_cash_account_balance() RETURNS trigger AS $$
DECLARE
    old_contribution NUMERIC(18, 2) := 0;
    new_contribution NUMERIC(18, 2) := 0;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF OLD.is_posted AND NOT OLD.is_deleted THEN
            old_contribution := CASE WHEN OLD.transaction_type = 'receipt' THEN OLD.amount
                                      WHEN OLD.transaction_type = 'payment' THEN -OLD.amount
                                      WHEN OLD.transaction_type = 'transfer_in' THEN OLD.amount
                                      WHEN OLD.transaction_type = 'transfer_out' THEN -OLD.amount
                                      WHEN OLD.transaction_type = 'bank_charge' THEN -OLD.amount
                                      ELSE 0 END;
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.is_posted AND NOT NEW.is_deleted THEN
            new_contribution := CASE WHEN NEW.transaction_type = 'receipt' THEN NEW.amount
                                      WHEN NEW.transaction_type = 'payment' THEN -NEW.amount
                                      WHEN NEW.transaction_type = 'transfer_in' THEN NEW.amount
                                      WHEN NEW.transaction_type = 'transfer_out' THEN -NEW.amount
                                      WHEN NEW.transaction_type = 'bank_charge' THEN -NEW.amount
                                      ELSE 0 END;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.cash_account_id IS DISTINCT FROM NEW.cash_account_id THEN
        UPDATE finance.cash_accounts SET current_balance = current_balance - old_contribution
            WHERE id = OLD.cash_account_id;
        UPDATE finance.cash_accounts SET current_balance = current_balance + new_contribution
            WHERE id = NEW.cash_account_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE finance.cash_accounts SET current_balance = current_balance - old_contribution
            WHERE id = OLD.cash_account_id;
    ELSE
        UPDATE finance.cash_accounts SET current_balance = current_balance + (new_contribution - old_contribution)
            WHERE id = NEW.cash_account_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
