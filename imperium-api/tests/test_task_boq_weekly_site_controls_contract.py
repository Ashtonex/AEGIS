from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
QUOTATIONS = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
PROCUREMENT = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")
SITE_REPORTS = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
TASKS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "tasks" / "page.tsx"
).read_text(encoding="utf-8")
BUILDER_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "quotations" / "builder" / "page.tsx"
).read_text(encoding="utf-8")
SITE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "site-operations" / "page.tsx"
).read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "142_task_boq_weekly_site_controls.sql").read_text(encoding="utf-8")


class TaskBoqWeeklySiteControlsContractTests(unittest.TestCase):
    def test_boq_import_can_link_to_source_task_document_and_quotation(self):
        self.assertIn("source_type: Optional[str] = Form", QUOTATIONS)
        self.assertIn("task_id: Optional[str] = Form", QUOTATIONS)
        self.assertIn("document_id: Optional[str] = Form", QUOTATIONS)
        self.assertIn("_load_autonomous_quote_source", QUOTATIONS)
        self.assertIn("_find_existing_quotation_id", QUOTATIONS)
        self.assertIn("_link_task_to_quotation", QUOTATIONS)
        self.assertIn("INSERT INTO core.document_links", QUOTATIONS)
        self.assertIn("boq_imported_at = NOW()", QUOTATIONS)
        self.assertIn('"project": "project_id"', QUOTATIONS)
        self.assertIn("context?: { source_type?: string", WEB_API)
        self.assertIn("formData.append(key, value)", WEB_API)
        self.assertIn("source_type: sourceType", BUILDER_PAGE)
        self.assertIn("task_id: paramTaskId", BUILDER_PAGE)
        self.assertIn("BOQ imported", TASKS_PAGE)

    def test_estimations_associate_and_task_boq_columns_are_seeded(self):
        self.assertIn("boq_document_id UUID REFERENCES core.documents", MIGRATION)
        self.assertIn("Estimations & Quotations Associate", MIGRATION)
        self.assertIn("quotations.boq_builder.use", MIGRATION)
        self.assertIn("'crm_tasks.read'", MIGRATION)
        self.assertIn("'teams.read'", MIGRATION)
        self.assertIn("'quotations.create'", MIGRATION)
        self.assertIn("'documents.link'", MIGRATION)

    def test_weekly_budget_gate_blocks_requisitions_rfq_and_site_requests(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS projects.weekly_budgets", MIGRATION)
        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("TO service_role", MIGRATION)
        self.assertIn("idx_weekly_budgets_project_week_unique", MIGRATION)
        self.assertIn("async def ensure_current_weekly_budget", PROCUREMENT)
        self.assertIn("Submit this week's project/site budget before creating requisitions or RFQs.", PROCUREMENT)
        self.assertIn("weekly_budget_id", PROCUREMENT)
        self.assertIn("async def ensure_current_weekly_budget", SITE_REPORTS)
        self.assertIn("Submit this week's site budget before requesting materials.", SITE_REPORTS)

    def test_site_day_requires_labour_toolbox_and_ppe_ticks(self):
        for marker in [
            "labour_count_completed: bool = False",
            "toolbox_talk_completed: bool = False",
            "ppe_check_completed: bool = False",
            "Labour count, toolbox talk and PPE check must be ticked",
        ]:
            self.assertIn(marker, SITE_REPORTS)
        for marker in [
            "labour_count_completed: false",
            "toolbox_talk_completed: false",
            "ppe_check_completed: false",
            "Labour count done",
            "Toolbox talk done",
            "PPE check done",
        ]:
            self.assertIn(marker, SITE_PAGE)


if __name__ == "__main__":
    unittest.main()
