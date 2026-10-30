"""Client quotation PDF and internal estimate workbook, from a frozen revision.

Both documents are derived only from a saved finance.quotation_revisions
snapshot and its stored QuotationCalculator result - never from browser
state - so the figures on paper are the figures that were issued.

Client document: the priced schedule shows SELLING rates. QuotationCalculator
applies overhead, contingency and profit each as a percentage of (direct
costs + preliminaries), so every cost rate carries the same selling factor
f = 1 + overhead% + contingency% + profit%. Each line's selling rate is
rate x f rounded to cents; the cent-rounding residue against the calculator's
selling value is absorbed into the preliminaries line (or shown as a rounding
line when there are no preliminaries), so the schedule always sums exactly to
the authoritative total. Costs, build-ups, markups and margins never appear.

Internal workbook: cost rates, build-ups, markups, markup and margin - for
the estimating team only.
"""

from __future__ import annotations

import io
import os
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Optional

from reportlab.lib.pagesizes import A4
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.documents.invoice_renderer import NumberedCanvas
from app.services.documents.po_renderer import NAVY, RULE, ZEBRA, _date, _money, _qty, _styles, _text
from app.services.quotations.calculator import quotation_item_qty_rate

CENT = Decimal("0.01")
LOGO_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))


def _d(value: Any) -> Decimal:
    try:
        return Decimal(str(value if value not in (None, "") else 0))
    except Exception:  # noqa: BLE001 - malformed numbers price at zero, as in the calculator
        return Decimal("0")


def _c(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


def selling_factor(snapshot: Dict[str, Any]) -> Decimal:
    return Decimal("1") + sum(
        (_d(snapshot.get(k)) / Decimal("100") for k in ("overhead_pct", "contingency_pct", "profit_pct")),
        Decimal("0"),
    )


def client_schedule(snapshot: Dict[str, Any], calculation: Dict[str, Any]) -> Dict[str, Any]:
    """The client-facing priced schedule for one frozen revision."""
    factor = selling_factor(snapshot)
    sections: List[Dict[str, Any]] = []
    index: Dict[str, int] = {}
    lines_total = Decimal("0")
    for item in snapshot.get("items") or []:
        if not isinstance(item, dict):
            continue
        section_name = str(item.get("section") or "Measured Works").strip() or "Measured Works"
        if section_name not in index:
            index[section_name] = len(sections)
            sections.append({"section": section_name, "lines": [], "total": Decimal("0")})
        section = sections[index[section_name]]
        item_type = item.get("item_type") or "measured"
        if item_type == "note":
            section["lines"].append({
                "item_no": item.get("item_no") or "", "description": item.get("description") or "",
                "note": True, "unit": "", "qty": None, "rate": None, "amount": None,
            })
            continue
        qty, rate, unit = quotation_item_qty_rate(item)
        qty, rate = _d(qty), _d(rate)
        sell_rate = _c(rate * factor)
        amount = _c(qty * sell_rate)
        section["lines"].append({
            "item_no": item.get("item_no") or "", "description": item.get("description") or "",
            "note": False, "unit": unit or "", "qty": qty, "rate": sell_rate, "amount": amount,
            "item_type": item_type,
        })
        section["total"] += amount
        lines_total += amount

    taxable = _d(calculation.get("taxable_amount"))
    discount = _d(calculation.get("discount_amount"))
    provisional = _d(calculation.get("provisional_sums"))
    prelims_sell = _c(_d(calculation.get("preliminaries")) * factor)
    residue = taxable + discount - provisional - prelims_sell - lines_total
    adjustments: List[Dict[str, Any]] = []
    if prelims_sell != 0 or residue != 0:
        if prelims_sell != 0:
            adjustments.append({"label": "Preliminaries and general items", "amount": prelims_sell + residue})
        else:
            adjustments.append({"label": "Rounding adjustment", "amount": residue})
    if provisional:
        adjustments.append({"label": "Provisional sums", "amount": provisional})
    schedule_total = lines_total + sum((a["amount"] for a in adjustments), Decimal("0"))
    return {
        "sections": sections,
        "adjustments": adjustments,
        "schedule_total": schedule_total,
        "discount": discount,
        "taxable": taxable,
        "tax": _d(calculation.get("tax_amount")),
        "grand_total": _d(calculation.get("grand_total")),
        "reconciles": schedule_total - discount == taxable,
    }


def _valid_until(snapshot: Dict[str, Any]) -> Optional[str]:
    if snapshot.get("valid_until"):
        return _date(snapshot["valid_until"])
    try:
        start = date.fromisoformat(str(snapshot.get("quote_date"))[:10])
    except ValueError:
        return None
    return _date(start + timedelta(days=int(_d(snapshot.get("valid_until_days") or 30))))


def render_client_quotation_pdf(
    *,
    revision: Dict[str, Any],
    client_name: Optional[str],
) -> bytes:
    snapshot = revision["snapshot"]
    calculation = revision["calculation"]
    schedule = client_schedule(snapshot, calculation)
    currency = str(snapshot.get("currency") or revision.get("currency") or "USD").upper()
    st = _styles()
    ref = str(snapshot.get("reference_number") or "QUOTATION")
    rev_label = f"Rev {revision['revision_number']}"

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
        Paragraph("QUOTATION", st["title"]),
        Spacer(1, 3),
        Paragraph(f"{_text(ref)} · {rev_label}", st["number"]),
        Paragraph(_date(snapshot.get("quote_date")), st["date"]),
    ]
    header = Table([[logo, company, title]], colWidths=[52, 300, 171])
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LINEBELOW", (0, 0), (-1, 0), 1.2, NAVY),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ]))
    story: List[Any] = [header, Spacer(1, 10)]
    if snapshot.get("project_title"):
        story += [Paragraph(_text(snapshot["project_title"]), st["subject"]), Spacer(1, 8)]

    def box(title_text: str, rows: List[tuple]) -> List[Any]:
        out: List[Any] = [Paragraph(title_text.upper(), st["label"]), Spacer(1, 3)]
        for label, value in rows:
            out.append(Paragraph(f"<b>{label}:</b> {value}" if label else value, st["body"]))
        return out

    client_rows = [("", f"<b>{_text(client_name)}</b>")]
    if snapshot.get("client_email"):
        client_rows.append(("Email", _text(snapshot["client_email"])))
    detail_rows = [
        ("Reference", f"{_text(ref)} ({rev_label})"),
        ("Date", _date(snapshot.get("quote_date"))),
        ("Valid until", _valid_until(snapshot) or "—"),
        ("Currency", _text(currency)),
    ]
    if snapshot.get("programme_weeks") or snapshot.get("duration_text"):
        detail_rows.append(("Programme", _text(snapshot.get("duration_text") or f"{snapshot['programme_weeks']} weeks")))
    parties = Table([[box("Client", client_rows), box("Quotation details", detail_rows)]], colWidths=[262, 261])
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

    rows: List[List[Any]] = [[
        Paragraph("Item", st["th"]), Paragraph("Description", st["th"]), Paragraph("Qty", st["th_r"]),
        Paragraph("Unit", st["th"]), Paragraph("Rate", st["th_r"]), Paragraph("Amount", st["th_r"]),
    ]]
    section_rows: List[int] = []
    subtotal_rows: List[int] = []
    for section in schedule["sections"]:
        section_rows.append(len(rows))
        rows.append([Paragraph(f"<b>{_text(section['section'])}</b>", st["td"]), "", "", "", "", ""])
        for line in section["lines"]:
            if line["note"]:
                rows.append([
                    Paragraph(_text(line["item_no"], ""), st["td"]),
                    Paragraph(f"<i>{_text(line['description'], '')}</i>", st["td"]), "", "", "", "",
                ])
                continue
            rows.append([
                Paragraph(_text(line["item_no"], ""), st["td"]),
                Paragraph(_text(line["description"], ""), st["td"]),
                Paragraph(_qty(line["qty"]), st["td_r"]),
                Paragraph(_text(line["unit"], ""), st["td"]),
                Paragraph(_money(line["rate"], currency), st["td_r"]),
                Paragraph(_money(line["amount"], currency), st["td_r"]),
            ])
        subtotal_rows.append(len(rows))
        rows.append([
            "", Paragraph(f"<b>Total carried: {_text(section['section'])}</b>", st["td"]), "", "", "",
            Paragraph(f"<b>{_money(section['total'], currency)}</b>", st["td_r"]),
        ])
    for adjustment in schedule["adjustments"]:
        rows.append([
            "", Paragraph(_text(adjustment["label"]), st["td"]), "", "", "",
            Paragraph(_money(adjustment["amount"], currency), st["td_r"]),
        ])
    table = Table(rows, colWidths=[42, 239, 50, 40, 70, 82], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    style += [("BACKGROUND", (0, r), (-1, r), ZEBRA) for r in section_rows]
    style += [("SPAN", (0, r), (-1, r)) for r in section_rows]
    style += [("LINEABOVE", (0, r), (-1, r), 0.8, NAVY) for r in subtotal_rows]
    table.setStyle(TableStyle(style))
    story += [table, Spacer(1, 6)]

    tax_label = "VAT"
    if snapshot.get("apply_vat") and snapshot.get("vat_rate") not in (None, ""):
        tax_label = f"VAT @ {(_d(snapshot['vat_rate']) * 100).normalize():f}%"
    total_rows = [[Paragraph("Total of schedule", st["total_l"]), Paragraph(_money(schedule["schedule_total"], currency), st["total_r"])]]
    if schedule["discount"]:
        total_rows.append([Paragraph("Discount", st["total_l"]), Paragraph(_money(-schedule["discount"], currency), st["total_r"])])
    total_rows += [
        [Paragraph("Total excluding VAT", st["total_l"]), Paragraph(_money(schedule["taxable"], currency), st["total_r"])],
        [Paragraph(tax_label if snapshot.get("apply_vat") else "VAT (not applicable)", st["total_l"]), Paragraph(_money(schedule["tax"], currency), st["total_r"])],
        [Paragraph("QUOTATION TOTAL", st["total_l"]), Paragraph(_money(schedule["grand_total"], currency), st["total_r"])],
    ]
    totals = Table(total_rows, colWidths=[441, 82])
    totals.setStyle(TableStyle([
        ("LINEABOVE", (0, len(total_rows) - 1), (-1, len(total_rows) - 1), 1.2, NAVY),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story += [KeepTogether(totals), Spacer(1, 12)]

    def bullet_block(title_text: str, values: Any) -> List[Any]:
        values = [str(v).strip() for v in (values or []) if str(v).strip()]
        if not values:
            return []
        return [KeepTogether(
            [Paragraph(title_text, st["h2"]), Spacer(1, 3)]
            + [Paragraph(f"{i}. {_text(v)}", st["note"]) for i, v in enumerate(values, start=1)]
            + [Spacer(1, 8)]
        )]

    story += bullet_block("Inclusions", snapshot.get("inclusions"))
    story += bullet_block("Exclusions", snapshot.get("exclusions"))
    story += bullet_block("Assumptions and qualifications", snapshot.get("assumptions"))
    if snapshot.get("terms"):
        story += [KeepTogether([Paragraph("Payment terms", st["h2"]), Spacer(1, 3), Paragraph(_text(snapshot["terms"]), st["note"])]), Spacer(1, 12)]

    def signer(label: str) -> List[Any]:
        return [Spacer(1, 20), Paragraph("_" * 34, st["sig"]), Paragraph(f"<b>{label}</b>", st["sig"]),
                Paragraph("Name, signature and date", st["sig"])]

    acceptance = [
        Paragraph("Acceptance", st["h2"]), Spacer(1, 3),
        Paragraph(
            f"We accept quotation {_text(ref)} {rev_label} for {_money(schedule['grand_total'], currency)} "
            "on the terms stated above.", st["note"],
        ),
        Table([[signer("For the client"), signer("For Six Nine Construction")]], colWidths=[261, 262]),
    ]
    story.append(KeepTogether(acceptance))

    def make_canvas(*args, **kwargs):
        canv = NumberedCanvas(*args, **kwargs)
        canv.invoice_ref = f"{ref} {rev_label}"
        canv.doc_label = "Quotation"
        canv.client_name = str(client_name or "Client")
        canv.project_title = str(snapshot.get("project_title") or "")
        canv.status_stamp = None
        return canv

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=48,
                            title=f"Quotation {ref} {rev_label}", author="Six Nine Construction (Pvt) Ltd")
    doc.build(story, canvasmaker=make_canvas)
    return buffer.getvalue()


def render_internal_estimate_xlsx(*, revision: Dict[str, Any], client_name: Optional[str], breakdown: Dict[str, Any]) -> bytes:
    """INTERNAL estimate workbook: cost rates, build-ups and the commercial
    build-up with markup and margin. Not for the client."""
    import xlsxwriter

    snapshot = revision["snapshot"]
    buffer = io.BytesIO()
    book = xlsxwriter.Workbook(buffer, {"in_memory": True})
    bold = book.add_format({"bold": True})
    banner = book.add_format({"bold": True, "font_color": "#B91C1C"})
    money = book.add_format({"num_format": "#,##0.00"})
    qty_fmt = book.add_format({"num_format": "#,##0.000"})
    head = book.add_format({"bold": True, "bg_color": "#0B2B39", "font_color": "#FFFFFF"})

    summary = book.add_worksheet("Summary")
    summary.write(0, 0, "INTERNAL ESTIMATE - contains costs and margins. Do not send to the client.", banner)
    summary.write(2, 0, "Reference", bold)
    summary.write(2, 1, f"{snapshot.get('reference_number') or ''} Rev {revision['revision_number']}")
    summary.write(3, 0, "Client", bold)
    summary.write(3, 1, client_name or "")
    summary.write(4, 0, "Project", bold)
    summary.write(4, 1, snapshot.get("project_title") or "")
    summary.write(5, 0, "Currency", bold)
    summary.write(5, 1, snapshot.get("currency") or "USD")
    row = 7
    summary.write_row(row, 0, ["Step", "Amount", "Basis"], head)
    for step in breakdown["steps"]:
        row += 1
        summary.write(row, 0, step["label"])
        summary.write_number(row, 1, float(step["amount"]), money)
        summary.write(row, 2, step["basis"])
    row += 2
    summary.write(row, 0, "Cost (direct + prelims + overhead + contingency + provisional)", bold)
    summary.write_number(row, 1, float(breakdown["cost_total"]), money)
    summary.write(row + 1, 0, "Realised profit (selling excl. tax - cost)", bold)
    summary.write_number(row + 1, 1, float(breakdown["profit_realised"]), money)
    summary.write(row + 2, 0, "Markup (profit / cost) %", bold)
    summary.write(row + 2, 1, breakdown["markup_pct"] if breakdown["markup_pct"] is not None else "n/a")
    summary.write(row + 3, 0, "Margin (profit / selling excl. tax) %", bold)
    summary.write(row + 3, 1, breakdown["margin_pct"] if breakdown["margin_pct"] is not None else "n/a")
    summary.set_column(0, 0, 58)
    summary.set_column(1, 1, 18)
    summary.set_column(2, 2, 48)

    boq = book.add_worksheet("BOQ costs")
    boq.write_row(0, 0, ["Line id", "Section", "Item", "Type", "Description", "Unit", "Qty", "Cost rate", "Cost amount", "Rate source"], head)
    for r, item in enumerate([i for i in snapshot.get("items") or [] if isinstance(i, dict)], start=1):
        qty, rate, unit = quotation_item_qty_rate(item)
        is_note = (item.get("item_type") or "measured") == "note"
        boq.write_row(r, 0, [item.get("line_id") or "", item.get("section") or "", item.get("item_no") or "",
                             item.get("item_type") or "measured", item.get("description") or "", unit or ""])
        boq.write_number(r, 6, 0 if is_note else float(_d(qty)), qty_fmt)
        boq.write_number(r, 7, 0 if is_note else float(_d(rate)), money)
        boq.write_number(r, 8, 0 if is_note else float(_c(_d(qty) * _d(rate))), money)
        boq.write(r, 9, str(item.get("rate_source") or ("build-up" if item.get("buildup") else "")))
    boq.set_column(0, 0, 10)
    boq.set_column(4, 4, 60)

    build = book.add_worksheet("Build-ups")
    build.write_row(0, 0, ["Item", "Description", "Resource type", "Resource", "Qty per unit", "Unit", "Unit cost", "Contribution"], head)
    r = 1
    for item in snapshot.get("items") or []:
        if not isinstance(item, dict):
            continue
        for b in item.get("buildup") or []:
            if not isinstance(b, dict):
                continue
            build.write_row(r, 0, [item.get("item_no") or "", item.get("description") or "", b.get("type") or "", b.get("name") or ""])
            build.write_number(r, 4, float(_d(b.get("qty"))), qty_fmt)
            build.write(r, 5, b.get("unit") or "")
            build.write_number(r, 6, float(_d(b.get("rate"))), money)
            build.write_number(r, 7, float(_c(_d(b.get("qty")) * _d(b.get("rate")))), money)
            r += 1
    build.set_column(1, 1, 50)
    build.set_column(3, 3, 32)
    book.close()
    return buffer.getvalue()
