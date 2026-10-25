"""
SNC Purchase Order PDF Renderer.

Same corporate identity as the invoice renderer (logo header, centred SNC
watermark, running header/footer, page numbers) via its NumberedCanvas.
Purchase orders that are not yet issued carry a diagonal status stamp so a
draft can never be mistaken for a valid order.
"""

import io
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

from app.services.documents.invoice_renderer import NumberedCanvas, number_to_words_usd

LOGO_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))

NAVY = colors.HexColor("#0B2B39")
GOLD = colors.HexColor("#B45309")
SLATE = colors.HexColor("#475569")
DARK = colors.HexColor("#0F172A")
RULE = colors.HexColor("#CBD5E1")
ZEBRA = colors.HexColor("#F8FAFC")

# Statuses at which the PO is a binding order; anything else is stamped.
OFFICIAL_STATUSES = {"issued", "partially_received", "received", "invoiced", "closed"}
STATUS_STAMPS = {
    "draft": "DRAFT - NOT A VALID ORDER",
    "approved": "APPROVED - NOT YET ISSUED",
    "cancelled": "CANCELLED",
}

DEFAULT_TERMS = [
    "Quote this purchase order number on every delivery note, invoice and statement. Invoices without it cannot be processed.",
    "Deliver to the address above by the required date. Advise Six Nine Construction immediately of any delay.",
    "Goods are received subject to inspection; items that do not match this order or its specification may be rejected.",
    "Prices are fixed as stated. No variation, substitution or additional charge is accepted without a written amendment to this order.",
    "Payment is made against this order, the signed goods received note and a valid tax invoice, within the payment terms shown.",
]


def _money(value: Any, currency: str = "USD") -> str:
    amount = Decimal(str(value or 0))
    symbol = "$" if currency.upper() in ("USD", "ZWG", "") else f"{currency} "
    return f"{symbol}{amount:,.2f}"


def _qty(value: Any) -> str:
    amount = Decimal(str(value or 0))
    return f"{amount.normalize():,f}" if amount != amount.to_integral() else f"{int(amount):,}"


def _date(value: Any) -> str:
    if not value:
        return "—"
    if isinstance(value, (datetime, date)):
        return value.strftime("%d %B %Y")
    try:
        return datetime.fromisoformat(str(value)[:10]).strftime("%d %B %Y")
    except ValueError:
        return str(value)


def _text(value: Any, fallback: str = "—") -> str:
    """Escape for ReportLab's mini-markup; keep line breaks."""
    if value is None or str(value).strip() == "":
        return fallback
    return escape(str(value).strip()).replace("\n", "<br/>")


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    def s(name: str, **kw) -> ParagraphStyle:
        return ParagraphStyle(name=name, parent=base, **kw)

    return {
        "title": s("POTitle", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=NAVY, alignment=2),
        "number": s("PONumber", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=NAVY, alignment=2),
        "date": s("PODate", fontName="Helvetica", fontSize=9, leading=12, textColor=SLATE, alignment=2),
        "co_name": s("POCoName", fontName="Helvetica-Bold", fontSize=13, leading=15, textColor=NAVY),
        "co_tag": s("POCoTag", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=GOLD),
        "co_details": s("POCoDetails", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=SLATE),
        "subject": s("POSubject", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=NAVY),
        "label": s("POLabel", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=NAVY),
        "body": s("POBody", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK),
        "th": s("POTh", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white),
        "th_r": s("POThR", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white, alignment=2),
        "td": s("POTd", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK),
        "td_r": s("POTdR", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK, alignment=2),
        "total_l": s("POTotL", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=NAVY, alignment=2),
        "total_r": s("POTotR", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=NAVY, alignment=2),
        "words": s("POWords", fontName="Helvetica-Oblique", fontSize=7.5, leading=9.5, textColor=SLATE, alignment=2),
        "h2": s("POH2", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=NAVY),
        "note": s("PONote", fontName="Helvetica", fontSize=7.5, leading=10, textColor=SLATE),
        "sig": s("POSig", fontName="Helvetica", fontSize=7.5, leading=10, textColor=SLATE),
    }


def _header(st, po_number: str, po_date: str) -> Table:
    logo: Any = Paragraph("", st["body"])
    if os.path.exists(LOGO_PATH):
        from reportlab.platypus import Image as RLImage

        logo = RLImage(LOGO_PATH, width=44, height=44)
    company = [
        Paragraph("SIX NINE CONSTRUCTION", st["co_name"]),
        Paragraph("Building Zimbabwe’s Future", st["co_tag"]),
        Spacer(1, 2),
        Paragraph("No. 4 Kariba Road, Nyakamete Industrial Area, Mutare, Manicaland, Zimbabwe", st["co_details"]),
        Paragraph("+263 77 100 1750 · +263 77 100 1577 · 0202 065 845", st["co_details"]),
        Paragraph("info@snc.co.zw · snc.co.zw · Incorporation 11284/2019", st["co_details"]),
        Paragraph("VAT reg. 220116087 · TIN 2001309644 · ZIMRA tax clearance ITF263", st["co_details"]),
    ]
    title = [
        Paragraph("PURCHASE ORDER", st["title"]),
        Spacer(1, 3),
        Paragraph(f"No. {_text(po_number)}", st["number"]),
        Paragraph(po_date, st["date"]),
    ]
    table = Table([[logo, company, title]], colWidths=[52, 300, 171])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, NAVY),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ]))
    return table


def _box(st, title: str, rows: List[tuple]) -> List[Any]:
    out: List[Any] = [Paragraph(title.upper(), st["label"]), Spacer(1, 3)]
    for label, value in rows:
        out.append(Paragraph(f"<b>{escape(label)}:</b> {value}" if label else value, st["body"]))
    return out


def render_purchase_order_pdf(po: Dict[str, Any], organization: Optional[Dict[str, Any]] = None) -> bytes:
    """Render a purchase order (as returned by the procurement API) to PDF bytes."""
    st = _styles()
    currency = str(po.get("currency") or "USD").upper()
    po_number = str(po.get("po_number") or "DRAFT")
    status = str(po.get("status") or "draft").lower()
    supplier = po.get("supplier") or {}
    po_date = _date(po.get("issued_at") or po.get("approved_at") or po.get("created_at"))

    story: List[Any] = [_header(st, po_number, po_date), Spacer(1, 10)]

    if po.get("title"):
        story += [Paragraph(_text(po["title"]), st["subject"]), Spacer(1, 8)]

    supplier_rows = [
        ("", f"<b>{_text(supplier.get('supplier_name') or po.get('supplier_name'))}</b>"),
        ("", _text(supplier.get("address"), "")),
    ]
    if supplier.get("vat_registration_number") or supplier.get("tax_number"):
        supplier_rows.append(("", f"VAT No. {_text(supplier.get('vat_registration_number'))} · TIN {_text(supplier.get('tax_number'))}"))
    if supplier.get("primary_contact_name") or supplier.get("primary_contact_email") or supplier.get("primary_contact_phone"):
        contact = " · ".join(
            _text(v, "") for v in (supplier.get("primary_contact_name"), supplier.get("primary_contact_phone"), supplier.get("primary_contact_email")) if v
        )
        supplier_rows.append(("Contact", contact))

    terms_days = po.get("payment_terms_days")
    detail_rows = [
        ("Project", _text(po.get("project_name"))),
        ("Deliver to", _text(po.get("delivery_address"))),
        ("Required by", _date(po.get("required_by_date"))),
        ("Payment terms", f"{int(terms_days)} days" if terms_days not in (None, "") else "As agreed"),
        ("Currency", escape(currency)),
    ]
    if po.get("requisition_number"):
        detail_rows.append(("Requisition", _text(po.get("requisition_number"))))

    parties = Table([[_box(st, "Supplier", supplier_rows), _box(st, "Order details", detail_rows)]], colWidths=[262, 261])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (0, 0), 0.6, RULE),
        ("BOX", (1, 0), (1, 0), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [parties, Spacer(1, 12)]

    # Line items
    lines = [line for line in (po.get("lines") or []) if not line.get("is_deleted")]
    rows: List[List[Any]] = [[
        Paragraph("#", st["th"]), Paragraph("Description", st["th"]), Paragraph("Qty", st["th_r"]),
        Paragraph("Unit", st["th"]), Paragraph("Unit price", st["th_r"]), Paragraph("Amount", st["th_r"]),
    ]]
    lines_total = Decimal("0")
    for index, line in enumerate(lines, start=1):
        qty = Decimal(str(line.get("quantity") or 0))
        price = Decimal(str(line.get("unit_price") or 0))
        amount = Decimal(str(line.get("line_total") if line.get("line_total") is not None else qty * price))
        lines_total += amount
        rows.append([
            Paragraph(str(index), st["td"]),
            Paragraph(_text(line.get("description")), st["td"]),
            Paragraph(_qty(qty), st["td_r"]),
            Paragraph(_text(line.get("unit_of_measure"), ""), st["td"]),
            Paragraph(_money(price, currency), st["td_r"]),
            Paragraph(_money(amount, currency), st["td_r"]),
        ])
    if not lines:
        rows.append([Paragraph("", st["td"]), Paragraph("No line items on this order.", st["td"]), "", "", "", ""])

    items = Table(rows, colWidths=[22, 233, 52, 46, 80, 90], repeatRows=1)
    zebra = [("BACKGROUND", (0, r), (-1, r), ZEBRA) for r in range(2, len(rows), 2)]
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        *zebra,
    ]))
    story += [items, Spacer(1, 6)]

    subtotal = Decimal(str(po.get("subtotal") if po.get("subtotal") is not None else lines_total))
    tax = Decimal(str(po.get("tax_amount") or 0))
    total = Decimal(str(po.get("total_amount") if po.get("total_amount") is not None else subtotal + tax))
    totals = Table([
        [Paragraph("Subtotal (excl. VAT)", st["total_l"]), Paragraph(_money(subtotal, currency), st["total_r"])],
        [Paragraph("VAT", st["total_l"]), Paragraph(_money(tax, currency), st["total_r"])],
        [Paragraph("ORDER TOTAL", st["total_l"]), Paragraph(_money(total, currency), st["total_r"])],
    ], colWidths=[433, 90])
    totals.setStyle(TableStyle([
        ("LINEABOVE", (0, 2), (-1, 2), 1.2, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(KeepTogether([totals, Paragraph(number_to_words_usd(float(total)) if currency == "USD" else "", st["words"])]))
    story.append(Spacer(1, 12))

    # Notes and terms
    terms: List[Any] = [Paragraph("Notes &amp; terms", st["h2"]), Spacer(1, 4)]
    if po.get("notes"):
        terms += [Paragraph(_text(po["notes"]), st["note"]), Spacer(1, 4)]
    for index, term in enumerate(DEFAULT_TERMS, start=1):
        terms.append(Paragraph(f"{index}. {escape(term)}", st["note"]))
    story += [KeepTogether(terms), Spacer(1, 16)]

    # Authorisation block
    def signer(label: str, name: Any, when: Any) -> List[Any]:
        return [
            Spacer(1, 18),
            Paragraph("_" * 26, st["sig"]),
            Paragraph(f"<b>{label}</b>", st["sig"]),
            Paragraph(f"{_text(name, '')}{(' · ' + _date(when)) if when else ''}", st["sig"]),
        ]

    sign = Table([[
        signer("Prepared by", po.get("created_by_name"), po.get("created_at")),
        signer("Finance sign-off", po.get("finance_signed_off_by_name"), po.get("finance_signed_off_at")),
        signer("Director sign-off", po.get("director_signed_off_by_name") or po.get("approved_by_name"),
               po.get("director_signed_off_at") or po.get("approved_at")),
        signer("Issued by", po.get("issued_by_name"), po.get("issued_at")),
    ]], colWidths=[131, 131, 131, 130])
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(sign))
    if po.get("signoff_override_reason"):
        story += [Spacer(1, 8), Paragraph(
            f"Issued by superadmin override of the sign-offs: {_text(po['signoff_override_reason'])}", st["note"])]

    def make_canvas(*args, **kwargs):
        canv = NumberedCanvas(*args, **kwargs)
        canv.invoice_ref = po_number
        canv.doc_label = "Purchase Order"
        canv.client_name = str(supplier.get("supplier_name") or po.get("supplier_name") or "Supplier")
        canv.project_title = str(po.get("project_name") or po.get("title") or "")
        canv.status_stamp = None if status in OFFICIAL_STATUSES else STATUS_STAMPS.get(status, status.upper())
        return canv

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=48,
                            title=f"Purchase Order {po_number}", author="Six Nine Construction (Pvt) Ltd")
    doc.build(story, canvasmaker=make_canvas)
    return buffer.getvalue()
