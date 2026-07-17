from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class GeneratedRouterRbacContractTests(unittest.TestCase):
    """Keep generated CRUD routers behind the action-level RBAC dependency."""

    def test_generated_crud_routers_use_resource_permission_dependency(self):
        resources = (
            "projects site_operations workforce fleet equipment_assets procurement_orders inventory_items "
            "budgets financial_performance quotations hr_records compliance_items hse_incidents documents "
            "crm_contacts crm_organizations crm_activities crm_automations client_portal_tickets supplier_records "
            "internal_messages kpi_metrics bi_reports risk_register tender_bids maintenance_schedules "
            "automated_reports website_enquiries"
        ).split()
        for resource in resources:
            pattern = rf"include_router\({resource}\.router,.*dependencies=\[Depends\(require_resource_permission\(\"{resource}\"\)\)\]"
            self.assertRegex(
                MAIN, pattern, msg=f"{resource} is missing central action-level RBAC"
            )

    def test_security_dependency_checks_active_identity_and_role_tenant(self):
        security = (ROOT / "core" / "security.py").read_text(encoding="utf-8")
        self.assertIn("is_active = true", security)
        self.assertIn("is_deleted = false", security)
        self.assertIn("r.organization_id = :org_id", security)

    def test_public_intake_cannot_bypass_the_hardened_router(self):
        crm = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
        intake = (ROOT / "routers" / "public_intake.py").read_text(encoding="utf-8")
        self.assertNotIn('@router.post("/leads/web-intake")', crm)
        self.assertIn("A valid Idempotency-Key header is required.", intake)
        self.assertIn(
            "Internal primary keys must never cross the public API boundary.", intake
        )


if __name__ == "__main__":
    unittest.main()
