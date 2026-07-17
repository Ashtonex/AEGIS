from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CRM_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "opportunities"
    / "page.tsx"
).read_text(encoding="utf-8")


class CrmOpportunitiesContractTests(unittest.TestCase):
    """Guard CRM opportunity loading against whole-page aborts."""

    def test_crm_opportunities_workspace_degrades_partial_sources(self):
        self.assertIn("Promise.allSettled", CRM_PAGE)
        self.assertIn(
            "The CRM feed is still synchronizing. Please retry once the connection is ready.",
            CRM_PAGE,
        )
        self.assertIn("Opportunities could not be loaded.", CRM_PAGE)
        self.assertIn("Contacts could not be loaded.", CRM_PAGE)
        self.assertIn("Activity log could not be loaded.", CRM_PAGE)

    def test_crm_opportunities_workspace_does_not_reintroduce_simple_hard_fail_loading(
        self,
    ):
        self.assertNotIn(
            "const [oppsRes, contactsRes, activitiesRes] = await Promise.all([",
            CRM_PAGE,
        )
        self.assertNotIn("getCrmOpportunities().catch", CRM_PAGE)
        self.assertNotIn("getCrmContacts().catch", CRM_PAGE)
        self.assertNotIn("getCrmActivities().catch", CRM_PAGE)


if __name__ == "__main__":
    unittest.main()
