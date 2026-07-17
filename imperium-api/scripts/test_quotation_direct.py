import os
import sys

# Ensure core and app can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.quotations.calculator import QuotationCalculator
from app.services.documents.renderers import QuotationPDFRenderer, QuotationExcelExporter

def test_quotation_engine():
    quotation_payload = {
        "quotation_id": "TEST-QT-999",
        "revision_number": 1,
        "items": [
            {
                "description": "Foundation works",
                "quantity": 1,
                "unit": "ls",
                "rate": 15000.00
            },
            {
                "description": "Brickwork",
                "quantity": 100,
                "unit": "m2",
                "rate": 200.00
            }
        ],
        "profit_rate": 0.15,
        "overhead_rate": 0.10,
        "tax_rate": 0.15,
        "preliminaries": 2000.00
    }

    print("Calculating quotation...")
    calc_result = QuotationCalculator.calculate(quotation_payload)
    print(f"Direct Costs: {calc_result.direct_costs}")
    print(f"Grand Total: {calc_result.grand_total}")
    print(f"Audit Trail Hash: {calc_result.audit_trail_hash}")

    calc_data = dict(quotation_payload)
    calc_data.update(calc_result.model_dump(mode="json"))

    pdf_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "test_arq_output.pdf"))
    excel_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "test_arq_output.xlsx"))

    print(f"Generating PDF at {pdf_path}...")
    pdf_renderer = QuotationPDFRenderer()
    pdf_success = pdf_renderer.render_pdf(calc_data, pdf_path)
    print(f"PDF Success: {pdf_success}")

    print(f"Generating Excel at {excel_path}...")
    excel_exporter = QuotationExcelExporter()
    excel_success = excel_exporter.export_to_excel(calc_data, excel_path)
    print(f"Excel Success: {excel_success}")

if __name__ == "__main__":
    test_quotation_engine()
