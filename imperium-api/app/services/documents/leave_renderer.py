"""
SNC Employee Leave Record PDF Renderer.

One employee's full leave history - every request with its dates, days,
reason and decision - plus an annual-leave balance and a per-type summary.
Same corporate identity as the invoice and purchase-order renderers (logo
header, SNC watermark, running header/footer, page numbers) via NumberedCanvas.
"""

import io
import os
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from xml.sax.saxutils import escape

from app.services.documents.invoice_renderer import NumberedCanvas

LOGO_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))

NAVY = colors.HexColor("#0B2B39")
GOLD = colors.HexColor("#B45309")
SLATE = colors.HexColor("#475569")
DARK = colors.HexColor("#0F172A")
RULE = colors.HexColor("#CBD5E1")
ZEBRA = colors.HexColor("#F8FAFC")
TINT = colors.HexColor("#F1F5F9")

STATUS_COLOURS = {
    "approved": "#047857",
    "pending": "#1D4ED8",
    "rejected": "#B91C1C",
    "cancelled": "#64748B",
}

TYPE_LABELS = {
    "annual": "Annual",
    "sick": "Sick",
    "maternity": "Maternity",
    "paternity": "Paternity",
    "compassionate": "Compassionate",
    "study": "Study",
    "unpaid": "Unpaid",
    "other": "Other",
}


def _days(value: Any) -> str:
    amount = Decimal(str(value or 0))
    return f"{amount.normalize():f}" if amount != amount.to_integral() else f"{int(amount)}"


def _date(value: Any, fmt: str = "%d %b %Y") -> str:
    if not value:
        return "—"
    if isinstance(value, (datetime, date)):
        return value.strftime(fmt)
    try:
        return datetime.fromisoformat(str(value)[:10]).strftime(fmt)
    except ValueError:
        return str(value)


def _text(value: Any, fallback: str = "—") -> str:
    """Escape for ReportLab's mini-markup; keep line breaks."""
    if value is None or str(value).strip() == "":
        return fallback
    return escape(str(value).strip()).replace("\n", "<br/>")


def _type_label(value: Any) -> str:
    key = str(value or "other").lower()
    return TYPE_LABELS.get(key, key.replace("_", " ").title())


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()["Normal"]

    def s(name: str, **kw) -> ParagraphStyle:
        return ParagraphStyle(name=name, parent=base, **kw)

    return {
        "title": s("LvTitle", fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=NAVY, alignment=2),
        "subtitle": s("LvSubtitle", fontName="Helvetica-Bold", fontSize=9, leading=12, textColor=GOLD, alignment=2),
        "number": s("LvNumber", fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=NAVY, alignment=2),
        "date": s("LvDate", fontName="Helvetica", fontSize=9, leading=12, textColor=SLATE, alignment=2),
        "co_name": s("LvCoName", fontName="Helvetica-Bold", fontSize=13, leading=15, textColor=NAVY),
        "co_tag": s("LvCoTag", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=GOLD),
        "co_details": s("LvCoDetails", fontName="Helvetica", fontSize=7.5, leading=9.5, textColor=SLATE),
        "label": s("LvLabel", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=NAVY),
        "body": s("LvBody", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK),
        "stat_v": s("LvStatV", fontName="Helvetica-Bold", fontSize=16, leading=19, textColor=NAVY, alignment=1),
        "stat_l": s("LvStatL", fontName="Helvetica", fontSize=7, leading=9, textColor=SLATE, alignment=1),
        "h2": s("LvH2", fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=NAVY),
        "th": s("LvTh", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white),
        "th_r": s("LvThR", fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white, alignment=2),
        "td": s("LvTd", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK),
        "td_r": s("LvTdR", fontName="Helvetica", fontSize=8, leading=10.5, textColor=DARK, alignment=2),
        "td_b": s("LvTdB", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=NAVY),
        "td_br": s("LvTdBR", fontName="Helvetica-Bold", fontSize=8, leading=10.5, textColor=NAVY, alignment=2),
        "note": s("LvNote", fontName="Helvetica", fontSize=7.5, leading=10, textColor=SLATE),
        "sig": s("LvSig", fontName="Helvetica", fontSize=7.5, leading=10, textColor=SLATE),
    }


def _header(st, reference: str, generated: str, subtitle: str) -> Table:
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
        Paragraph("info@snc.co.zw · snc.co.zw · Human Resources", st["co_details"]),
    ]
    title = [
        Paragraph("LEAVE RECORD", st["title"]),
        Paragraph(escape(subtitle), st["subtitle"]),
        Spacer(1, 3),
        Paragraph(_text(reference), st["number"]),
        Paragraph(f"Generated {generated}", st["date"]),
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
        out.append(Paragraph(f"<b>{escape(label)}:</b> {value}", st["body"]))
    return out


def _stat(st, value: str, label: str) -> List[Any]:
    return [Paragraph(value, st["stat_v"]), Paragraph(label, st["stat_l"])]


def render_leave_record_pdf(
    employee: Dict[str, Any],
    requests: List[Dict[str, Any]],
    *,
    year: Optional[int] = None,
    balance_year: int,
    annual_taken: float,
    generated_by: Optional[str] = None,
) -> bytes:
    """Render one employee's leave record to PDF bytes.

    requests: hr.leave_requests rows (oldest first) with approved_by_name.
    year: when set, the history is limited to leave starting in that year.
    balance_year / annual_taken: approved annual leave in the balance year,
    printed against the employee's annual_leave_days entitlement."""
    st = _styles()
    name = str(employee.get("employee_name") or "Employee")
    reference = str(employee.get("employee_number") or "") or name
    generated = _date(datetime.now(), "%d %B %Y")
    period = f"Calendar year {year}" if year else "Full history"

    story: List[Any] = [_header(st, reference, generated, period), Spacer(1, 10)]

    started = employee.get("start_date") or employee.get("hire_date")
    staff_rows = [
        ("Name", f"<b>{_text(name)}</b>"),
        ("Employee no.", _text(employee.get("employee_number"))),
        ("Position", _text(employee.get("position_name") or employee.get("job_title"))),
        ("Department", _text(employee.get("department_name"))),
        ("Status", _text(str(employee.get("employment_status") or "").replace("_", " ").capitalize())),
    ]
    if started:
        staff_rows.append(("Started", _date(started)))

    entitlement = float(employee.get("annual_leave_days") or 0)
    remaining = entitlement - annual_taken
    approved = [r for r in requests if str(r.get("status")).lower() == "approved"]
    pending = [r for r in requests if str(r.get("status")).lower() == "pending"]
    approved_days = sum(float(r.get("days_requested") or 0) for r in approved)
    first = min((r["start_date"] for r in requests if r.get("start_date")), default=None)
    last = max((r["end_date"] for r in requests if r.get("end_date")), default=None)
    record_rows = [
        ("Period", escape(period)),
        ("Requests on record", str(len(requests))),
        ("Covering", f"{_date(first)} to {_date(last)}" if first else "—"),
        ("Annual entitlement", f"{_days(entitlement)} days per year"),
    ]
    if generated_by:
        record_rows.append(("Prepared by", _text(generated_by)))

    parties = Table([[_box(st, "Employee", staff_rows), _box(st, "This record", record_rows)]], colWidths=[262, 261])
    parties.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOX", (0, 0), (0, 0), 0.6, RULE),
        ("BOX", (1, 0), (1, 0), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [parties, Spacer(1, 10)]

    # Headline figures
    stats = Table([[
        _stat(st, _days(approved_days), "Approved days (this record)"),
        _stat(st, _days(annual_taken), f"Annual leave taken {balance_year}"),
        _stat(st, _days(remaining), f"Annual leave remaining {balance_year}"),
        _stat(st, str(len(pending)), "Requests awaiting decision"),
    ]], colWidths=[130.75] * 4)
    stats.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), TINT),
        ("LINEABOVE", (0, 0), (-1, 0), 1.2, GOLD),
        ("LINEAFTER", (0, 0), (-2, 0), 0.6, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [stats, Spacer(1, 14)]

    # Days by leave type
    by_type: Dict[str, Dict[str, float]] = defaultdict(lambda: {"approved": 0.0, "pending": 0.0, "rejected": 0.0, "count": 0})
    for r in requests:
        bucket = by_type[str(r.get("leave_type") or "other").lower()]
        bucket["count"] += 1
        status = str(r.get("status") or "").lower()
        if status in ("approved", "pending", "rejected"):
            bucket[status] += float(r.get("days_requested") or 0)
    if by_type:
        rows: List[List[Any]] = [[
            Paragraph("Leave type", st["th"]), Paragraph("Requests", st["th_r"]),
            Paragraph("Approved days", st["th_r"]), Paragraph("Pending days", st["th_r"]),
            Paragraph("Rejected days", st["th_r"]),
        ]]
        for key in sorted(by_type, key=lambda k: -by_type[k]["approved"]):
            b = by_type[key]
            rows.append([
                Paragraph(_type_label(key), st["td"]), Paragraph(str(int(b["count"])), st["td_r"]),
                Paragraph(_days(b["approved"]), st["td_r"]), Paragraph(_days(b["pending"]), st["td_r"]),
                Paragraph(_days(b["rejected"]), st["td_r"]),
            ])
        rows.append([
            Paragraph("Total", st["td_b"]), Paragraph(str(len(requests)), st["td_br"]),
            Paragraph(_days(approved_days), st["td_br"]),
            Paragraph(_days(sum(b["pending"] for b in by_type.values())), st["td_br"]),
            Paragraph(_days(sum(b["rejected"] for b in by_type.values())), st["td_br"]),
        ])
        summary = Table(rows, colWidths=[163, 90, 90, 90, 90])
        summary.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), NAVY),
            ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
            ("LINEABOVE", (0, -1), (-1, -1), 1.0, NAVY),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))
        story += [KeepTogether([Paragraph("Days by leave type", st["h2"]), Spacer(1, 4), summary]), Spacer(1, 14)]

    # Full history
    story += [Paragraph("Leave history", st["h2"]), Spacer(1, 4)]
    rows = [[
        Paragraph("#", st["th"]), Paragraph("Type", st["th"]), Paragraph("From", st["th"]),
        Paragraph("To", st["th"]), Paragraph("Days", st["th_r"]), Paragraph("Status", st["th"]),
        Paragraph("Reason &amp; decision", st["th"]),
    ]]
    for index, r in enumerate(requests, start=1):
        status = str(r.get("status") or "pending").lower()
        colour = STATUS_COLOURS.get(status, "#475569")
        detail = _text(r.get("reason"), "<i>No reason given</i>")
        if status == "approved" and (r.get("approved_by_name") or r.get("approved_at")):
            by = _text(r.get("approved_by_name"), "")
            when = _date(r.get("approved_at")) if r.get("approved_at") else ""
            detail += f"<br/><font size='6.8' color='#475569'>Approved{' by ' + by if by else ''}{' on ' + when if when else ''}</font>"
        if status == "rejected" and r.get("rejection_reason"):
            detail += f"<br/><font size='6.8' color='#B91C1C'>Declined: {_text(r['rejection_reason'])}</font>"
        rows.append([
            Paragraph(str(index), st["td"]),
            Paragraph(_type_label(r.get("leave_type")), st["td"]),
            Paragraph(_date(r.get("start_date")), st["td"]),
            Paragraph(_date(r.get("end_date")), st["td"]),
            Paragraph(_days(r.get("days_requested")), st["td_r"]),
            Paragraph(f"<font color='{colour}'><b>{escape(status.upper())}</b></font>", st["td"]),
            Paragraph(detail, st["td"]),
        ])
    if not requests:
        rows.append(["", Paragraph("No leave has been recorded for this employee in this period.", st["td"]), "", "", "", "", ""])
    history = Table(rows, colWidths=[24, 74, 62, 62, 32, 62, 207], repeatRows=1)
    zebra = [("BACKGROUND", (0, r), (-1, r), ZEBRA) for r in range(2, len(rows), 2)]
    if not requests:
        zebra.append(("SPAN", (1, 1), (-1, 1)))
    history.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        *zebra,
    ]))
    story += [history, Spacer(1, 10)]

    notes = [
        Paragraph(
            f"Annual leave remaining is the entitlement of {_days(entitlement)} days less approved annual leave "
            f"starting in {balance_year}. Days are as requested and approved; public holidays and weekends inside "
            "a request are not deducted automatically.",
            st["note"],
        ),
        Spacer(1, 18),
    ]

    def signer(label: str) -> List[Any]:
        return [
            Spacer(1, 18),
            Paragraph("_" * 30, st["sig"]),
            Paragraph(f"<b>{label}</b>", st["sig"]),
            Paragraph("Name, signature and date", st["sig"]),
        ]

    sign = Table([[signer("Employee"), signer("HR Manager"), signer("Director")]], colWidths=[174, 174, 175])
    sign.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether(notes + [sign]))

    def make_canvas(*args, **kwargs):
        canv = NumberedCanvas(*args, **kwargs)
        canv.invoice_ref = reference
        canv.doc_label = "Leave Record"
        canv.client_name = name
        canv.project_title = period
        canv.status_stamp = None
        canv.verification = None
        return canv

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=36, rightMargin=36, topMargin=36, bottomMargin=48,
                            title=f"Leave Record - {name}", author="Six Nine Construction (Pvt) Ltd")
    doc.build(story, canvasmaker=make_canvas)
    return buffer.getvalue()
