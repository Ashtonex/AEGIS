from pathlib import Path
import ast
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFORCE_ROUTER = (ROOT / "routers" / "workforce.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
WORKFORCE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "workforce" / "page.tsx"
).read_text(encoding="utf-8")


class WorkforceSecurityContractTests(unittest.TestCase):
    """Prevent regressions in the workforce tenant and SQL-input boundary."""

    def test_workforce_router_has_authentication_and_explicit_action_permissions(self):
        self.assertIn(
            'include_router(workforce.router, prefix="/api/v1/workforce", tags=["Workforce"], dependencies=[Depends(get_current_user)])',
            MAIN,
        )
        module = ast.parse(WORKFORCE_ROUTER)
        for node in module.body:
            if isinstance(node, ast.AsyncFunctionDef) and node.decorator_list:
                if node.name == "list_my_attendance":
                    self.assertIn("resolve_own_employee_id", ast.unparse(node))
                    continue
                self.assertTrue(
                    any(
                        "require_permission(" in ast.unparse(default)
                        for default in node.args.defaults
                    ),
                    node.name,
                )
        self.assertIn('@router.get("/{employee_id}")', WORKFORCE_ROUTER)
        self.assertIn("Employee retrieved.", WORKFORCE_ROUTER)
        self.assertLess(
            WORKFORCE_ROUTER.index('@router.get("/allocations")'),
            WORKFORCE_ROUTER.index('@router.get("/{employee_id}")'),
        )

    def test_all_record_access_is_organization_scoped(self):
        # List, lookup, update, and soft-delete must all carry the authenticated org predicate.
        self.assertGreaterEqual(WORKFORCE_ROUTER.count("organization_id=:org_id"), 4)
        self.assertIn(
            "return await register_worker(payload=payload, db=db, key=key, user=user)",
            WORKFORCE_ROUTER,
        )
        self.assertIn('"org_id": user["org_id"]', WORKFORCE_ROUTER)

    def test_dynamic_columns_are_validated_before_sql_construction(self):
        self.assertIn("class Payload(BaseModel):", WORKFORCE_ROUTER)
        self.assertIn('ConfigDict(extra="forbid"', WORKFORCE_ROUTER)
        self.assertIn("PersonUpdate as EmployeeUpdate", WORKFORCE_ROUTER)
        self.assertIn("return await revise_worker", WORKFORCE_ROUTER)
        self.assertIn("key: CommandKey", WORKFORCE_ROUTER)
        self.assertNotIn("payload: dict", WORKFORCE_ROUTER)

    def test_workforce_page_degrades_optional_sources_without_aborting_register(self):
        self.assertIn("Promise.allSettled", WORKFORCE_PAGE)
        self.assertIn('if (workforceResult.status === "rejected")', WORKFORCE_PAGE)
        self.assertIn(
            "HR document records could not be loaded; employee register remains available.",
            WORKFORCE_PAGE,
        )
        self.assertIn(
            "Compliance records could not be loaded; employee register remains available.",
            WORKFORCE_PAGE,
        )
        self.assertIn(
            "The workforce register is still synchronizing. Please retry once the connection is ready.",
            WORKFORCE_PAGE,
        )
        self.assertNotIn(
            "const [workforceResult, hrResult, complianceResult] = await Promise.all([",
            WORKFORCE_PAGE,
        )

    def test_workforce_surfaces_deployment_gate_status(self):
        self.assertIn("getComplianceDeploymentGateChecks", WORKFORCE_PAGE)
        self.assertIn("Workforce deployment gate status", WORKFORCE_PAGE)
        self.assertIn("Scenario C/F control", WORKFORCE_PAGE)
        self.assertIn("Blocked deployments", WORKFORCE_PAGE)
        self.assertIn("Missing credential evidence", WORKFORCE_PAGE)
        self.assertIn("Deployment gate evidence", WORKFORCE_PAGE)
        self.assertIn(
            "expired, missing or unverified credentials block", WORKFORCE_PAGE
        )


if __name__ == "__main__":
    unittest.main()
