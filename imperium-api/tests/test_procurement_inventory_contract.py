import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROC = (ROOT / "routers" / "procurement.py").read_text()
INV = (ROOT / "routers" / "inventory.py").read_text()
INV_ITEMS = (ROOT / "routers" / "inventory_items.py").read_text()
INV_SERVICE = (ROOT / "app" / "services" / "inventory_service.py").read_text()
MAIN = (ROOT / "main.py").read_text()
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text()
INVENTORY_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "inventory" / "page.tsx"
).read_text()
PROCUREMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "procurement" / "page.tsx"
).read_text()
SUPPLIER_RECORDS = (ROOT / "routers" / "supplier_records.py").read_text()
SUPPLIER_EDIT_PERMISSION_REPAIR = (
    ROOT / "migrations" / "166_supplier_edit_permission_repair.sql"
).read_text()
STORES_PROCUREMENT_ACCESS_REPAIR = (
    ROOT / "migrations" / "167_stores_procurement_manager_access_repair.sql"
).read_text()
INVENTORY_CATEGORY_NORMALIZATION = (
    ROOT / "migrations" / "170_normalize_inventory_item_categories.sql"
).read_text()
SUPABASE_STORES_PROCUREMENT_ACCESS_REPAIR = (
    ROOT.parent
    / "supabase"
    / "migrations"
    / "20260826093000_stores_procurement_manager_access_repair.sql"
).read_text()
SETTINGS_ROUTER = (ROOT / "routers" / "settings.py").read_text()
DASHBOARD_SHELL = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "DashboardShell.tsx"
).read_text()
USE_API_QUERIES_HOOK = (
    ROOT.parent / "aegis-web" / "src" / "hooks" / "useApiQueries.ts"
).read_text()


class ProcurementInventoryContractTests(unittest.TestCase):
    def test_typed_procurement_router_registered(self):
        self.assertIn("from routers import auth, users, projects", MAIN)
        self.assertIn("procurement, inventory", MAIN)
        self.assertIn('prefix="/api/v1/procurement"', MAIN)
        self.assertIn('prefix="/api/v1/inventory"', MAIN)

    def test_procurement_workflow_is_api_first_and_tenant_scoped(self):
        for route in [
            '@router.post("/requisitions"',
            '@router.post("/requisitions/{req_id}/submit"',
            '@router.post("/requisitions/{req_id}/decision"',
            '@router.get("/rfqs"',
            '@router.post("/rfqs"',
            '@router.post("/rfqs/{rfq_id}/responses"',
            '@router.post("/rfqs/{rfq_id}/responses/{response_id}/decision"',
            '@router.post("/purchase-orders/from-rfq"',
            '@router.post("/purchase-orders"',
            '@router.post("/purchase-orders/{po_id}/decision"',
            '@router.post("/purchase-orders/{po_id}/issue"',
            '@router.post("/goods-received"',
            '@router.post("/invoices"',
            '@router.post("/invoices/{invoice_id}/match"',
            '@router.post("/invoices/{invoice_id}/payment-decision"',
            '@router.post("/documents/link"',
        ]:
            self.assertIn(route, PROC)
        self.assertIn("organization_id=:org_id", PROC)
        self.assertIn('require_permission("procurement.requisition.create")', PROC)
        self.assertIn("Self-approval is not permitted", PROC)
        self.assertIn("Procurement Manager can prepare purchase orders, but approval must be independent.", PROC)
        self.assertIn("Finance controls supplier payment approval; Procurement Manager cannot release payments.", PROC)
        self.assertIn("Payment approval requires a matched PO, GRN and invoice", PROC)
        self.assertIn('require_permission("documents.link")', PROC)
        self.assertIn('require_permission("procurement.rfq.create")', PROC)
        self.assertIn('require_permission("procurement.rfq.manage")', PROC)

    def test_procurement_posts_events_stock_and_finance_commitments(self):
        for event in [
            "material.requested.v1",
            "procurement.requisition.approved.v1",
            "procurement.rfq.issued.v1",
            "procurement.quotation.received.v1",
            "procurement.quotation.selected.v1",
            "procurement.purchase_order.issued.v1",
            "procurement.purchase_order.approved.v1",
            "finance.commitment_created.v1",
            "inventory.goods_received.v1",
            "procurement.invoice_matched.v1",
            "finance.invoice_approved.v1",
            "document.linked.v1",
        ]:
            self.assertIn(event, PROC)
        self.assertIn("INSERT INTO finance.commitments", PROC)
        # Goods receipt now delegates the stock_ledger write to the shared
        # inventory_service (used by inventory.py, site_reports.py and
        # procurement.py alike) instead of duplicating the INSERT here.
        self.assertIn("inventory_service.receive_stock", PROC)
        self.assertIn("INSERT INTO procurement.stock_ledger", INV_SERVICE)
        self.assertIn("UPDATE finance.commitments", PROC)

    def test_documents_gate_supplier_payment_approval(self):
        self.assertIn("core.document_links", PROC)
        self.assertIn(
            "Payment approval requires linked PO, GRN, invoice and approval evidence.",
            PROC,
        )
        self.assertIn("Payment approval requires approval evidence document.", PROC)
        self.assertIn('purchase_order", inv["po_id"]', PROC)
        self.assertIn('goods_received_note", inv["grn_id"]', PROC)
        self.assertIn('supplier_invoice", invoice_id', PROC)
        self.assertIn('link_role="payment_approval"', PROC)
        self.assertIn("linkProcurementDocument", WEB_API)
        self.assertIn("approval_document_id: approvalDocumentId", WEB_API)

    def test_direct_purchase_order_requires_supplier_selection_rationale(self):
        self.assertIn(
            "Direct purchase order creation requires a supplier selection rationale.",
            PROC,
        )
        page = (
            ROOT.parent
            / "aegis-web"
            / "src"
            / "app"
            / "dashboard"
            / "procurement"
            / "page.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn("supplierSelectionReason", page)
        self.assertIn("Supplier selection rationale", page)
        self.assertIn("notes: supplierSelectionReason", page)
        self.assertIn("supplierSelectionReason.trim().length < 12", page)

    def test_rfq_frontend_contracts_are_exposed(self):
        for api in [
            "getProcurementRfqs",
            "createProcurementRfq",
            "recordProcurementRfqResponse",
            "decideProcurementRfqResponse",
            "createPurchaseOrderFromRfq",
        ]:
            self.assertIn(api, WEB_API)
        page = (
            ROOT.parent
            / "aegis-web"
            / "src"
            / "app"
            / "dashboard"
            / "procurement"
            / "page.tsx"
        ).read_text(encoding="utf-8")
        self.assertIn(
            'type Tab = "requisitions" | "rfqs" | "orders" | "suppliers" | "invoices";',
            page,
        )
        self.assertIn("function RfqsTab", page)
        self.assertIn("function CreateRfqModal", page)
        self.assertIn("function RfqResponseModal", page)

    def test_po_drawer_guides_scenario_a_to_payment_gate(self):
        page = (
            ROOT.parent
            / "aegis-web"
            / "src"
            / "app"
            / "dashboard"
            / "procurement"
            / "page.tsx"
        ).read_text(encoding="utf-8")
        for marker in [
            "Scenario A completion rail",
            "Finance commitment",
            "Goods received",
            "Supplier invoice",
            "Three-way match",
            "Payment evidence gate",
            "Approve with evidence",
            "Payment gate cleared",
            "onMatchInvoice",
            "onApprovePayment",
            "onApprove={approvePO}",
            "Approve PO",
        ]:
            self.assertIn(marker, page)

    def test_inventory_router_uses_ledger_not_frontend_business_logic(self):
        for route in [
            '@router.get("/stock-levels"',
            '@router.get("/movements"',
            '@router.post("/receive"',
            '@router.post("/issue"',
        ]:
            self.assertIn(route, INV)
        self.assertIn("SUM(quantity) AS available_qty", INV)
        self.assertIn('require_permission("inventory.receipt.create")', INV)
        self.assertIn('require_permission("inventory.issue.create")', INV)
        # Ledger writes and event emission for receive/issue live in the
        # shared inventory_service, called from here rather than duplicated.
        self.assertIn("inventory_service.receive_stock", INV)
        self.assertIn("inventory_service.issue_stock", INV)
        self.assertIn("p.client_name", INV)
        self.assertIn("inventory.receipt_recorded.v1", INV_SERVICE)
        self.assertIn("inventory.issue_recorded.v1", INV_SERVICE)

    def test_inventory_issue_prevents_negative_stock_and_emits_reorder_event(self):
        self.assertIn("async def stock_balance", INV_SERVICE)
        self.assertIn("if available < quantity", INV_SERVICE)
        self.assertIn("Insufficient stock available for issue.", INV_SERVICE)
        self.assertIn("Use a material request to procure the shortfall.", INV_SERVICE)
        self.assertIn("inventory.below_reorder_level.v1", INV_SERVICE)
        self.assertIn("remaining <= threshold", INV_SERVICE)

    def test_inventory_transfer_and_adjustment_are_wired(self):
        for route in [
            '@router.post("/transfer"',
            '@router.post("/adjustment"',
            '@router.get("/stores"',
            '@router.post("/stores"',
        ]:
            self.assertIn(route, INV)
        self.assertIn('require_permission("inventory.transfer.create")', INV)
        self.assertIn('require_permission("inventory.count.create")', INV)
        self.assertIn('require_permission("inventory.store.manage")', INV)
        self.assertIn("Source and destination store must differ.", INV_SERVICE)
        self.assertIn("Adjustment quantity cannot be zero.", INV_SERVICE)
        self.assertIn("inventory.transfer.completed.v1", INV_SERVICE)
        self.assertIn("inventory.adjustment.recorded.v1", INV_SERVICE)
        self.assertIn("transfer_out", INV_SERVICE)
        self.assertIn("transfer_in", INV_SERVICE)

    def test_issue_stock_posts_actual_cost_when_project_supplied(self):
        """The cost-recognition unification: any stock issue tied to a
        project posts a real finance.cost_transactions row, not just a
        budget commitment - this is what makes PO-sourced materials show
        up as actual project spend the same way site-issued materials do."""
        self.assertIn("async def issue_stock", INV_SERVICE)
        self.assertIn("if project_id is not None:", INV_SERVICE)
        self.assertIn("INSERT INTO finance.cost_transactions", INV_SERVICE)
        self.assertIn("finance.actual_cost_created.v1", INV_SERVICE)
        self.assertIn("async def receive_stock", INV_SERVICE)
        self.assertNotIn(
            "INSERT INTO finance.cost_transactions",
            INV_SERVICE.split("async def receive_stock")[1].split(
                "async def issue_stock"
            )[0],
        )

    def test_inventory_page_degrades_supporting_sources_without_killing_stock_view(
        self,
    ):
        self.assertIn("Promise.allSettled", INVENTORY_PAGE)
        self.assertIn(
            "The inventory feed is still synchronizing. Please retry once the connection is ready.",
            INVENTORY_PAGE,
        )
        self.assertIn("Stock levels could not be loaded.", INVENTORY_PAGE)
        self.assertIn("Inventory catalogue could not be loaded.", INVENTORY_PAGE)
        self.assertIn("Store register could not be loaded.", INVENTORY_PAGE)
        self.assertIn("Movement history could not be loaded.", INVENTORY_PAGE)

    def test_receive_stock_uses_persistent_catalogue_items(self):
        self.assertIn("getInventoryCatalogue()", INVENTORY_PAGE)
        self.assertIn("catalogue={catalogue}", INVENTORY_PAGE)
        self.assertIn("set(\"item_id\", String(id))", INVENTORY_PAGE)
        self.assertIn("unit_of_measure: uom", INVENTORY_PAGE)
        self.assertIn("normalize_item_payload", INV_ITEMS)
        self.assertIn('"uom" in normalized', INV_ITEMS)
        self.assertIn('"unit_of_measure"', INV_ITEMS)
        self.assertIn("SELECT {ITEM_RETURNING_COLUMNS}", INV_ITEMS)
        self.assertIn("ORDER BY item_name NULLS LAST", INV_ITEMS)
        self.assertIn("LIMIT 500", INV_ITEMS)
        self.assertIn("delete body.uom", WEB_API)
        self.assertIn("body.unit_of_measure = body.uom", WEB_API)
        self.assertIn("require_ref(\n        db, \"procurement.inventory_items\", payload.item_id", INV)
        self.assertIn("inventory_service.receive_stock", INV)

    def test_inventory_item_categories_are_canonicalized(self):
        self.assertIn("INVENTORY_CATEGORY_ALIASES", INV_ITEMS)
        self.assertIn("def normalize_inventory_category", INV_ITEMS)
        self.assertIn('normalized["category"] = normalize_inventory_category', INV_ITEMS)
        self.assertIn("normalizeInventoryCategory", INVENTORY_PAGE)
        self.assertIn("list=\"inventory-category-options\"", INVENTORY_PAGE)
        self.assertIn("categories={categories}", INVENTORY_PAGE)
        self.assertIn("cats.add(normalizeInventoryCategory(r.category))", INVENTORY_PAGE)
        self.assertIn("normalizeInventoryCategory(form.category)", INVENTORY_PAGE)
        self.assertIn("UPDATE procurement.inventory_items", INVENTORY_CATEGORY_NORMALIZATION)
        self.assertIn("Timber & Boards", INVENTORY_CATEGORY_NORMALIZATION)
        self.assertIn("Cement & Concrete", INVENTORY_CATEGORY_NORMALIZATION)

    def test_inventory_supports_tools_zimra_vat_and_full_invoice_receipt(self):
        for marker in [
            "item_type, vat_rate, vat_inclusive, unit_price_ex_vat",
            '"apply_zimra_vat" in normalized',
            'normalized["vat_rate"] = Decimal("15.5")',
            '"tool"',
        ]:
            self.assertIn(marker, INV_ITEMS)
        for marker in [
            "InventoryInvoiceReceiptPayload",
            '@router.post("/receive-invoice"',
            'require_permission("procurement.invoice.create")',
            "procurement.supplier_invoice_lines",
            'source_type="supplier_invoice"',
            "inventory.invoice_received.v1",
        ]:
            self.assertIn(marker, INV)
        self.assertIn("receiveInventoryInvoice", WEB_API)
        for marker in [
            "Bulk Store Invoice",
            "ReceiveInvoiceModal",
            "Reusable Tool",
            "Apply ZIMRA VAT",
            "unit_price_inc_vat",
            "stockValue(row)",
        ]:
            self.assertIn(marker, INVENTORY_PAGE)

    def test_procurement_page_degrades_supporting_sources_without_killing_workflow(
        self,
    ):
        # Multi-source loading (Promise.allSettled + critical-vs-warning source
        # split) is centralized in the shared useApiQueries hook rather than
        # hand-rolled here - see test_crm_contacts_workspace_degrades_partial_sources
        # for the same pattern on the CRM contacts page.
        self.assertIn("useApiQueries", PROCUREMENT_PAGE)
        self.assertIn("Promise.allSettled", USE_API_QUERIES_HOOK)
        self.assertIn("could not be loaded.", USE_API_QUERIES_HOOK)
        self.assertIn(
            "The procurement feed is still synchronizing. Please retry once the connection is ready.",
            PROCUREMENT_PAGE,
        )
        self.assertIn('criticalKeys: ["requisitions"]', PROCUREMENT_PAGE)
        self.assertIn('rfqs: "RFQs"', PROCUREMENT_PAGE)
        self.assertIn('orders: "Purchase orders"', PROCUREMENT_PAGE)
        self.assertIn('suppliers: "Suppliers"', PROCUREMENT_PAGE)

    def test_supplier_360_allows_editing_and_portal_login_issue(self):
        for marker in [
            "Supplier360Modal",
            "Supplier 360",
            "Business dealings",
            "SupplierBusinessDealings",
            "updateSupplierRecord",
            "issueSupplierPortalLogin",
            "Issue login",
            "Copy login",
            "Purchase orders",
            "Supplier invoices",
            "RFQ quotations",
            "Received materials and tools",
        ]:
            self.assertIn(marker, PROCUREMENT_PAGE + WEB_API)

        self.assertIn('@router.post("/{item_id}/portal-login")', SUPPLIER_RECORDS)
        self.assertIn("sync_supplier_subcontractor_bridge", SUPPLIER_RECORDS)
        self.assertIn("ensure_supplier_subcontractor_bridge", SUPPLIER_RECORDS)
        self.assertIn('user_has_permission(db, user, "settings.update")', SUPPLIER_RECORDS)
        self.assertIn("'Executive (Admin)'", SUPPLIER_EDIT_PERMISSION_REPAIR)
        self.assertIn("'Procurement Manager'", SUPPLIER_EDIT_PERMISSION_REPAIR)
        self.assertIn("'supplier_records.update'", SUPPLIER_EDIT_PERMISSION_REPAIR)

    def test_stores_procurement_manager_can_access_procurement_and_inventory(self):
        for role_name in [
            "Procurement Manager",
            "Stores and Procurement Manager",
            "Stores & Procurement Manager",
        ]:
            self.assertIn(role_name, STORES_PROCUREMENT_ACCESS_REPAIR)
            self.assertIn(role_name, DASHBOARD_SHELL)
            self.assertIn(role_name, PROCUREMENT_PAGE)
            self.assertIn(role_name, INVENTORY_PAGE)

        for permission in [
            "procurement.requisition.read",
            "procurement.requisition.create",
            "procurement.requisition.submit",
            "procurement.po.read",
            "procurement.po.create",
            "procurement.po.issue",
            "procurement.rfq.read",
            "procurement.rfq.create",
            "procurement.rfq.manage",
            "procurement.invoice.read",
            "procurement.invoice.create",
            "procurement.invoice.match",
            "procurement.grn.read",
            "procurement.grn.create",
            "procurement.grn.confirm",
            "procurement.supplier.read",
            "supplier_records.read",
            "supplier_records.create",
            "supplier_records.update",
            "inventory_items.read",
            "inventory_items.create",
            "inventory_items.update",
            "inventory_items.delete",
            "inventory.receipt.create",
            "inventory.issue.create",
            "inventory.transfer.create",
            "inventory.count.create",
            "inventory.store.manage",
        ]:
            self.assertIn(permission, STORES_PROCUREMENT_ACCESS_REPAIR)

        self.assertIn("procurement.invoice.approve_payment", STORES_PROCUREMENT_ACCESS_REPAIR)
        self.assertIn("procurement.po.approve", STORES_PROCUREMENT_ACCESS_REPAIR)
        self.assertIn("DELETE FROM core.role_permissions", STORES_PROCUREMENT_ACCESS_REPAIR)
        self.assertEqual(STORES_PROCUREMENT_ACCESS_REPAIR, SUPABASE_STORES_PROCUREMENT_ACCESS_REPAIR)

    def test_inventory_page_is_visible_in_access_matrix(self):
        self.assertIn('"page": "Inventory"', SETTINGS_ROUTER)
        self.assertIn('"route": "/dashboard/inventory"', SETTINGS_ROUTER)
        self.assertIn('"permission": "inventory_items.read"', SETTINGS_ROUTER)


if __name__ == "__main__":
    unittest.main()
