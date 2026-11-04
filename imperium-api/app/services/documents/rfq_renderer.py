"""
SNC Request for Quotation PDF Renderer.

The document SNC sends to suppliers for an RFQ: what is wanted (the
requisition's lines, with blank price columns for a printed reply), the
closing date, and how to respond - the supplier portal or procurement@. Its
AEGIS signature QR opens the RFQ's public notice, which shows whether it is
still open. Estimated costs are never printed.
"""

import io
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.documents.branding import PROCUREMENT_EMAIL
from app.services.documents.invoice_renderer import NumberedCanvas
from app.services.documents.po_renderer import GOLD, NAVY, RULE, ZEBRA, _date, _qty, _styles, _text, letterhead

STATUS_STAMPS = {"draft": "DRAFT - NOT YET ISSUED", "cancelled": "CANCELLED", "closed": "CLOSED FOR QUOTATIONS"}

DEFAULT_TERMS = [
    "Quote unit prices in the currency shown, stating whether they include VAT. Prices must hold for at least 30 days.",
    "State your delivery lead time, and any item you cannot supply or offer as an alternative.",
    "Quotations received after the closing date may not be considered.",
    "This request is not an order. Six Nine Construction may accept any quotation in whole or in part, or none; "
    "an order is placed only by an issued purchase order.",
]


def _closing(value: Any) -> str:
    if not value:
        return "Not set"
    from datetime import datetime
    from zoneinfo import ZoneInfo

    if isinstance(value, datetime):
        local = value.astimezone(ZoneInfo("Africa/Harare")) if value.tzinfo else value
        return local.strftime("%d %B %Y, %H:%M")
    return _date(value)


def render_rfq_pdf(
    rfq: Dict[str, Any],
    lines: Optional[List[Dict[str, Any]]] = None,
    verification: Optional[Dict[str, str]] = None,
    *,
    public_site: str = "https://sixnineconstruction.com",
) -> bytes:
    """Render an RFQ to PDF bytes.

    rfq: procurement.rfqs row plus project_name, requisition_number,
    required_by_date, notice_reference, issued_by_name.
    lines: requisition_lines (description, quantity, unit_of_measure,
    work_package, notes). verification: {"code", "url", ...} from attestation."""
    st = _styles()
    lines = lines or []
    number = str(rfq.get("rfq_number") or "DRAFT")
    status = str(rfq.get("status") or "draft").lower()
    issued = _date(rfq.get("issued_at") or rfq.get("created_at"))
    notice = rfq.get("notice_reference")
    site = public_site.rstrip("/")

    story: List[Any] = [letterhead(st, "REQUEST FOR QUOTATION", number, issued), Spacer(1, 10)]
    if rfq.get("title"):
        story += [Paragraph(_text(rfq["title"]), st["subject"]), Spacer(1, 6)]

    closing = Table([[
        Paragraph("<b>QUOTATIONS CLOSE</b>", st["band"].clone("RfqCloseL", textColor=colors.white)),
        Paragraph(f"<b>{_closing(rfq.get('closing_date'))}</b>", st["total_r"].clone("RfqCloseR", textColor=colors.white, fontSize=11)),
    ]], colWidths=[220, 303])
    closing.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [closing, Spacer(1, 10)]

    def box(title: str, rows: List[tuple]) -> List[Any]:
        out: List[Any] = [Paragraph(title.upper(), st["label"]), Spacer(1, 3)]
        for label, value in rows:
            out.append(Paragraph(f"<b>{label}:</b> {value}", st["body"]))
        return out

    detail_rows = [
        ("Project", _text(rfq.get("project_name"))),
        ("Deliver to", _text(rfq.get("delivery_address"), "To be confirmed with procurement")),
        ("Required by", _date(rfq.get("required_by_date"))),
        ("Currency", "USD unless stated"),
    ]
    respond_rows = [
        ("Online", f"Supplier portal, {_text(site)}/portal/supplier"),
        ("Email", _text(PROCUREMENT_EMAIL)),
        ("Quote reference", _text(notice or number)),
    ]
    if notice:
        respond_rows.append(("Live status", f"{_text(site)}/tenders/{_text(notice)}"))
    parties = Table([[box("Request details", detail_rows), box("How to respond", respond_rows)]], colWidths=[262, 261])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (0, 0), 0.6, RULE), ("BOX", (1, 0), (1, 0), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [parties, Spacer(1, 12)]

    if rfq.get("description"):
        story += [Paragraph("Scope", st["h2"]), Spacer(1, 3), Paragraph(_text(rfq["description"]), st["note"]), Spacer(1, 10)]

    rows: List[List[Any]] = [[
        Paragraph("#", st["th"]), Paragraph("Item required", st["th"]), Paragraph("Qty", st["th_r"]),
        Paragraph("Unit", st["th"]), Paragraph("Unit price", st["th_r"]), Paragraph("Amount", st["th_r"]),
    ]]
    for index, line in enumerate(lines, start=1):
        description = _text(line.get("description"))
        extra = " · ".join(_text(v, "") for v in (line.get("work_package"), line.get("notes")) if v)
        if extra:
            description += f"<br/><font size='6.8' color='#475569'>{extra}</font>"
        rows.append([
            Paragraph(str(index), st["td"]), Paragraph(description, st["td"]),
            Paragraph(_qty(line.get("quantity")), st["td_r"]), Paragraph(_text(line.get("unit_of_measure"), ""), st["td"]),
            "", "",
        ])
    if not lines:
        rows.append(["", Paragraph("Items as described in the scope above.", st["td"]), "", "", "", ""])
    rows.append(["", Paragraph("<b>Total (state whether VAT is included)</b>", st["td"]), "", "", "", ""])
    items = Table(rows, colWidths=[22, 233, 52, 46, 80, 90], repeatRows=1)
    items.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("BOX", (4, 1), (5, -1), 0.4, RULE), ("INNERGRID", (4, 1), (5, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, NAVY),
        *[("BACKGROUND", (0, r), (3, r), ZEBRA) for r in range(2, len(rows) - 1, 2)],
    ]))
    story += [items, Spacer(1, 12)]

    terms: List[Any] = [Paragraph("Conditions", st["h2"]), Spacer(1, 4)]
    for index, term in enumerate(rfq.get("terms") or DEFAULT_TERMS, start=1):
        terms.append(Paragraph(f"{index}. {_text(term)}", st["note"]))
    terms += [Spacer(1, 10), Paragraph(
        f"Issued by {_text(rfq.get('issued_by_name'), 'Six Nine Construction procurement')} for Six Nine Construction (Pvt) Ltd.",
        st["note"].clone("RfqIssuer", textColor=GOLD))]
    story.append(KeepTogether(terms))

    def make_canvas(*args, **kwargs):
        canv = NumberedCanvas(*args, **kwargs)
        canv.invoice_ref = number
        canv.doc_label = "Request for Quotation"
        canv.client_name = "Suppliers"
        canv.project_title = str(rfq.get("project_name") or rfq.get("title") or "")
        canv.status_stamp = STATUS_STAMPS.get(status)
        canv.verification = verification
        return canv

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36,
                            bottomMargin=104 if verification else 48,
                            title=f"Request for Quotation {number}", author="Six Nine Construction (Pvt) Ltd")
    doc.build(story, canvasmaker=make_canvas)
    return buffer.getvalue()
