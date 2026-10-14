import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
SITE_DAY_ROUTER = (ROOT / "routers" / "site_day.py").read_text(encoding="utf-8")
MIGRATION_260 = (ROOT / "migrations" / "260_site_operations_unified_flow.sql").read_text(encoding="utf-8")


class SiteOperationsUnifiedFlowTests(unittest.TestCase):
    """Guard the Site Operations Unified Workflow upgrade (Migration 260)."""

    def test_migration_260_structure(self):
        self.assertIn("projects.daily_site_reports", MIGRATION_260)
        self.assertIn("briefing_id", MIGRATION_260)
        self.assertIn("procurement.material_candidates", MIGRATION_260)
        self.assertIn("material_description", MIGRATION_260)
        self.assertIn("candidate_id", MIGRATION_260)
        self.assertIn("site_worker_id", MIGRATION_260)
        self.assertIn("attendance_id", MIGRATION_260)
        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION_260)

    def test_site_day_ensures_daily_report_draft(self):
        self.assertIn("ensure_daily_report_draft", SITE_DAY_ROUTER)
        self.assertIn("sync_attendance_to_daily_report", SITE_DAY_ROUTER)
        self.assertIn("daily_report_id", SITE_DAY_ROUTER)
        self.assertIn("/day/{briefing_id}/daily-report", SITE_DAY_ROUTER)

    def test_free_text_material_request_flow(self):
        self.assertIn("material_description", ROUTER)
        self.assertIn("candidate_id", ROUTER)
        self.assertIn("procurement.material_candidates", ROUTER)
        self.assertIn('@router.get("/materials/suggest")', ROUTER)
        self.assertIn('@router.post("/materials/candidates/{candidate_id}/promote")', ROUTER)

    def test_daily_report_enhanced_receipts_issues_completeness(self):
        self.assertIn("sync_attendance_to_daily_report", ROUTER)
        self.assertIn("material_receipts", ROUTER)
        self.assertIn("material_issues", ROUTER)
        self.assertIn("open_requests", ROUTER)
        self.assertIn("safety_briefing", ROUTER)
        self.assertIn("completeness", ROUTER)
        self.assertIn("score_percent", ROUTER)

    def test_execution_budget_visibility(self):
        self.assertIn("total_committed", ROUTER)
        self.assertIn("total_actual_cost", ROUTER)
        self.assertIn("material_actual_cost", ROUTER)
        self.assertIn("forecast_headroom", ROUTER)
        self.assertIn("budget_explanation", ROUTER)


if __name__ == "__main__":
    unittest.main()
