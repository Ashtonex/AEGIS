from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "imperium-api"
WEB_ROOT = ROOT / "aegis-web"

CRM_LEADS_ROUTER = (API_ROOT / "routers" / "crm_leads.py").read_text(encoding="utf-8")
LEADS_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "leads" / "page.tsx"
).read_text(encoding="utf-8")
API_CLIENT = (WEB_ROOT / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


class CrmIndividualLeadsContractTests(unittest.TestCase):
    def test_lead_form_allows_individual_clients_without_company(self):
        self.assertIn("company_name?: string | null", LEADS_PAGE)
        self.assertIn("Company Name (optional)", LEADS_PAGE)
        self.assertIn("Leave blank for individual clients", LEADS_PAGE)
        self.assertIn("Client / Contact Name", LEADS_PAGE)
        self.assertIn('showToast("Client / contact name is required."', LEADS_PAGE)
        self.assertNotIn("if (!manualForm.company_name.trim()) return;", LEADS_PAGE)
        self.assertIn("company_name: manualForm.company_name.trim() || undefined", LEADS_PAGE)
        self.assertIn("contact_name: manualForm.contact_name.trim()", LEADS_PAGE)
        self.assertIn("company_name?: string;", API_CLIENT)

    def test_individual_leads_display_and_qualify_without_organization(self):
        self.assertIn("const leadPrimaryName", LEADS_PAGE)
        self.assertIn("lead.company_name?.trim() || lead.contact_name?.trim()", LEADS_PAGE)
        self.assertIn("const leadContactName", LEADS_PAGE)
        self.assertIn("const hasCompany = Boolean(lead.company_name?.trim())", LEADS_PAGE)
        self.assertIn("...(hasCompany", LEADS_PAGE)
        self.assertIn("name: leadOpportunityName(lead)", LEADS_PAGE)
        self.assertIn("OrganizationQualify(BaseModel):", CRM_LEADS_ROUTER)
        self.assertIn("name: Optional[str] = None", CRM_LEADS_ROUTER)
        self.assertIn("organization: Optional[OrganizationQualify] = None", CRM_LEADS_ROUTER)
        self.assertIn("client_org_id = None", CRM_LEADS_ROUTER)
        self.assertIn("if org_name:", CRM_LEADS_ROUTER)
        self.assertIn('"organization_id": str(client_org_id) if client_org_id else None', CRM_LEADS_ROUTER)


if __name__ == "__main__":
    unittest.main()
