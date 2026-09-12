from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICE = (ROOT / "app" / "services" / "finance" / "financial_statements.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "financial_statements.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")


class BalanceSheetContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return SERVICE.split("async def get_balance_sheet")[1].split("\n\nasync def get_cash_movement_statement")[0]

    def test_computes_retained_earnings_and_balance_check(self):
        fn_body = self._fn_body()
        self.assertIn("retained_earnings_current_and_prior", fn_body)
        self.assertIn("is_balanced", fn_body)
        self.assertIn("total_liabilities_and_equity", fn_body)

    def test_never_touches_pnl_categories_as_balance_sheet_lines(self):
        fn_body = self._fn_body()
        self.assertIn('r["account_category"] == "asset"', fn_body)
        self.assertIn('r["account_category"] == "liability"', fn_body)
        self.assertIn('r["account_category"] == "equity"', fn_body)
        self.assertNotIn('r["account_category"] == "revenue"', fn_body)


class IncomeStatementContractTests(unittest.TestCase):
    def test_income_statement_never_touches_balance_sheet_categories(self):
        fn_body = SERVICE.split("async def get_income_statement")[1].split("\n\nasync def get_balance_sheet")[0]
        for banned in ("asset", "liability", "\"equity\""):
            self.assertNotIn(banned, fn_body)

    def test_income_statement_is_period_bounded_not_cumulative(self):
        fn_body = SERVICE.split("async def get_income_statement")[1].split("\n\nasync def get_balance_sheet")[0]
        self.assertIn("_get_period_activity", fn_body)

    def test_period_activity_query_filters_posted_only_within_date_range(self):
        candidates_fn = SERVICE.split("async def _get_period_activity")[1].split("\n\ndef _sum_category")[0]
        self.assertIn("je.status = 'posted'", candidates_fn)
        self.assertIn("je.entry_date BETWEEN :period_start AND :period_end", candidates_fn)


class CashMovementContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return SERVICE.split("async def get_cash_movement_statement")[1].split("\n\nasync def get_ar_aging")[0]

    def test_resolves_the_single_cash_account_by_code(self):
        fn_body = self._fn_body()
        self.assertIn("_CASH_ACCOUNT_CODE", SERVICE)
        self.assertIn('_CASH_ACCOUNT_CODE = "1000"', SERVICE)
        self.assertIn("account_code = :code", fn_body)

    def test_cross_checks_closing_balance_against_trial_balance(self):
        fn_body = self._fn_body()
        self.assertIn("reconciles", fn_body)
        self.assertIn("get_trial_balance", fn_body)


class AgingContractTests(unittest.TestCase):
    def test_ar_aging_never_infers_outstanding_from_status_text(self):
        fn_body = SERVICE.split("async def get_ar_aging")[1].split("\n\nasync def get_ap_aging")[0]
        # Must compute outstanding via the real allocation join, and must
        # not gate "is this outstanding" on any specific status value like
        # 'certified' or 'invoiced' - only exclude clearly-inapplicable
        # draft/disputed states, then compute the real number.
        self.assertIn("receipt_allocations", fn_body)
        self.assertIn("certified_amount", fn_body)
        self.assertNotIn("status = 'certified'", fn_body)
        self.assertNotIn("status = 'invoiced'", fn_body)

    def test_ap_aging_never_infers_outstanding_from_status_text(self):
        fn_body = SERVICE.split("async def get_ap_aging")[1].split("\n\ndef _age_bucket")[0]
        self.assertIn("supplier_payment_items", fn_body)
        self.assertNotIn("status = 'paid'", fn_body)
        self.assertNotIn("status = 'approved'", fn_body)

    def test_both_aging_functions_exclude_near_zero_outstanding(self):
        for fn_name in ("get_ar_aging", "get_ap_aging"):
            fn_body = SERVICE.split(f"async def {fn_name}")[1].split("\n\n")[0]
            self.assertIn("abs(outstanding) < 0.01", fn_body)

    def test_bucket_boundaries(self):
        from app.services.finance.financial_statements import _age_bucket

        self.assertEqual(_age_bucket(None), "unknown")
        self.assertEqual(_age_bucket(0), "0-30")
        self.assertEqual(_age_bucket(30), "0-30")
        self.assertEqual(_age_bucket(31), "31-60")
        self.assertEqual(_age_bucket(60), "31-60")
        self.assertEqual(_age_bucket(61), "61-90")
        self.assertEqual(_age_bucket(90), "61-90")
        self.assertEqual(_age_bucket(91), "90+")


class RouterContractTests(unittest.TestCase):
    def test_every_endpoint_requires_gl_read_permission(self):
        for endpoint in ("income_statement", "balance_sheet", "cash_movement", "ar_aging", "ap_aging", "trial_balance"):
            fn_body = ROUTER.split(f"async def {endpoint}")[1].split("\n\n\n@router.get")[0]
            self.assertIn('require_permission("finance.gl.read")', fn_body)

    def test_no_new_permission_key_introduced(self):
        # Zero-migration phase - must reuse the existing finance.gl.read key,
        # never introduce a new one.
        self.assertNotIn("finance.financial_statements", ROUTER)
        self.assertNotIn("finance.reporting", ROUTER)

    def test_trial_balance_is_a_thin_passthrough(self):
        fn_body = ROUTER.split("async def trial_balance")[1]
        self.assertIn("general_ledger.get_trial_balance", fn_body)

    def test_router_is_mounted_at_its_own_distinct_prefix(self):
        self.assertIn("from routers import financial_statements", MAIN)
        self.assertIn(
            'app.include_router(financial_statements.router, prefix="/api/v1/finance/financial-statements"', MAIN
        )


class NonInterferenceContractTests(unittest.TestCase):
    def test_existing_department_statements_endpoint_is_untouched(self):
        # Regression guard: this phase must never modify _compute_department_pnl
        # or the existing GET /statements - they stay operational-table-based,
        # completely independent of the new GL-sourced statements. The
        # existing endpoint function happens to already be named
        # get_financial_statements (pre-existing, unrelated to this phase's
        # new module of the same-ish name) - only assert there's no actual
        # import dependency on the new module.
        self.assertIn("_compute_department_pnl", FINANCIAL_PERFORMANCE_ROUTER)
        self.assertNotIn("from app.services.finance.financial_statements import", FINANCIAL_PERFORMANCE_ROUTER)
        self.assertNotIn("from app.services.finance import financial_statements", FINANCIAL_PERFORMANCE_ROUTER)


if __name__ == "__main__":
    unittest.main()
