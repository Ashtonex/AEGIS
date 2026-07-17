from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "automated_reports.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "027_reporting_controls.sql").read_text(
    encoding="utf-8"
)
REPORTS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "reports" / "page.tsx"
).read_text(encoding="utf-8")


class AutomatedReportingContractTests(unittest.TestCase):
    """Guard automated reporting as operational ERP records, not demo rows."""

    def test_reporting_schema_stores_evidence_and_publication_audit(self):
        for column in [
            "evidence_snapshot JSONB",
            "project_id UUID",
            "project_name VARCHAR(255)",
            "start_date DATE",
            "end_date DATE",
            "published_at TIMESTAMPTZ",
            "approved_by UUID",
        ]:
            self.assertIn(column, MIGRATION)
        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn('CREATE POLICY "Automated reports service role only"', MIGRATION)

    def test_recent_and_scheduled_reports_do_not_return_demo_rows(self):
        self.assertIn("FROM executive.automated_reports", ROUTER)
        self.assertNotIn("Daily Site Summary - Harare Bypass", ROUTER)
        self.assertNotIn("Monthly Financial Close", ROUTER)
        self.assertNotIn("sch1", ROUTER)
        self.assertNotIn("run1", ROUTER)

    def test_generated_reports_capture_operational_source_snapshot(self):
        self.assertIn("async def _report_evidence_snapshot", ROUTER)
        for source in [
            "projects.daily_site_reports",
            "projects.daily_report_labour",
            "projects.daily_report_equipment",
            "projects.daily_report_materials",
            "procurement.purchase_orders",
            "procurement.supplier_invoices",
            "finance.cost_transactions",
        ]:
            self.assertIn(source, ROUTER)
        self.assertIn("CAST(:evidence_snapshot AS jsonb)", ROUTER)
        self.assertIn('snapshot["source_status"]', ROUTER)
        self.assertIn("approved_by = :user_id", ROUTER)
        self.assertIn("except HTTPException:", ROUTER)

    def test_reporting_routes_use_action_permissions_and_strict_payloads(self):
        self.assertIn('require_permission("automated_reports.read")', ROUTER)
        self.assertIn('require_permission("automated_reports.create")', ROUTER)
        self.assertIn('require_permission("automated_reports.approve")', ROUTER)
        self.assertNotIn("get_current_user", ROUTER)
        self.assertIn('ConfigDict(extra="forbid", str_strip_whitespace=True)', ROUTER)
        self.assertIn('format: Literal["pdf", "excel"] = "pdf"', ROUTER)
        self.assertIn("Report end_date must be on or after start_date.", ROUTER)

    def test_recent_runs_return_and_ui_surfaces_evidence_snapshot(self):
        self.assertIn('"evidence_snapshot": r.get("evidence_snapshot") or {}', ROUTER)
        self.assertIn('"source_status":', ROUTER)
        self.assertIn("function reportEvidenceSummary", REPORTS_PAGE)
        self.assertIn("Source evidence:", REPORTS_PAGE)
        self.assertIn("Reporting data could not be loaded.", REPORTS_PAGE)
        self.assertIn(
            "The reporting feed is still synchronizing. Please retry once the connection is ready.",
            REPORTS_PAGE,
        )
        self.assertIn("Promise.allSettled", REPORTS_PAGE)
        self.assertIn("Available report templates could not be loaded.", REPORTS_PAGE)
        self.assertIn("Scheduled reports could not be loaded.", REPORTS_PAGE)
        self.assertIn("Recent report runs could not be loaded.", REPORTS_PAGE)
        self.assertIn("No source evidence snapshot captured", REPORTS_PAGE)
        self.assertIn(
            "No report templates are available from the reporting service.",
            REPORTS_PAGE,
        )
        self.assertNotIn("getAvailableReports().catch", REPORTS_PAGE)
        self.assertNotIn("getScheduledReports().catch", REPORTS_PAGE)
        self.assertNotIn("getRecentReports().catch", REPORTS_PAGE)
        self.assertNotIn('Daily Site Summary", category: "site"', REPORTS_PAGE)


if __name__ == "__main__":
    unittest.main()
