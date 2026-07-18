from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"
PORTALS = (ROOT / "routers" / "portals.py").read_text(encoding="utf-8")
API = (WEB_ROOT / "lib" / "api.ts").read_text(encoding="utf-8")
PORTAL_HOME = (WEB_ROOT / "components" / "auth" / "PortalHome.tsx").read_text(encoding="utf-8")
FOREMAN_HOME = (WEB_ROOT / "components" / "auth" / "ForemanPortalHome.tsx").read_text(encoding="utf-8")
FOREMAN_PAGE = (WEB_ROOT / "app" / "portal" / "foreman" / "page.tsx").read_text(encoding="utf-8")


class ForemanPortalContractTests(unittest.TestCase):
    def test_backend_resolves_foreman_portal(self):
        self.assertIn('"foreman": "/portal/foreman"', PORTALS)
        self.assertIn('"FOREMAN", "SITE AGENT", "SITE CLERK", "STOREKEEPER"', PORTALS)
        self.assertIn('"portal": "foreman"', PORTALS)
        self.assertIn('Foreman portal access confirmed.', PORTALS)

    def test_frontend_exposes_foreman_portal_route(self):
        self.assertIn('portal="foreman"', FOREMAN_PAGE)
        self.assertIn('"client" | "supplier" | "foreman"', PORTAL_HOME)
        self.assertIn('<ForemanPortalHome />', PORTAL_HOME)
        self.assertIn('"foreman" | "client"', API)

    def test_foreman_portal_uses_source_backed_operational_endpoints(self):
        for symbol in [
            "getDailySiteReports",
            "createDailySiteReport",
            "submitDailySiteReport",
            "requestSiteMaterial",
            "getComplianceDeploymentGateChecks",
        ]:
            self.assertIn(symbol, FOREMAN_HOME)
        self.assertNotIn("mock", FOREMAN_HOME.lower())
        self.assertIn("Foreman portal data could not be loaded.", FOREMAN_HOME)


if __name__ == "__main__":
    unittest.main()
