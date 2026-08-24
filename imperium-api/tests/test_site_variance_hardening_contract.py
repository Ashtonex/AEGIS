from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

SITE_REPORTS = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
PORTALS = (ROOT / "routers" / "portals.py").read_text(encoding="utf-8")
EXECUTIVE = (ROOT / "routers" / "executive.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "147_site_variance_hardening_controls.sql").read_text(encoding="utf-8")
API = (WEB_ROOT / "lib" / "api.ts").read_text(encoding="utf-8")
PORTAL_HOME = (WEB_ROOT / "components" / "auth" / "PortalHome.tsx").read_text(encoding="utf-8")
ENGINEER_PORTAL = (WEB_ROOT / "components" / "auth" / "SiteEngineerPortalHome.tsx").read_text(encoding="utf-8")
QS_PORTAL = (WEB_ROOT / "components" / "auth" / "QsPortalHome.tsx").read_text(encoding="utf-8")
SITE_AGENT_PORTAL = (WEB_ROOT / "components" / "auth" / "SiteAgentPortalHome.tsx").read_text(encoding="utf-8")


class SiteVarianceHardeningContractTests(unittest.TestCase):
    def test_variance_classification_and_proceed_at_risk_fields_are_persisted(self):
        self.assertIn("variance_classification VARCHAR(40)", MIGRATION)
        self.assertIn("client_variation", MIGRATION)
        self.assertIn("site_condition_variation", MIGRATION)
        self.assertIn("emergency_variance", MIGRATION)
        self.assertIn("proceed_instruction_given_by", MIGRATION)
        self.assertIn("proceed_estimated_cost_exposure", MIGRATION)
        self.assertIn("formal_approval_deadline", MIGRATION)
        self.assertIn("variations_proceed_at_risk_required_fields_chk", MIGRATION)

    def test_site_engineer_payload_requires_proceed_at_risk_evidence(self):
        self.assertIn("variance_classification", SITE_REPORTS)
        self.assertIn("proceed_at_risk_requires_control_fields", SITE_REPORTS)
        self.assertIn("proceed_instruction_given_by", SITE_REPORTS)
        self.assertIn("proceed_management_authorizer", SITE_REPORTS)
        self.assertIn("formal_approval_deadline", SITE_REPORTS)
        self.assertIn("Variance class", ENGINEER_PORTAL)
        self.assertIn("Proceed-at-risk override record", ENGINEER_PORTAL)

    def test_material_request_gate_blocks_unreleased_execution(self):
        self.assertIn("weekly_budget_item_id UUID REFERENCES projects.weekly_budget_items", MIGRATION)
        self.assertIn("execution_gate_status", MIGRATION)
        self.assertIn("enforce_material_execution_release", SITE_REPORTS)
        self.assertIn("exceeds the released allowance", SITE_REPORTS)
        self.assertIn("approved_variance", SITE_REPORTS)
        self.assertIn("proceed_override", SITE_REPORTS)

    def test_qs_and_site_agent_portals_are_real_admission_targets(self):
        self.assertIn('"site-agent": "/portal/site-agent"', PORTALS)
        self.assertIn('"qs": "/portal/qs"', PORTALS)
        self.assertIn("Site Agent portal access confirmed", PORTALS)
        self.assertIn("QS portal access confirmed", PORTALS)
        self.assertIn('"site-agent" | "qs"', API)
        self.assertIn("QsPortalHome", PORTAL_HOME)
        self.assertIn("SiteAgentPortalHome", PORTAL_HOME)
        self.assertIn("reviewSiteVarianceQs", QS_PORTAL)
        self.assertIn("decideWeeklySiteBudget", SITE_AGENT_PORTAL)

    def test_executive_exceptions_include_variance_and_blocked_execution(self):
        self.assertIn("exceptions.site_variance_gates", EXECUTIVE)
        self.assertIn("exceptions.blocked_material_requests", EXECUTIVE)
        self.assertIn("Site variance gate", EXECUTIVE)
        self.assertIn("Blocked execution item", EXECUTIVE)


if __name__ == "__main__":
    unittest.main()
