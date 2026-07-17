import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "migrations" / "025_workforce_compliance_deployment_gate.sql"
).read_text(encoding="utf-8")
WORKFORCE_ROUTER = (ROOT / "routers" / "workforce.py").read_text(encoding="utf-8")
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
COMPLIANCE_ROUTER = (ROOT / "routers" / "compliance_items.py").read_text(
    encoding="utf-8"
)
COMPLIANCE_SERVICE = (ROOT / "core" / "compliance.py").read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
COMPLIANCE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "compliance" / "page.tsx"
).read_text(encoding="utf-8")
SOURCE_BACKED_MIGRATION = (
    ROOT / "migrations" / "028_compliance_source_backed_controls.sql"
).read_text(encoding="utf-8")
OVERRIDE_MIGRATION = (
    ROOT / "migrations" / "029_compliance_gate_override_audit.sql"
).read_text(encoding="utf-8")


class WorkforceComplianceGateContractTests(unittest.TestCase):
    def test_migration_creates_service_role_only_gate_tables(self):
        self.assertIn("CREATE SCHEMA IF NOT EXISTS compliance", MIGRATION)
        self.assertIn("compliance.deployment_requirements", MIGRATION)
        self.assertIn("compliance.deployment_gate_checks", MIGRATION)
        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn(
            "REVOKE ALL ON compliance.deployment_requirements, compliance.deployment_gate_checks FROM anon, authenticated",
            MIGRATION,
        )
        self.assertIn('CREATE POLICY "Compliance service role only"', MIGRATION)

    def test_gate_links_to_workforce_and_fleet_authoritative_records(self):
        self.assertIn(
            "operator_employee_id UUID REFERENCES hr.employees(id)", MIGRATION
        )
        self.assertIn(
            "compliance_gate_check_id UUID REFERENCES compliance.deployment_gate_checks(id)",
            MIGRATION,
        )
        self.assertIn("ALTER TABLE hr.project_allocations", MIGRATION)
        self.assertIn("compliance_status VARCHAR(24)", MIGRATION)

    def test_shared_gate_enforces_verified_unexpired_certifications(self):
        self.assertIn("async def validate_employee_deployment", COMPLIANCE_SERVICE)
        self.assertIn("employment_status", COMPLIANCE_SERVICE)
        self.assertIn("hr.employee_certifications", COMPLIANCE_SERVICE)
        self.assertIn("verification_status", COMPLIANCE_SERVICE)
        self.assertIn("expires_on", COMPLIANCE_SERVICE)
        self.assertIn("Compliance gate blocked deployment.", COMPLIANCE_SERVICE)

    def test_blocked_and_passed_gates_emit_domain_events(self):
        self.assertIn("compliance.deployment_blocked.v1", COMPLIANCE_SERVICE)
        self.assertIn("compliance.deployment_cleared.v1", COMPLIANCE_SERVICE)
        self.assertIn("INSERT INTO core.domain_events", COMPLIANCE_SERVICE)
        self.assertIn("await db.commit()", COMPLIANCE_SERVICE)

    def test_workforce_allocation_uses_gate_before_project_deployment(self):
        self.assertIn(
            "from fastapi import APIRouter, Depends, HTTPException, Query, status",
            WORKFORCE_ROUTER,
        )
        self.assertIn("validate_employee_deployment", WORKFORCE_ROUTER)
        self.assertIn('gate_type="workforce_project_allocation"', WORKFORCE_ROUTER)
        self.assertIn("compliance_gate_check_id", WORKFORCE_ROUTER)
        self.assertIn("compliance_status", WORKFORCE_ROUTER)

    def test_fleet_assignment_uses_gate_for_operator_deployment(self):
        self.assertIn("operator_employee_id", FLEET_ROUTER)
        self.assertIn('gate_type="equipment_assignment"', FLEET_ROUTER)
        self.assertIn('role_on_project="Equipment Operator"', FLEET_ROUTER)
        self.assertIn('equipment_type=asset.get("vehicle_type")', FLEET_ROUTER)

    def test_compliance_requirements_are_api_managed_and_auditable(self):
        self.assertIn('@router.get("/deployment-requirements")', COMPLIANCE_ROUTER)
        self.assertIn('@router.post("/deployment-requirements"', COMPLIANCE_ROUTER)
        self.assertIn(
            '@router.patch("/deployment-requirements/{requirement_id}")',
            COMPLIANCE_ROUTER,
        )
        self.assertIn(
            '@router.delete("/deployment-requirements/{requirement_id}")',
            COMPLIANCE_ROUTER,
        )
        self.assertIn(
            'require_permission("compliance.requirement.read")', COMPLIANCE_ROUTER
        )
        self.assertIn(
            'require_permission("compliance.requirement.manage")', COMPLIANCE_ROUTER
        )
        self.assertIn("compliance.requirement.created.v1", COMPLIANCE_ROUTER)
        self.assertIn("compliance.requirement.updated.v1", COMPLIANCE_ROUTER)
        self.assertIn("compliance.requirement.archived.v1", COMPLIANCE_ROUTER)

    def test_gate_history_is_available_without_browser_fallback(self):
        self.assertIn('@router.get("/deployment-gate-checks")', COMPLIANCE_ROUTER)
        self.assertIn('require_permission("compliance.gate.read")', COMPLIANCE_ROUTER)
        self.assertIn("missing_requirements", COMPLIANCE_ROUTER)
        self.assertIn("CAST(:scope AS varchar)", COMPLIANCE_ROUTER)
        self.assertIn("CAST(:active AS boolean)", COMPLIANCE_ROUTER)
        self.assertIn("CAST(:employee_id AS uuid)", COMPLIANCE_ROUTER)
        self.assertIn("getComplianceDeploymentRequirements", WEB_API)
        self.assertIn("createComplianceDeploymentRequirement", WEB_API)
        self.assertIn("archiveComplianceDeploymentRequirement", WEB_API)
        self.assertIn("getComplianceDeploymentGateChecks", WEB_API)
        self.assertIn("allowFallback: false", WEB_API)

    def test_controlled_gate_override_is_audited_and_ui_visible(self):
        self.assertIn("override_by UUID REFERENCES core.users(id)", OVERRIDE_MIGRATION)
        self.assertIn("override_at TIMESTAMPTZ", OVERRIDE_MIGRATION)
        self.assertIn("deployment_gate_checks_override_idx", OVERRIDE_MIGRATION)
        self.assertIn(
            '@router.post("/deployment-gate-checks/{check_id}/override")',
            COMPLIANCE_ROUTER,
        )
        self.assertIn(
            'require_permission("compliance.gate.override")', COMPLIANCE_ROUTER
        )
        self.assertIn(
            "Only blocked deployment gate checks can be overridden.", COMPLIANCE_ROUTER
        )
        self.assertIn("compliance.deployment_override_recorded.v1", COMPLIANCE_ROUTER)
        self.assertIn("override_reason", COMPLIANCE_ROUTER)
        self.assertIn("override_reference", COMPLIANCE_ROUTER)
        self.assertIn("override_by_email", COMPLIANCE_ROUTER)
        self.assertIn("overrideComplianceDeploymentGateCheck", WEB_API)
        self.assertIn("Record controlled override", COMPLIANCE_PAGE)
        self.assertIn("Deployment gate override evidence", COMPLIANCE_PAGE)
        self.assertIn("Overrides do not erase missing credentials.", COMPLIANCE_PAGE)
        self.assertIn("Authority reference", COMPLIANCE_PAGE)

    def test_compliance_workspace_is_source_backed_not_seeded(self):
        self.assertIn("compliance.corrective_actions", SOURCE_BACKED_MIGRATION)
        self.assertIn("ENABLE ROW LEVEL SECURITY", SOURCE_BACKED_MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", SOURCE_BACKED_MIGRATION)
        self.assertIn("compliance.corrective_action.read", SOURCE_BACKED_MIGRATION)
        self.assertIn("compliance.corrective_action.create", SOURCE_BACKED_MIGRATION)
        self.assertIn("FROM compliance.corrective_actions", COMPLIANCE_ROUTER)
        self.assertIn("INSERT INTO compliance.corrective_actions", COMPLIANCE_ROUTER)
        self.assertIn("compliance.corrective_action.created.v1", COMPLIANCE_ROUTER)
        self.assertIn("FROM fleet.fleet_inspections", COMPLIANCE_ROUTER)
        self.assertIn("WITH obligations AS", COMPLIANCE_ROUTER)
        self.assertIn(
            "Score appears after obligations, credentials, gates, or corrective actions are recorded.",
            COMPLIANCE_PAGE,
        )
        self.assertIn("Compliance data could not be loaded.", COMPLIANCE_PAGE)
        self.assertIn(
            "The compliance feed is still synchronizing. Please retry once the connection is ready.",
            COMPLIANCE_PAGE,
        )
        self.assertIn("Promise.allSettled", COMPLIANCE_PAGE)
        self.assertIn("Obligations register could not be loaded.", COMPLIANCE_PAGE)
        self.assertIn("Employee credentials could not be loaded.", COMPLIANCE_PAGE)
        self.assertIn("Deployment gate checks could not be loaded.", COMPLIANCE_PAGE)
        self.assertNotIn("getComplianceObligations().catch", COMPLIANCE_PAGE)
        self.assertNotIn("getComplianceEmployeeCredentials().catch", COMPLIANCE_PAGE)
        self.assertNotIn("getComplianceEquipmentCredentials().catch", COMPLIANCE_PAGE)
        self.assertNotIn("getComplianceDeploymentRequirements().catch", COMPLIANCE_PAGE)
        self.assertNotIn(
            "getComplianceDeploymentGateChecks({ limit: 100 }).catch", COMPLIANCE_PAGE
        )
        self.assertNotIn("getComplianceCorrectiveActions().catch", COMPLIANCE_PAGE)
        self.assertNotIn("getHseIncidents().catch", COMPLIANCE_PAGE)
        self.assertNotIn("getComplianceScore().catch", COMPLIANCE_PAGE)
        self.assertNotIn("default mock compliance score", COMPLIANCE_PAGE)
        self.assertNotIn("score: 87", COMPLIANCE_PAGE)
        for fake_value in [
            "Tafadzwa Mudekwa",
            "Chipo Moyo",
            "CAT-D9-04",
            "VOL-EX-22",
            "Chief Accountant",
            "Site Agent B",
            "ca-new",
            "Fallback mock data",
            "Seed fallback obligations",
        ]:
            self.assertNotIn(fake_value, COMPLIANCE_ROUTER + COMPLIANCE_PAGE)

    def test_no_superadmin_or_user_seed_is_created(self):
        combined = (
            MIGRATION
            + SOURCE_BACKED_MIGRATION
            + OVERRIDE_MIGRATION
            + WORKFORCE_ROUTER
            + FLEET_ROUTER
            + COMPLIANCE_SERVICE
            + COMPLIANCE_ROUTER
        )
        self.assertNotIn("INSERT INTO core.users", combined)
        self.assertNotIn("INSERT INTO core.user_roles", combined)
        self.assertNotIn("SUPERADMIN", combined)


if __name__ == "__main__":
    unittest.main()
