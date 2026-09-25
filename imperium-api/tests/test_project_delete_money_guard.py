"""Deleting a project with money attached must be a deliberate, warned action.

Plant & Equipment was archived while 16 bank lines, $9,995 of costs and their
ledger lines still pointed at it - archiving hides all of that from the
Finance dashboard and pickers without any warning. These guards keep that
from happening silently again.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROJECT_DELETE = (ROOT / "app" / "shared" / "project_delete.py").read_text(encoding="utf-8")
PROJECTS_ROUTER = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
DETAIL_PANEL = (ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "projects" / "ProjectDetailPanel.tsx").read_text(encoding="utf-8")


class ProjectDeleteMoneyGuardTests(unittest.TestCase):
    def test_bank_and_ledger_rows_block_a_permanent_wipe(self):
        # bank lines / allocations SET NULL on delete (a wipe would silently
        # untag them); journal_lines has no delete rule (a wipe would 500).
        for table in ("finance.bank_statement_lines", "finance.bank_line_allocations", "finance.journal_lines"):
            self.assertIn(f'("{table}", "project_id")', PROJECT_DELETE)

    def test_delete_refuses_without_acknowledging_attached_money(self):
        body = PROJECTS_ROUTER.split("async def delete_project(")[1].split("\n@router")[0]
        self.assertIn("acknowledge_money: bool = Query(default=False", body)
        self.assertIn('if money["has_money"] and not acknowledge_money:', body)
        self.assertIn("status_code=409", body)
        # the check runs before anything is archived or wiped
        self.assertLess(body.find("money_attached("), body.find("UPDATE projects.projects SET is_deleted=true"))

    def test_reversed_test_journals_do_not_count_as_money(self):
        self.assertIn("je.reversed_by_journal_id IS NULL AND je.journal_type <> 'reversal'", PROJECT_DELETE)

    def test_project_page_warns_with_the_figures_before_deleting(self):
        self.assertIn("getProjectDeleteImpact(project.id)", DETAIL_PANEL)
        self.assertIn("deleteInternalProject(project.id, acknowledgeMoney)", DETAIL_PANEL)
        self.assertIn("has money attached", DETAIL_PANEL)


if __name__ == "__main__":
    unittest.main()
