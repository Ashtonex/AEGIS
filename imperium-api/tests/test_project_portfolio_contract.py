from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SERVICE = (ROOT / "app" / "services" / "finance" / "project_portfolio.py").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")


class NonInterferenceContractTests(unittest.TestCase):
    def test_list_project_financial_summaries_is_untouched(self):
        self.assertIn("async def list_project_financial_summaries", FINANCIAL_PERFORMANCE_ROUTER)
        self.assertNotIn("project_portfolio", FINANCIAL_PERFORMANCE_ROUTER)


class HealthFactorContractTests(unittest.TestCase):
    def test_response_always_includes_full_factor_breakdown_alongside_composite(self):
        fn_body = SERVICE.split("def get_project_health_factors")[1].split("\n\nasync def list_project_portfolio")[0]
        self.assertIn('"factors": factors', fn_body)
        self.assertIn('"attention_level": attention_level', fn_body)

    def test_every_factor_carries_a_truth_status(self):
        fn_body = SERVICE.split("def get_project_health_factors")[1].split("\n\nasync def list_project_portfolio")[0]
        # Count the literal key assignment, not the word "truth_status" -
        # the function's own docstring also mentions it in prose.
        self.assertEqual(fn_body.count('"truth_status":'), 5)

    def test_gl_drift_factor_marked_incomplete_when_gl_adoption_is_empty(self):
        fn_body = SERVICE.split("def get_project_health_factors")[1].split("\n\nasync def list_project_portfolio")[0]
        self.assertIn("gl_actual == 0 and op_actual > 0", fn_body)
        self.assertIn('"INCOMPLETE"', fn_body)

    def test_retention_age_is_documented_as_an_approximation(self):
        fn_body = SERVICE.split("async def _batch_retention")[1].split("\n\nasync def _batch_pending_variations")[0]
        self.assertIn("APPROXIMATE", fn_body.upper())

    def test_attention_level_is_never_the_only_output(self):
        # Regression guard against a future edit collapsing this into a
        # single hidden score - the function signature itself must return
        # both keys together, not one gated behind a flag.
        return_stmt = SERVICE.split('return {"factors": factors, "attention_level": attention_level}')
        self.assertEqual(len(return_stmt), 2)


class PortfolioLoopContractTests(unittest.TestCase):
    def test_loops_compute_project_financials_since_no_batch_variant_exists(self):
        fn_body = SERVICE.split("async def list_project_portfolio")[1]
        self.assertIn("project_forecast.compute_project_financials", fn_body)
        self.assertIn("project_forecast.derive_forecast_metrics", fn_body)
        self.assertIn("for p in projects:", fn_body)

    def test_ccb_retention_variation_lookups_are_batched_not_n_plus_1(self):
        fn_body = SERVICE.split("async def list_project_portfolio")[1]
        self.assertIn("_batch_ccb_findings", fn_body)
        self.assertIn("_batch_retention", fn_body)
        self.assertIn("_batch_pending_variations", fn_body)
        # These three batch calls happen once, outside the per-project loop.
        loop_start = fn_body.index("for p in projects:")
        self.assertLess(fn_body.index("_batch_ccb_findings"), loop_start)
        self.assertLess(fn_body.index("_batch_retention"), loop_start)
        self.assertLess(fn_body.index("_batch_pending_variations"), loop_start)

    def test_only_active_projects_are_included(self):
        fn_body = SERVICE.split("async def _list_active_projects")[1].split("\n\nasync def _batch_ccb_findings")[0]
        self.assertIn("_ACTIVE_PROJECT_STATUSES", fn_body)
        self.assertIn("is_deleted = false", fn_body)


if __name__ == "__main__":
    unittest.main()
