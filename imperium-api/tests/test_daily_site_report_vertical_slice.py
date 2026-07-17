from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ROUTER = (ROOT / "routers" / "site_reports.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
MIGRATION = (
    ROOT / "migrations" / "021_daily_site_report_vertical_slice.sql"
).read_text(encoding="utf-8")
MATERIAL_REQUEST_MIGRATION = (
    ROOT / "migrations" / "026_site_material_request_bridge.sql"
).read_text(encoding="utf-8")
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
SITE_PAGE = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "app"
    / "dashboard"
    / "site-operations"
    / "page.tsx"
).read_text(encoding="utf-8")


class DailySiteReportVerticalSliceTests(unittest.TestCase):
    """Guard the first AEGIS vertical slice: approved daily site report to enterprise evidence."""

    def test_router_is_registered_before_legacy_site_operations_crud(self):
        typed_index = MAIN.index(
            'include_router(site_reports.router, prefix="/api/v1/site-operations", tags=["Site Operations"])'
        )
        legacy_index = MAIN.index(
            'include_router(site_operations.router, prefix="/api/v1/site-operations", tags=["Site Operations"], dependencies=[Depends(require_resource_permission("site_operations"))])'
        )
        self.assertLess(typed_index, legacy_index)

    def test_payloads_are_typed_and_frontend_cannot_override_tenant_identity(self):
        self.assertIn("class DailyReportCreate(Payload):", ROUTER)
        self.assertIn("class LabourLine(Payload):", ROUTER)
        self.assertIn("class EquipmentLine(Payload):", ROUTER)
        self.assertIn("class MaterialLine(Payload):", ROUTER)
        self.assertIn('ConfigDict(extra="forbid", str_strip_whitespace=True)', ROUTER)
        self.assertNotIn("request.json()", ROUTER)
        self.assertNotIn("payload: dict", ROUTER)
        self.assertIn('"org_id": user["org_id"]', ROUTER)
        self.assertIn('"user_id": user["user_id"]', ROUTER)

    def test_daily_report_workflow_permissions_are_action_specific(self):
        for permission in [
            'require_permission("site_operations.daily_report.read")',
            'require_permission("site_operations.daily_report.create")',
            'require_permission("site_operations.daily_report.update")',
            'require_permission("site_operations.daily_report.submit")',
            'require_permission("site_operations.daily_report.approve")',
            'require_permission("site_operations.labour.record")',
            'require_permission("site_operations.equipment.record")',
            'require_permission("site_operations.material.record")',
            'require_permission("documents.link")',
        ]:
            self.assertIn(permission, ROUTER)

    def test_material_selectors_are_read_only_tenant_scoped_contracts(self):
        self.assertIn('@router.get("/inventory-items")', ROUTER)
        self.assertIn('@router.get("/stores")', ROUTER)
        self.assertIn('require_permission("site_operations.material.record")', ROUTER)
        self.assertIn("FROM procurement.inventory_items i", ROUTER)
        self.assertIn("FROM procurement.stores st", ROUTER)
        self.assertIn("WHERE i.organization_id=:org_id AND i.is_deleted=false", ROUTER)
        self.assertIn(
            "WHERE st.organization_id=:org_id AND st.is_deleted=false", ROUTER
        )
        self.assertNotIn('@router.post("/inventory-items")', ROUTER)
        self.assertNotIn('@router.post("/stores")', ROUTER)

    def test_nullable_filters_are_cast_for_asyncpg(self):
        self.assertIn("CAST(:project_id AS uuid) IS NULL", ROUTER)
        self.assertIn("CAST(:status_filter AS varchar) IS NULL", ROUTER)
        self.assertNotIn(":project_id IS NULL OR", ROUTER)
        self.assertNotIn(":status_filter IS NULL OR", ROUTER)

    def test_migration_creates_shared_foundations_with_service_role_rls(self):
        for table in [
            "core.domain_events",
            "core.approval_instances",
            "core.approval_steps",
            "core.document_links",
            "projects.daily_site_reports",
            "projects.daily_report_labour",
            "projects.daily_report_equipment",
            "projects.daily_report_materials",
            "procurement.stock_ledger",
            "finance.cost_transactions",
        ]:
            self.assertIn(table, MIGRATION)
        self.assertGreaterEqual(MIGRATION.count("ENABLE ROW LEVEL SECURITY"), 10)
        self.assertGreaterEqual(MIGRATION.count("FORCE ROW LEVEL SECURITY"), 10)
        self.assertGreaterEqual(MIGRATION.count("TO service_role"), 10)
        self.assertIn("REVOKE ALL ON core.domain_events", MIGRATION)
        self.assertNotIn("auth.role()", MIGRATION)

    def test_events_documents_costs_and_stock_are_integrated(self):
        for event_type in [
            "site.daily_report.created.v1",
            "site.daily_report.submitted.v1",
            "site.daily_report.approved.v1",
            "site.labour_recorded.v1",
            "site.equipment_recorded.v1",
            "site.material_consumed.v1",
            "document.linked.v1",
            "finance.actual_cost_created.v1",
            "project.progress_updated.v1",
        ]:
            self.assertIn(event_type, ROUTER)
        self.assertIn("INSERT INTO core.domain_events", ROUTER)
        self.assertIn("INSERT INTO core.document_links", ROUTER)
        self.assertIn("INSERT INTO finance.cost_transactions", ROUTER)
        self.assertIn("INSERT INTO procurement.stock_ledger", ROUTER)

    def test_approval_rules_prevent_empty_report_and_self_approval(self):
        self.assertIn("Cannot submit an empty daily report.", ROUTER)
        self.assertIn("Self-approval is not permitted for daily site reports.", ROUTER)
        self.assertIn(
            "Only submitted daily reports can receive an approval decision.", ROUTER
        )
        self.assertIn(
            "ON CONFLICT (organization_id, source_type, source_id, cost_category) DO NOTHING",
            ROUTER,
        )

    def test_site_material_request_bridges_inventory_procurement_and_finance(self):
        self.assertIn('@router.post("/material-requests"', ROUTER)
        self.assertIn('require_permission("site_operations.material.request")', ROUTER)
        self.assertIn("available_stock", ROUTER)
        self.assertIn("INSERT INTO procurement.material_requests", ROUTER)
        self.assertIn("'site_material_request'", ROUTER)
        self.assertIn("INSERT INTO procurement.stock_ledger", ROUTER)
        self.assertIn("INSERT INTO finance.cost_transactions", ROUTER)
        self.assertIn("INSERT INTO procurement.purchase_requisitions", ROUTER)
        self.assertIn("INSERT INTO procurement.requisition_lines", ROUTER)
        for event_type in [
            "site.material.requested.v1",
            "inventory.material_issued.v1",
            "material.requested.v1",
            "procurement.requisition.submitted.v1",
            "finance.actual_cost_created.v1",
        ]:
            self.assertIn(event_type, ROUTER)

    def test_site_material_request_schema_is_service_role_scoped_and_exposed_in_ui(
        self,
    ):
        self.assertIn(
            "CREATE TABLE IF NOT EXISTS procurement.material_requests",
            MATERIAL_REQUEST_MIGRATION,
        )
        self.assertIn("ENABLE ROW LEVEL SECURITY", MATERIAL_REQUEST_MIGRATION)
        self.assertIn("FORCE ROW LEVEL SECURITY", MATERIAL_REQUEST_MIGRATION)
        self.assertIn("TO service_role", MATERIAL_REQUEST_MIGRATION)
        self.assertIn("'site_operations.material.request'", MATERIAL_REQUEST_MIGRATION)
        self.assertIn("requestSiteMaterial", WEB_API)
        self.assertIn("/api/v1/site-operations/material-requests", WEB_API)
        self.assertIn("Scenario A bridge", SITE_PAGE)
        self.assertIn("Request material", SITE_PAGE)

    def test_site_operations_page_degrades_supporting_sources_without_killing_report_list(
        self,
    ):
        self.assertIn("Promise.allSettled", SITE_PAGE)
        self.assertIn("Daily site reports could not be loaded.", SITE_PAGE)
        self.assertIn("Project register could not be loaded.", SITE_PAGE)
        self.assertIn("Workforce register could not be loaded.", SITE_PAGE)
        self.assertIn(
            "The site operations feed is still synchronizing. Please retry once the connection is ready.",
            SITE_PAGE,
        )


if __name__ == "__main__":
    unittest.main()
