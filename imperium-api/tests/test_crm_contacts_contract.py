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


class CrmContactsContractTests(unittest.TestCase):
    """Guard CRM contacts against whole-page failure on partial source outages."""

    def test_crm_contacts_workspace_degrades_partial_sources(self):
        self.assertIn("Promise.allSettled", CONTACTS_PAGE)
        self.assertIn(
            "The CRM contacts feed is still synchronizing. Please retry once the connection is ready.",
            CONTACTS_PAGE,
        )
        self.assertIn(
            "Contacts could not be loaded from the CRM service.", CONTACTS_PAGE
        )
        self.assertIn("Client organizations could not be loaded.", CONTACTS_PAGE)
        self.assertIn("CRM activities could not be loaded.", CONTACTS_PAGE)

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
