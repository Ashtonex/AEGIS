from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VENDOR_CHECK = (ROOT / "app" / "shared" / "vendor_verification.py").read_text(encoding="utf-8")
HR_ROUTER = (ROOT / "routers" / "hr_verification.py").read_text(encoding="utf-8")
HR_PANEL = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "hr" / "VendorVerificationPanel.tsx"
).read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
CRM_ROUTER = (ROOT / "routers" / "crm.py").read_text(encoding="utf-8")
SUPPLIER_RECORDS = (ROOT / "routers" / "supplier_records.py").read_text(encoding="utf-8")
PAYMENTS_ROUTER = (ROOT / "routers" / "payments.py").read_text(encoding="utf-8")
SUBCONTRACTOR_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "subcontractors" / "page.tsx"
).read_text(encoding="utf-8")
VENDOR_PAYMENTS_PANEL = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "finance" / "VendorPaymentsPanel.tsx"
).read_text(encoding="utf-8")


class VendorVerificationBridgeContractTests(unittest.TestCase):
    def test_system_check_reads_linked_supplier_profile_fields(self):
        self.assertIn("LEFT JOIN procurement.suppliers ps", VENDOR_CHECK)
        self.assertIn("NULLIF(ps.primary_contact_email, '')", VENDOR_CHECK)
        self.assertIn("NULLIF(ps.tax_number, '')", VENDOR_CHECK)
        self.assertIn("NULLIF(ps.address, '')", VENDOR_CHECK)
        self.assertIn("NULLIF(s.submission_data->>'company_address', '')", VENDOR_CHECK)

    def test_system_check_accepts_uploaded_supplier_compliance_documents(self):
        self.assertIn("procurement.supplier_compliance_documents scd", VENDOR_CHECK)
        self.assertIn("scd.status NOT IN ('rejected', 'needs_update')", VENDOR_CHECK)
        self.assertIn("scd.supplier_id = s.linked_supplier_id", VENDOR_CHECK)
        self.assertIn("normalize_compliance_category", VENDOR_CHECK)
        self.assertIn("dl.entity_type = 'supplier'", VENDOR_CHECK)
        self.assertIn("registration_certificate", VENDOR_CHECK)

    def test_system_check_survives_missing_supplier_compliance_table(self):
        self.assertIn("to_regclass('procurement.supplier_compliance_documents')", VENDOR_CHECK)
        self.assertIn("doc_sql =", VENDOR_CHECK)

    def test_hr_detail_endpoint_returns_combined_profile_and_documents(self):
        self.assertIn('@router.get("/{subcontractor_id}", summary="Get a combined supplier/subcontractor profile for HR review")', HR_ROUTER)
        self.assertIn('"filled_fields": filled_fields', HR_ROUTER)
        self.assertIn('"documents": documents', HR_ROUTER)
        self.assertIn("NULLIF(ps.address, '')", HR_ROUTER)
        self.assertIn("scd.supplier_id = s.linked_supplier_id", HR_ROUTER)

    def test_hr_queue_survives_document_table_migration_gap(self):
        self.assertIn("to_regclass('procurement.supplier_compliance_documents')", HR_ROUTER)
        self.assertIn("0::integer AS compliance_document_count", HR_ROUTER)
        self.assertIn("0::integer AS verified_document_count", HR_ROUTER)

    def test_hr_panel_uses_full_review_modal_and_auto_refresh(self):
        self.assertIn("getHrVendorVerificationDetail", API)
        self.assertIn("HrVendorVerificationDetail", API)
        self.assertIn("VendorReviewModal", HR_PANEL)
        self.assertIn("setInterval(() => void load(), 30000)", HR_PANEL)
        self.assertIn("Filled profile fields", HR_PANEL)
        self.assertIn("Uploaded compliance documents", HR_PANEL)

    def test_registry_splits_supplier_and_subcontractor_records(self):
        self.assertIn("submission_data ->> 'account_type' AS account_type", CRM_ROUTER)
        self.assertIn('submission_data": \'{"account_type":"supplier"}\'', SUPPLIER_RECORDS)
        self.assertIn("type RegistryTab = 'subcontractors' | 'suppliers'", SUBCONTRACTOR_PAGE)
        self.assertIn("function vendorKind", SUBCONTRACTOR_PAGE)
        self.assertIn("Subcontractors", SUBCONTRACTOR_PAGE)
        self.assertIn("Suppliers", SUBCONTRACTOR_PAGE)

    def test_hr_exception_accept_is_audited_and_notified(self):
        self.assertIn('@router.post("/{subcontractor_id}/accept-with-gaps"', HR_ROUTER)
        self.assertIn("vendor.onboarding_bypass.accepted.v1", HR_ROUTER)
        self.assertIn("emit_role_notification", HR_ROUTER)
        self.assertIn("SUPERADMIN_ROLE", HR_ROUTER)
        self.assertIn("onboarding_bypass", HR_ROUTER)
        self.assertIn("UPDATE procurement.suppliers", HR_ROUTER)
        self.assertIn("status = 'active'", HR_ROUTER)
        self.assertIn("acceptHrVendorVerificationWithGaps", API)
        self.assertIn("Accept", HR_PANEL)

    def test_bypassed_vendor_business_carries_onboarding_warning(self):
        self.assertIn("vendor_onboarding_bypass_enabled", PAYMENTS_ROUTER)
        self.assertIn("vendor_onboarding_bypass_message", PAYMENTS_ROUTER)
        self.assertIn("Onboarding bypass: vendor must complete onboarding properly", PAYMENTS_ROUTER)
        self.assertIn("vendor_onboarding_bypass_enabled", VENDOR_PAYMENTS_PANEL)
        self.assertIn("Vendor was accepted before onboarding was complete", VENDOR_PAYMENTS_PANEL)


if __name__ == "__main__":
    unittest.main()
