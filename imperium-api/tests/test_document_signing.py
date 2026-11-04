"""Every PDF AEGIS issues carries the AEGIS signature strip and both websites."""

import io
import re
from datetime import date
from pathlib import Path

import pypdf

from app.services.documents.branding import FOOTER_LINE, WEBSITES
from app.services.documents.leave_renderer import render_leave_record_pdf
from app.services.documents.po_renderer import render_purchase_order_pdf
from app.services.documents.renderers import ManagementAccountsPackPDFRenderer

VERIFICATION = {"code": "SNC-ABCD-EFGH-JKMN", "url": "https://sixnineconstruction.com/verify/SNC-ABCD-EFGH-JKMN"}
ROUTERS = Path(__file__).resolve().parents[1] / "routers"


def _text(pdf: bytes) -> str:
    return "\n".join(page.extract_text() for page in pypdf.PdfReader(io.BytesIO(pdf)).pages)


def _assert_signed(text: str) -> None:
    assert "AEGIS SIGNED DOCUMENT" in text
    assert VERIFICATION["code"] in text


def _assert_websites(text: str) -> None:
    for site in WEBSITES:
        assert site in text, site


def test_footer_fits_beside_the_page_number():
    from reportlab.pdfbase.pdfmetrics import stringWidth

    # A4 width less margins, less room for "Page 10 of 10" at the right.
    assert stringWidth(FOOTER_LINE, "Helvetica", 7.5) < 595.27 - 72 - 50


def test_purchase_order_shows_signature_and_both_websites():
    po = {
        "po_number": "PO-000009", "status": "issued", "currency": "USD",
        "supplier": {"supplier_name": "Halsteds"},
        "lines": [{"description": "Cement", "quantity": 10, "unit_price": 12, "line_total": 120}],
        "subtotal": 120, "tax_amount": 0, "total_amount": 120,
    }
    text = _text(render_purchase_order_pdf(po, None, VERIFICATION))
    _assert_signed(text)
    _assert_websites(text)


def test_leave_record_is_signed():
    employee = {"employee_name": "Tendai Moyo", "employee_number": "SNC-014", "annual_leave_days": 22}
    requests = [{
        "leave_type": "annual", "start_date": date(2026, 3, 2), "end_date": date(2026, 3, 6),
        "days_requested": 5, "status": "approved", "approved_by_name": "HR",
    }]
    pdf = render_leave_record_pdf(
        employee, requests, year=2026, balance_year=2026, annual_taken=5, verification=VERIFICATION,
    )
    text = _text(pdf)
    _assert_signed(text)
    _assert_websites(text)


def test_management_accounts_pack_is_signed():
    buffer = io.BytesIO()
    ManagementAccountsPackPDFRenderer().render_pdf(
        {"period_start": "2026-09-01", "period_end": "2026-09-30", "status": "locked"}, buffer, VERIFICATION,
    )
    text = _text(buffer.getvalue())
    _assert_signed(text)
    _assert_websites(text)


def test_every_pdf_route_signs_what_it_issues():
    """A router that returns a rendered PDF must attest it. New PDF routes
    that skip attestation fail here rather than shipping unsigned."""
    unsigned = []
    for path in ROUTERS.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        renders_pdf = re.search(r"render_\w*pdf|invoice_pdf_response|PDFRenderer\(\)", source)
        if renders_pdf and "attest_issue" not in source and "invoice_pdf_response" not in source:
            unsigned.append(path.name)
        if "invoice_pdf_response(" in source:
            for call in re.findall(r"invoice_pdf_response\([^)]*\)", source):
                if "db=db" not in call or "user=user" not in call:
                    unsigned.append(f"{path.name}: {call}")
    assert unsigned == []
