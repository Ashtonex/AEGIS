from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
EXECUTIVE_ROUTER = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
EXECUTIVE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "executive" / "page.tsx"
).read_text(encoding="utf-8")


class ExecutiveExceptionsContractTests(unittest.TestCase):
    """Guard executive decision signals as linked, source-backed exceptions."""

    def test_executive_exceptions_include_cross_module_decision_signals(self):
        for source in [
            "finance.project_forecasts",
            "procurement.suppliers",
            "fleet.fleet",
            "fleet.utilization_logs",
            "projects.hse_incidents",
            "projects.compliance_items",
            "projects.project_profiles",
            "projects.daily_site_reports",
            "projects.daily_report_labour",
            "projects.daily_report_equipment",
            "projects.daily_report_materials",
        ]:
            self.assertIn(source, EXECUTIVE_ROUTER)
        for category in [
            "Financial forecast",
            "Supplier performance",
            "Equipment utilisation",
            "HSE incident",
            "Compliance expiry",
            "Project viability",
            "Site report exception",
        ]:
            self.assertIn(category, EXECUTIVE_ROUTER)

    def test_exception_payloads_include_evidence_and_tenant_scope(self):
        self.assertIn("jsonb_build_object", EXECUTIVE_ROUTER)
        self.assertIn("f.organization_id=:org_id", EXECUTIVE_ROUTER)
        self.assertIn("s.organization_id=:org_id", EXECUTIVE_ROUTER)
        self.assertIn(
            "f.organization_id=:org_id AND f.is_deleted=false", EXECUTIVE_ROUTER
        )
        self.assertIn("current_project_id", EXECUTIVE_ROUTER)
        self.assertIn("daily_site_report_id", EXECUTIVE_ROUTER)
        self.assertIn("material_wastage", EXECUTIVE_ROUTER)
        self.assertIn("r.status='approved'", EXECUTIVE_ROUTER)
        self.assertIn("project_id", EXECUTIVE_ROUTER)

    def test_executive_ui_drills_linked_exceptions_to_project_detail(self):
        self.assertIn(
            "with source evidence and drill-through where a project is linked",
            EXECUTIVE_PAGE,
        )
        self.assertIn(
            'const drillProjectId = item.project_id ?? (item.category === "Project viability" ? item.id : null)',
            EXECUTIVE_PAGE,
        )
        self.assertIn("Evidence:", EXECUTIVE_PAGE)


if __name__ == "__main__":
    unittest.main()
