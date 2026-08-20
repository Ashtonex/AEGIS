from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

SETTINGS_ROUTER = (ROOT / "routers" / "settings.py").read_text(encoding="utf-8")
PORTALS_ROUTER = (ROOT / "routers" / "portals.py").read_text(encoding="utf-8")
WORKFORCE_ROUTER = (ROOT / "routers" / "workforce.py").read_text(encoding="utf-8")
PORTAL_ROLES_MIGRATION = (ROOT / "migrations" / "014_portal_access_roles.sql").read_text(
    encoding="utf-8"
)
FOREMAN_ROLE_MIGRATION = (
    ROOT / "migrations" / "127_foreman_role_catalog_gap_fix.sql"
).read_text(encoding="utf-8")
SETTINGS_PAGE = (
    WEB_ROOT / "app" / "dashboard" / "settings" / "page.tsx"
).read_text(encoding="utf-8")
PORTAL_HOME = (WEB_ROOT / "components" / "auth" / "PortalHome.tsx").read_text(
    encoding="utf-8"
)


class AccountRoleMatrixContractTests(unittest.TestCase):
    def test_external_account_roles_are_seeded_without_account_rows(self):
        for role_name in ("EMPLOYEE", "CLIENT", "SUPPLIER"):
            self.assertIn(f"'{role_name}'", PORTAL_ROLES_MIGRATION)
        self.assertNotIn("INSERT INTO crm.clients", PORTAL_ROLES_MIGRATION)
        self.assertNotIn("INSERT INTO crm.subcontractors", PORTAL_ROLES_MIGRATION)
        self.assertNotIn("INSERT INTO core.users", PORTAL_ROLES_MIGRATION)

    def test_managed_account_types_map_to_their_portal_roles_and_tables(self):
        self.assertIn('"client": "CLIENT"', SETTINGS_ROUTER)
        self.assertIn('"supplier": "SUPPLIER"', SETTINGS_ROUTER)
        self.assertIn('"subcontractor": "SUPPLIER"', SETTINGS_ROUTER)
        self.assertIn("crm.client_portal_access", SETTINGS_ROUTER)
        self.assertIn("crm.supplier_portal_access", SETTINGS_ROUTER)
        self.assertIn('AccountKind = Literal["client", "supplier", "subcontractor"]', SETTINGS_ROUTER)
        for account_type in ("client", "supplier", "subcontractor"):
            self.assertIn(f'<option value="{account_type}">', SETTINGS_PAGE)

    def test_foreman_role_exists_for_the_portal_gate(self):
        self.assertIn("'FOREMAN'", FOREMAN_ROLE_MIGRATION)
        for permission_key in (
            "site_operations.read",
            "site_operations.create",
            "site_operations.update",
            "workforce.read",
            "compliance.gate.read",
        ):
            self.assertIn(permission_key, FOREMAN_ROLE_MIGRATION)
        self.assertIn('"FOREMAN", "SITE AGENT", "SITE CLERK", "STOREKEEPER"', PORTALS_ROUTER)
        self.assertIn('"foreman": "/portal/foreman"', PORTALS_ROUTER)
        self.assertIn('portal === "foreman"', PORTAL_HOME)
        self.assertIn("<ForemanPortalHome />", PORTAL_HOME)

    def test_site_worker_accounts_are_linked_workforce_records_not_portal_fixtures(self):
        self.assertIn("linked_user_id", WORKFORCE_ROUTER)
        self.assertIn("INSERT INTO hr.employees", WORKFORCE_ROUTER)
        self.assertIn("linked_user_id", SETTINGS_ROUTER)
        self.assertIn("INSERT INTO hr.employees", SETTINGS_ROUTER)
        self.assertNotIn("INSERT INTO hr.employees", PORTAL_ROLES_MIGRATION)
        self.assertNotIn("INSERT INTO hr.employees", FOREMAN_ROLE_MIGRATION)


if __name__ == "__main__":
    unittest.main()
