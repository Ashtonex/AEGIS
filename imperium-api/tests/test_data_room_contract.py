from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DATA_ROOM_ROUTER = (ROOT / "routers" / "data_room.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
MIGRATION = (
    ROOT.parent / "supabase" / "migrations" / "20260908000000_snc_financial_data_room.sql"
).read_text(encoding="utf-8")


class DataRoomContractTests(unittest.TestCase):
    """Guards for SNC Financial Data Room & Bankability Engine."""

    def test_router_is_registered_under_api_v1_finance_data_room(self):
        self.assertIn(
            'app.include_router(data_room.router, prefix="/api/v1/finance/data-room"',
            MAIN,
        )

    def test_data_room_routes_enforce_dedicated_permissions(self):
        self.assertIn('require_permission("finance.data_room.read")', DATA_ROOM_ROUTER)
        self.assertIn('require_permission("finance.data_room.upload")', DATA_ROOM_ROUTER)
        self.assertIn('require_permission("finance.data_room.verify")', DATA_ROOM_ROUTER)
        self.assertIn('require_permission("finance.data_room.manage")', DATA_ROOM_ROUTER)
        self.assertIn('require_permission("finance.data_room.export")', DATA_ROOM_ROUTER)

    def test_all_18_standard_folders_are_defined(self):
        expected_folders = [
            "01 CORPORATE",
            "02 BANKING",
            "03 SALES & CLIENTS",
            "04 SUPPLIERS",
            "05 PROJECTS",
            "06 PROCUREMENT",
            "07 PAYROLL",
            "08 TAX",
            "09 ASSETS",
            "10 PLANT & EQUIPMENT",
            "11 LOANS & LIABILITIES",
            "12 DIRECTORS",
            "13 QUICKBOOKS",
            "14 CONTRACTS",
            "15 RECONCILIATIONS",
            "16 MANAGEMENT ACCOUNTS",
            "17 AUDIT",
            "18 BANKABILITY",
        ]
        for folder in expected_folders:
            self.assertIn(f'"{folder}"', DATA_ROOM_ROUTER)
            self.assertIn(f"'{folder}'", MIGRATION)

    def test_all_bs_categories_are_defined(self):
        bs_codes = [
            "BS-100",
            "BS-200",
            "BS-300",
            "BS-400",
            "BS-500",
            "BS-600",
            "BS-700",
            "BS-800",
        ]
        for code in bs_codes:
            self.assertIn(code, DATA_ROOM_ROUTER)
            self.assertIn(code, MIGRATION)

    def test_export_engine_generates_manifest_and_index(self):
        self.assertIn("AUDIT_MANIFEST.json", DATA_ROOM_ROUTER)
        self.assertIn("INDEX.html", DATA_ROOM_ROUTER)
        self.assertIn("StreamingResponse(", DATA_ROOM_ROUTER)
        self.assertIn("application/zip", DATA_ROOM_ROUTER)

    def test_auto_classification_logic_is_present(self):
        self.assertIn("auto_classify_document", DATA_ROOM_ROUTER)
        self.assertIn("Receipts & Invoices", DATA_ROOM_ROUTER)
        self.assertIn("Contracts & Agreements", DATA_ROOM_ROUTER)
        self.assertIn("Bank Statements", DATA_ROOM_ROUTER)
