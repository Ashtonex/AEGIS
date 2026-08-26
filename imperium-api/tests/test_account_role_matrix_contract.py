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
OPERATIONAL_ROLE_MIGRATION = (
    ROOT / "migrations" / "143_operational_role_templates.sql"
).read_text(encoding="utf-8")
SITE_ENGINEER_MIGRATION = (
    ROOT / "migrations" / "144_site_engineer_portal_controls.sql"
).read_text(encoding="utf-8")
PROCUREMENT_MANAGER_BOUNDARY_MIGRATION = (
    ROOT / "migrations" / "148_procurement_manager_control_boundaries.sql"
).read_text(encoding="utf-8")
CRM_ASSOCIATE_WORKSPACE_MIGRATION = (
    ROOT / "migrations" / "163_crm_associate_primary_workspace_access.sql"
).read_text(encoding="utf-8")
CRM_ASSOCIATE_ACCESS_BRIDGE_MIGRATION = (
    ROOT / "migrations" / "165_crm_associate_assignment_tender_leave_access.sql"
).read_text(encoding="utf-8")
TENDER_BIDS_ROUTER = (ROOT / "routers" / "tender_bids.py").read_text(encoding="utf-8")
SETTINGS_PAGE = (
    WEB_ROOT / "app" / "dashboard" / "settings" / "page.tsx"
).read_text(encoding="utf-8")
DASHBOARD_SHELL = (
    WEB_ROOT / "app" / "dashboard" / "DashboardShell.tsx"
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

    def test_site_engineer_role_has_technical_control_portal(self):
        self.assertIn("'Site Engineer'", SITE_ENGINEER_MIGRATION)
        self.assertIn("'site_operations.engineer_portal.read'", SITE_ENGINEER_MIGRATION)
        self.assertIn("'site_operations.engineer_verify'", SITE_ENGINEER_MIGRATION)
        self.assertIn('"site-engineer": "/portal/site-engineer"', PORTALS_ROUTER)
        self.assertIn('"SITE ENGINEER"', PORTALS_ROUTER)
        self.assertIn('portal === "site-engineer"', PORTAL_HOME)
        self.assertIn("<SiteEngineerPortalHome />", PORTAL_HOME)

    def test_site_worker_accounts_are_linked_workforce_records_not_portal_fixtures(self):
        self.assertIn("linked_user_id", WORKFORCE_ROUTER)
        self.assertIn("INSERT INTO hr.employees", WORKFORCE_ROUTER)
        self.assertIn("linked_user_id", SETTINGS_ROUTER)
        self.assertIn("INSERT INTO hr.employees", SETTINGS_ROUTER)
        self.assertNotIn("INSERT INTO hr.employees", PORTAL_ROLES_MIGRATION)
        self.assertNotIn("INSERT INTO hr.employees", FOREMAN_ROLE_MIGRATION)

    def test_operational_role_templates_are_seeded_and_visible(self):
        expected_roles = (
            "Document Controller",
            "Tender / Bid Manager",
            "Contracts Manager",
            "Commercial Manager",
            "Inventory Controller",
            "Maintenance Planner",
            "Executive Read Only",
            "System Administrator",
            "Authorising Officer",
            "External Auditor",
        )
        for role_name in expected_roles:
            self.assertIn(f"'{role_name}'", OPERATIONAL_ROLE_MIGRATION)
            self.assertIn(f'"{role_name}"', DASHBOARD_SHELL)

        for permission_key in (
            "documents.link",
            "tender_bids.award",
            "finance.final_account.agree",
            "settings.update",
            "inventory.transfer.create",
            "maintenance_schedules.update",
            "compliance.gate.override",
        ):
            self.assertIn(permission_key, OPERATIONAL_ROLE_MIGRATION)

    def test_procurement_manager_owns_procurement_and_inventory_without_payment_or_po_approval(self):
        self.assertIn("'Procurement Manager'", PROCUREMENT_MANAGER_BOUNDARY_MIGRATION)
        for permission_key in (
            "documents.read",
            "documents.create",
            "documents.link",
        ):
            self.assertIn(permission_key, PROCUREMENT_MANAGER_BOUNDARY_MIGRATION)
        for restricted_key in (
            "procurement.po.approve",
            "procurement.invoice.approve_payment",
            "inventory.count.create",
        ):
            self.assertIn(restricted_key, PROCUREMENT_MANAGER_BOUNDARY_MIGRATION)
        self.assertIn("DELETE FROM core.role_permissions", PROCUREMENT_MANAGER_BOUNDARY_MIGRATION)

    def test_crm_associate_primary_role_stays_in_crm_not_qs_portal(self):
        self.assertIn("primary_role_name not in portal_primary_roles", PORTALS_ROUTER)
        self.assertIn("secondary operational roles", PORTALS_ROUTER)
        self.assertIn("trapped in /portal/qs", PORTALS_ROUTER)
        self.assertIn("default_landing_path = '/dashboard/crm'", CRM_ASSOCIATE_WORKSPACE_MIGRATION)
        for permission_key in (
            "crm.view_opportunities",
            "crm.view_tenders",
            "crm_communications.read",
            "crm_automations.read",
            "crm.marketing.read",
            "crm.reports.read",
            "crm.support.read",
            "crm.import",
            "documents.read",
            "crm_tasks.read",
        ):
            self.assertIn(permission_key, CRM_ASSOCIATE_WORKSPACE_MIGRATION)
        self.assertIn('"CRM Associate"', DASHBOARD_SHELL)
        self.assertNotIn('name: "Commercial Command", href: "/dashboard/crm", icon: BarChart, restrictedRoles: ["CRM Associate"]', DASHBOARD_SHELL)

    def test_crm_associate_can_assign_tenders_and_use_leave_self_service(self):
        for permission_key in (
            "assignments.manage",
            "tender_bids.read",
            "tender_bids.create",
            "tender_bids.update",
            "tender_bids.award",
            "crm.opportunities.close_won",
            "hr.leave.self_service",
        ):
            self.assertIn(permission_key, CRM_ASSOCIATE_ACCESS_BRIDGE_MIGRATION)
        self.assertIn("supersede_entity_tasks", TENDER_BIDS_ROUTER)
        self.assertIn('source_event="tender_stage_changed"', TENDER_BIDS_ROUTER)
        self.assertIn('entity_type="tender"', TENDER_BIDS_ROUTER)


if __name__ == "__main__":
    unittest.main()
