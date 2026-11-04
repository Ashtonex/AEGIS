"""
SNC Payment Receipt PDF Renderer.

A receipt for money Six Nine Construction has received, issued from a
cashbook receipt (finance.cashbook_transactions, direction inflow) and the
progress claims it was allocated to. Same corporate identity as the purchase
order and invoice (logo header, SNC watermark, running header/footer, AEGIS
signature strip).

It is not a fiscal tax invoice: where VAT applies, that comes from the ZIMRA
fiscal device, and the receipt prints any fiscal invoice numbers on record
for the claims it settles.
"""

import io
from decimal import Decimal
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.documents.invoice_renderer import NumberedCanvas, number_to_words_usd
from app.services.documents.po_renderer import NAVY, RULE, ZEBRA, _date, _money, _styles, _text, letterhead

UNPOSTED_STAMP = "NOT POSTED - NOT A VALID RECEIPT"

PAYMENT_METHODS = {
    "bank_transfer": "Bank transfer",
    "rtgs": "RTGS",
    "cash": "Cash",
    "cheque": "Cheque",
    "mobile_money": "Mobile money",
    "card": "Card",
    "swipe": "Card (swipe)",
    "ecocash": "EcoCash",
}

FISCAL_NOTE = (
    "This receipt confirms payment received by Six Nine Construction (Pvt) Ltd. It is not a fiscal tax "
    "invoice: where VAT applies, the fiscal tax invoice is issued from our ZIMRA-registered fiscal device."
)


def payment_method_label(method: Any) -> str:
    key = str(method or "").strip().lower()
    return PAYMENT_METHODS.get(key, key.replace("_", " ").capitalize() or "—")


def _box(st, title: str, rows: List[tuple]) -> List[Any]:
    out: List[Any] = [Paragraph(title.upper(), st["label"]), Spacer(1, 3)]
    for label, value in rows:
        out.append(Paragraph(f"<b>{label}:</b> {value}" if label else value, st["body"]))
    return out


def render_payment_receipt_pdf(
    receipt: Dict[str, Any],
    allocations: Optional[List[Dict[str, Any]]] = None,
    verification: Optional[Dict[str, str]] = None,
) -> bytes:
    """Render a payment receipt to PDF bytes.

    receipt: a cashbook transaction row plus account_name, bank_name,
    project_name, project_code, recorded_by_name and issued_by_name.
    allocations: progress claims the money settles - claim_number,
    allocated_amount, fiscal_invoice_number, claim_period_start/end.
    verification: {"code", "url"} from attestation - prints the AEGIS
    signed-document strip and QR on every page."""
    st = _styles()
    allocations = allocations or []
    currency = str(receipt.get("currency") or "USD").upper()
    number = str(receipt.get("transaction_number") or "DRAFT")
    amount = Decimal(str(receipt.get("amount") or 0))
    received_on = _date(receipt.get("transaction_date"))
    payer = receipt.get("counterparty_name")

    story: List[Any] = [letterhead(st, "PAYMENT RECEIPT", number, received_on), Spacer(1, 12)]

    payer_rows = [("", f"<b>{_text(payer)}</b>")]
    if receipt.get("project_name"):
        project = _text(receipt["project_name"])
        if receipt.get("project_code"):
            project = f"{project} ({_text(receipt['project_code'])})"
        payer_rows.append(("Project", project))
    paid_into = " · ".join(_text(v, "") for v in (receipt.get("account_name"), receipt.get("bank_name")) if v) or "—"
    detail_rows = [
        ("Date received", received_on),
        ("Payment method", _text(payment_method_label(receipt.get("payment_method")))),
        ("Payer's reference", _text(receipt.get("reference"))),
        ("Paid into", paid_into),
        ("Currency", _text(currency)),
    ]
    parties = Table([[_box(st, "Received from", payer_rows), _box(st, "Receipt details", detail_rows)]], colWidths=[262, 261])
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

    # Amount received banner
    words = number_to_words_usd(float(amount)) if currency == "USD" else ""
    banner = Table([[
        [Paragraph("<b>AMOUNT RECEIVED</b>", st["band"].clone("RcBnrL", textColor=colors.white, fontSize=13, leading=16))],
        [
            Paragraph(f"<b>{_money(amount, currency)}</b>", st["title"].clone("RcBnrAmt", textColor=colors.HexColor("#38BDF8"), fontSize=21, leading=25)),
            Spacer(1, 3),
            Paragraph(words, st["words"].clone("RcBnrWords", textColor=colors.HexColor("#E2E8F0"))),
        ],
    ]], colWidths=[220, 303])
    banner.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    story += [banner, Spacer(1, 12)]

    # What the payment was for
    rows: List[List[Any]] = [[
        Paragraph("Payment for", st["th"]), Paragraph("Period", st["th"]),
        Paragraph("Fiscal invoice", st["th"]), Paragraph("Amount", st["th_r"]),
    ]]
    allocated = Decimal("0")
    for alloc in allocations:
        share = Decimal(str(alloc.get("allocated_amount") or 0))
        allocated += share
        period = "—"
        if alloc.get("claim_period_start") or alloc.get("claim_period_end"):
            period = f"{_date(alloc.get('claim_period_start'))} to {_date(alloc.get('claim_period_end'))}"
        rows.append([
            Paragraph(f"Progress claim {_text(alloc.get('claim_number'))}", st["td"]),
            Paragraph(period, st["td"]),
            Paragraph(_text(alloc.get("fiscal_invoice_number"), "Not yet issued"), st["td"]),
            Paragraph(_money(share, currency), st["td_r"]),
        ])
    remainder = amount - allocated
    if not allocations:
        rows.append([Paragraph(_text(receipt.get("description")), st["td"]), Paragraph("—", st["td"]),
                     Paragraph("—", st["td"]), Paragraph(_money(amount, currency), st["td_r"])])
    elif remainder > Decimal("0.005"):
        rows.append([Paragraph("Not yet allocated to a claim (held on account)", st["td"]), Paragraph("—", st["td"]),
                     Paragraph("—", st["td"]), Paragraph(_money(remainder, currency), st["td_r"])])
    rows.append([Paragraph("TOTAL RECEIVED", st["total_l"]), "", "", Paragraph(_money(amount, currency), st["total_r"])])

    table = Table(rows, colWidths=[211, 140, 82, 90], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("SPAN", (0, -1), (2, -1)),
        ("LINEABOVE", (0, -1), (-1, -1), 1.2, NAVY),
        *[("BACKGROUND", (0, r), (-1, r), ZEBRA) for r in range(2, len(rows) - 1, 2)],
    ]))
    story += [table, Spacer(1, 12)]

    # Notes and signature
    notes: List[Any] = [Paragraph("Notes", st["h2"]), Spacer(1, 4)]
    if receipt.get("description") and allocations:
        notes += [Paragraph(_text(receipt["description"]), st["note"]), Spacer(1, 3)]
    notes += [Paragraph(FISCAL_NOTE, st["note"]), Spacer(1, 3)]
    notes.append(Paragraph(f"Please keep this receipt. Quote {_text(number)} on any query about this payment.", st["note"]))
    notes.append(Spacer(1, 14))

    def signer(label: str, name: Any) -> List[Any]:
        return [Spacer(1, 18), Paragraph("_" * 34, st["sig"]), Paragraph(f"<b>{label}</b>", st["sig"]),
                Paragraph(_text(name, ""), st["sig"])]

    sign = Table([[signer("Recorded by", receipt.get("recorded_by_name")),
                   signer("Issued by", receipt.get("issued_by_name"))]], colWidths=[261, 262])
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(notes + [sign]))

    posted = receipt.get("is_posted", True) is not False

    def make_canvas(*args, **kwargs):
        canv = NumberedCanvas(*args, **kwargs)
        canv.invoice_ref = number
        canv.doc_label = "Payment Receipt"
        canv.client_name = str(payer or "Payer")
        canv.project_title = str(receipt.get("project_name") or "")
        canv.status_stamp = None if posted else UNPOSTED_STAMP
        canv.verification = verification
        return canv

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36,
                            bottomMargin=104 if verification else 48,
                            title=f"Payment Receipt {number}", author="Six Nine Construction (Pvt) Ltd")
    doc.build(story, canvasmaker=make_canvas)
    return buffer.getvalue()
