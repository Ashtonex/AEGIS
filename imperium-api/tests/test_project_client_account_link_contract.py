from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROJECTS_ROUTER = (ROOT / "routers" / "projects.py").read_text(encoding="utf-8")
CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "155_project_individual_client_links.sql").read_text(encoding="utf-8")
PROJECTS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "projects" / "page.tsx"
).read_text(encoding="utf-8")


class ProjectClientAccountLinkContractTests(unittest.TestCase):
    def test_projects_can_be_formally_linked_to_one_crm_client_account(self):
        self.assertIn("client_org_id: Optional[UUID] = None", PROJECTS_ROUTER)
        self.assertIn("client_id: Optional[UUID] = None", PROJECTS_ROUTER)
        self.assertIn("async def _client_org_name_or_404", PROJECTS_ROUTER)
        self.assertIn("async def _client_contact_name_or_404", PROJECTS_ROUTER)
        self.assertIn("INSERT INTO projects.projects (name, status, project_code, project_type, client_org_id, client_id, client_name", PROJECTS_ROUTER)
        self.assertIn("ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES crm.contacts(id)", MIGRATION)
        self.assertIn("client_org_id: clientLinkType === \"organization\" ? clientId || null : null", PROJECTS_PAGE)
        self.assertIn("client_id: clientLinkType === \"individual\" ? clientId || null : null", PROJECTS_PAGE)
        self.assertIn("Client account", PROJECTS_PAGE)
        self.assertIn("Link CRM organisation", PROJECTS_PAGE)
        self.assertIn("Link CRM individual", PROJECTS_PAGE)
        self.assertIn("Individual", PROJECTS_PAGE)
        self.assertIn("OR client_id = ANY(:contact_ids)", CRM_ROUTER)


if __name__ == "__main__":
    unittest.main()
