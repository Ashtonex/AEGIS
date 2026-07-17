import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROC = (ROOT / "routers" / "procurement.py").read_text()
INV = (ROOT / "routers" / "inventory.py").read_text()
MAIN = (ROOT / "main.py").read_text()
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text()
INVENTORY_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "inventory" / "page.tsx"
).read_text()
PROCUREMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "procurement" / "page.tsx"
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
            "finance.commitment_created.v1",
            "inventory.goods_received.v1",
            "procurement.invoice_matched.v1",
            "finance.invoice_approved.v1",
            "document.linked.v1",
        ]:
            self.assertIn(event, PROC)
        self.assertIn("INSERT INTO finance.commitments", PROC)
        self.assertIn("INSERT INTO procurement.stock_ledger", PROC)
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
        self.assertIn("inventory.receipt_recorded.v1", INV)
        self.assertIn("inventory.issue_recorded.v1", INV)

    def test_inventory_issue_prevents_negative_stock_and_emits_reorder_event(self):
        self.assertIn("async def stock_balance", INV)
        self.assertIn("if available < payload.quantity", INV)
        self.assertIn("Insufficient stock available for issue.", INV)
        self.assertIn("Use a material request to procure the shortfall.", INV)
        self.assertIn("inventory.below_reorder_level.v1", INV)
        self.assertIn("remaining <= threshold", INV)

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

    def test_procurement_page_degrades_supporting_sources_without_killing_workflow(
        self,
    ):
        self.assertIn("Promise.allSettled", PROCUREMENT_PAGE)
        self.assertIn(
            "The procurement feed is still synchronizing. Please retry once the connection is ready.",
            PROCUREMENT_PAGE,
        )
        self.assertIn("Requisitions could not be loaded.", PROCUREMENT_PAGE)
        self.assertIn("RFQs could not be loaded.", PROCUREMENT_PAGE)
        self.assertIn("Purchase orders could not be loaded.", PROCUREMENT_PAGE)
        self.assertIn("Suppliers could not be loaded.", PROCUREMENT_PAGE)


if __name__ == "__main__":
    unittest.main()
