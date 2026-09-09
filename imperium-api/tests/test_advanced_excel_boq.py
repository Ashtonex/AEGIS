import os
import unittest
from io import BytesIO
from decimal import Decimal
from openpyxl import Workbook
from app.services.quotations.boq_importer import BOQImporter
from app.services.documents.renderers import QuotationExcelExporter, QuotationPDFRenderer


class AdvancedExcelBOQTests(unittest.TestCase):
    def test_excel_formula_cells_cached_values(self):
        """Verifies that formulas are properly evaluated or parsed without zeroing out."""
        wb = Workbook()
        ws = wb.active
        ws.title = "Earthworks"
        ws.append(["Item No", "Description", "Unit", "Quantity", "Rate", "Amount"])
        # Add items with formulas
        ws.append(["1.1", "Site Excavation", "m3", 100, 25.50, "=D2*E2"])
        ws.append(["1.2", "Disposal of excavated material", "m3", 50, 12.00, "=D3*E3"])
        buffer = BytesIO()
        wb.save(buffer)

        result = BOQImporter.import_boq(buffer.getvalue(), ".xlsx")
        self.assertEqual(len(result.items), 2)
        self.assertEqual(result.items[0].description, "Site Excavation")
        self.assertEqual(result.items[0].quantity, Decimal("100"))
        self.assertEqual(result.items[0].rate, Decimal("25.50"))
        self.assertEqual(result.items[1].quantity, Decimal("50"))
        self.assertEqual(result.items[1].rate, Decimal("12.00"))

    def test_multi_sheet_skips_cover_and_extracts_sections(self):
        """Verifies that non-bill sheets (Cover, Notes) are skipped and bill sheets become sections."""
        wb = Workbook()
        # Sheet 1: Cover Page
        ws_cover = wb.active
        ws_cover.title = "Cover Page"
        ws_cover.append(["SIX NINE CONSTRUCTION"])
        ws_cover.append(["Project: Warehouse Expansion"])
        ws_cover.append(["Client: ABC Logistics"])
        ws_cover.append(["Date: 2026-09-08"])

        # Sheet 2: Substructure
        ws_sub = wb.create_sheet(title="Substructure")
        ws_sub.append(["No", "Work Description", "UOM", "Qty", "Unit Price"])
        ws_sub.append(["1", "Trench excavation in earth", "m3", 120, 18.00])
        ws_sub.append(["2", "Mass concrete in footings", "m3", 40, 150.00])

        # Sheet 3: Superstructure
        ws_super = wb.create_sheet(title="Superstructure")
        ws_super.append(["No", "Work Description", "UOM", "Qty", "Unit Price"])
        ws_super.append(["1", "Common brickwork in foundation walls", "m2", 250, 32.50])

        # Sheet 4: Notes
        ws_notes = wb.create_sheet(title="Notes & Conditions")
        ws_notes.append(["1. All rates exclude VAT."])
        ws_notes.append(["2. Valid for 30 days."])

        buffer = BytesIO()
        wb.save(buffer)

        result = BOQImporter.import_boq(buffer.getvalue(), ".xlsx")
        self.assertEqual(len(result.items), 3)
        self.assertEqual(result.items[0].section, "Substructure")
        self.assertEqual(result.items[1].section, "Substructure")
        self.assertEqual(result.items[2].section, "Superstructure")

    def test_international_currency_and_accounting_formats(self):
        """Verifies parsing of currency symbols (R, $, £, USD), space separators, and accounting parens."""
        csv_data = (
            "Item No,Description,Unit,Quantity,Rate\n"
            "1,Excavation in trenches,m3,150,\"R 1 250,50\"\n"
            "2,Rebar reinforcement,kg,500,\"$ 45.00\"\n"
            "3,Structural steel beam,item,10,\"(150.00)\"\n"
            "4,Cement bags supply,bags,100,\"USD 12.50\"\n"
        ).encode("utf-8")

        result = BOQImporter.import_boq(csv_data, ".csv")
        self.assertEqual(len(result.items), 4)
        self.assertEqual(result.items[0].rate, Decimal("1250.50"))
        self.assertEqual(result.items[1].rate, Decimal("45.00"))
        # Accounting negative clamped to 0 with warning
        self.assertEqual(result.items[2].rate, Decimal("0"))
        self.assertTrue(any("negative rate" in w.lower() for w in result.warnings))
        self.assertEqual(result.items[3].rate, Decimal("12.50"))

    def test_amount_column_and_lump_sum_derivation(self):
        """Verifies derivation of rate from Amount / Qty, and lump-sum items."""
        wb = Workbook()
        ws = wb.active
        ws.title = "Electrical"
        ws.append(["Item No", "Description", "Unit", "Quantity", "Rate", "Amount"])
        # Row with Amount and Qty, but missing Rate -> Rate should be 5000 / 50 = 100
        ws.append(["1", "Conduit piping", "m", 50, None, 5000])
        # Lump sum item with Amount only
        ws.append(["2", "Distribution board testing & commissioning", None, None, None, 1200])
        buffer = BytesIO()
        wb.save(buffer)

        result = BOQImporter.import_boq(buffer.getvalue(), ".xlsx")
        self.assertEqual(len(result.items), 2)
        self.assertEqual(result.items[0].quantity, Decimal("50"))
        self.assertEqual(result.items[0].rate, Decimal("100.00"))
        self.assertEqual(result.items[1].quantity, Decimal("1"))
        self.assertEqual(result.items[1].unit, "sum")
        self.assertEqual(result.items[1].rate, Decimal("1200"))

    def test_description_continuation_and_subtotal_exclusion(self):
        """Verifies multi-line description stitching and filtering out subtotal rows."""
        wb = Workbook()
        ws = wb.active
        ws.title = "Masonry"
        ws.append(["Item", "Description", "Unit", "Qty", "Rate"])
        ws.append(["1", "Substructure brickwork in cement mortar", "m2", 100, 45.00])
        ws.append([None, "including pointing and raking out joints", None, None, None])
        ws.append([None, "Total Carried Forward", None, None, 4500.00])
        ws.append(["2", "Damp proof membrane 250 micron", "m2", 100, 5.50])
        buffer = BytesIO()
        wb.save(buffer)

        result = BOQImporter.import_boq(buffer.getvalue(), ".xlsx")
        self.assertEqual(len(result.items), 2)
        self.assertIn("including pointing and raking out joints", result.items[0].description)
        self.assertEqual(result.items[1].description, "Damp proof membrane 250 micron")

    def test_export_excel_and_pdf_with_sections(self):
        """Verifies that QuotationExcelExporter and QuotationPDFRenderer handle multi-section data."""
        payload = {
            "quotation_id": "SNC-BOQ-TEST-001",
            "revision_number": 1,
            "project_title": "Harare Commercial Complex",
            "client_name": "Mega Investments",
            "direct_costs": Decimal("25000.00"),
            "preliminaries": Decimal("3000.00"),
            "overhead_amount": Decimal("1500.00"),
            "contingency_amount": Decimal("2500.00"),
            "profit_amount": Decimal("4000.00"),
            "tax_amount": Decimal("5580.00"),
            "grand_total": Decimal("41580.00"),
            "items": [
                {
                    "section": "Substructure",
                    "item_no": "1.1",
                    "description": "Bulk earthworks excavation",
                    "quantity": 200,
                    "unit": "m3",
                    "rate": 25.00,
                },
                {
                    "section": "Substructure",
                    "item_no": "1.2",
                    "description": "Strip footing reinforced concrete",
                    "quantity": 50,
                    "unit": "m3",
                    "rate": 180.00,
                },
                {
                    "section": "Superstructure",
                    "item_no": "2.1",
                    "description": "Reinforced concrete columns",
                    "quantity": 30,
                    "unit": "m3",
                    "rate": 220.00,
                },
            ],
            "assumptions": ["Soil bearing capacity 150kPa"],
            "exclusions": ["Specialist geotechnical piling"],
            "audit_trail_hash": "a1b2c3d4e5f67890",
        }

        excel_out = "test_multi_section.xlsx"
        pdf_out = "test_multi_section.pdf"

        for p in (excel_out, pdf_out):
            if os.path.exists(p):
                os.remove(p)

        try:
            excel_ok = QuotationExcelExporter().export_to_excel(payload, excel_out)
            pdf_ok = QuotationPDFRenderer().render_pdf(payload, pdf_out)

            self.assertTrue(excel_ok)
            self.assertTrue(pdf_ok)
            self.assertTrue(os.path.exists(excel_out))
            self.assertTrue(os.path.exists(pdf_out))
            self.assertGreater(os.path.getsize(excel_out), 1000)
            self.assertGreater(os.path.getsize(pdf_out), 1000)
        finally:
            for p in (excel_out, pdf_out):
                if os.path.exists(p):
                    os.remove(p)


if __name__ == "__main__":
    unittest.main()
