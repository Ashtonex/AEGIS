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

    def test_multi_tab_workbook_differentiation_prevents_inflation(self):
        """Verifies that a multi-tab workbook with a Summary roll-up sheet, rate analysis, and detail sheets
        excludes the summary and rate analysis so direct costs are not double-counted or inflated."""
        wb = Workbook()

        # Sheet 1: General Summary (Rolls up totals from other sheets)
        ws_sum = wb.active
        ws_sum.title = "General Summary"
        ws_sum.append(["Item No", "Description", "Amount"])
        ws_sum.append(["1", "Bill No. 1: Earthworks", 15000.00])
        ws_sum.append(["2", "Bill No. 2: Concrete Works", 35000.00])
        ws_sum.append([None, "Total Carried to Final Summary", 50000.00])

        # Sheet 2: Earthworks (Actual bill items totaling 15000)
        ws_earth = wb.create_sheet(title="Earthworks")
        ws_earth.append(["Item No", "Description", "Unit", "Quantity", "Rate", "Amount"])
        ws_earth.append(["1.1", "Clear site of shrubs and trees", "m2", 1000, 5.00, 5000.00])
        ws_earth.append(["1.2", "Excavate topsoil and stockpile", "m3", 500, 20.00, 10000.00])
        ws_earth.append([None, "Total Carried Forward", None, None, None, 15000.00])

        # Sheet 3: Concrete Works (Actual bill items totaling 35000)
        ws_conc = wb.create_sheet(title="Concrete Works")
        ws_conc.append(["Item No", "Description", "Unit", "Quantity", "Rate", "Amount"])
        ws_conc.append(["2.1", "Mass concrete in column bases C25", "m3", 100, 250.00, 25000.00])
        ws_conc.append(["2.2", "Formwork to sides of bases", "m2", 200, 50.00, 10000.00])

        # Sheet 4: Rate Analysis (Internal working sheet that should NOT be in the bill)
        ws_rate = wb.create_sheet(title="Rate Analysis")
        ws_rate.append(["Code", "Resource Description", "Unit", "Rate", "Quantity", "Cost"])
        ws_rate.append(["MAT-01", "Cement 42.5N", "bags", 12.50, 400, 5000.00])
        ws_rate.append(["LAB-01", "Artisan mason", "hrs", 8.00, 120, 960.00])

        # Sheet 5: Notes & Conditions (Informational)
        ws_notes = wb.create_sheet(title="Preamble & Notes")
        ws_notes.append(["Standard preambles to trades apply."])

        buffer = BytesIO()
        wb.save(buffer)

        result = BOQImporter.import_boq(buffer.getvalue(), ".xlsx")

        # Must only contain the 4 detailed bill items (2 earthworks + 2 concrete), NOT summary or rate analysis
        self.assertEqual(len(result.items), 4)
        sections = {it.section for it in result.items}
        self.assertEqual(sections, {"Earthworks", "Concrete Works"})

        # Total must be exactly 50,000 (15,000 + 35,000), NOT 100,000 (if summary was included)
        # and NOT 105,960 (if rate analysis was included)
        total = Decimal(result.summary["total_direct_costs"])
        self.assertEqual(total, Decimal("50000.00"))

        # Verify differentiation telemetry
        self.assertTrue(result.summary.get("differentiated_summary_prevented"))
        self.assertEqual(result.summary.get("imported_sheets_count"), 2)

        # Verify sheet manifest
        manifest = result.summary.get("sheet_manifest", [])
        self.assertEqual(len(manifest), 5)
        manifest_map = {m["sheet_name"]: m for m in manifest}
        self.assertEqual(manifest_map["General Summary"]["status"], "excluded_summary")
        self.assertEqual(manifest_map["Earthworks"]["status"], "imported")
        self.assertEqual(manifest_map["Concrete Works"]["status"], "imported")
        self.assertEqual(manifest_map["Rate Analysis"]["status"], "excluded_working")
        self.assertEqual(manifest_map["Preamble & Notes"]["status"], "excluded_informational")


if __name__ == "__main__":
    unittest.main()

