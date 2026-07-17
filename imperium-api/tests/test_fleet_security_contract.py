from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class FleetSecurityContractTests(unittest.TestCase):
    """Protect Fleet's server-side tenant and action authorization boundary."""

    def test_fleet_router_uses_central_action_rbac(self):
        self.assertIn(
            'include_router(fleet.router, prefix="/api/v1/fleet", tags=["Fleet"], dependencies=[Depends(require_resource_permission("fleet"))])',
            MAIN,
        )
        self.assertIn('Depends(require_permission("fleet.create"))', FLEET_ROUTER)
        self.assertIn('Depends(require_permission("fleet.update"))', FLEET_ROUTER)
        self.assertIn('Depends(require_permission("fleet.delete"))', FLEET_ROUTER)

    def test_payloads_forbid_unexpected_fields_and_dynamic_columns(self):
        self.assertIn("class Payload(BaseModel):", FLEET_ROUTER)
        self.assertIn(
            'ConfigDict(extra="forbid", str_strip_whitespace=True)', FLEET_ROUTER
        )
        self.assertNotIn("payload: dict", FLEET_ROUTER)
        self.assertNotIn("request.json()", FLEET_ROUTER)

    def test_records_and_cross_record_references_are_tenant_scoped(self):
        self.assertGreaterEqual(FLEET_ROUTER.count("organization_id=:org_id"), 10)
        self.assertIn("async def asset_or_404", FLEET_ROUTER)
        self.assertIn("async def tenant_reference", FLEET_ROUTER)
        self.assertIn("async def asset_reference", FLEET_ROUTER)
        self.assertIn("fleet_id=:fleet_id AND organization_id=:org_id", FLEET_ROUTER)

    def test_workflow_decisions_are_updates_not_creates(self):
        self.assertIn('@router.patch("/defects/{defect_id}/decision")', FLEET_ROUTER)
        self.assertIn(
            '@router.patch("/work-orders/{work_order_id}/decision")', FLEET_ROUTER
        )
        self.assertNotIn('@router.post("/defects/{defect_id}/decision")', FLEET_ROUTER)
        self.assertNotIn(
            '@router.post("/work-orders/{work_order_id}/decision")', FLEET_ROUTER
        )


if __name__ == "__main__":
    unittest.main()
