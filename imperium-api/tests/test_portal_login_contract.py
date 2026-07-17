from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
PORTAL_LOGIN = (
    ROOT.parent / "aegis-web" / "src" / "components" / "auth" / "PortalLogin.tsx"
).read_text(encoding="utf-8")


class PortalLoginContractTests(unittest.TestCase):
    """Prevent duplicate portal admission and stale auth-race regressions."""

    def test_portal_login_is_single_flight(self):
        self.assertIn("const resolvingPortalRef = useRef(false);", PORTAL_LOGIN)
        self.assertIn("const resolvedPortalRef = useRef(false);", PORTAL_LOGIN)
        self.assertIn(
            "if (resolvingPortalRef.current || resolvedPortalRef.current)", PORTAL_LOGIN
        )
        self.assertIn("resolvedPortalRef.current = true;", PORTAL_LOGIN)
        self.assertIn("void resolvePortal(session.access_token);", PORTAL_LOGIN)
        self.assertIn("await resolvePortal(data.session.access_token);", PORTAL_LOGIN)


if __name__ == "__main__":
    unittest.main()
