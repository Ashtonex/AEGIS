from datetime import date, timedelta
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICE = (ROOT / "app" / "services" / "finance" / "cash_position.py").read_text(encoding="utf-8")
SERVICE_CODE_ONLY = SERVICE.split('"""', 2)[-1]
ROUTER = (ROOT / "routers" / "cash_forecast.py").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class Phase6ASharedFunctionContractTests(unittest.TestCase):
    def test_financial_performance_uses_the_shared_runway_function(self):
        self.assertIn("from app.services.finance.cash_position import compute_cash_runway", FINANCIAL_PERFORMANCE_ROUTER)
        self.assertIn("await compute_cash_runway(db, user[\"org_id\"])", FINANCIAL_PERFORMANCE_ROUTER)
        # Regression guard: the old inline duplicate queries must be gone,
        # not left alongside the new shared call.
        statements_fn = FINANCIAL_PERFORMANCE_ROUTER.split("async def get_financial_statements")[1].split("\n@router")[0] if "async def get_financial_statements" in FINANCIAL_PERFORMANCE_ROUTER else FINANCIAL_PERFORMANCE_ROUTER
        self.assertNotIn("SELECT COALESCE(SUM(current_balance), 0) AS total_cash", statements_fn)

    def test_statements_response_shape_is_unchanged(self):
        # cash_position must still be a dict with these exact three keys,
        # so FinancialStatementsPanel.tsx needs no frontend change.
        self.assertIn('"cash_position": cash_position,', FINANCIAL_PERFORMANCE_ROUTER)


class Phase6AServiceContractTests(unittest.TestCase):
    def test_only_two_tiers_no_optimistic(self):
        self.assertIn("async def compute_cash_forecast", SERVICE)
        self.assertIn('"committed": committed_series', SERVICE)
        self.assertIn('"probable": probable_series', SERVICE)
        # The module docstring legitimately explains, in prose, why a third
        # tier is deliberately not shipped - check only the actual code.
        self.assertNotIn('"optimistic"', SERVICE_CODE_ONLY.lower())

    def test_probable_series_always_includes_committed_events(self):
        fn_body = SERVICE.split("async def compute_cash_forecast")[1]
        self.assertIn("probable_series = _bucket_events(opening_cash, committed + probable_only, horizons)", fn_body)

    def test_pipeline_never_enters_a_horizon_bucket(self):
        # The pipeline summary must be computed and returned separately -
        # never passed into _bucket_events.
        bucket_calls = [line for line in SERVICE.splitlines() if "_bucket_events(" in line and "def " not in line]
        for call in bucket_calls:
            self.assertNotIn("pipeline", call.lower())

    def test_commitments_and_variations_are_never_modeled_as_timed_events(self):
        self.assertNotIn("finance.commitments", SERVICE_CODE_ONLY)
        self.assertNotIn("finance.variations", SERVICE_CODE_ONLY)

    def test_supplier_invoice_due_date_falls_back_to_payment_terms(self):
        self.assertIn("COALESCE(si.due_date,", SERVICE)
        self.assertIn("payment_terms_days", SERVICE)

    def test_client_collection_dates_are_documented_assumptions_not_stored_data(self):
        self.assertIn("CLIENT_COLLECTION_DAYS_AFTER_CERTIFICATION = 30", SERVICE)
        self.assertIn("CLIENT_COLLECTION_DAYS_AFTER_SUBMISSION = 45", SERVICE)
        self.assertIn('"assumptions":', SERVICE)

    def test_interval_parameters_are_explicitly_cast(self):
        # Regression guard for a real bug found during verification: binding
        # a raw Python timedelta into "date + :param" raises
        # AmbiguousFunctionError in asyncpg without an explicit cast.
        self.assertIn("CAST(:lag AS interval)", SERVICE)

    def test_bucket_events_is_cumulative_and_monotonic_by_date(self):
        import sys
        sys.path.insert(0, str(ROOT))
        from app.services.finance.cash_position import _bucket_events

        today = date(2026, 1, 1)
        horizons = [today, today + timedelta(days=10), today + timedelta(days=20)]
        events = [
            {"date": today + timedelta(days=5), "amount": 100.0, "direction": "inflow"},
            {"date": today + timedelta(days=15), "amount": 40.0, "direction": "outflow"},
        ]
        result = _bucket_events(opening_cash=10.0, events=events, horizons=horizons)
        self.assertEqual(result[0]["projected_cash"], 10.0)
        self.assertEqual(result[1]["projected_cash"], 110.0)
        self.assertEqual(result[2]["projected_cash"], 70.0)


class Phase6ARouterContractTests(unittest.TestCase):
    def test_router_uses_existing_permission_no_new_keys(self):
        self.assertIn('require_permission("finance.cash.read")', ROUTER)

    def test_router_is_mounted(self):
        self.assertIn("from routers import cash_forecast", MAIN)
        self.assertIn('app.include_router(cash_forecast.router, prefix="/api/v1/finance/cash-forecast"', MAIN)

    def test_endpoints_exist(self):
        self.assertIn('@router.get("")', ROUTER)
        self.assertIn('@router.get("/runway")', ROUTER)


if __name__ == "__main__":
    unittest.main()
