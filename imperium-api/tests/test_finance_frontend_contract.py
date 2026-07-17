from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FINANCE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "finance" / "page.tsx"
).read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
FINANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(
    encoding="utf-8"
)
BUDGETS_ROUTER = (ROOT / "routers" / "budgets.py").read_text(encoding="utf-8")


class FinanceFrontendContractTests(unittest.TestCase):
    """Guard finance screens from hiding broken backend/API integrations."""

    def test_finance_workspace_does_not_mask_backend_failures_as_empty_data(self):
        self.assertNotIn(
            "getFinanceProjectSummaries().catch(() => ({ success: true, data: [] }))",
            FINANCE_PAGE,
        )
        self.assertNotIn(
            "getFinanceCostCodes().catch(() => ({ success: true, data: [] }))",
            FINANCE_PAGE,
        )
        self.assertNotIn(
            "getFinanceVariations().catch(() => ({ success: true, data: [] }))",
            FINANCE_PAGE,
        )
        self.assertNotIn(
            "getFinanceProgressClaims().catch(() => ({ success: true, data: [] }))",
            FINANCE_PAGE,
        )
        self.assertNotIn(
            "getFinanceBudgets().catch(() => ({ success: true, data: [] }))",
            FINANCE_PAGE,
        )
        self.assertIn("Finance data could not be loaded.", FINANCE_PAGE)

    def test_finance_api_calls_are_no_fallback_operational_calls(self):
        self.assertIn("getFinanceProjectSummaries", WEB_API)
        self.assertIn("/api/v1/financial-performance/projects", WEB_API)
        self.assertIn("allowFallback: false", WEB_API)

    def test_finance_read_routes_use_finance_permissions_not_bare_identity(self):
        self.assertIn('require_permission("finance.cost.read")', FINANCE_ROUTER)
        self.assertIn('require_permission("finance.budget.read")', FINANCE_ROUTER)
        self.assertIn('require_permission("finance.variation.read")', FINANCE_ROUTER)
        self.assertIn('require_permission("finance.claim.read")', FINANCE_ROUTER)
        self.assertIn('require_permission("finance.budget.read")', BUDGETS_ROUTER)
        self.assertNotIn("get_current_user", FINANCE_ROUTER)
        self.assertNotIn("get_current_user", BUDGETS_ROUTER)

    def test_finance_write_payloads_are_strict_contracts(self):
        self.assertIn(
            'ConfigDict(extra="forbid", str_strip_whitespace=True)', FINANCE_ROUTER
        )
        self.assertIn("class CostCodeCreate(BaseModel):", FINANCE_ROUTER)
        self.assertIn("class VariationCreate(BaseModel):", FINANCE_ROUTER)


if __name__ == "__main__":
    unittest.main()
