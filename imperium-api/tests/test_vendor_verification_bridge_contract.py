from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VENDOR_CHECK = (ROOT / "app" / "shared" / "vendor_verification.py").read_text(encoding="utf-8")
HR_ROUTER = (ROOT / "routers" / "hr_verification.py").read_text(encoding="utf-8")
HR_PANEL = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "hr" / "VendorVerificationPanel.tsx"
).read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(encoding="utf-8")


class VendorVerificationBridgeContractTests(unittest.TestCase):
    def test_system_check_reads_linked_supplier_profile_fields(self):
        self.assertIn("LEFT JOIN procurement.suppliers ps", VENDOR_CHECK)
        self.assertIn("NULLIF(ps.primary_contact_email, '')", VENDOR_CHECK)
        self.assertIn("NULLIF(ps.tax_number, '')", VENDOR_CHECK)
        self.assertIn("NULLIF(s.submission_data->>'company_address', '')", VENDOR_CHECK)

    def test_system_check_accepts_uploaded_supplier_compliance_documents(self):
        self.assertIn("procurement.supplier_compliance_documents scd", VENDOR_CHECK)
        self.assertIn("scd.status NOT IN ('rejected', 'needs_update')", VENDOR_CHECK)
        self.assertIn("scd.supplier_id = s.linked_supplier_id", VENDOR_CHECK)

    def test_hr_detail_endpoint_returns_combined_profile_and_documents(self):
        self.assertIn('@router.get("/{subcontractor_id}", summary="Get a combined supplier/subcontractor profile for HR review")', HR_ROUTER)
        self.assertIn('"filled_fields": filled_fields', HR_ROUTER)
        self.assertIn('"documents": documents', HR_ROUTER)
        self.assertIn("scd.supplier_id = s.linked_supplier_id", HR_ROUTER)

    def test_hr_panel_uses_full_review_modal_and_auto_refresh(self):
        self.assertIn("getHrVendorVerificationDetail", API)
        self.assertIn("HrVendorVerificationDetail", API)
        self.assertIn("VendorReviewModal", HR_PANEL)
        self.assertIn("setInterval(() => void load(), 30000)", HR_PANEL)
        self.assertIn("Filled profile fields", HR_PANEL)
        self.assertIn("Uploaded compliance documents", HR_PANEL)


if __name__ == "__main__":
    unittest.main()
