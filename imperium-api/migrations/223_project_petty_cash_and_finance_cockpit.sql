-- ============================================================================
-- AEGIS MIGRATION 223 — PROJECT PETTY CASH + FINANCE COCKPIT FOUNDATION
-- ============================================================================
-- Supports a per-project "Project Finance" cockpit: a single project's cash
-- position, income/spend ledger and petty cash float, all read from the
-- existing finance.cash_accounts / finance.cashbook_transactions tables
-- rather than a new parallel ledger (those tables already carry project_id
-- on cashbook_transactions - it's just never been aggregated per project).
--
-- Petty cash is deliberately NOT a new account_type value. A prior phase
-- already tried and reverted exactly that (see
-- tests/test_bank_reconciliation_contract.py::
-- test_account_type_pattern_matches_db_check_constraint, which asserts
-- "petty_cash" must never appear in bank_accounts.py because it isn't in
-- the account_type CHECK). Petty cash stays account_type='cash' and is
-- distinguished by is_petty_cash + a custodian + an authorised float
-- ceiling, so the existing CHECK constraint and its regression test are
-- untouched.
-- ============================================================================

ALTER TABLE finance.cash_accounts
    ADD COLUMN IF NOT EXISTS project_id       UUID REFERENCES projects.projects(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_petty_cash     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS custodian_user_id UUID REFERENCES core.users(id),
    ADD COLUMN IF NOT EXISTS float_amount      NUMERIC(15,2);

-- One active petty cash float per project - one custodian holds one float.
CREATE UNIQUE INDEX IF NOT EXISTS cash_accounts_one_petty_cash_per_project_idx
    ON finance.cash_accounts (organization_id, project_id)
    WHERE is_petty_cash = true AND is_deleted = false;

CREATE INDEX IF NOT EXISTS cash_accounts_project_idx
    ON finance.cash_accounts (organization_id, project_id)
    WHERE is_deleted = false;

-- Project Finance cockpit reads cashbook rows filtered by project_id and
-- ordered by date; cashbook_account_date_idx (migration 034) is keyed by
-- cash_account_id, not project_id, so it doesn't serve this query shape.
CREATE INDEX IF NOT EXISTS cashbook_project_date_idx
    ON finance.cashbook_transactions (organization_id, project_id, transaction_date DESC)
    WHERE is_deleted = false AND project_id IS NOT NULL;

INSERT INTO core.permissions (key, description) VALUES
    ('finance.petty_cash.read',   'View project petty cash floats and movements'),
    ('finance.petty_cash.manage', 'Open, replenish and close project petty cash floats'),
    ('finance.petty_cash.spend',  'Record a petty cash spend against a project float')
ON CONFLICT (key) DO NOTHING;

INSERT INTO core.role_permissions (organization_id, role_id, permission_id)
SELECT r.organization_id, r.id, p.id
FROM core.organizations o
JOIN core.roles r ON r.organization_id = o.id AND r.is_deleted = false
JOIN (VALUES
    ('SUPERADMIN',         'finance.petty_cash.read'),
    ('SUPERADMIN',         'finance.petty_cash.manage'),
    ('SUPERADMIN',         'finance.petty_cash.spend'),
    ('Executive (Admin)',  'finance.petty_cash.read'),
    ('Executive (Admin)',  'finance.petty_cash.manage'),
    ('Executive (Admin)',  'finance.petty_cash.spend'),
    ('Finance Manager',    'finance.petty_cash.read'),
    ('Finance Manager',    'finance.petty_cash.manage'),
    ('Finance Manager',    'finance.petty_cash.spend'),
    ('Project Manager',    'finance.petty_cash.read'),
    ('Project Manager',    'finance.petty_cash.spend'),
    ('Site Supervisor',    'finance.petty_cash.read')
) AS grant_def(role_name, permission_key) ON grant_def.role_name = r.name
JOIN core.permissions p ON p.key = grant_def.permission_key
WHERE o.is_deleted = false
ON CONFLICT (role_id, permission_id) DO NOTHING;
