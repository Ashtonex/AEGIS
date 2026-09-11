from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
TRIGGER_MIGRATION = (ROOT / "migrations" / "192_finance_cash_account_balance_trigger_fix.sql").read_text(encoding="utf-8")
# The migration's header comment legitimately explains, in prose, why
# 'adjustment' stays a no-op - strip it before asserting on the actual
# function body so that explanation doesn't trip the regression guard.
TRIGGER_FUNCTION_BODY = TRIGGER_MIGRATION.split("CREATE OR REPLACE FUNCTION")[1]
IMPORTS_MIGRATION = (ROOT / "migrations" / "193_finance_bank_statement_imports.sql").read_text(encoding="utf-8")
PERMISSIONS_MIGRATION = (ROOT / "migrations" / "194_finance_reconciliation_permissions.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "bank_reconciliation.py").read_text(encoding="utf-8")
SERVICE_CODE_ONLY = SERVICE.split('"""', 2)[-1]
BANK_ACCOUNTS_ROUTER = (ROOT / "routers" / "bank_accounts.py").read_text(encoding="utf-8")
BANK_TRANSACTIONS_ROUTER = (ROOT / "routers" / "bank_transactions.py").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
FINANCE_STATUTORY_ROUTER = (ROOT / "routers" / "finance_statutory.py").read_text(encoding="utf-8")


class Phase4SchemaContractTests(unittest.TestCase):
    def test_balance_trigger_extends_transfer_and_charge_types(self):
        for txn_type in ("transfer_in", "transfer_out", "bank_charge"):
            self.assertIn(f"transaction_type = '{txn_type}'", TRIGGER_MIGRATION)
        # receipt/payment branches must remain byte-for-byte present.
        self.assertIn("WHEN OLD.transaction_type = 'receipt' THEN OLD.amount", TRIGGER_MIGRATION)
        self.assertIn("WHEN OLD.transaction_type = 'payment' THEN -OLD.amount", TRIGGER_MIGRATION)
        # adjustment stays a deliberate no-op - not mentioned in either CASE.
        self.assertNotIn("'adjustment'", TRIGGER_FUNCTION_BODY)

    def test_bank_statement_tables_are_additive_with_rls(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.bank_statement_imports", IMPORTS_MIGRATION)
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.bank_statement_lines", IMPORTS_MIGRATION)
        for table in ("bank_statement_imports", "bank_statement_lines"):
            self.assertIn(f"ALTER TABLE finance.{table} ENABLE ROW LEVEL SECURITY", IMPORTS_MIGRATION)
            self.assertIn(f"ALTER TABLE finance.{table} FORCE ROW LEVEL SECURITY", IMPORTS_MIGRATION)
        self.assertNotIn("ALTER TABLE finance.cash_accounts", IMPORTS_MIGRATION)
        self.assertNotIn("ALTER TABLE finance.cashbook_transactions", IMPORTS_MIGRATION)

    def test_match_status_vocabulary_matches_master_spec(self):
        for status in ("unmatched", "suggested", "matched", "duplicate", "difference"):
            self.assertIn(f"'{status}'", IMPORTS_MIGRATION)

    def test_reconciliation_permissions_granted_in_same_migration(self):
        for key in (
            "finance.reconciliation.read", "finance.reconciliation.import",
            "finance.reconciliation.match", "finance.reconciliation.reopen",
        ):
            self.assertIn(f"'{key}'", PERMISSIONS_MIGRATION)
        self.assertIn("r.name = 'SUPERADMIN'", PERMISSIONS_MIGRATION)
        self.assertIn("r.name = 'Finance Manager'", PERMISSIONS_MIGRATION)


class Phase4DoubleCountingBugFixContractTests(unittest.TestCase):
    """Regression guard for the live double-counting bug found and fixed
    during this phase: the balance trigger and application code must never
    both adjust current_balance for the same insert."""

    def test_financial_performance_no_longer_manually_adjusts_balance(self):
        for fn_name in ("post_cashbook_transaction", "post_supplier_payment_batch", "post_payroll_run"):
            fn_body = FINANCIAL_PERFORMANCE_ROUTER.split(f"async def {fn_name}")[1].split("\n@router")[0]
            self.assertNotIn("UPDATE finance.cash_accounts SET current_balance", fn_body)

    def test_finance_statutory_no_longer_manually_adjusts_balance(self):
        fn_body = FINANCE_STATUTORY_ROUTER.split("async def settle_liability")[1].split("\n@router")[0]
        self.assertNotIn("UPDATE finance.cash_accounts SET current_balance", fn_body)


class Phase4OrphanedRouterBugFixContractTests(unittest.TestCase):
    """Regression guard for the latent schema-mismatch bugs found in the
    previously-unused bank_accounts.py/bank_transactions.py routers."""

    def test_account_type_pattern_matches_db_check_constraint(self):
        self.assertIn('pattern=r"^(bank|cash|mobile_money)$"', BANK_ACCOUNTS_ROUTER)
        self.assertNotIn("petty_cash", BANK_ACCOUNTS_ROUTER)
        self.assertNotIn("money_market", BANK_ACCOUNTS_ROUTER)

    def test_transaction_type_pattern_matches_db_check_constraint(self):
        self.assertIn("receipt|payment|transfer_in|transfer_out|bank_charge|adjustment", BANK_TRANSACTIONS_ROUTER)
        self.assertNotIn("interest", BANK_TRANSACTIONS_ROUTER)

    def test_create_cash_account_does_not_reference_nonexistent_notes_column(self):
        fn_body = BANK_ACCOUNTS_ROUTER.split("async def create_cash_account")[1].split("\n@router")[0]
        self.assertNotIn("notes", fn_body)

    def test_create_transaction_supplies_required_columns(self):
        fn_body = BANK_TRANSACTIONS_ROUTER.split("async def create_transaction")[1].split("\n@router")[0]
        self.assertIn("transaction_number", fn_body)
        self.assertIn("direction", fn_body)
        self.assertNotIn("supplier_invoice_id", fn_body)
        self.assertNotIn("progress_claim_id", fn_body)

    def test_list_transactions_uses_real_project_column(self):
        self.assertIn("p.project_code AS project_number", BANK_TRANSACTIONS_ROUTER)
        self.assertNotIn("p.project_number,", BANK_TRANSACTIONS_ROUTER)


class Phase4MatchingEngineContractTests(unittest.TestCase):
    def test_only_exact_tight_window_match_bypasses_human_confirmation(self):
        # run_matching's auto-'matched' branch must require BOTH an exact
        # amount AND the tight (1-day) window - anything looser is
        # 'suggested', never silently confirmed.
        self.assertIn("EXACT_MATCH_WINDOW_DAYS = 1", SERVICE)
        self.assertIn("SUGGESTED_MATCH_WINDOW_DAYS = 7", SERVICE)

    def test_exact_auto_match_also_reconciles_the_cashbook_side(self):
        # Regression guard: found and fixed during live verification - the
        # bank line being marked 'matched' must not leave the cashbook
        # transaction's reconciliation_status untouched.
        run_matching_body = SERVICE.split("async def run_matching")[1].split("\nasync def ")[0]
        self.assertIn("_reconcile_cashbook_row", run_matching_body)

    def test_confirm_match_and_run_matching_share_the_same_reconcile_helper(self):
        confirm_body = SERVICE.split("async def confirm_match")[1].split("\nasync def ")[0]
        self.assertIn("_reconcile_cashbook_row", confirm_body)
        # Only the shared helper should UPDATE ... SET reconciliation_status
        # directly - confirm_match/run_matching must call it, not duplicate
        # the SQL inline (create_cashbook_entry_from_line sets it via its
        # own INSERT's positional VALUES, which this pattern doesn't match).
        self.assertEqual(SERVICE.count("reconciliation_status = 'reconciled'"), 1)

    def test_reject_only_allowed_on_suggested_or_duplicate(self):
        fn_body = SERVICE.split("async def reject_match")[1].split("\nasync def ")[0]
        self.assertIn('"suggested", "duplicate"', fn_body)

    def test_reopen_requires_a_reason_and_reverts_both_sides(self):
        fn_body = SERVICE.split("async def reopen_match")[1].split("\nasync def ")[0]
        self.assertIn("A reason is required", fn_body)
        self.assertIn("reconciliation_status = 'unreconciled'", fn_body)

    def test_duplicate_detection_runs_before_matching(self):
        run_matching_body = SERVICE.split("async def run_matching")[1].split("\nasync def ")[0]
        dup_index = run_matching_body.find('"duplicate"')
        exact_index = run_matching_body.find("EXACT_MATCH_WINDOW_DAYS")
        self.assertGreater(dup_index, 0)
        self.assertLess(dup_index, exact_index)

    def test_csv_parsing_never_raises_on_a_single_bad_row(self):
        fn_body = SERVICE.split("def parse_csv_rows")[1].split("\ndef ")[0]
        self.assertIn("except (ValueError, InvalidOperation, KeyError) as exc:", fn_body)
        self.assertIn("errors.append", fn_body)


if __name__ == "__main__":
    unittest.main()
