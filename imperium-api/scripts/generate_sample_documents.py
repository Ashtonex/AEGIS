import os
import sys

# Ensure parent directory is in python path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.services.quotations.calculator import QuotationCalculator
from app.services.documents.renderers import QuotationPDFRenderer, QuotationExcelExporter

def main():
    payload = {
        "quotation_id": "SNC-QT-2026-009",
        "revision_number": 3,
        "project_title": "Harare Ring Road Earthworks & Bridge Overpass Section 4",
        "client_name": "Ministry of Transport & Infrastructural Development",
        "preliminaries": 12500.00,
        "overhead_rate": 0.08,      # 8%
        "contingency_rate": 0.12,   # 12%
        "profit_rate": 0.18,        # 18%
        "discount": 5000.00,
        "tax_rate": 0.15,            # 15% ZIMRA VAT
        "items": [
            {
                "description": "Bulk excavation in soft rock materials",
                "quantity": 4200.00,
                "unit": "m3",
                "rate": 18.50
            },
            {
                "description": "Reinforced concrete foundations pour (Class 30/20)",
                "quantity": 180.00,
                "unit": "m3",
                "rate": 340.00
            },
            {
                "description": "High-tensile steel reinforcement bars (Y20/Y25)",
                "quantity": 14.50,
                "unit": "ton",
                "rate": 1150.00
            },
            {
                "description": "Standard kerbs and precast concrete edge channels",
                "quantity": 1200.00,
                "unit": "m",
                "rate": 45.00
            }
        ]
    }
    
    print("Calculating quotation totals...")
    calc_result = QuotationCalculator.calculate(payload)
    calc_data = calc_result.dict()
    
    artifact_dir = r"C:\Users\ashjx\.gemini\antigravity-cli\brain\46010bd6-ebef-48e7-8b63-c07a7186f4b2"
    pdf_path = os.path.join(artifact_dir, "sample_quotation.pdf")
    excel_path = os.path.join(artifact_dir, "sample_quotation.xlsx")
    
    print(f"Rendering PDF to: {pdf_path}")
    pdf_success = QuotationPDFRenderer().render_pdf(calc_data, pdf_path)
    print(f"PDF Render success: {pdf_success}")
    
    print(f"Exporting Excel to: {excel_path}")
    excel_success = QuotationExcelExporter().export_to_excel(calc_data, excel_path)
    print(f"Excel Export success: {excel_success}")
    
    print("Sample generation complete!")

if __name__ == "__main__":
    main()
