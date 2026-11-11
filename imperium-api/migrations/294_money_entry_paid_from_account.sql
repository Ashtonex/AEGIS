-- ============================================================================
-- AEGIS MIGRATION 294 — RECORDED MONEY NAMES THE ACCOUNT IT WENT THROUGH
-- ============================================================================
-- Money recorded on a project (and office expense vouchers) used to say only
-- "bank" or "cash", and cash always meant HQ Cash. Each entry now names the
-- Banking & Cash account (finance.cash_accounts) it was paid from / into:
--
--   bank account          -> paid_via 'bank'; GL 1070 until its statement line
--                            is matched, and only that account's statement
--                            lines are considered for the match
--   cash / mobile money   -> paid_via 'cash'; a cashbook payment (or receipt)
--                            in THAT account, so its balance moves, posted
--                            against the account's ledger account
--
-- Each Banking & Cash account also gets the ledger account it sits in
-- (cash_accounts.ledger_account_code). Blank means the default for its type:
-- bank 1000 Cash and Bank, cash / mobile money 1010 cash on hand. Employee
-- Advance is money an employee holds and must account for, already carried
-- in 1500 Cash Advances Receivable (finance journalled the HQ -> Employee
-- Advance transfer as Dr 1500 / Cr 1010 on 2026-10-26), so it is set to 1500.
--
-- Backfill: cash entries were always HQ Cash (code HQPC). Bank entries are
-- given the organisation's bank account only where it has exactly one; the
-- rest stay NULL and match against any bank account, as before.
--
-- Additive only.
-- ============================================================================

ALTER TABLE finance.cash_accounts
    ADD COLUMN IF NOT EXISTS ledger_account_code VARCHAR(20);

UPDATE finance.cash_accounts
SET ledger_account_code = '1500'
WHERE ledger_account_code IS NULL AND account_code = 'EMPA' AND account_name ILIKE '%advance%' AND NOT is_deleted;

ALTER TABLE finance.project_money_entries
    ADD COLUMN IF NOT EXISTS cash_account_id UUID REFERENCES finance.cash_accounts(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS project_money_entries_cash_account_idx
    ON finance.project_money_entries (cash_account_id) WHERE cash_account_id IS NOT NULL;

-- cash entries: the cash account their cashbook row is in (a voided entry's
-- row is soft-deleted and unlinked, so find it by source; latest row wins)
UPDATE finance.project_money_entries e
SET cash_account_id = (
    SELECT ct.cash_account_id FROM finance.cashbook_transactions ct
    WHERE ct.id = e.petty_cashbook_id
       OR (ct.source_type = 'project_money_entry' AND ct.source_id = e.id)
    ORDER BY (ct.id = e.petty_cashbook_id) DESC NULLS LAST, ct.created_at DESC
    LIMIT 1
)
WHERE e.cash_account_id IS NULL AND e.paid_via = 'cash';

UPDATE finance.project_money_entries e
SET cash_account_id = ca.id
FROM finance.cash_accounts ca
WHERE e.cash_account_id IS NULL AND e.paid_via = 'cash'
  AND ca.organization_id = e.organization_id AND ca.account_code = 'HQPC' AND NOT ca.is_deleted;

-- bank entries: the matched line's account, else the only bank account
UPDATE finance.project_money_entries e
SET cash_account_id = l.cash_account_id
FROM finance.bank_statement_lines l
WHERE e.cash_account_id IS NULL AND e.paid_via = 'bank' AND l.id = e.matched_line_id AND l.cash_account_id IS NOT NULL;

UPDATE finance.project_money_entries e
SET cash_account_id = only_bank.id
FROM (
    SELECT organization_id, (array_agg(id))[1] AS id
    FROM finance.cash_accounts
    WHERE account_type = 'bank' AND NOT is_deleted AND is_active
    GROUP BY organization_id HAVING count(*) = 1
) only_bank
WHERE e.cash_account_id IS NULL AND e.paid_via = 'bank' AND only_bank.organization_id = e.organization_id;
