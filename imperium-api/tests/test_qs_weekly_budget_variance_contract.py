from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

SITE_REPORTS = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
FINANCE = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "migrations" / "146_qs_master_to_weekly_budget_variance_controls.sql"
).read_text(encoding="utf-8")
API = (WEB_ROOT / "lib" / "api.ts").read_text(encoding="utf-8")
ENGINEER_PORTAL = (
    WEB_ROOT / "components" / "auth" / "SiteEngineerPortalHome.tsx"
).read_text(encoding="utf-8")


class QsWeeklyBudgetVarianceContractTests(unittest.TestCase):
    def test_schema_links_weekly_budget_lines_to_boq_and_variations(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS projects.weekly_budget_items", MIGRATION)
        self.assertIn("boq_line_item_id    UUID REFERENCES finance.boq_line_items", MIGRATION)
        self.assertIn("variance_id         UUID REFERENCES finance.variations", MIGRATION)
        self.assertIn("ALTER TABLE finance.variations", MIGRATION)
        self.assertIn("client_approval_required BOOLEAN NOT NULL DEFAULT false", MIGRATION)
        self.assertIn("qs_review_status VARCHAR(24) NOT NULL DEFAULT 'pending'", MIGRATION)
        self.assertIn("execution_blocked BOOLEAN NOT NULL DEFAULT true", MIGRATION)
        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("TO service_role", MIGRATION)

    def test_permissions_keep_master_budget_with_qs_and_execution_budget_with_site(self):
        self.assertIn("'projects.execution_budget.read'", MIGRATION)
        self.assertIn("'projects.weekly_budget.line_submit'", MIGRATION)
        self.assertIn("'finance.variation.initiate_site'", MIGRATION)
        self.assertIn("'finance.variation.qs_review'", MIGRATION)
        self.assertIn("'finance.variation.client_approval'", MIGRATION)
        self.assertIn("('Quantity Surveyor', 'finance.budget.read')", MIGRATION)
        self.assertIn("('Site Engineer', 'projects.execution_budget.read')", MIGRATION)

    def test_site_engineer_gets_execution_allowances_not_full_master_budget(self):
        self.assertIn('@router.get("/projects/{project_id}/execution-budget")', SITE_REPORTS)
        self.assertIn("remaining_execution_amount", SITE_REPORTS)
        self.assertNotIn("project_budgets pb JOIN finance.budget_lines", SITE_REPORTS)
        self.assertIn("getExecutionBudget", API)
        self.assertIn("QS allowance", ENGINEER_PORTAL)

    def test_weekly_budget_creates_variance_gate_when_outside_baseline(self):
        self.assertIn("class WeeklyBudgetLinePayload", SITE_REPORTS)
        self.assertIn("variance_required = allowance is None or line.planned_qty > available_qty", SITE_REPORTS)
        self.assertIn("create_site_variation_from_weekly_line", SITE_REPORTS)
        self.assertIn("client_approval_status", SITE_REPORTS)
        self.assertIn("Weekly budget created variance items", SITE_REPORTS)
        self.assertIn("This line will create a variance gate", ENGINEER_PORTAL)

    def test_finance_approval_enforces_qs_and_client_approval(self):
        self.assertIn("QS review is required before approving this site-originated variance.", FINANCE)
        self.assertIn("Client approval is required before approving this variation.", FINANCE)
        self.assertIn("finance.variations", FINANCE)
        self.assertIn("execution_blocked = CASE WHEN :status='approved' THEN false", FINANCE)


if __name__ == "__main__":
    unittest.main()
