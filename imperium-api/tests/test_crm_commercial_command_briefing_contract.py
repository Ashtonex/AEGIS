from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
CRM_PAGE = (REPO / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "page.tsx").read_text(encoding="utf-8")
API = (REPO / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


class CommercialCommandBriefingContractTests(unittest.TestCase):
    def test_backend_generates_live_morning_briefing(self):
        self.assertIn('@router.get("/commercial-briefing")', CRM_ROUTER)
        self.assertIn("Commercial morning briefing generated.", CRM_ROUTER)
        self.assertIn("crm.tenders", CRM_ROUTER)
        self.assertIn("crm.tasks", CRM_ROUTER)
        self.assertIn("crm.tender_requirements", CRM_ROUTER)
        self.assertIn("core.document_links", CRM_ROUTER)
        self.assertIn("tenders_due", CRM_ROUTER)
        self.assertIn("task_activity", CRM_ROUTER)
        self.assertIn("paperwork_gaps", CRM_ROUTER)
        self.assertIn("stale_items", CRM_ROUTER)

    def test_frontend_commercial_command_uses_live_briefing(self):
        self.assertIn("getCommercialMorningBriefing", API)
        self.assertIn("/api/v1/crm/commercial-briefing", API)
        self.assertIn("getCommercialMorningBriefing()", CRM_PAGE)
        self.assertIn("briefingItems", CRM_PAGE)
        self.assertIn("Missing paperwork", CRM_PAGE)
        self.assertIn("Tender deadline", CRM_PAGE)
        self.assertIn("Needs verification", CRM_PAGE)
        self.assertNotIn("No briefing alerts configured.", CRM_PAGE)
        self.assertIn("AEGIS is watching deadlines, task movement, missing paperwork and stale follow-ups.", CRM_PAGE)


if __name__ == "__main__":
    unittest.main()
