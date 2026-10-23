"""Regression tests for the shared SNC invoice PDF endpoint body.

Every ``/invoices/generate-pdf`` route (documents, fleet, projects, quotations)
delegates to ``invoice_pdf_response``; these tests pin its behaviour.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.services.documents.invoice_renderer import (
    invoice_pdf_filename,
    invoice_pdf_response,
    render_invoice_pdf_bytes,
)

USD211 = {
    "invoice_type": "PROFORMA INVOICE",
    "invoice_number": "USD211",
    "client_name": "Gold Coast Properties (Pvt) Ltd",
    "deposit_percentage": 40,
    "apply_vat": True,
    "vat_rate": 0.155,
    "items": [
        {"item_no": "1", "description": "Phase 1", "amount_excl_vat": 159108.90},
        {"item_no": "2", "description": "Phase 2", "amount_excl_vat": 32171.32},
    ],
}


def test_response_is_pdf_attachment():
    response = asyncio.run(invoice_pdf_response(USD211))
    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF-")
    assert response.headers["content-disposition"] == 'attachment; filename="SNC_Invoice_USD211.pdf"'


def test_missing_items_and_amount_is_rejected_not_invented():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(invoice_pdf_response({"invoice_number": "X1", "client_name": "Acme"}))
    assert exc.value.status_code == 422


def test_non_list_items_rejected():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(invoice_pdf_response({"items": "nope"}))
    assert exc.value.status_code == 422


def test_filename_is_sanitised():
    assert invoice_pdf_filename({"invoice_number": "../../etc/passwd"}) == "SNC_Invoice_etcpasswd.pdf"
    assert invoice_pdf_filename({}) == "SNC_Invoice_draft.pdf"


def test_renders_without_optional_client_fields():
    pdf = render_invoice_pdf_bytes({"items": [{"description": "Works", "amount_excl_vat": 100}]})
    assert pdf.startswith(b"%PDF-")
