from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
API_ROOT = ROOT / "imperium-api"
WEB_ROOT = ROOT / "aegis-web"

CRM_ROUTER = (API_ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
CRM_LEADS_ROUTER = (API_ROOT / "routers" / "crm_leads.py").read_text(encoding="utf-8")
CRM_ORGS_ROUTER = (API_ROOT / "routers" / "crm_organizations.py").read_text(encoding="utf-8")
MIGRATION = (API_ROOT / "migrations" / "041_crm_completion_phases_1_6.sql").read_text(encoding="utf-8")
API_CLIENT = (WEB_ROOT / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
CUSTOMER_360_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "organizations" / "[id]" / "page.tsx"
).read_text(encoding="utf-8")
OPPORTUNITIES_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "opportunities" / "page.tsx"
).read_text(encoding="utf-8")
MARKETING_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "marketing" / "page.tsx"
).read_text(encoding="utf-8")
SEGMENTS_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "segments" / "page.tsx"
).read_text(encoding="utf-8")
TEMPLATES_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "templates" / "page.tsx"
).read_text(encoding="utf-8")


class CrmCompletionPhasesContract(unittest.TestCase):
    def test_phase_1_schema_hardens_required_crm_entities_without_seed_rows(self):
        for table in (
            "crm.campaigns",
            "crm.campaign_members",
            "crm.support_tickets",
            "crm.ticket_comments",
            "crm.ticket_sla_events",
            "crm.automation_rules",
            "crm.automation_runs",
            "crm.segments",
            "crm.message_templates",
            "crm.win_loss_reasons",
        ):
            self.assertIn(table, MIGRATION)

        self.assertIn("ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("No seed/demo records", MIGRATION)
        self.assertNotIn("INSERT INTO crm.leads", MIGRATION)
        self.assertIn("opportunity_id UUID REFERENCES crm.opportunities", MIGRATION)
        self.assertIn("client_org_id UUID REFERENCES crm.organizations", MIGRATION)

    def test_phase_2_customer_360_backend_and_frontend_exist(self):
        self.assertIn('@router.get("/customer-360/{client_org_id}")', CRM_ROUTER)
        for key in (
            "primary_contacts",
            "open_leads",
            "active_opportunities",
            "quotation_history",
            "awarded_projects",
            "open_support_tickets",
            "recent_communications",
            "upcoming_activities",
            "documents",
            "financial_summary",
            "risk_compliance_flags",
        ):
            self.assertIn(key, CRM_ROUTER)
            self.assertIn(key, CUSTOMER_360_PAGE)
        self.assertIn("getCrmCustomer360", API_CLIENT)
        self.assertIn("Activity Timeline", CUSTOMER_360_PAGE)

    def test_phase_3_lead_lifecycle_is_traceable_and_duplicate_aware(self):
        self.assertIn('@router.get("/duplicates")', CRM_LEADS_ROUTER)
        self.assertIn('@router.post("/{lead_id}/disqualify")', CRM_LEADS_ROUTER)
        self.assertIn('@router.post("/{lead_id}/merge")', CRM_LEADS_ROUTER)
        self.assertIn("Duplicate lead candidate exists", CRM_LEADS_ROUTER)
        self.assertIn("client_org_id = :client_org_id", CRM_LEADS_ROUTER)
        self.assertIn("opportunity_id = :opportunity_id", CRM_LEADS_ROUTER)
        self.assertIn("converted_at = NOW()", CRM_LEADS_ROUTER)
        self.assertIn("findDuplicateCrmLeads", API_CLIENT)
        self.assertIn("disqualifyCrmLead", API_CLIENT)
        self.assertIn("mergeCrmLeads", API_CLIENT)

    def test_phase_4_marketing_routes_and_pages_are_real_service_backed(self):
        for route in (
            '@router.get("/campaigns")',
            '@router.post("/campaigns"',
            '@router.post("/campaigns/{campaign_id}/members"',
            '@router.get("/segments")',
            '@router.post("/segments"',
            '@router.get("/templates")',
            '@router.post("/templates"',
        ):
            self.assertIn(route, CRM_ROUTER)
        self.assertIn("getCrmCampaigns", MARKETING_PAGE)
        self.assertIn("createCrmSegment", SEGMENTS_PAGE)
        self.assertIn("createCrmMessageTemplate", TEMPLATES_PAGE)
        self.assertIn("No production campaigns recorded", MARKETING_PAGE)
        self.assertNotIn("fallbackCampaign", MARKETING_PAGE)

    def test_phase_5_and_6_pipeline_quote_project_handoff_are_exposed(self):
        for route in (
            '@router.post("/opportunities/{opportunity_id}/create-quotation"',
            '@router.post("/opportunities/{opportunity_id}/mark-won")',
            '@router.post("/opportunities/{opportunity_id}/mark-lost")',
        ):
            self.assertIn(route, CRM_ROUTER)
        self.assertIn("weighted_value", CRM_ROUTER)
        self.assertIn("is_stale", CRM_ROUTER)
        self.assertIn("projects.projects", CRM_ROUTER)
        self.assertIn("finance.quotations", CRM_ROUTER)
        self.assertIn("createCrmOpportunityQuotation", API_CLIENT)
        self.assertIn("markCrmOpportunityWon", API_CLIENT)
        self.assertIn("markCrmOpportunityLost", API_CLIENT)
        self.assertIn("Quote & Project Handoff", OPPORTUNITIES_PAGE)
        self.assertIn("Create quote", OPPORTUNITIES_PAGE)
        self.assertIn("Mark won", OPPORTUNITIES_PAGE)
        self.assertIn("Mark lost", OPPORTUNITIES_PAGE)

    def test_organization_api_accepts_customer_360_account_fields(self):
        for column in (
            "sector",
            "registration_number",
            "tax_id",
            "credit_limit",
            "total_contract_value",
            "risk_rating",
            "parent_org_id",
        ):
            self.assertIn(column, CRM_ORGS_ROUTER)


if __name__ == "__main__":
    unittest.main()
