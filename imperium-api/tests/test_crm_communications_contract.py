from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web"
MIGRATION = (ROOT / "migrations" / "032_crm_communication_ledger.sql").read_text(
    encoding="utf-8"
)
ROUTER = (ROOT / "routers" / "crm_communications.py").read_text(encoding="utf-8")
PORTALS_ROUTER = (ROOT / "routers" / "portals.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
WEB_API = (WEB_ROOT / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
PORTAL_HOME = (
    WEB_ROOT / "src" / "components" / "auth" / "PortalHome.tsx"
).read_text(encoding="utf-8")
MESSAGES_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "messages" / "page.tsx"
).read_text(encoding="utf-8")
ACTIVITIES_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "crm" / "activities" / "page.tsx"
).read_text(encoding="utf-8")


class CrmCommunicationsContractTests(unittest.TestCase):
    def test_migration_creates_unified_communication_ledger(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS crm.communication_events", MIGRATION)
        self.assertIn("duration_seconds", MIGRATION)
        self.assertIn("external_message_id", MIGRATION)
        self.assertIn("external_call_id", MIGRATION)
        self.assertIn("communication_events_provider_call_unique", MIGRATION)
        self.assertIn("raw_payload JSONB", MIGRATION)
        self.assertIn("communication_events_actor_reporting_idx", MIGRATION)
        self.assertIn("ALTER TABLE crm.communication_events ENABLE ROW LEVEL SECURITY", MIGRATION)
        self.assertIn("FOR ALL TO service_role", MIGRATION)

    def test_router_is_registered_and_permissioned(self):
        self.assertIn("crm_communications", MAIN)
        self.assertIn('prefix="/api/v1/crm-communications"', MAIN)
        self.assertIn('require_permission("crm_communications.read")', ROUTER)
        self.assertIn('require_permission("crm_communications.create")', ROUTER)
        self.assertIn('require_permission("crm_communications.update")', ROUTER)

    def test_whatsapp_integration_is_server_side_and_webhook_backed(self):
        self.assertIn('"/whatsapp/messages"', ROUTER)
        self.assertIn('"/webhooks/whatsapp"', ROUTER)
        self.assertIn("WHATSAPP_ACCESS_TOKEN", ROUTER)
        self.assertIn("WHATSAPP_PHONE_NUMBER_ID", ROUTER)
        self.assertIn("WHATSAPP_VERIFY_TOKEN", ROUTER)
        self.assertIn("x-hub-signature-256", ROUTER)
        self.assertNotIn("WHATSAPP_ACCESS_TOKEN", WEB_API)
        self.assertIn("sendCrmWhatsAppMessage", WEB_API)

    def test_twilio_voice_callbacks_are_prepared_for_call_logging(self):
        self.assertIn('"/webhooks/twilio/voice/status"', ROUTER)
        self.assertIn("x-twilio-signature", ROUTER)
        self.assertIn("TWILIO_AUTH_TOKEN", ROUTER)
        self.assertIn("TWILIO_WEBHOOK_BASE_URL", ROUTER)
        self.assertIn("CallSid", ROUTER)
        self.assertIn("CallDuration", ROUTER)
        self.assertIn("twilio_voice", ROUTER)
        self.assertIn("phone_call", ROUTER)

    def test_activity_page_uses_communication_ledger_and_captures_call_context(self):
        self.assertIn("getCrmCommunications", ACTIVITIES_PAGE)
        self.assertIn("createCrmCommunication", ACTIVITIES_PAGE)
        self.assertIn("sendViaWhatsApp", ACTIVITIES_PAGE)
        self.assertIn("formDurationMinutes", ACTIVITIES_PAGE)
        self.assertIn("formOutcome", ACTIVITIES_PAGE)
        self.assertIn("formResponse", ACTIVITIES_PAGE)
        self.assertIn("formNextAction", ACTIVITIES_PAGE)
        self.assertIn("actor_name", ACTIVITIES_PAGE)
        self.assertIn("direction", ACTIVITIES_PAGE)

    def test_portal_and_internal_messages_use_communication_ledger(self):
        self.assertIn("portal_message", MIGRATION)
        self.assertIn("recipient_user_id", MIGRATION)
        self.assertIn('"/client/messages"', PORTALS_ROUTER)
        self.assertIn("createClientPortalMessage", WEB_API)
        self.assertIn("createCrmCommunication", MESSAGES_PAGE)
        self.assertIn('direction: "internal"', MESSAGES_PAGE)
        self.assertIn("getCrmCommunications", MESSAGES_PAGE)
        self.assertIn("createClientPortalMessage", PORTAL_HOME)


if __name__ == "__main__":
    unittest.main()
