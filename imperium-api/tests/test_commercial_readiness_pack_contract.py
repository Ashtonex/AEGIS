from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
MIGRATION = (ROOT / "migrations" / "151_commercial_pre_mobilisation_readiness_pack.sql").read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    REPO / "supabase" / "migrations" / "20260823160701_commercial_pre_mobilisation_readiness_pack.sql"
).read_text(encoding="utf-8")
PROJECTS_ROUTER = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
TENDER_ROUTER = (ROOT / "routers" / "tender_bids.py").read_text(encoding="utf-8")
QUOTATIONS_ROUTER = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
TASK_STACKS = (ROOT / "app" / "shared" / "task_stacks.py").read_text(encoding="utf-8")
PROJECTS_PAGE = (REPO / "aegis-web" / "src" / "app" / "dashboard" / "projects" / "page.tsx").read_text(encoding="utf-8")
API = (REPO / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


class CommercialReadinessPackContractTests(unittest.TestCase):
    def test_migration_adds_commercial_clearance_state_permissions_and_tasks(self):
        for sql in (MIGRATION, SUPABASE_MIGRATION):
            self.assertIn("commercial_readiness_status", sql)
            self.assertIn("commercial_readiness_pack", sql)
            self.assertIn("commercial_readiness_blockers", sql)
            self.assertIn("commercial_clearance_statement", sql)
            self.assertIn("projects.commercial_readiness.read", sql)
            self.assertIn("projects.commercial_readiness.update", sql)
            self.assertIn("projects.commercial_readiness.clear", sql)
            self.assertIn("'commercial_readiness'", sql)
            self.assertIn("Contract document collection", sql)
            self.assertIn("Commercial clearance", sql)

    def test_project_api_blocks_mobilisation_until_commercial_clearance(self):
        self.assertIn('@router.get("/{project_id}/commercial-readiness")', PROJECTS_ROUTER)
        self.assertIn('@router.patch("/{project_id}/commercial-readiness")', PROJECTS_ROUTER)
        self.assertIn('@router.post("/{project_id}/commercial-readiness/clear")', PROJECTS_ROUTER)
        self.assertIn("project.commercial_readiness_cleared.v1", PROJECTS_ROUTER)
        self.assertIn('commercial["status"] != "cleared"', PROJECTS_ROUTER)
        self.assertIn("Commercial readiness must be cleared before mobilisation", PROJECTS_ROUTER)

    def test_award_paths_open_commercial_readiness_task_stack(self):
        self.assertIn('"commercial_readiness": "commercial"', TASK_STACKS)
        for source in (TENDER_ROUTER, QUOTATIONS_ROUTER):
            self.assertIn("commercial_readiness_status", source)
            self.assertIn('entity_type="commercial_readiness"', source)

    def test_frontend_exposes_commercial_readiness_panel(self):
        self.assertIn("CommercialReadinessPanel", PROJECTS_PAGE)
        self.assertIn("COMMERCIAL_READINESS_ROLES", PROJECTS_PAGE)
        self.assertIn("clearProjectCommercialReadiness", PROJECTS_PAGE)
        self.assertIn("getProjectCommercialReadiness", API)
        self.assertIn("updateProjectCommercialReadiness", API)
        self.assertIn("clearProjectCommercialReadiness", API)
        self.assertIn("commercial_readiness", API)


if __name__ == "__main__":
    unittest.main()
