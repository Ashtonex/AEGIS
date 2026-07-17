import os
import unittest
from decimal import Decimal
from app.services.quotations.calculator import QuotationCalculator
from app.services.quotations.boq_importer import BOQImporter
from app.services.documents.renderers import (
    QuotationPDFRenderer,
    QuotationExcelExporter,
)
from core.config import settings


class StandardizedStackCalculationsTests(unittest.TestCase):
    def test_settings_validation(self):
        """Verifies Pydantic settings parsing and properties."""
        self.assertEqual(settings.ENVIRONMENT, "development")
        self.assertIn("http://localhost:3000", settings.cors_origins)

    def test_quotation_baseline_calculation(self):
        """Tests standard cost buildup: Direct + Prelims + Overheads + Contingency + Profit + VAT."""
        payload = {
            "items": [
                {
                    "description": "Concrete Footings Pour",
                    "quantity": 10,
                    "unit": "m3",
                    "rate": 150,
                },
                {
                    "description": "Steel Rebar installation",
                    "quantity": 2,
                    "unit": "ton",
                    "rate": 800,
                },
            ],
            "preliminaries": 500,
            "overhead_rate": 0.05,  # 5%
            "contingency_rate": 0.10,  # 10%
            "profit_rate": 0.15,  # 15%
            "discount": 100,
            "tax_rate": 0.15,  # 15% VAT
        }

        result = QuotationCalculator.calculate(payload)

        # Direct: (10*150) + (2*800) = 1500 + 1600 = 3100
        self.assertEqual(result.direct_costs, Decimal("3100.00"))
        self.assertEqual(result.preliminaries, Decimal("500.00"))

        # Base markups: 3100 + 500 = 3600
        # Overheads: 3600 * 0.05 = 180
        # Contingency: 3600 * 0.10 = 360
        # Profit: 3600 * 0.15 = 540
        self.assertEqual(result.overhead_amount, Decimal("180.00"))
        self.assertEqual(result.contingency_amount, Decimal("360.00"))
        self.assertEqual(result.profit_amount, Decimal("540.00"))

        # Subtotal: 3600 + 180 + 360 + 540 = 4680
        self.assertEqual(result.subtotal, Decimal("4680.00"))

        # Taxable: 4680 - 100 = 4580
        self.assertEqual(result.taxable_amount, Decimal("4580.00"))

        # Tax: 4580 * 0.15 = 687
        self.assertEqual(result.tax_amount, Decimal("687.00"))

        # Grand: 4580 + 687 = 5267
        self.assertEqual(result.grand_total, Decimal("5267.00"))

    def test_quotation_calculations_with_negatives_and_empty(self):
        """Ensures calculator sanitizes invalid negative rates, negative quantities, and empty values."""
        payload = {
            "items": [
                {
                    "description": "Concrete Footings Pour",
                    "quantity": -10,
                    "unit": "m3",
                    "rate": 150,
                },
                {
                    "description": "Steel Rebar",
                    "quantity": 5,
                    "unit": "ton",
                    "rate": -800,
                },
            ],
            "preliminaries": -500,
            "overhead_rate": -0.05,
            "contingency_rate": 0.10,
            "profit_rate": 0.15,
            "discount": 5000,  # Discount greater than subtotal
            "tax_rate": 0.15,
        }

        result = QuotationCalculator.calculate(payload)

        # Negative quantities and rates must be forced to zero
        self.assertEqual(result.direct_costs, Decimal("0.00"))
        self.assertEqual(result.preliminaries, Decimal("0.00"))

        # Subtotal must be 0
        self.assertEqual(result.subtotal, Decimal("0.00"))

        # Taxable amount cannot go below 0 even with large discount
        self.assertEqual(result.taxable_amount, Decimal("0.00"))
        self.assertEqual(result.grand_total, Decimal("0.00"))

    def test_document_rendering_fallbacks(self):
        """Verifies PDF and Excel export execution using local test files."""
        payload = {
            "project_title": "SNC Test Expansion",
            "reference_number": "TEST-QT-99",
            "client_name": "Test Client Inc",
            "direct_costs": Decimal("3000.00"),
            "preliminaries": Decimal("500.00"),
            "overhead_amount": Decimal("150.00"),
            "contingency_amount": Decimal("300.00"),
            "profit_amount": Decimal("450.00"),
            "tax_amount": Decimal("660.00"),
            "grand_total": Decimal("5060.00"),
            "items": [
                {
                    "description": "Excavation Work",
                    "quantity": 100,
                    "unit": "m3",
                    "rate": 30,
                }
            ],
        }

        pdf_path = "test_quotation.pdf"
        excel_path = "test_quotation.xlsx"

        # Clean up existing files
        for p in (pdf_path, excel_path):
            if os.path.exists(p):
                os.remove(p)

        pdf_success = QuotationPDFRenderer().render_pdf(payload, pdf_path)
        excel_success = QuotationExcelExporter().export_to_excel(payload, excel_path)

        self.assertTrue(pdf_success)
        self.assertTrue(excel_success)
        self.assertTrue(os.path.exists(pdf_path))
        self.assertTrue(os.path.exists(excel_path))

        # Clean up files
        for p in (pdf_path, excel_path):
            if os.path.exists(p):
                os.remove(p)

    def test_boq_importer_csv(self):
        """Tests parsing a CSV string containing BOQ items with non-standard column headers."""
        csv_data = (
            "Item Description,Qty,Unit,Unit Price\n"
            "Bulk Earthworks,120.5,m3,15.50\n"
            "Trench Excavation,45.0,m3,22.00\n"
        ).encode("utf-8")

        res = BOQImporter.import_boq(csv_data, ".csv")
        self.assertTrue(res.summary["valid_items_imported"] == 2)
        self.assertEqual(res.items[0].description, "Bulk Earthworks")
        self.assertEqual(res.items[0].quantity, Decimal("120.5"))
        self.assertEqual(res.items[0].rate, Decimal("15.50"))

        # Total cost: (120.5 * 15.50) + (45 * 22.00) = 1867.75 + 990 = 2857.75
        self.assertEqual(res.summary["total_direct_costs"], "2857.75")

    def test_boq_importer_excel(self):
        """Tests parsing a basic Excel file using pandas/openpyxl integration."""
        import pandas as pd
        from io import BytesIO

        # Create a simple dataframe and write to in-memory excel
        df = pd.DataFrame(
            {
                "task": ["Brickwork", "Plastering"],
                "volume": [50.0, 150.0],
                "unit": ["m2", "m2"],
                "cost": [12.00, 8.50],
            }
        )

        excel_buffer = BytesIO()
        df.to_excel(excel_buffer, index=False, engine="openpyxl")
        excel_data = excel_buffer.getvalue()

        res = BOQImporter.import_boq(excel_data, ".xlsx")
        self.assertEqual(res.summary["valid_items_imported"], 2)
        self.assertEqual(res.items[0].description, "Brickwork")
        self.assertEqual(res.items[0].quantity, Decimal("50.0"))
        self.assertEqual(res.items[0].rate, Decimal("12.00"))
        self.assertEqual(res.summary["total_direct_costs"], "1875.00")


if __name__ == "__main__":
    unittest.main()
