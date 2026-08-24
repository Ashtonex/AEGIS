from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "141_plant_equipment_lifecycle.sql").read_text(
    encoding="utf-8"
)
READINESS_MIGRATION = (
    ROOT / "migrations" / "150_plant_pre_mobilisation_readiness_pack.sql"
).read_text(encoding="utf-8")
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
EXECUTIVE_ROUTER = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
TASK_STACKS = (ROOT / "app" / "shared" / "task_stacks.py").read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
FLEET_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "fleet" / "page.tsx"
).read_text(encoding="utf-8")
EXECUTIVE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "executive" / "page.tsx"
).read_text(encoding="utf-8")


class PlantEquipmentLifecycleContractTests(unittest.TestCase):
    """Protect the Plant & Equipment demand-to-closure workflow spine."""

    def test_migration_adds_lifecycle_tables_without_replacing_fleet_register(self):
        for table in [
            "fleet.plant_requests",
            "fleet.plant_request_items",
            "fleet.plant_reservations",
            "fleet.dispatch_notes",
            "fleet.plant_incidents",
            "fleet.off_hire_records",
            "fleet.return_inspections",
            "fleet.damage_claims",
            "fleet.plant_financial_closures",
        ]:
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", MIGRATION)
        self.assertIn("ALTER TABLE fleet.fleet_assignments", MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS plant_request_id", MIGRATION)
        self.assertNotIn("DROP TABLE fleet.fleet", MIGRATION)
        self.assertNotIn("CREATE TABLE IF NOT EXISTS fleet.equipment_assets", MIGRATION)

    def test_lifecycle_tables_are_service_role_protected_and_permissioned(self):
        self.assertGreaterEqual(MIGRATION.count("FORCE ROW LEVEL SECURITY"), 9)
        self.assertGreaterEqual(MIGRATION.count("service role only"), 9)
        for permission in [
            "fleet.plant_requests.read",
            "fleet.plant_requests.create",
            "fleet.plant_requests.update",
            "fleet.plant_requests.approve",
            "fleet.plant_requests.close",
        ]:
            self.assertIn(permission, MIGRATION)

    def test_router_exposes_bounded_phase_endpoints(self):
        for route in [
            '@router.get("/plant/summary")',
            '@router.get("/plant/requests")',
            '@router.post("/plant/requests"',
            '@router.patch("/plant/requests/{plant_request_id}/status")',
            '@router.post("/plant/requests/{plant_request_id}/reserve"',
            '@router.post("/plant/requests/{plant_request_id}/dispatch"',
            '@router.post("/plant/requests/{plant_request_id}/incidents"',
            '@router.post("/plant/requests/{plant_request_id}/off-hire"',
            '@router.post("/plant/requests/{plant_request_id}/return-inspections"',
            '@router.post("/plant/requests/{plant_request_id}/financial-close"',
        ]:
            self.assertIn(route, FLEET_ROUTER)

    def test_router_keeps_existing_operational_spine_connected(self):
        for marker in [
            "INSERT INTO fleet.fleet_assignments",
            "INSERT INTO fleet.fleet_inspections",
            "INSERT INTO fleet.maintenance_work_orders",
            "INSERT INTO fleet.fuel_transactions",
            "INSERT INTO fleet.utilization_logs",
            "INSERT INTO fleet.plant_financial_closures",
            "equipment.utilization_recorded.v1",
            "plant.asset_dispatched.v1",
            "plant.financial_closure_posted.v1",
            'await require_permission("fleet.plant_requests.approve")(user=user, db=db)',
        ]:
            self.assertIn(marker, FLEET_ROUTER)

    def test_task_stacks_route_to_plant_department(self):
        for entity_type in [
            "plant_request",
            "plant_dispatch",
            "plant_breakdown",
            "plant_return",
            "plant_closure",
        ]:
            self.assertIn(entity_type, TASK_STACKS)
            self.assertIn(entity_type, MIGRATION)

    def test_executive_dashboard_reads_lifecycle_metrics_and_exceptions(self):
        for marker in [
            "plant_open_requests",
            "plant_dispatch_queue",
            "plant_active_deployments",
            "plant_closure_queue",
            "plant_serious_incidents",
            "plant_contribution_margin",
            "exceptions.plant_requests",
            "exceptions.plant_incidents",
        ]:
            self.assertIn(marker, EXECUTIVE_ROUTER)
        self.assertIn("Plant & Equipment", EXECUTIVE_PAGE)

    def test_frontend_exposes_lifecycle_api_and_dashboard_entry(self):
        for marker in [
            "getPlantLifecycleSummary",
            "getPlantRequests",
            "createPlantRequest",
            "dispatchPlantAsset",
            "recordPlantIncident",
            "closePlantFinancials",
            "Plant & Equipment lifecycle control",
            "New Plant Request",
            "No request without a record",
        ]:
            self.assertIn(marker, API + FLEET_PAGE)

    def test_plant_readiness_pack_blocks_dispatch_until_complete(self):
        for marker in [
            "readiness_pack JSONB",
            "readiness_blockers JSONB",
            "readiness_status",
            "plant_manager_ready_at",
            "plant_manager_ready_by",
        ]:
            self.assertIn(marker, READINESS_MIGRATION)
        for marker in [
            "PLANT_READINESS_CONTROLS",
            "plant_manager_declaration",
            "Plant mobilisation blocked",
            "Critical defects remain open",
            "readiness_pack",
            "readiness_blockers",
        ]:
            self.assertIn(marker, FLEET_ROUTER)
        for marker in [
            "Pre-mobilisation readiness pack",
            "Plant Manager mobilisation controls",
            "readiness_pack: readiness",
            "technical_specification",
            "fuel_controls",
            "maintenance_controls",
        ]:
            self.assertIn(marker, FLEET_PAGE)


if __name__ == "__main__":
    unittest.main()
