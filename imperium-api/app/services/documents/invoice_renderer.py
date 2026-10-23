"""
SNC Official Invoice PDF Renderer
Renders high-fidelity Six Nine Construction invoices matching the corporate standard:
- PROFORMA INVOICE / TAX INVOICE
- SNC Header & Official Corporate Identity
- Two-Column Bill-To & Invoice Metadata
- Amount Due Navy Hero Banner with Figures & Words
- Perfectly Aligned & Numbered Items Table (Excl. VAT, 15.5% VAT, Incl. VAT)
- Banc ABC Southerton Settlement Details
- Commercial Notes & Quantity Surveyor Contact
- SNC Watermark on all pages
"""

import io
import os
import math
from decimal import Decimal
from typing import BinaryIO, Dict, Any, List, Optional, Union
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
    HRFlowable,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.pdfgen import canvas


def number_to_words_usd(amount: float) -> str:
    """Converts a dollar amount to words in English (e.g. 88371.46 -> Eighty-eight thousand, three hundred and seventy-one United States Dollars and forty-six cents)."""
    ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
            "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]

    def _convert_group(n: int) -> str:
        res = []
        if n >= 100:
            res.append(ones[n // 100] + " hundred")
            n %= 100
        if n >= 20:
            ten_part = tens[n // 10]
            unit_part = ones[n % 10]
            res.append(f"{ten_part}-{unit_part}" if unit_part else ten_part)
        elif n > 0:
            res.append(ones[n])
        return " and ".join(res) if len(res) == 2 and "hundred" in res[0] else " ".join(res)

    if amount < 0:
        return "Negative " + number_to_words_usd(-amount)

    cents = int(round((amount - int(amount)) * 100))
    dollars = int(amount)

    if dollars == 0 and cents == 0:
        return "Zero United States Dollars and zero cents"

    groups = []
    names = ["", "thousand", "million", "billion"]
    idx = 0
    while dollars > 0 and idx < len(names):
        chunk = dollars % 1000
        if chunk > 0:
            group_str = _convert_group(chunk)
            if names[idx]:
                group_str += f" {names[idx]}"
            groups.append(group_str)
        dollars //= 1000
        idx += 1

    if not groups:
        dollars_str = "Zero"
    elif len(groups) == 1:
        dollars_str = groups[0].capitalize()
    else:
        dollars_str = ", ".join(reversed(groups)).capitalize()

    cents_str = _convert_group(cents) if cents > 0 else "zero"
    return f"{dollars_str} United States Dollars and {cents_str} cents"


class NumberedCanvas(canvas.Canvas):
    """Two-pass canvas to compute total page numbers, running header, running footer, and watermark."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages: int):
        self.saveState()
        w, h = A4

        # 1. WATERMARK: Faded SNC Logo centered in background
        logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))
        if os.path.exists(logo_path):
            try:
                self.setFillAlpha(0.06)
            except AttributeError:
                pass
            # Draw large 300x300 watermark logo centered on the page
            self.drawImage(logo_path, x=(w - 280) / 2, y=(h - 280) / 2, width=280, height=280, preserveAspectRatio=True, mask="auto")

        # Reset alpha for headers and footers
        try:
            self.setFillAlpha(1.0)
        except AttributeError:
            pass

        # Running header (pages 2+)
        if self._pageNumber > 1:
            self.setFont("Helvetica", 7.5)
            self.setFillColor(colors.HexColor("#64748B"))
            doc_ref = getattr(self, "invoice_ref", "DRAFT")
            client_name = getattr(self, "client_name", "Client")
            project_title = getattr(self, "project_title", "Project")
            header_text = f"Six Nine Construction (Pvt) Ltd · Invoice {doc_ref} · {client_name} · {project_title}    Page {self._pageNumber} of {total_pages}"
            self.drawString(36, h - 28, header_text)
            self.setStrokeColor(colors.HexColor("#CBD5E1"))
            self.setLineWidth(0.5)
            self.line(36, h - 32, w - 36, h - 32)

        # Running footer (all pages)
        self.setFont("Helvetica", 7.5)
        self.setFillColor(colors.HexColor("#64748B"))
        footer_line = "No. 4 Kariba Road, Nyakamete Industrial Area, Mutare · +263 77 100 1750 · info@snc.co.zw · snc.co.zw · VAT reg. 220116087"
        page_str = f"Page {self._pageNumber} of {total_pages}"
        self.drawString(36, 26, footer_line)
        self.drawRightString(w - 36, 26, page_str)
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(36, 36, w - 36, 36)

        self.restoreState()


class SNCInvoicePDFRenderer:
    """Renderer for Six Nine Construction Proforma and Tax Invoices."""

    def render_invoice_pdf(self, data: Dict[str, Any], output_path: Union[str, BinaryIO]) -> bool:
        doc = SimpleDocTemplate(
            output_path,
            pagesize=A4,
            leftMargin=36,
            rightMargin=36,
            topMargin=36,
            bottomMargin=48,
        )

        styles = getSampleStyleSheet()

        # Custom styles matching SNC Typography
        navy_color = colors.HexColor("#0B2B39")
        gold_color = colors.HexColor("#B45309")
        slate_color = colors.HexColor("#475569")
        dark_text = colors.HexColor("#0F172A")

        title_style = ParagraphStyle(
            name="SNCInvTitle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=18,
            leading=22,
            textColor=navy_color,
            alignment=2,  # Right-aligned
        )

        sub_title_style = ParagraphStyle(
            name="SNCInvSubTitle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=navy_color,
            alignment=2,
        )

        date_style = ParagraphStyle(
            name="SNCInvDate",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12,
            textColor=slate_color,
            alignment=2,
        )

        co_name_style = ParagraphStyle(
            name="SNCInvCoName",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=15,
            textColor=navy_color,
        )

        co_tag_style = ParagraphStyle(
            name="SNCInvCoTag",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=gold_color,
        )

        co_details_style = ParagraphStyle(
            name="SNCInvCoDetails",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9.5,
            textColor=slate_color,
        )

        subject_style = ParagraphStyle(
            name="SNCSubjectStyle",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=11,
            leading=14,
            textColor=navy_color,
        )

        meta_label = ParagraphStyle(
            name="SNCMetaLabel",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=navy_color,
        )

        meta_body = ParagraphStyle(
            name="SNCMetaBody",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10.5,
            textColor=dark_text,
        )

        amount_words_style = ParagraphStyle(
            name="SNCAmountWords",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=7.5,
            leading=9.5,
            textColor=colors.HexColor("#E2E8F0"),
            alignment=2,
        )

        table_hdr = ParagraphStyle(
            name="SNCTableHdr",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=colors.white,
        )

        table_hdr_right = ParagraphStyle(
            name="SNCTableHdrRight",
            parent=table_hdr,
            alignment=2,
        )

        table_body = ParagraphStyle(
            name="SNCTableBody",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10.5,
            textColor=dark_text,
        )

        table_body_right = ParagraphStyle(
            name="SNCTableBodyRight",
            parent=table_body,
            alignment=2,
        )

        notes_hdr = ParagraphStyle(
            name="SNCNotesHdr",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=navy_color,
        )

        notes_body = ParagraphStyle(
            name="SNCNotesBody",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=slate_color,
        )

        story = []

        # Extract payload values
        invoice_type = data.get("invoice_type", "PROFORMA INVOICE").upper()
        invoice_number = data.get("invoice_number") or data.get("invoice_reference") or "DRAFT"
        invoice_date_raw = data.get("invoice_date") or datetime.now().strftime("%d %B %Y")
        if isinstance(invoice_date_raw, str) and "-" in invoice_date_raw and len(invoice_date_raw) == 10:
            try:
                invoice_date_raw = datetime.strptime(invoice_date_raw, "%Y-%m-%d").strftime("%d %B %Y")
            except Exception:
                pass

        subject = data.get("subject") or data.get("title") or "Commercial Works & Services Deposit"
        client_name = data.get("client_name") or data.get("customer_name") or "—"
        client_address = data.get("client_address") or "—"
        client_vat = data.get("client_vat") or data.get("vat_number") or "—"
        client_tin = data.get("client_tin") or data.get("tin_number") or "—"

        quotation_ref = data.get("quotation_ref") or data.get("reference_number") or data.get("quotation_id") or "—"
        client_po = data.get("client_po") or "—"
        currency = data.get("currency", "USD")

        # -------------------------------------------------------------------------
        # 1. HEADER SECTION: SNC Logo + Corporate Details (Left) and Title (Right)
        # -------------------------------------------------------------------------
        logo_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))
        logo_flowable = Paragraph("", meta_body)
        if os.path.exists(logo_path):
            from reportlab.platypus import Image as RLImage
            logo_flowable = RLImage(logo_path, width=44, height=44)

        co_info = [
            Paragraph("SIX NINE CONSTRUCTION", co_name_style),
            Paragraph("Building Zimbabwe’s Future", co_tag_style),
            Spacer(1, 2),
            Paragraph("No. 4 Kariba Road, Nyakamete Industrial Area, Mutare, Manicaland, Zimbabwe", co_details_style),
            Paragraph("+263 77 100 1750 · +263 77 100 1577 · 0202 065 845", co_details_style),
            Paragraph("info@snc.co.zw · snc.co.zw · Incorporation 11284/2019", co_details_style),
            Paragraph("VAT reg. 220116087 · TIN 2001309644 · ZIMRA tax clearance ITF263", co_details_style),
        ]

        title_info = [
            Paragraph(invoice_type, title_style),
            Spacer(1, 3),
            Paragraph(f"No. {invoice_number}", sub_title_style),
            Paragraph(str(invoice_date_raw), date_style),
        ]

        hdr_table = Table(
            [
                [logo_flowable, co_info, title_info]
            ],
            colWidths=[50, 290, 183],
        )
        hdr_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        story.append(hdr_table)
        story.append(Spacer(1, 10))

        # Thin Teal Accent Line
        story.append(HRFlowable(width="100%", thickness=1.5, color=colors.HexColor("#0B2B39"), spaceBefore=2, spaceAfter=8))

        # -------------------------------------------------------------------------
        # 2. SUBJECT LINE
        # -------------------------------------------------------------------------
        story.append(Paragraph(subject, subject_style))
        story.append(Spacer(1, 8))

        # -------------------------------------------------------------------------
        # 3. TWO-COLUMN METADATA (BILL TO & INVOICE DETAILS)
        # -------------------------------------------------------------------------
        bill_to_content = [
            Paragraph("BILL TO", meta_label),
            Spacer(1, 2),
            Paragraph(f"<b>{client_name}</b>", meta_body),
            Paragraph(client_address.replace("\n", "<br/>"), meta_body),
            Paragraph(f"VAT No. {client_vat} · TIN {client_tin}", meta_body),
        ]

        details_content = [
            Paragraph("INVOICE DETAILS", meta_label),
            Spacer(1, 2),
            Paragraph(f"Proforma invoice: <b>{invoice_number}</b>", meta_body),
            Paragraph(f"Date: <b>{invoice_date_raw}</b>", meta_body),
            Paragraph(f"Quotation: <b>{quotation_ref}</b>", meta_body),
            Paragraph(f"Client PO: <b>{client_po}</b> · Currency: <b>{currency}</b>", meta_body),
        ]

        meta_table = Table(
            [
                [bill_to_content, details_content]
            ],
            colWidths=[270, 253],
        )
        meta_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ]))
        story.append(meta_table)
        story.append(Spacer(1, 10))

        # -------------------------------------------------------------------------
        # 4. LINE ITEMS CALCULATION & NUMBERING
        # -------------------------------------------------------------------------
        raw_items = data.get("items") or []
        if not raw_items:
            # Fallback single line item if none provided
            subtotal_raw = data.get("subtotal") or data.get("amount") or data.get("gross_amount")
            if subtotal_raw is None:
                raise ValueError("invoice requires line items or a subtotal amount")
            subtotal_excl = float(subtotal_raw)
            raw_items = [
                {
                    "item_no": "1",
                    "description": data.get("description") or f"Commercial Deposit — {subject}",
                    "amount_excl_vat": subtotal_excl,
                }
            ]

        vat_rate = float(data.get("vat_rate", 0.155))
        deposit_pct = float(data.get("deposit_percentage", 0))  # e.g. 40 for 40%

        processed_items = []
        tot_excl = 0.0
        tot_vat = 0.0
        tot_incl = 0.0

        for idx, it in enumerate(raw_items, start=1):
            desc = it.get("description") or it.get("name") or f"Item {idx}"
            # Excl amount
            amt_excl = float(it.get("amount_excl_vat") or it.get("amount") or it.get("total") or 0.0)
            # If rate and quantity provided
            if amt_excl == 0.0 and it.get("rate") and it.get("quantity"):
                amt_excl = float(it.get("rate")) * float(it.get("quantity"))

            # If this is a deposit invoice and items are full sums, apply deposit_pct if specified
            if deposit_pct > 0 and not it.get("already_pro_rated"):
                item_desc_display = f"{desc} (Deposit of {int(deposit_pct) if deposit_pct.is_integer() else deposit_pct}% on lump sum)"
                item_excl = round(amt_excl * (deposit_pct / 100.0), 2)
            else:
                item_desc_display = desc
                item_excl = round(amt_excl, 2)

            item_vat = round(item_excl * vat_rate, 2) if data.get("apply_vat", True) else 0.0
            item_incl = round(item_excl + item_vat, 2)

            tot_excl += item_excl
            tot_vat += item_vat
            tot_incl += item_incl

            processed_items.append({
                "num": str(it.get("item_no") or idx),
                "desc": item_desc_display,
                "excl": item_excl,
                "vat": item_vat,
                "incl": item_incl,
            })

        # Totals
        total_due = float(data.get("grand_total") or data.get("total_due") or tot_incl)
        if abs(total_due - tot_incl) > 0.05 and not data.get("items"):
            tot_incl = total_due
            tot_excl = round(tot_incl / (1.0 + vat_rate), 2)
            tot_vat = round(tot_incl - tot_excl, 2)

        # -------------------------------------------------------------------------
        # 5. AMOUNT DUE HERO BANNER
        # -------------------------------------------------------------------------
        vat_label = f"incl. VAT at {vat_rate * 100:.1f}%" if data.get("apply_vat", True) else "VAT zero-rated"
        deposit_note = f"{int(deposit_pct)}% deposit, {vat_label}" if deposit_pct > 0 else f"Total payable, {vat_label}"

        banner_left = [
            Paragraph("<b>AMOUNT DUE</b>", ParagraphStyle(name="BnrHdr", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=13, textColor=colors.white)),
            Spacer(1, 2),
            Paragraph(deposit_note, ParagraphStyle(name="BnrSub", parent=styles["Normal"], fontName="Helvetica", fontSize=8.5, textColor=colors.HexColor("#94A3B8"))),
        ]

        words_formatted = number_to_words_usd(tot_incl)
        banner_right = [
            Paragraph(f"<b>${tot_incl:,.2f}</b>", ParagraphStyle(name="BnrAmt", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=21, textColor=colors.HexColor("#38BDF8"), alignment=2)),
            Spacer(1, 1),
            Paragraph(words_formatted, amount_words_style),
        ]

        banner_table = Table(
            [[banner_left, banner_right]],
            colWidths=[240, 283],
        )
        banner_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), navy_color),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 10),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ("LEFTPADDING", (0, 0), (-1, -1), 12),
            ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ]))
        story.append(banner_table)
        story.append(Spacer(1, 12))

        # -------------------------------------------------------------------------
        # 6. INVOICE ITEMS TABLE
        # -------------------------------------------------------------------------
        story.append(Paragraph("<b>Invoice items</b>", meta_label))
        story.append(Spacer(1, 4))

        vat_header_title = f"VAT<br/>{vat_rate * 100:.1f}%" if data.get("apply_vat", True) else "VAT<br/>0.0%"

        table_rows = [
            [
                Paragraph("<b>Item</b>", table_hdr),
                Paragraph("<b>Description</b>", table_hdr),
                Paragraph("<b>Amount<br/>excl. VAT</b>", table_hdr_right),
                Paragraph(f"<b>{vat_header_title}</b>", table_hdr_right),
                Paragraph("<b>Amount<br/>incl. VAT</b>", table_hdr_right),
            ]
        ]

        def _fmt_money(val: float) -> str:
            if val < 0:
                return f"-${abs(val):,.2f}"
            return f"${val:,.2f}"

        for p_item in processed_items:
            table_rows.append([
                Paragraph(p_item["num"], table_body),
                Paragraph(p_item["desc"], table_body),
                Paragraph(_fmt_money(p_item['excl']), table_body_right),
                Paragraph(_fmt_money(p_item['vat']), table_body_right),
                Paragraph(_fmt_money(p_item['incl']), table_body_right),
            ])

        # Total Row
        table_rows.append([
            "",
            Paragraph(f"<b>Total {'deposit ' if deposit_pct > 0 else ''}due</b>", ParagraphStyle(name="TotLabel", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=9, textColor=navy_color)),
            Paragraph(f"<b>{_fmt_money(tot_excl)}</b>", ParagraphStyle(name="TotVal1", parent=table_body_right, fontName="Helvetica-Bold", fontSize=9, textColor=navy_color)),
            Paragraph(f"<b>{_fmt_money(tot_vat)}</b>", ParagraphStyle(name="TotVal2", parent=table_body_right, fontName="Helvetica-Bold", fontSize=9, textColor=navy_color)),
            Paragraph(f"<b>{_fmt_money(tot_incl)}</b>", ParagraphStyle(name="TotVal3", parent=table_body_right, fontName="Helvetica-Bold", fontSize=9.5, textColor=navy_color)),
        ])

        items_table = Table(
            table_rows,
            colWidths=[36, 247, 80, 75, 85],
        )

        t_style = [
            ("BACKGROUND", (0, 0), (-1, 0), navy_color),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, 0), 6),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
            ("INNERGRID", (0, 0), (-1, -2), 0.5, colors.HexColor("#E2E8F0")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#CBD5E1")),
            # Total row styling
            ("LINEABOVE", (0, -1), (-1, -1), 1.2, navy_color),
            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F8FAFC")),
            ("TOPPADDING", (0, -1), (-1, -1), 6),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 6),
        ]

        # Alternating row background for items
        for r_i in range(1, len(table_rows) - 1):
            if r_i % 2 == 0:
                t_style.append(("BACKGROUND", (0, r_i), (-1, r_i), colors.HexColor("#F8FAFC")))

        items_table.setStyle(TableStyle(t_style))
        story.append(items_table)
        story.append(Spacer(1, 14))

        # -------------------------------------------------------------------------
        # 7. PAYMENT DETAILS (BANC ABC MUTARE / SOUTHERTON ACCOUNT)
        # -------------------------------------------------------------------------
        pay_rows = [
            [
                Paragraph("<b>Payment details</b>", meta_label),
                "",
                "",
                "",
            ],
            [
                Paragraph("Bank", meta_body),
                Paragraph("<b>Banc ABC</b>", meta_body),
                Paragraph("Branch", meta_body),
                Paragraph("<b>117 (Southerton)</b>", meta_body),
            ],
            [
                Paragraph("Account name", meta_body),
                Paragraph("<b>Six Nine Construction (Pvt) Ltd</b>", meta_body),
                Paragraph("Account currency", meta_body),
                Paragraph("<b>USD</b>", meta_body),
            ],
            [
                Paragraph("Account number", meta_body),
                Paragraph("<b>54925046633016</b>", meta_body),
                Paragraph("Payment reference", meta_body),
                Paragraph(f"<b>{invoice_number}</b>", meta_body),
            ],
        ]

        pay_table = Table(
            pay_rows,
            colWidths=[90, 170, 100, 163],
        )
        pay_table.setStyle(TableStyle([
            ("SPAN", (0, 0), (-1, 0)),
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F8FAFC")),
            ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("INNERGRID", (0, 1), (-1, -1), 0.5, colors.HexColor("#E2E8F0")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(KeepTogether(pay_table))
        story.append(Spacer(1, 12))

        # -------------------------------------------------------------------------
        # 8. NOTES & CONTACT (EXACT SNC INVOICE FOOTNOTE)
        # -------------------------------------------------------------------------
        notes_list = data.get("notes") or [
            f"This proforma invoice covers the {int(deposit_pct) if deposit_pct > 0 else 'full'} deposit on the quoted works, as set out in Quotation {quotation_ref}.",
            f"Please quote {invoice_number} as the reference on your payment.",
            "A fiscal tax invoice will be issued on receipt of payment.",
            "Ordering of materials and mobilisation to site begin on receipt of the full deposit.",
        ]

        notes_flow = [
            Paragraph("<b>Notes</b>", notes_hdr),
            Spacer(1, 4),
        ]
        for n_idx, n_text in enumerate(notes_list, start=1):
            notes_flow.append(Paragraph(f"<b>{n_idx}.</b> {n_text}", notes_body))
            notes_flow.append(Spacer(1, 1.5))

        notes_flow.append(Spacer(1, 4))
        qs_name = data.get("qs_name", "Prosper Mlambo")
        qs_title = data.get("qs_title", "Quantity Surveyor")
        qs_phone = data.get("qs_phone", "+263 77 100 1577")
        qs_email = data.get("qs_email", "sales@snc.co.zw")
        notes_flow.append(Paragraph(f"<i>Any query on this invoice may be directed to {qs_name}, {qs_title}, on {qs_phone} or at {qs_email}.</i>", notes_body))

        story.append(KeepTogether(notes_flow))

        # Pass metadata to canvas for running header & footer
        def make_canvas(*args, **kwargs):
            canv = NumberedCanvas(*args, **kwargs)
            canv.invoice_ref = invoice_number
            canv.client_name = client_name
            canv.project_title = subject
            return canv

        doc.build(story, canvasmaker=make_canvas)
        return True


def render_invoice_pdf_bytes(data: Dict[str, Any]) -> bytes:
    """Render an invoice in memory. Raises ValueError/TypeError on bad input."""
    buffer = io.BytesIO()
    SNCInvoicePDFRenderer().render_invoice_pdf(data, buffer)
    return buffer.getvalue()


def invoice_pdf_filename(data: Dict[str, Any], prefix: str = "SNC_Invoice") -> str:
    inv_no = str(data.get("invoice_number") or data.get("invoice_reference") or data.get("quotation_id") or "")
    clean = "".join(c for c in inv_no if c.isalnum() or c in "-_")[:64] or "draft"
    return f"{prefix}_{clean}.pdf"


async def invoice_pdf_response(data: Dict[str, Any], prefix: str = "SNC_Invoice"):
    """Shared HTTP handler body for every ``/invoices/generate-pdf`` route.

    Renders in memory (no shared temp files that concurrent requests could
    clobber) and off the event loop, since ReportLab is CPU-bound.
    """
    from fastapi import HTTPException, status
    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import Response

    items = data.get("items")
    if items is not None and not isinstance(items, list):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invoice items must be a list.")
    filename = invoice_pdf_filename(data, prefix)
    try:
        pdf = await run_in_threadpool(render_invoice_pdf_bytes, data)
    except (TypeError, ValueError, KeyError, AttributeError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"Invalid invoice data: {exc}") from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
