from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONTACTS_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "crm"
    / "contacts"
    / "page.tsx"
).read_text(encoding="utf-8")
USE_API_QUERIES_HOOK = (
    ROOT.parent / "aegis-web" / "src" / "hooks" / "useApiQueries.ts"
).read_text(encoding="utf-8")


class CrmContactsContractTests(unittest.TestCase):
    """Guard CRM contacts against whole-page failure on partial source outages."""

    def test_crm_contacts_workspace_degrades_partial_sources(self):
        # The multi-source degrade-on-partial-failure pattern (Promise.allSettled,
        # critical vs warning sources, "<label> could not be loaded." messages) now
        # lives in the shared useApiQueries hook - reused by CRM contacts,
        # procurement, and finance - instead of being hand-rolled per page.
        self.assertIn("useApiQueries", CONTACTS_PAGE)
        self.assertIn("Promise.allSettled", USE_API_QUERIES_HOOK)
        self.assertIn("could not be loaded.", USE_API_QUERIES_HOOK)
        self.assertIn(
            "Contacts could not be loaded from the CRM service.", CONTACTS_PAGE
        )
        self.assertIn('criticalKeys: ["contacts"]', CONTACTS_PAGE)
        self.assertIn("organizations: \"Client organizations\"", CONTACTS_PAGE)
        self.assertIn("activities: \"CRM activities\"", CONTACTS_PAGE)

    def test_crm_contacts_workspace_does_not_reintroduce_hard_fail_loading(self):
        self.assertNotIn(
            "const [contactsRes, orgsRes, activitiesRes] = await Promise.all([",
            CONTACTS_PAGE,
        )
        self.assertNotIn("getCrmContacts().catch", CONTACTS_PAGE)
        self.assertNotIn("getCrmOrganizations().catch", CONTACTS_PAGE)
        self.assertNotIn("getCrmActivities().catch", CONTACTS_PAGE)


if __name__ == "__main__":
    unittest.main()
