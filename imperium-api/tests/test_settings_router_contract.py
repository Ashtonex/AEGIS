from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "settings.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "019_settings_controls.sql").read_text(
    encoding="utf-8"
)
SETTINGS_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "settings" / "page.tsx"
).read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)


class SettingsRouterContractTests(unittest.TestCase):
    def test_settings_router_is_registered_and_permissions_are_explicit(self):
        self.assertIn('prefix="/api/v1/settings"', MAIN)
        self.assertIn('require_permission("settings.read")', ROUTER)
        self.assertIn('require_permission("settings.update")', ROUTER)
        self.assertIn('require_permission("settings.audit.read")', ROUTER)

    def test_settings_data_is_tenant_scoped_and_audited(self):
        self.assertGreaterEqual(ROUTER.count("organization_id=:org_id"), 4)
        self.assertIn("INSERT INTO settings.audit_events", ROUTER)
        self.assertIn('"org_id": user["org_id"]', ROUTER)

    def test_settings_audit_reads_settings_and_canonical_erp_audit(self):
        self.assertIn("async def _audit_events", ROUTER)
        self.assertIn("UNION ALL", ROUTER)
        self.assertIn("FROM core.audit_log", ROUTER)
        self.assertIn(
            "COALESCE(a.new_data->>'organization_id', a.old_data->>'organization_id')=:org_id",
            ROUTER,
        )
        self.assertIn("'settings.audit_events' AS source", ROUTER)
        self.assertIn("'core.audit_log' AS source", ROUTER)

    def test_settings_schema_has_rls_without_seed_data_or_secret_columns(self):
        self.assertNotIn("INSERT INTO settings.organization_settings", MIGRATION)
        self.assertNotIn("api_key", MIGRATION.lower())
        self.assertNotIn("secret", MIGRATION.lower())
        for table in (
            "organization_settings",
            "notification_preferences",
            "integration_connections",
            "audit_events",
        ):
            self.assertIn(
                f"ALTER TABLE settings.{table} ENABLE ROW LEVEL SECURITY", MIGRATION
            )
            self.assertIn(
                f'CREATE POLICY "Settings service role only" ON settings.{table}',
                MIGRATION,
            )

    def test_settings_enforces_single_configured_superadmin(self):
        self.assertIn('SOLE_SUPERADMIN_EMAIL = "ashton@admin.com"', ROUTER)
        self.assertIn("SUPERADMIN access is restricted", ROUTER)
        self.assertIn("cannot be removed from", ROUTER)
        self.assertIn("_enforce_sole_superadmin(target)", ROUTER)
        self.assertIn("_enforce_sole_superadmin(target, removing=True)", ROUTER)

    def test_website_content_is_source_backed_and_frontend_sends_strict_payload(self):
        self.assertIn(
            'raise HTTPException(status_code=503, detail="Website content storage is not migrated yet.',
            ROUTER,
        )
        self.assertNotIn(
            "return [dict(row) for row in rows] or DEFAULT_WEBSITE_CONTENT", ROUTER
        )
        self.assertIn("page_key: item.page_key", SETTINGS_PAGE)
        self.assertIn("section_key: item.section_key", SETTINGS_PAGE)
        self.assertIn("metadata: item.metadata ?? {}", SETTINGS_PAGE)
        self.assertNotIn("await updateWebsiteContent(item)", SETTINGS_PAGE)
        self.assertIn("Broadcast image stream could not be loaded.", SETTINGS_PAGE)
        self.assertIn("Failed to broadcast image.", SETTINGS_PAGE)
        self.assertIn("setFeedError(null)", SETTINGS_PAGE)
        self.assertNotIn('alert("Failed to broadcast image.', SETTINGS_PAGE)
        self.assertIn("getSettingsAuditEvents", WEB_API)
        self.assertIn("Audit log data could not be loaded.", SETTINGS_PAGE)
        self.assertIn("Loading audit events...", SETTINGS_PAGE)


if __name__ == "__main__":
    unittest.main()
