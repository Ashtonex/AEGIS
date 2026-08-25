from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]

MIGRATION = (ROOT / "migrations" / "159_crm_sales_operating_system_foundation.sql").read_text(encoding="utf-8")
NAMECHEAP_MIGRATION = (ROOT / "migrations" / "160_namecheap_private_email_connector.sql").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "crm_integrations.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
PAGE = (ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "integrations" / "page.tsx").read_text(encoding="utf-8")


class CrmSalesOperatingSystemContract(unittest.TestCase):
    def test_integration_foundation_tables_are_additive_and_audited(self):
        for table in (
            "crm.connected_accounts",
            "crm.integration_sync_jobs",
            "crm.integration_sync_errors",
            "crm.synced_email_events",
            "crm.synced_calendar_events",
            "crm.ai_recommendations",
        ):
            self.assertIn(table, MIGRATION)
        self.assertIn("CRM integration service role", MIGRATION)
        self.assertIn("core.process_audit_log()", MIGRATION)
        self.assertNotIn("DROP TABLE", MIGRATION)
        self.assertNotIn("DROP COLUMN", MIGRATION)

    def test_permissions_are_distinct_for_integrations_and_ai(self):
        for permission in (
            "crm.integrations.read",
            "crm.integrations.manage",
            "crm.ai.read",
            "crm.ai.manage",
        ):
            self.assertIn(permission, MIGRATION)
            self.assertIn(permission, ROUTER)

    def test_router_is_mounted_and_exposes_operating_layer_endpoints(self):
        self.assertIn("crm_integrations", MAIN)
        self.assertIn('prefix="/api/v1/crm-integrations"', MAIN)
        for marker in (
            '"/providers"',
            '"/connected-accounts"',
            '"/connected-accounts/{account_id}/sync"',
            '"/email-events"',
            '"/calendar-events"',
            '"/ai/run-scoring"',
            '"/ai/recommendations"',
        ):
            self.assertIn(marker, ROUTER)

    def test_email_calendar_sync_mirror_to_communication_ledger(self):
        self.assertIn("from routers.crm_communications import _insert_communication", ROUTER)
        self.assertIn('"channel": "email"', ROUTER)
        self.assertIn('"channel": "meeting"', ROUTER)
        self.assertIn("_match_crm_party", ROUTER)

    def test_frontend_has_connected_apps_api_and_page(self):
        for helper in (
            "getCrmIntegrationProviders",
            "getCrmConnectedAccounts",
            "queueCrmIntegrationSync",
            "runCrmAiScoring",
            "getCrmAiRecommendations",
            "sendCrmPrivateEmail",
        ):
            self.assertIn(helper, API)
        self.assertIn("Connected Apps", PAGE)
        self.assertIn("Next Best Actions", PAGE)
        self.assertIn("Namecheap", PAGE)

    def test_namecheap_private_email_connector_is_supported(self):
        for marker in (
            "namecheap_private_email",
            "imap_smtp",
        ):
            self.assertIn(marker, NAMECHEAP_MIGRATION)
            self.assertIn(marker, ROUTER)
        for marker in (
            "mail.privateemail.com",
            "Fernet",
            "_test_namecheap_connection",
            "_sync_namecheap_inbox",
            '"/email/send"',
        ):
            self.assertIn(marker, ROUTER)
        self.assertNotIn("SELECT ca.*", ROUTER)


if __name__ == "__main__":
    unittest.main()
