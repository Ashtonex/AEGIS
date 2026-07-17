from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "bi_reports.py").read_text(encoding="utf-8")
ANALYTICS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "analytics" / "page.tsx"
).read_text(encoding="utf-8")


class AnalyticsContractTests(unittest.TestCase):
    """Guard BI/analytics endpoints as source-backed decision intelligence."""

    def test_bi_endpoints_do_not_return_hardcoded_demo_entities(self):
        for forbidden in [
            "CAT D9 Bulldozer",
            "Volvo Excavator",
            "ZimSteel Ltd",
            "SinoCement Private",
            "Harare Bypass Phase 2",
            "Mbare Residential Hub",
        ]:
            self.assertNotIn(forbidden, ROUTER)
            self.assertNotIn(forbidden, ANALYTICS_PAGE)

    def test_bi_endpoints_query_live_operational_sources(self):
        for source in [
            "fleet.utilization_logs",
            "procurement.purchase_orders",
            "procurement.goods_received_notes",
            "procurement.supplier_invoices",
            "hr.attendance_records",
            "finance.cost_transactions",
        ]:
            self.assertIn(source, ROUTER)
        self.assertIn("WHERE f.organization_id=:org_id", ROUTER)
        self.assertIn("WHERE s.organization_id=:org_id", ROUTER)
        self.assertIn("WHERE a.organization_id=:org_id", ROUTER)
        self.assertIn("async def _rows", ROUTER)

    def test_bi_endpoints_use_executive_permission_not_bare_identity(self):
        self.assertIn('require_permission("executive.view_dashboard")', ROUTER)
        self.assertNotIn("get_current_user", ROUTER)

    def test_analytics_frontend_uses_empty_states_not_demo_fallbacks(self):
        self.assertIn("No active decision signals", ANALYTICS_PAGE)
        self.assertIn("No fleet utilisation records", ANALYTICS_PAGE)
        self.assertIn("No procurement analytics records", ANALYTICS_PAGE)
        self.assertIn("No workforce analytics records", ANALYTICS_PAGE)
        self.assertIn("Analytics data could not be loaded.", ANALYTICS_PAGE)
        self.assertIn(
            "The analytics feed is still synchronizing. Please retry once the connection is ready.",
            ANALYTICS_PAGE,
        )
        self.assertIn("equipmentIntel.map", ANALYTICS_PAGE)
        self.assertIn("procurementIntel.map", ANALYTICS_PAGE)
        self.assertIn("workforceIntel.map", ANALYTICS_PAGE)
        self.assertIn("Promise.allSettled", ANALYTICS_PAGE)
        self.assertNotIn("getAnalyticsExceptions().catch", ANALYTICS_PAGE)
        self.assertNotIn("getAnalyticsProjectPerformance().catch", ANALYTICS_PAGE)
        self.assertNotIn("getAnalyticsEquipmentIntelligence().catch", ANALYTICS_PAGE)
        self.assertNotIn("getAnalyticsProcurement().catch", ANALYTICS_PAGE)
        self.assertNotIn("getAnalyticsWorkforce().catch", ANALYTICS_PAGE)


if __name__ == "__main__":
    unittest.main()
