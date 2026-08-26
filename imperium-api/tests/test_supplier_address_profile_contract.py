from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
SUPPLIER_RECORDS = (ROOT / "routers" / "supplier_records.py").read_text(encoding="utf-8")
PROCUREMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "procurement" / "page.tsx"
).read_text(encoding="utf-8")
MIGRATION = (ROOT / "migrations" / "169_supplier_address_profile.sql").read_text(encoding="utf-8")


class SupplierAddressProfileContractTests(unittest.TestCase):
    def test_supplier_profile_persists_address_for_hr_verification(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS address TEXT", MIGRATION)
        self.assertIn('"address"', SUPPLIER_RECORDS)
        self.assertIn("address = COALESCE(s.address, sc.address)", SUPPLIER_RECORDS)
        self.assertIn('"address": payload.get("address")', SUPPLIER_RECORDS)

    def test_procurement_supplier_forms_capture_address(self):
        self.assertIn("address: tx(supplier.address", PROCUREMENT_PAGE)
        self.assertIn("address: form.address.trim()", PROCUREMENT_PAGE)
        self.assertIn('onChange={(v) => updateField("address", v)}', PROCUREMENT_PAGE)


if __name__ == "__main__":
    unittest.main()
