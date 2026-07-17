import os
import logging
from typing import Dict, Any, List
from app.services.documents.interfaces import (
    DocumentRenderer,
    ExcelExporter,
    TextExtractor,
    PDFMergeService,
)


class QuotationPDFRenderer(DocumentRenderer):
    def render_pdf(self, data: Dict[str, Any], output_path: str) -> bool:
        """
        Generates a professional A4 ReportLab PDF for Six Nine Construction.
        Supports detailed rate breakdowns, provisional sums, assumptions, exclusions,
        revision tracking, and audit trail hash display.
        """
        logging.info(f"Rendering PDF to {output_path}")
        try:
            from reportlab.lib.pagesizes import A4
            from reportlab.platypus import (
                SimpleDocTemplate,
                Paragraph,
                Spacer,
                Table,
                TableStyle,
            )
            from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
            from reportlab.lib import colors

            doc = SimpleDocTemplate(
                output_path,
                pagesize=A4,
                rightMargin=36,
                leftMargin=36,
                topMargin=36,
                bottomMargin=36,
            )
            styles = getSampleStyleSheet()

            # Custom branded styling
            title_style = ParagraphStyle(
                name="BrandedTitle",
                parent=styles["Heading1"],
                textColor=colors.HexColor("#0F172A"),  # Charcoal Slate
                fontSize=20,
                spaceAfter=10,
            )
            section_style = ParagraphStyle(
                name="SectionHeading",
                parent=styles["Heading2"],
                textColor=colors.HexColor("#1E293B"),
                fontSize=12,
                spaceBefore=10,
                spaceAfter=6,
            )
            body_style = ParagraphStyle(
                name="SmallBody",
                parent=styles["Normal"],
                fontSize=8,
                textColor=colors.HexColor("#475569"),
            )

            story = []

            # Branded Header
            story.append(Paragraph("SIX NINE CONSTRUCTION (PVT) LTD", title_style))
            story.append(
                Paragraph(
                    f"<b>PROJECT:</b> {data.get('project_title', 'General Civil Infrastructure')}",
                    styles["Normal"],
                )
            )
            story.append(
                Paragraph(
                    f"<b>QUOTATION ID:</b> {data.get('quotation_id', 'SNC-QT-2026')} | <b>REVISION:</b> {data.get('revision_number', 1)}",
                    styles["Normal"],
                )
            )
            story.append(
                Paragraph(
                    f"<b>CLIENT:</b> {data.get('client_name', 'Corporate Customer')}",
                    styles["Normal"],
                )
            )
            story.append(Spacer(1, 10))

            # BOQ Table Header
            table_data = [
                ["Item Description", "Unit", "Quantity", "Rate ($)", "Total ($)"]
            ]

            # Add BOQ lines
            for item in data.get("items", []):
                qty = float(item.get("quantity", 0))
                rate = float(item.get("rate", 0))
                total = qty * rate
                table_data.append(
                    [
                        item.get("description", "Unspecified task"),
                        item.get("unit", "item"),
                        f"{qty:,.2f}",
                        f"{rate:,.2f}",
                        f"{total:,.2f}",
                    ]
                )

            # Totals build-up
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Direct Costs:",
                    f"${float(data.get('direct_costs', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Preliminaries:",
                    f"${float(data.get('preliminaries', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Overheads:",
                    f"${float(data.get('overhead_amount', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Contingency:",
                    f"${float(data.get('contingency_amount', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Profit Margin:",
                    f"${float(data.get('profit_amount', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Provisional Sums:",
                    f"${float(data.get('provisional_sums', 0)):,.2f}",
                ]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "Discounts:",
                    f"-${float(data.get('discount_amount', 0)):,.2f}",
                ]
            )
            table_data.append(
                ["", "", "", "ZIMRA VAT:", f"${float(data.get('tax_amount', 0)):,.2f}"]
            )
            table_data.append(
                [
                    "",
                    "",
                    "",
                    "GRAND TOTAL:",
                    f"${float(data.get('grand_total', 0)):,.2f}",
                ]
            )

            boq_table = Table(table_data, colWidths=[200, 50, 70, 100, 100])
            boq_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
                        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
                        ("ALIGN", (2, 0), (-1, -1), "RIGHT"),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
                        ("GRID", (0, 0), (-1, -10), 0.5, colors.HexColor("#CBD5E1")),
                        ("FONTNAME", (3, -9), (-1, -1), "Helvetica-Bold"),
                        ("LINEABOVE", (3, -9), (-1, -1), 1, colors.HexColor("#0F172A")),
                    ]
                )
            )
            story.append(boq_table)
            story.append(Spacer(1, 10))

            # Assumptions & Exclusions
            assumptions = data.get("assumptions", [])
            exclusions = data.get("exclusions", [])

            if assumptions:
                story.append(Paragraph("<b>Assumptions</b>", section_style))
                for item in assumptions:
                    story.append(Paragraph(f"• {item}", body_style))
                story.append(Spacer(1, 5))

            if exclusions:
                story.append(Paragraph("<b>Exclusions</b>", section_style))
                for item in exclusions:
                    story.append(Paragraph(f"• {item}", body_style))
                story.append(Spacer(1, 5))

            # Audit Trail Signature
            audit_hash = data.get("audit_trail_hash", "N/A")
            story.append(
                Paragraph(
                    "<b>Audit Trail & Pricing Integrity Signature</b>", section_style
                )
            )
            story.append(Paragraph(f"Secure Checksum: {audit_hash}", body_style))

            doc.build(story)
            return True

        except ImportError:
            # Fallback
            logging.warning(
                "ReportLab not installed. Writing fallback text representation."
            )
            with open(output_path, "w", encoding="utf-8") as f:
                f.write("--- SIX NINE CONSTRUCTION QUOTATION ---\n")
                f.write(f"Quotation ID: {data.get('quotation_id')}\n")
                f.write(f"Revision: {data.get('revision_number')}\n")
                f.write(f"Project: {data.get('project_title')}\n")
                f.write(f"Client: {data.get('client_name')}\n")
                f.write(f"Grand Total: ${data.get('grand_total')}\n")
                f.write(f"Audit Trail Hash: {data.get('audit_trail_hash')}\n")
            return True


class QuotationExcelExporter(ExcelExporter):
    def export_to_excel(self, data: Dict[str, Any], output_path: str) -> bool:
        """
        Generates a richly formatted Excel worksheet.
        Falls back to CSV format if xlsxwriter/openpyxl are not present.
        """
        logging.info(f"Exporting Excel to {output_path}")
        try:
            import xlsxwriter

            workbook = xlsxwriter.Workbook(output_path)
            worksheet = workbook.add_worksheet("Quotation BOQ")

            # Branded Header Formats
            header_format = workbook.add_format(
                {
                    "bold": True,
                    "font_color": "white",
                    "bg_color": "#0F172A",
                    "border": 1,
                }
            )
            currency_format = workbook.add_format({"num_format": "$#,##0.00"})
            bold_format = workbook.add_format({"bold": True})

            # Title block
            worksheet.write(0, 0, "SIX NINE CONSTRUCTION (PVT) LTD", bold_format)
            worksheet.write(1, 0, f"Client: {data.get('client_name')}")
            worksheet.write(2, 0, f"Project: {data.get('project_title')}")
            worksheet.write(
                3,
                0,
                f"Quotation ID: {data.get('quotation_id')} | Revision: {data.get('revision_number', 1)}",
            )

            # Headers
            headers = ["Description", "Unit", "Quantity", "Rate", "Total"]
            for col, header in enumerate(headers):
                worksheet.write(5, col, header, header_format)

            # Write rows
            row = 6
            for item in data.get("items", []):
                qty = float(item.get("quantity", 0))
                rate = float(item.get("rate", 0))
                worksheet.write(row, 0, item.get("description", ""))
                worksheet.write(row, 1, item.get("unit", "m"))
                worksheet.write(row, 2, qty)
                worksheet.write(row, 3, rate, currency_format)
                # Excel formula for line item total
                worksheet.write_formula(
                    row, 4, f"=C{row + 1}*D{row + 1}", currency_format
                )
                row += 1

            # Totals Block
            worksheet.write(row, 3, "Direct Costs:", bold_format)
            worksheet.write(row, 4, float(data.get("direct_costs", 0)), currency_format)
            row += 1
            worksheet.write(row, 3, "Preliminaries:", bold_format)
            worksheet.write(
                row, 4, float(data.get("preliminaries", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Overheads:", bold_format)
            worksheet.write(
                row, 4, float(data.get("overhead_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Contingency:", bold_format)
            worksheet.write(
                row, 4, float(data.get("contingency_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Profit Margin:", bold_format)
            worksheet.write(
                row, 4, float(data.get("profit_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Provisional Sums:", bold_format)
            worksheet.write(
                row, 4, float(data.get("provisional_sums", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "Discounts:", bold_format)
            worksheet.write(
                row, 4, float(data.get("discount_amount", 0)), currency_format
            )
            row += 1
            worksheet.write(row, 3, "ZIMRA VAT:", bold_format)
            worksheet.write(row, 4, float(data.get("tax_amount", 0)), currency_format)
            row += 1
            worksheet.write(row, 3, "GRAND TOTAL:", bold_format)
            worksheet.write(row, 4, float(data.get("grand_total", 0)), currency_format)

            # Write assumptions & exclusions below the totals block
            row += 2
            assumptions = data.get("assumptions", [])
            exclusions = data.get("exclusions", [])

            if assumptions:
                worksheet.write(row, 0, "Assumptions:", bold_format)
                row += 1
                for item in assumptions:
                    worksheet.write(row, 0, f"- {item}")
                    row += 1
                row += 1

            if exclusions:
                worksheet.write(row, 0, "Exclusions:", bold_format)
                row += 1
                for item in exclusions:
                    worksheet.write(row, 0, f"- {item}")
                    row += 1
                row += 1

            # Audit Signature
            worksheet.write(
                row, 0, "Audit Trail Hash (Pricing Integrity Key):", bold_format
            )
            worksheet.write(row, 1, data.get("audit_trail_hash", "N/A"))

            workbook.close()
            return True

        except ImportError:
            # Fallback CSV format
            logging.warning("xlsxwriter not installed. Exporting fallback CSV.")
            import csv

            with open(output_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(["SIX NINE CONSTRUCTION (PVT) LTD"])
                writer.writerow(["Client", data.get("client_name")])
                writer.writerow(["Project", data.get("project_title")])
                writer.writerow(
                    [
                        "Quotation ID",
                        data.get("quotation_id"),
                        "Revision",
                        data.get("revision_number", 1),
                    ]
                )
                writer.writerow([])
                writer.writerow(["Description", "Unit", "Quantity", "Rate", "Total"])
                for item in data.get("items", []):
                    qty = float(item.get("quantity", 0))
                    rate = float(item.get("rate", 0))
                    writer.writerow(
                        [
                            item.get("description"),
                            item.get("unit"),
                            qty,
                            rate,
                            qty * rate,
                        ]
                    )
                writer.writerow(["Direct Costs", "", "", "", data.get("direct_costs")])
                writer.writerow(["Grand Total", "", "", "", data.get("grand_total")])
                writer.writerow(["Audit Trail Hash", data.get("audit_trail_hash")])
            return True


class PyMuPDFTextExtractor(TextExtractor):
    def extract_text(self, file_path: str) -> str:
        """Extracts text using PyMuPDF (fitz) or returns fallback file metadata."""
        logging.info(f"Extracting text from {file_path}")
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(file_path)
            text = ""
            for page in doc:
                text += page.get_text()
            return text
        except ImportError:
            logging.warning(
                "PyMuPDF (fitz) not available. Returning file path metadata fallback."
            )
            return f"Metadata Fallback: Document located at {file_path}"


class PyMuPDFMergeService(PDFMergeService):
    def merge_pdfs(self, pdf_paths: List[str], output_path: str) -> bool:
        """Merges multiple PDFs using PyMuPDF."""
        logging.info(f"Merging PDFs: {pdf_paths} into {output_path}")
        try:
            import fitz

            result = fitz.open()
            for pdf_path in pdf_paths:
                if os.path.exists(pdf_path):
                    with fitz.open(pdf_path) as doc:
                        result.insert_pdf(doc)
            result.save(output_path)
            return True
        except ImportError:
            logging.warning(
                "PyMuPDF not available. Concatenating fallback text representations."
            )
            with open(output_path, "w", encoding="utf-8") as f_out:
                for pdf_path in pdf_paths:
                    if os.path.exists(pdf_path):
                        with open(pdf_path, "r", errors="ignore") as f_in:
                            f_out.write(f_in.read())
                            f_out.write("\n--- PAGE BREAK ---\n")
            return True
