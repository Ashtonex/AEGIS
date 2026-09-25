-- 233: the bank's own running balance after each statement line.
--
-- Monthly PDF statements overlap the lines already stored (a statement run on
-- the 9th and the next one for the whole month share days 1-9). The bank's
-- running balance makes a line unique - two identical ledger fees on the same
-- day still leave different balances - so an upload can skip exactly the
-- lines AEGIS already has, and can prove there is no gap: the first new line
-- must start from the last stored balance.

ALTER TABLE finance.bank_statement_lines
    ADD COLUMN IF NOT EXISTS bank_balance numeric(18, 2);

COMMENT ON COLUMN finance.bank_statement_lines.bank_balance IS
    'Balance the bank printed after this line (PDF imports). NULL for CSV imports.';

-- Backfill the lines from PDF imports: the full-history statement opened at
-- 0.00, so each balance is the running sum of the signed amounts in statement
-- order (verified at import time to tie to the bank''s closing balance).
WITH running AS (
    SELECT l.id,
           COALESCE((i.column_mapping->>'opening_balance')::numeric, 0)
             + sum(l.amount) OVER (PARTITION BY l.import_id ORDER BY l.line_number) AS balance
    FROM finance.bank_statement_lines l
    JOIN finance.bank_statement_imports i ON i.id = l.import_id
    WHERE i.column_mapping->>'source' = 'pdf'
)
UPDATE finance.bank_statement_lines l
SET bank_balance = running.balance
FROM running
WHERE running.id = l.id AND l.bank_balance IS NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_lines_account_dedupe
    ON finance.bank_statement_lines (cash_account_id, transaction_date, amount, bank_balance);
