from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INBOX_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "inbox"
    / "page.tsx"
).read_text(encoding="utf-8")
ORG_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "organizations"
    / "page.tsx"
).read_text(encoding="utf-8")


class CrmSupportPagesContractTests(unittest.TestCase):
    """Guard CRM support pages against whole-page failure on partial source outages."""

    def test_inbox_workspace_degrades_partial_sources(self):
        self.assertIn("Promise.allSettled", INBOX_PAGE)
        self.assertIn("Website enquiries could not be loaded.", INBOX_PAGE)
        self.assertIn("CRM contacts could not be loaded.", INBOX_PAGE)
        self.assertIn("CRM organizations could not be loaded.", INBOX_PAGE)
        self.assertIn("sourceWarnings.length > 0", INBOX_PAGE)

    def test_organizations_workspace_degrades_partial_sources(self):
        self.assertIn("Promise.allSettled", ORG_PAGE)
        self.assertIn(
            "Client organizations could not be loaded from the CRM service.", ORG_PAGE
        )
        self.assertIn("CRM contacts could not be loaded.", ORG_PAGE)
        self.assertIn("CRM activities could not be loaded.", ORG_PAGE)
        self.assertIn("sourceWarnings.length > 0", ORG_PAGE)

    def test_crm_support_pages_do_not_reintroduce_simple_hard_fail_loaders(self):
        self.assertNotIn("Promise.all([", INBOX_PAGE)
        self.assertNotIn("Promise.all([", ORG_PAGE)
        self.assertNotIn("getWebsiteEnquiries().catch", INBOX_PAGE)
        self.assertNotIn("getCrmOrganizations().catch", ORG_PAGE)


if __name__ == "__main__":
    unittest.main()
