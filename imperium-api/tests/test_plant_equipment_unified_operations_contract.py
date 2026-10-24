from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_259 = (
    ROOT / "migrations" / "259_plant_equipment_unified_operations.sql"
).read_text(encoding="utf-8")
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
API_FLEET = (
    ROOT.parent / "aegis-web" / "src" / "lib" / "api" / "fleet.ts"
).read_text(encoding="utf-8")
NAV_FILE = (
    ROOT.parent / "aegis-web" / "src" / "lib" / "navigation.ts"
).read_text(encoding="utf-8")


class PlantEquipmentUnifiedOperationsContractTests(unittest.TestCase):
    """Verify that the unified Plant & Equipment operating system contract is satisfied."""

    def test_migration_259_defines_unified_controls(self):
        markers = [
            "start_engine_hours",
            "end_engine_hours",
            "weather_downtime_hours",
            "breakdown_downtime_hours",
            "standing_downtime_hours",
            "output_quantity",
            "approval_status",
            "client_signoff_name",
            "invoiced_amount",
            "invoice_reference",
            "min_guaranteed_hours_day",
            "sunday_premium_multiplier",
            "telematics_status",
            "pm_interval_hours",
            "benchmark_litres_per_hour",
        ]
        for marker in markers:
            self.assertIn(marker, MIGRATION_259, f"Missing {marker} in migration 259")

    def test_fleet_router_has_unified_endpoints(self):
        endpoints = [
            '@router.get("/fuel")',
            '@router.get("/utilization")',
            '@router.patch("/utilization/{log_id}/status")',
            '@router.patch("/external-hire-agreements/{agreement_id}")',
            '@router.post("/external-hire-agreements/{agreement_id}/invoice")',
        ]
        for ep in endpoints:
            self.assertIn(ep, FLEET_ROUTER, f"Missing endpoint {ep} in fleet.py")

    def test_api_client_exports_unified_operations(self):
        methods = [
            "getFleetFuelTransactions",
            "recordFleetFuel",
            "getFleetUtilizationLogs",
            "recordFleetUtilization",
            "updateFleetUtilizationStatus",
            "updateExternalPlantHireAgreement",
            "generateExternalPlantHireInvoice",
        ]
        for method in methods:
            self.assertIn(method, API_FLEET, f"Missing method {method} in api/fleet.ts")

    def test_navigation_has_unified_plant_and_equipment_group(self):
        self.assertIn('name: "Plant & Equipment"', NAV_FILE)
        sub_items = [
            'name: "Command Center"',
            'name: "Asset Register"',
            'name: "Plant Requests & Dispatch"',
            'name: "Commercial Hire & Revenue"',
            'name: "Daily Shift Logs"',
            'name: "Fuel & Consumables"',
            'name: "Maintenance & Workshop"',
            'name: "Operators & Safety"',
            'name: "Asset Financials & P&L"',
        ]
        for item in sub_items:
            self.assertIn(item, NAV_FILE, f"Missing navigation sub-item {item}")

    def test_pages_exist(self):
        web_app = ROOT.parent / "aegis-web" / "src" / "app" / "dashboard"
        expected_pages = [
            web_app / "fleet" / "page.tsx",
            web_app / "equipment" / "page.tsx",
            web_app / "fleet" / "requests" / "page.tsx",
            web_app / "fleet" / "hire" / "page.tsx",
            web_app / "fleet" / "shift-logs" / "page.tsx",
            web_app / "fleet" / "fuel" / "page.tsx",
            web_app / "fleet" / "maintenance" / "page.tsx",
            web_app / "fleet" / "operators" / "page.tsx",
            web_app / "fleet" / "performance" / "page.tsx",
            web_app / "assets" / "page.tsx",
        ]
        for page in expected_pages:
            self.assertTrue(page.exists(), f"Page {page} does not exist")


if __name__ == "__main__":
    unittest.main()
