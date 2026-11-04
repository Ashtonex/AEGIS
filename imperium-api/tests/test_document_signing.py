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


RECEIPT = {
    "transaction_number": "CB-000231", "transaction_date": date(2026, 11, 3), "amount": "73508.31",
    "currency": "USD", "counterparty_name": "Gold Coast Properties (Pvt) Ltd", "project_name": "Gold Coast Villas",
    "payment_method": "bank_transfer", "reference": "GCP-TT-8841", "account_name": "BancABC USD Main",
    "description": "Deposit for Phase 1", "recorded_by_name": "Cosmas", "issued_by_name": "Nyasha", "is_posted": True,
}


def test_payment_receipt_is_signed_and_lists_what_it_settles():
    from app.services.documents.receipt_renderer import FISCAL_NOTE, render_payment_receipt_pdf

    allocations = [{"claim_number": "PC-007", "allocated_amount": "60000", "fiscal_invoice_number": "FDMS-00012345"}]
    text = _text(render_payment_receipt_pdf(RECEIPT, allocations, VERIFICATION))
    _assert_signed(text)
    _assert_websites(text)
    assert "PAYMENT RECEIPT" in text and "CB-000231" in text and "$73,508.31" in text
    assert "Progress claim PC-007" in text and "FDMS-00012345" in text
    # The part not allocated to a claim is shown, so the lines add up to the amount received.
    assert "$13,508.31" in text and "held on account" in text
    assert "not a fiscal tax" in " ".join(text.split()) and FISCAL_NOTE.startswith("This receipt")


def test_unallocated_receipt_shows_its_description():
    from app.services.documents.receipt_renderer import render_payment_receipt_pdf

    text = _text(render_payment_receipt_pdf(RECEIPT, [], VERIFICATION))
    assert "Deposit for Phase 1" in text and "held on account" not in text


def test_unposted_receipt_is_stamped():
    from app.services.documents.receipt_renderer import UNPOSTED_STAMP, render_payment_receipt_pdf

    assert UNPOSTED_STAMP in _text(render_payment_receipt_pdf({**RECEIPT, "is_posted": False}))


def test_receipt_route_requires_cash_read_permission():
    from fastapi.routing import APIRoute

    from routers import financial_performance

    route = next(r for r in financial_performance.router.routes
                 if isinstance(r, APIRoute) and r.path == "/cashbook/{transaction_id}/receipt")
    assert "GET" in route.methods
    assert any("require_permission" in d.call.__qualname__ for d in route.dependant.dependencies)


def test_invoice_notes_match_the_invoice_type():
    from app.services.documents.invoice_renderer import default_invoice_notes

    tax = default_invoice_notes("TAX INVOICE", "USD230", "SNC-QT-2026-014", 40)
    assert tax[0] == "This tax invoice covers the 40% deposit on the quoted works, as set out in Quotation SNC-QT-2026-014."
    assert not any("fiscal tax invoice will be issued" in n for n in tax)

    proforma = default_invoice_notes("PROFORMA INVOICE", "USD231", "—", 0)
    assert proforma[0] == "This proforma invoice covers the works and services listed above."
    assert any("fiscal tax invoice will be issued" in n for n in proforma)
    assert not any("deposit" in n for n in proforma)
    assert default_invoice_notes("PROFORMA INVOICE", "USD232", "Q1", 12.5)[0].startswith("This proforma invoice covers the 12.5% deposit")
