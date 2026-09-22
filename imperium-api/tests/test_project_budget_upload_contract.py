from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROJECTS = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
WEB_PANEL = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "projects"
    / "ProjectDetailPanel.tsx"
).read_text(encoding="utf-8")


class ProjectBudgetUploadContractTests(unittest.TestCase):
    def test_execution_budget_is_a_draft_and_does_not_replace_master(self):
        self.assertIn('budget_stage: Literal["master", "execution"]', PROJECTS)
        self.assertIn('"status": "approved" if is_master else "draft"', PROJECTS)
        self.assertIn("if payload.budget_stage == \"master\":", PROJECTS)
        self.assertIn("label='Execution budget review'", PROJECTS)

    def test_uploaded_lines_and_cost_codes_are_retained(self):
        self.assertIn("INSERT INTO finance.cost_codes", PROJECTS)
        self.assertIn("INSERT INTO finance.budget_lines", PROJECTS)
        self.assertIn("for line in payload.lines:", PROJECTS)

    def test_project_popup_sends_both_budget_stages_and_lines(self):
        self.assertIn("budgetStage,", WEB_PANEL)
        self.assertIn("lines: acceptedBudgetRows.map", WEB_PANEL)
        self.assertIn("Save execution budget draft", WEB_PANEL)


if __name__ == "__main__":
    unittest.main()
