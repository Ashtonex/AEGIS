import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUPPLIER_RECORDS = (ROOT / "routers" / "supplier_records.py").read_text()
PORTALS = (ROOT / "routers" / "portals.py").read_text()
HR_VERIFICATION = (ROOT / "routers" / "hr_verification.py").read_text()
DOCUMENTS = (ROOT / "routers" / "documents.py").read_text()
VENDOR_VERIFICATION = (ROOT / "app" / "shared" / "vendor_verification.py").read_text()
MIGRATION = (ROOT / "migrations" / "168_supplier_compliance_document_workflow.sql").read_text()
SUPABASE_MIGRATION = (
    ROOT.parent / "supabase" / "migrations" / "20260826093704_supplier_compliance_document_workflow.sql"
).read_text()
WEB_API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text()
PROCUREMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "procurement" / "page.tsx"
).read_text(encoding="utf-8")
SUPPLIER_PORTAL = (
    ROOT.parent / "aegis-web" / "src" / "components" / "auth" / "SupplierPortalHome.tsx"
).read_text(encoding="utf-8")
CLIENT_PORTAL = (
    ROOT.parent / "aegis-web" / "src" / "components" / "auth" / "ClientPortalHome.tsx"
).read_text(encoding="utf-8")
HR_PANEL = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "hr" / "VendorVerificationPanel.tsx"
).read_text(encoding="utf-8")


class SupplierComplianceDocumentsContractTests(unittest.TestCase):
    def test_required_document_register_exists_in_both_migration_ledgers(self):
        for migration in (MIGRATION, SUPABASE_MIGRATION):
            self.assertIn("CREATE TABLE IF NOT EXISTS procurement.supplier_compliance_documents", migration)
            for document_type in ["tax_clearance", "nssa", "praz", "vat", "company_registration"]:
                self.assertIn(document_type, migration)
            for permission in [
                "supplier_compliance_documents.read",
                "supplier_compliance_documents.upload",
                "supplier_compliance_documents.verify",
            ]:
                self.assertIn(permission, migration)
            self.assertIn("Stores and Procurement Manager", migration)
            self.assertIn("HR Manager", migration)

    def test_supplier_documents_are_linked_to_documents_module_and_reviewed_by_staff(self):
        self.assertIn('"supplier": "procurement.suppliers"', DOCUMENTS)
        self.assertIn('@router.get("/{item_id}/documents")', SUPPLIER_RECORDS)
        self.assertIn('@router.post("/{item_id}/documents"', SUPPLIER_RECORDS)
        self.assertIn('@router.get("/{item_id}/documents/{document_id}/signed-url")', SUPPLIER_RECORDS)
        self.assertIn('@router.post("/{item_id}/documents/{document_id}/decision")', SUPPLIER_RECORDS)
        self.assertIn("INSERT INTO core.document_links", SUPPLIER_RECORDS)
        self.assertIn('("supplier", item_id)', SUPPLIER_RECORDS)
        self.assertIn('("subcontractor", subcontractor_id)', SUPPLIER_RECORDS)
        self.assertIn("emit_role_notification", SUPPLIER_RECORDS)

    def test_supplier_portal_can_upload_view_and_trigger_re_review(self):
        self.assertIn("document_type: Optional[str]", PORTALS)
        self.assertIn('@router.get("/supplier/documents/{document_id}/signed-url")', PORTALS)
        self.assertIn("procurement.supplier_compliance_documents", PORTALS)
        self.assertIn("Supplier uploaded compliance document", PORTALS)
        self.assertIn("verification_stage = 'incomplete'", PORTALS)
        for document_type in ["tax_clearance", "nssa", "praz", "vat", "company_registration"]:
            self.assertIn(document_type, SUPPLIER_PORTAL)
        self.assertIn("getSupplierPortalDocumentSignedUrl", WEB_API)
        self.assertIn("document_type?: SupplierComplianceDocumentType", WEB_API)

    def test_hr_queue_reviews_documents_before_profile_approval(self):
        self.assertIn('@router.get("/{subcontractor_id}/documents"', HR_VERIFICATION)
        self.assertIn('@router.post("/{subcontractor_id}/documents/{document_id}/decision")', HR_VERIFICATION)
        self.assertIn("Verify these documents before approving the vendor", HR_VERIFICATION)
        self.assertIn("compliance_document_count", HR_VERIFICATION)
        self.assertIn("getHrVendorVerificationDocuments", HR_PANEL)
        self.assertIn("decideHrVendorVerificationDocument", HR_PANEL)
        self.assertIn("Documents {row.compliance_document_count ?? 0}/5 uploaded", HR_PANEL)

    def test_automated_verification_uses_full_document_set(self):
        for document_type in ["tax_clearance", "nssa", "praz", "vat", "company_registration"]:
            self.assertIn(document_type, VENDOR_VERIFICATION)
        self.assertIn("procurement.supplier_compliance_documents", VENDOR_VERIFICATION)
        self.assertIn("dl.link_role IN", VENDOR_VERIFICATION)

    def test_supplier_popup_has_compliance_document_tab(self):
        self.assertIn('type SupplierModalTab = "overview" | "documents" | "dealings"', PROCUREMENT_PAGE)
        self.assertIn('["documents", "Documents"]', PROCUREMENT_PAGE)
        self.assertIn("SupplierComplianceDocumentsPanel", PROCUREMENT_PAGE)
        self.assertIn("recordSupplierComplianceDocument", PROCUREMENT_PAGE)
        self.assertIn("getSupplierComplianceDocumentSignedUrl", PROCUREMENT_PAGE)

    def test_client_portal_can_review_and_replace_documents(self):
        self.assertIn('"client_contact": "crm.contacts"', DOCUMENTS)
        self.assertIn('"client_organization": "crm.organizations"', DOCUMENTS)
        self.assertIn('@router.get("/client/documents/{document_id}/signed-url")', PORTALS)
        self.assertIn("Client uploaded a document", PORTALS)
        self.assertIn("documents?: Array", WEB_API)
        self.assertIn("getClientPortalDocumentSignedUrl", WEB_API)
        self.assertIn("uploadClientDocument", CLIENT_PORTAL)
        self.assertIn("Your files", CLIENT_PORTAL)


if __name__ == "__main__":
    unittest.main()
