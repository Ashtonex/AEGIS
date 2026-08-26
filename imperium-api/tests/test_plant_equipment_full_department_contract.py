from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "migrations" / "164_plant_equipment_full_operating_department.sql"
).read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    ROOT.parent
    / "supabase"
    / "migrations"
    / "20260826074645_plant_equipment_full_operating_department.sql"
).read_text(encoding="utf-8")
FLEET_ROUTER = (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
API = (ROOT.parent / "aegis-web" / "src" / "lib" / "api.ts").read_text(
    encoding="utf-8"
)
FLEET_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "fleet" / "page.tsx"
).read_text(encoding="utf-8")
EQUIPMENT_PAGE = (
    ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "equipment" / "page.tsx"
).read_text(encoding="utf-8")
ASSET_MODALS = (
    ROOT.parent
    / "aegis-web"
    / "src"
    / "components"
    / "fleet"
    / "AssetOperationsModals.tsx"
).read_text(encoding="utf-8")


class PlantEquipmentFullDepartmentContractTests(unittest.TestCase):
    """Protect the full Plant & Equipment department upgrade."""

    def test_migration_hardens_asset_register_and_status_board(self):
        for marker in [
            "asset_category",
            "asset_type",
            "serial_number",
            "chassis_number",
            "supplier_name",
            "current_book_value",
            "useful_life_months",
            "insurance_expiry_date",
            "licence_expiry_date",
            "warranty_expiry_date",
            "photo_urls JSONB",
            "qr_code_value",
            "barcode_value",
            "disposal_status",
            "expected_replacement_date",
            "mobilisation_pending",
            "idle_on_site",
            "awaiting_parts",
            "quarantined",
            "hired_out",
            "disposed",
        ]:
            self.assertIn(marker, MIGRATION)
        self.assertIn("fleet.operator_profiles", MIGRATION)
        self.assertIn("fleet.external_hire_agreements", MIGRATION)
        self.assertEqual(MIGRATION, SUPABASE_MIGRATION)

    def test_migration_adds_operator_hire_maintenance_and_fuel_controls(self):
        for marker in [
            "licence_classes TEXT[]",
            "operator_certificates JSONB",
            "medical_clearance_expiry",
            "incident_count",
            "performance_score",
            "hire_agreement_number",
            "hire_type",
            "fuel_responsibility",
            "debtor_follow_up_status",
            "return_to_service_certified_by",
            "testing_notes",
            "parts_request_reference",
            "litres_per_hour",
            "duplicate_slip_hash",
            "tank_balance_after",
        ]:
            self.assertIn(marker, MIGRATION)

    def test_backend_exposes_full_operating_department_workflows(self):
        for marker in [
            "class OperatorProfilePayload",
            "class ExternalHireAgreementPayload",
            '@router.get("/operator-profiles")',
            '@router.post("/operator-profiles"',
            '@router.get("/external-hire-agreements")',
            '@router.post("/external-hire-agreements"',
            "litres_per_hour",
            "actual_consumption_litres",
            "locked_asset",
            "supervisor_approval_required",
            "CASE WHEN :severity='catastrophic' THEN 'breakdown' ELSE 'quarantined' END",
            '"mobilisation_pending"',
            '"awaiting_parts"',
            '"hired_out"',
            '"quarantined"',
        ]:
            self.assertIn(marker, FLEET_ROUTER)

    def test_frontend_api_and_fleet_page_surface_operator_and_hire_modules(self):
        for marker in [
            "getFleetOperatorProfiles",
            "createFleetOperatorProfile",
            "getExternalPlantHireAgreements",
            "createExternalPlantHireAgreement",
            "expected_consumption_litres",
            "actual_consumption_litres",
            "storage_tank",
            "tank_balance_after",
        ]:
            self.assertIn(marker, API)
        for marker in [
            "Operator management",
            "External plant hire",
            "Add Operator Profile",
            "New hire",
            "OperatorProfileModal",
            "ExternalHireModal",
            "licence_classes",
            "medical_clearance_expiry",
            "debtor_follow_up_notes",
        ]:
            self.assertIn(marker, FLEET_PAGE)

    def test_equipment_and_asset_register_pages_expose_full_register_controls(self):
        for marker in [
            "ASSET_STATUS_OPTIONS",
            "ASSET_CATEGORY_OPTIONS",
            "Asset Category",
            "Current Book Value",
            "Useful Life",
            "Insurance Expiry",
            "Licence Expiry",
            "Warranty Expiry",
            "QR Code",
            "Barcode Value",
            "Disposal Status",
            "Mobilisation pending",
            "Quarantined",
            "Hired out",
        ]:
            self.assertIn(marker, ASSET_MODALS)
        for marker in [
            "Documents & Expiry Controls",
            "Value, Useful Life & Disposal",
            "Current Book Value",
            "Cost Centre",
            "Actual Fuel Use",
            "Tank Balance",
            "inspection_type",
            "severity",
        ]:
            self.assertIn(marker, EQUIPMENT_PAGE)


if __name__ == "__main__":
    unittest.main()
