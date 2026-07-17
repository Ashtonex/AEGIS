from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "024_equipment_finance_integration.sql").read_text(
    encoding="utf-8"
)
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
FLEET_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "fleet" / "page.tsx"
).read_text(encoding="utf-8")
FINANCE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "finance" / "page.tsx"
).read_text(encoding="utf-8")
EQUIPMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "equipment" / "page.tsx"
).read_text(encoding="utf-8")


class EquipmentFinanceContractTests(unittest.TestCase):
    """Protect the Equipment -> Finance vertical slice contract."""

    def test_migration_adds_project_allocation_and_profitability_fields(self):
        self.assertIn("hourly_charge_rate", MIGRATION)
        self.assertIn("hourly_operating_cost", MIGRATION)
        self.assertIn("monthly_ownership_cost", MIGRATION)
        self.assertIn("current_project_id", MIGRATION)
        self.assertIn("cost_transaction_id", MIGRATION)
        self.assertIn("fleet_utilization_project_idx", MIGRATION)
        self.assertIn("fleet.profitability.view", MIGRATION)

    def test_fleet_posts_equipment_costs_to_finance(self):
        self.assertIn("async def post_equipment_cost", FLEET_ROUTER)
        self.assertIn("INSERT INTO finance.cost_transactions", FLEET_ROUTER)
        self.assertIn('source_type="fleet_utilization_log"', FLEET_ROUTER)
        self.assertIn('source_type="fleet_fuel_transaction"', FLEET_ROUTER)
        self.assertIn('source_type="fleet_maintenance_work_order"', FLEET_ROUTER)
        self.assertIn(
            "ON CONFLICT (organization_id, source_type, source_id, cost_category) DO UPDATE",
            FLEET_ROUTER,
        )

    def test_fleet_reads_require_explicit_permission(self):
        for marker in [
            'async def list_assets(user: dict = Depends(require_permission("fleet.read"))',
            'async def list_assignments(user: dict = Depends(require_permission("fleet.read"))',
            'async def list_asset_inspections(fleet_id: UUID, user: dict = Depends(require_permission("fleet.read"))',
            'async def get_asset(fleet_id: UUID, user: dict = Depends(require_permission("fleet.read"))',
        ]:
            self.assertIn(marker, FLEET_ROUTER)

    def test_events_are_emitted_for_operational_and_finance_records(self):
        for event_name in [
            "equipment.deployed.v1",
            "equipment.utilization_recorded.v1",
            "equipment.fuel_recorded.v1",
            "equipment.breakdown_reported.v1",
            "equipment.service_completed.v1",
            "finance.actual_cost_created.v1",
        ]:
            self.assertIn(event_name, FLEET_ROUTER)
        self.assertIn(
            "ON CONFLICT (organization_id, idempotency_key) DO NOTHING", FLEET_ROUTER
        )

    def test_frontend_normalizes_legacy_equipment_payloads(self):
        self.assertIn("fleet_id: assetId", API)
        self.assertIn("inspection_type: 'pre_start'", API)
        self.assertIn("minor_defects: 'conditional'", API)
        self.assertIn("major_defects: 'fail'", API)
        self.assertIn("occurred_on:", API)
        self.assertIn("fuel_litres:", API)

    def test_fleet_page_exposes_scenario_b_profitability_controls(self):
        for marker in [
            "Scenario B cost/profitability control",
            "Equipment to Finance",
            "Hourly charge rate",
            "Hourly operating cost",
            "Monthly ownership cost",
            "Estimated revenue",
            "Estimated operating cost",
            "Estimated margin",
            "Cost allocation readiness",
            "Project allocation",
            "Operator assignment",
            "Finance cost allocation",
        ]:
            self.assertIn(marker, FLEET_PAGE)

        for live_field in [
            "hourly_charge_rate",
            "hourly_operating_cost",
            "monthly_ownership_cost",
            "monthly_revenue",
            "monthly_operating_cost",
            "current_project_id",
            "current_assignment_id",
        ]:
            self.assertIn(live_field, FLEET_PAGE)

    def test_fleet_page_surfaces_equipment_assignment_gate_status(self):
        for marker in [
            "getComplianceDeploymentGateChecks",
            "Equipment assignment gate status",
            "Scenario C/F control",
            "operator deployments are blocked",
            "Blocked deployments",
            "Missing credential evidence",
            "Linked equipment assignment gate evidence",
            "Deployment gate history unavailable",
        ]:
            self.assertIn(marker, FLEET_PAGE)

        for live_field in [
            "missing_requirements",
            "employee_name",
            "employee_number",
            "fleet_id",
            "asset_code",
            "vehicle_registration",
            "project_name",
        ]:
            self.assertIn(live_field, FLEET_PAGE)

    def test_finance_page_degrades_supporting_sources_without_killing_kpis(self):
        self.assertIn("Promise.allSettled", FINANCE_PAGE)
        self.assertIn(
            "The finance feed is still synchronizing. Please retry once the connection is ready.",
            FINANCE_PAGE,
        )
        self.assertIn("Project financial summaries could not be loaded.", FINANCE_PAGE)
        self.assertIn("Cost codes could not be loaded.", FINANCE_PAGE)
        self.assertIn("Variation register could not be loaded.", FINANCE_PAGE)
        self.assertIn("Progress claims could not be loaded.", FINANCE_PAGE)
        self.assertIn("Budgets could not be loaded.", FINANCE_PAGE)

    def test_equipment_page_surfaces_inspection_load_failure(self):
        for marker in [
            "Inspection history could not be loaded.",
            "You do not have permission to view inspection history.",
        ]:
            self.assertIn(marker, EQUIPMENT_PAGE)
        self.assertNotIn(".catch(() => setInspections([]))", EQUIPMENT_PAGE)


if __name__ == "__main__":
    unittest.main()
