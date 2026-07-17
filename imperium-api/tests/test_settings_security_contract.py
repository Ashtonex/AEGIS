from pathlib import Path
import unittest


API_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = API_ROOT.parent / "aegis-web"
SETTINGS_ROUTER = (API_ROOT / "routers" / "settings.py").read_text(encoding="utf-8")
SETTINGS_MIGRATION = (API_ROOT / "migrations" / "019_settings_controls.sql").read_text(
    encoding="utf-8"
)
MAIN = (API_ROOT / "main.py").read_text(encoding="utf-8")
AUTH_CONTEXT = (WEB_ROOT / "src" / "lib" / "auth" / "AuthContext.tsx").read_text(
    encoding="utf-8"
)
RBAC_GUARD = (WEB_ROOT / "src" / "components" / "auth" / "RBACGuard.tsx").read_text(
    encoding="utf-8"
)
SETTINGS_PAGE = (
    WEB_ROOT / "src" / "app" / "dashboard" / "settings" / "page.tsx"
).read_text(encoding="utf-8")


class SettingsSecurityContractTests(unittest.TestCase):
    """Prevent browser-only elevation and tenant leaks in settings controls."""

    def test_settings_router_has_explicit_permissions_and_tenant_filters(self):
        self.assertIn(
            'include_router(settings_router.router, prefix="/api/v1/settings", tags=["Settings"])',
            MAIN,
        )
        self.assertIn('require_permission("settings.read")', SETTINGS_ROUTER)
        self.assertIn('require_permission("settings.update")', SETTINGS_ROUTER)
        self.assertIn('require_permission("settings.audit.read")', SETTINGS_ROUTER)
        self.assertGreaterEqual(SETTINGS_ROUTER.count("organization_id=:org_id"), 5)

    def test_settings_payloads_are_typed_and_secrets_are_not_persisted(self):
        self.assertIn(
            'ConfigDict(extra="forbid", str_strip_whitespace=True)', SETTINGS_ROUTER
        )
        self.assertNotIn("api_key", SETTINGS_ROUTER.lower())
        self.assertNotIn("client_secret", SETTINGS_ROUTER.lower())
        self.assertNotIn("access_token", SETTINGS_ROUTER.lower())
        self.assertIn("Store connection secrets in", SETTINGS_ROUTER)

    def test_settings_tables_use_service_role_only_rls(self):
        self.assertIn("FORCE ROW LEVEL SECURITY", SETTINGS_MIGRATION)
        self.assertIn(
            "REVOKE ALL ON ALL TABLES IN SCHEMA settings FROM anon, authenticated",
            SETTINGS_MIGRATION,
        )
        self.assertEqual(
            SETTINGS_MIGRATION.count('CREATE POLICY "Settings service role only"'), 4
        )

    def test_no_client_side_role_elevation_or_bypass_codes_remain(self):
        source = "\n".join((AUTH_CONTEXT, RBAC_GUARD, SETTINGS_PAGE))
        for forbidden in (
            "elevateSession",
            "elevatedRole",
            "snc_elevated_role",
            "SNC-ELEVATE",
            "bypass key",
        ):
            self.assertNotIn(forbidden, source)

    def test_dashboard_redirect_waits_for_a_session_recheck(self):
        self.assertIn("setTimeout(async () =>", AUTH_CONTEXT)
        self.assertIn("supabase.auth.getSession()", AUTH_CONTEXT)
        self.assertIn("router.push('/login')", AUTH_CONTEXT)
        self.assertIn("clearTimeout(redirectTimerRef.current)", AUTH_CONTEXT)


if __name__ == "__main__":
    unittest.main()
