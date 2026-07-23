-- =============================================================================
-- 037_cash_account_performance.sql
-- Performance hardening for finance.cash_accounts / finance.cashbook_transactions.
--
-- 1. Adds the list/filter index that migration 034 omitted for cash_accounts
--    (bank_accounts.py filters on organization_id + is_active/account_type and
--    sorts by account_code, but no covering index existed).
-- 2. Replaces the per-request correlated-subquery balance calculation with a
--    maintained `current_balance` column, kept in sync by trigger so reads no
--    longer re-sum the full transaction history for every account on every
--    list/get call. The trigger reproduces the existing app-level sign
--    convention exactly (only `receipt` and `payment` affect the balance;
--    all other transaction_type values remain a no-op, matching current
--    behaviour in routers/bank_accounts.py) so this is a pure performance
--    change with no behavioural difference.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Missing list/filter index on cash_accounts
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS cash_accounts_org_active_idx
    ON finance.cash_accounts (organization_id, is_active, account_type)
    WHERE is_deleted = false;

CREATE INDEX IF NOT EXISTS cash_accounts_org_code_idx
    ON finance.cash_accounts (organization_id, account_code)
    WHERE is_deleted = false;

-- ---------------------------------------------------------------------------
-- 2. Cached running balance
-- ---------------------------------------------------------------------------
ALTER TABLE finance.cash_accounts
    ADD COLUMN IF NOT EXISTS current_balance NUMERIC(18, 2) NOT NULL DEFAULT 0;

-- Backfill: opening_balance + sum of posted, non-deleted receipt/payment amounts,
-- identical to the CASE expression previously evaluated on every read.
UPDATE finance.cash_accounts ca
SET current_balance = ca.opening_balance + COALESCE((
    SELECT SUM(CASE WHEN ct.transaction_type = 'receipt' THEN ct.amount
                    WHEN ct.transaction_type = 'payment' THEN -ct.amount
                    ELSE 0 END)
    FROM finance.cashbook_transactions ct
    WHERE ct.cash_account_id = ca.id
      AND ct.is_deleted = false
      AND ct.is_posted = true
), 0);

-- Keep current_balance in sync on insert/update/delete of cashbook_transactions.
CREATE OR REPLACE FUNCTION finance.sync_cash_account_balance() RETURNS trigger AS $$
DECLARE
    old_contribution NUMERIC(18, 2) := 0;
    new_contribution NUMERIC(18, 2) := 0;
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        IF OLD.is_posted AND NOT OLD.is_deleted THEN
            old_contribution := CASE WHEN OLD.transaction_type = 'receipt' THEN OLD.amount
                                      WHEN OLD.transaction_type = 'payment' THEN -OLD.amount
                                      ELSE 0 END;
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        IF NEW.is_posted AND NOT NEW.is_deleted THEN
            new_contribution := CASE WHEN NEW.transaction_type = 'receipt' THEN NEW.amount
                                      WHEN NEW.transaction_type = 'payment' THEN -NEW.amount
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

DROP TRIGGER IF EXISTS cashbook_transactions_sync_balance ON finance.cashbook_transactions;
CREATE TRIGGER cashbook_transactions_sync_balance
    AFTER INSERT OR UPDATE OR DELETE ON finance.cashbook_transactions
    FOR EACH ROW EXECUTE FUNCTION finance.sync_cash_account_balance();
