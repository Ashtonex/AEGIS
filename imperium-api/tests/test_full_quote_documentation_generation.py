from decimal import Decimal
import json
from pathlib import Path
import unittest

from app.services.documents.renderers import QuotationExcelExporter, QuotationPDFRenderer
from app.services.quotations.boq_importer import BOQImporter
from app.services.quotations.calculator import QuotationCalculator


OUTPUT_DIR = Path("generated/quotations/full_quote_test")


class FullQuoteDocumentationGenerationTests(unittest.TestCase):
    def test_generate_complete_quotation_documentation_pack(self):
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        boq_csv = (
            "Description,Quantity,Unit,Rate\n"
            "Site establishment and setting out,1,item,2500\n"
            "Bulk earthworks and cart-away,850,m3,12.75\n"
            "Reinforced concrete foundations,120,m3,185.50\n"
            "Structural steel supply and installation,18,ton,1420\n"
            "Roof sheeting and flashings,2200,m2,18.25\n"
            "Electrical first fix and distribution,1,item,18750\n"
            "Plumbing and drainage installation,1,item,14200\n"
        ).encode("utf-8")

        boq_result = BOQImporter.import_boq(boq_csv, ".csv")
        self.assertTrue(boq_result.items)
        self.assertEqual(boq_result.summary["valid_items_imported"], 7)

        payload = {
            "quotation_id": "SNC-FULL-QT-2026-001",
            "revision_number": 2,
            "project_title": "Industrial Warehouse Extension",
            "reference_number": "SNC-FULL-QT-2026-001-R2",
            "client_name": "Full Documentation Test Client",
            "items": [item.model_dump(mode="json") for item in boq_result.items],
            "preliminaries": Decimal("9500.00"),
            "overhead_rate": Decimal("0.075"),
            "contingency_rate": Decimal("0.065"),
            "profit_rate": Decimal("0.12"),
            "discount": Decimal("2500.00"),
            "tax_rate": Decimal("0.15"),
            "provisional_sums": Decimal("15000.00"),
            "assumptions": [
                "Rates assume normal working hours and unobstructed site access.",
                "Client will provide approved IFC drawings before mobilisation.",
                "Quotation excludes statutory authority fees unless listed separately.",
            ],
            "exclusions": [
                "Rock blasting and contaminated soil remediation.",
                "Client-side professional fees and third-party inspections.",
                "Foreign exchange variation after quote validity period.",
            ],
        }

        calculation = QuotationCalculator.calculate(payload)
        self.assertGreater(calculation.grand_total, Decimal("0"))
        self.assertFalse(calculation.breakdown_log["margin_policy_violated"])

        document_payload = dict(payload)
        document_payload.update(calculation.model_dump(mode="json"))

        pdf_path = OUTPUT_DIR / "SNC-FULL-QT-2026-001-R2.pdf"
        excel_path = OUTPUT_DIR / "SNC-FULL-QT-2026-001-R2.xlsx"
        calculation_path = OUTPUT_DIR / "SNC-FULL-QT-2026-001-R2_calculation.json"
        boq_path = OUTPUT_DIR / "SNC-FULL-QT-2026-001-R2_boq_import.json"

        self.assertTrue(QuotationPDFRenderer().render_pdf(document_payload, str(pdf_path)))
        self.assertTrue(QuotationExcelExporter().export_to_excel(document_payload, str(excel_path)))

        calculation_path.write_text(
            json.dumps(calculation.model_dump(mode="json"), indent=2, default=str),
            encoding="utf-8",
        )
        boq_path.write_text(
            json.dumps(boq_result.to_dict(), indent=2, default=str),
            encoding="utf-8",
        )

        self.assertTrue(pdf_path.exists())
        self.assertTrue(excel_path.exists())
        self.assertTrue(calculation_path.exists())
        self.assertTrue(boq_path.exists())
        self.assertGreater(pdf_path.stat().st_size, 1000)
        self.assertGreater(excel_path.stat().st_size, 1000)

        try:
            import fitz

            with fitz.open(pdf_path) as document:
                pdf_text = "\n".join(page.get_text() for page in document)
            self.assertIn("SIX NINE CONSTRUCTION (PVT) LTD", pdf_text)
            self.assertIn("Industrial Warehouse Extension", pdf_text)
        except ImportError:
            self.skipTest("PyMuPDF is not installed in this runtime.")

    def test_quotation_enhancements_workflow_benchmarks(self):
        # Scenario 1: normal quote with sqm benchmarking in-range ($600/m²)
        payload = {
            "quotation_id": "SNC-BENCH-001",
            "revision_number": 1,
            "items": [
                {"description": "Standard finished space", "quantity": 150, "unit": "m2", "rate": 600.00}
            ],
            "built_area_sqm": Decimal("150"),
            "price_validity_days": 45,
            "is_inflation_adjusted": True
        }
        calculation = QuotationCalculator.calculate(payload)
        self.assertEqual(calculation.built_area_sqm, Decimal("150"))
        self.assertEqual(calculation.price_validity_days, 45)
        self.assertTrue(calculation.is_inflation_adjusted)
        
        controls = calculation.breakdown_log["estimation_controls"]
        self.assertEqual(controls["sqm_benchmark_status"], "within_range")
        self.assertEqual(Decimal(controls["finished_price_per_sqm"]), Decimal("600"))

        # Scenario 2: finished price below range ($300/m²)
        payload_below = {
            "quotation_id": "SNC-BENCH-002",
            "revision_number": 1,
            "items": [
                {"description": "Basic shed", "quantity": 100, "unit": "m2", "rate": 300.00}
            ],
            "built_area_sqm": Decimal("100"),
            "is_inflation_adjusted": True
        }
        calc_below = QuotationCalculator.calculate(payload_below)
        self.assertEqual(calc_below.breakdown_log["estimation_controls"]["sqm_benchmark_status"], "below_range")
        self.assertTrue(any("below the standard corporate benchmark" in alert for alert in calc_below.breakdown_log["margin_alerts"]))

        # Scenario 3: finished price above range ($900/m²)
        payload_above = {
            "quotation_id": "SNC-BENCH-003",
            "revision_number": 1,
            "items": [
                {"description": "Luxury finish", "quantity": 100, "unit": "m2", "rate": 900.00}
            ],
            "built_area_sqm": Decimal("100"),
            "is_inflation_adjusted": True
        }
        calc_above = QuotationCalculator.calculate(payload_above)
        self.assertEqual(calc_above.breakdown_log["estimation_controls"]["sqm_benchmark_status"], "above_range")
        self.assertTrue(any("exceeds the standard corporate benchmark" in alert for alert in calc_above.breakdown_log["margin_alerts"]))

        # Scenario 4: not inflation adjusted warning
        payload_not_adjusted = {
            "quotation_id": "SNC-BENCH-004",
            "revision_number": 1,
            "items": [
                {"description": "Standard space", "quantity": 150, "unit": "m2", "rate": 600.00}
            ],
            "built_area_sqm": Decimal("150"),
            "is_inflation_adjusted": False
        }
        calc_not_adjusted = QuotationCalculator.calculate(payload_not_adjusted)
        self.assertTrue(any("historical rates and has not been inflation-adjusted" in alert for alert in calc_not_adjusted.breakdown_log["margin_alerts"]))


if __name__ == "__main__":
    unittest.main()
