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


if __name__ == "__main__":
    unittest.main()
