from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_263 = (
    ROOT / "migrations" / "263_plant_equipment_cross_hire_sublease_brokerage.sql"
).read_text(encoding="utf-8")
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
API_FLEET = (
    ROOT.parent / "aegis-web" / "src" / "lib" / "api" / "fleet.ts"
).read_text(encoding="utf-8")
HIRE_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "fleet" / "hire" / "page.tsx"
).read_text(encoding="utf-8")


class PlantEquipmentCrossHireContractTests(unittest.TestCase):
    """Verify that the cross-hire & sub-lease brokerage contract is satisfied."""

    def test_migration_263_defines_brokerage_controls(self):
        markers = [
            "fulfillment_type",
            "sourcing_rate",
            "sourcing_rate_unit",
            "supplier_name",
            "supplier_contact",
            "supplier_terms",
            "supplier_payable_amount",
            "supplier_payment_status",
            "supplier_invoice_reference",
            "unit_spread",
            "unit_spread_percentage",
            "projected_hours_or_units",
            "projected_revenue",
            "projected_cost",
            "projected_gross_profit",
            "realized_gross_profit",
            "sourced_asset_category",
            "sourced_asset_make_model",
            "sourced_asset_reg_serial",
        ]
        for marker in markers:
            self.assertIn(marker, MIGRATION_263, f"Missing {marker} in migration 263")

    def test_fleet_router_has_brokerage_endpoints_and_logic(self):
        self.assertIn('@router.post("/external-hire-agreements/{agreement_id}/supplier-invoice")', FLEET_ROUTER)
        self.assertIn('unit_spread = client_rate - sourcing_rate', FLEET_ROUTER)
        self.assertIn('supplier_payable_amount', FLEET_ROUTER)
        self.assertIn('realized_gross_profit', FLEET_ROUTER)

    def test_api_client_exports_supplier_invoice(self):
        self.assertIn("recordExternalPlantHireSupplierInvoice", API_FLEET)

    def test_hire_page_has_brokerage_ui(self):
        self.assertIn("Cross-Hire Sub-Lease", HIRE_PAGE)
        self.assertIn("sourcing_rate", HIRE_PAGE)
        self.assertIn("supplier_name", HIRE_PAGE)
        self.assertIn("Live Sub-Lease Spread & Profit Calculator", HIRE_PAGE)
        self.assertIn("SupplierInvoiceModal", HIRE_PAGE)
