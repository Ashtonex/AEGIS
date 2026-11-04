"""Regression tests for the shared SNC invoice PDF endpoint body.

Every ``/invoices/generate-pdf`` route (documents, fleet, projects, quotations)
delegates to ``invoice_pdf_response``; these tests pin its behaviour.
"""

import asyncio

import pytest
from fastapi import HTTPException

from app.services.documents.invoice_renderer import (
    allocate_invoice_number,
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


USER = {"org_id": "00000000-0000-0000-0000-000000000001", "user_id": "00000000-0000-0000-0000-000000000002"}


class _SigningResult:
    def scalar(self):
        return "Test Issuer"


class _SigningDb:
    """Records the SQL attestation runs; never touches a database."""

    def __init__(self):
        self.statements = []
        self.commits = 0

    async def execute(self, stmt, params=None):
        self.statements.append((str(stmt), params or {}))
        return _SigningResult()

    async def commit(self):
        self.commits += 1

    def attestation(self):
        inserts = [p for sql, p in self.statements if "INSERT INTO core.document_attestations" in sql]
        assert len(inserts) == 1
        return inserts[0]


def _pdf_text(pdf: bytes) -> str:
    import io

    import pypdf

    return "\n".join(page.extract_text() for page in pypdf.PdfReader(io.BytesIO(pdf)).pages)


def test_response_is_pdf_attachment():
    db = _SigningDb()
    response = asyncio.run(invoice_pdf_response(USD211, db=db, user=USER))
    assert response.media_type == "application/pdf"
    assert response.body.startswith(b"%PDF-")
    assert response.headers["content-disposition"] == 'attachment; filename="SNC_Invoice_USD211.pdf"'


def test_every_invoice_is_aegis_signed_and_recorded():
    import hashlib

    db = _SigningDb()
    response = asyncio.run(invoice_pdf_response(USD211, db=db, user=USER))
    code = response.headers["x-aegis-verification-code"]
    text = _pdf_text(response.body)
    assert "AEGIS SIGNED DOCUMENT" in text and code in text
    row = db.attestation()
    assert row["code"] == code
    assert row["document_type"] == "proforma_invoice"
    assert row["document_number"] == "USD211"
    assert row["counterparty"] == "Gold Coast Properties (Pvt) Ltd"
    assert row["sha256"] == hashlib.sha256(response.body).hexdigest()
    # The signed amount is the one printed in the amount-due banner.
    assert f"${float(row['amount']):,.2f}" in text
    assert row["amount"] == "88371.46"
    assert row["issued_by_name"] == "Test Issuer"
    assert db.commits == 1


def test_invoice_shows_both_websites():
    db = _SigningDb()
    text = _pdf_text(asyncio.run(invoice_pdf_response(USD211, db=db, user=USER)).body)
    assert "www.snc.co.zw" in text and "www.sixnineconstruction.com" in text


def test_unnumbered_invoice_is_signed_as_a_draft():
    db = _SigningDb()
    asyncio.run(invoice_pdf_response({"items": [{"description": "Works", "amount_excl_vat": 100}]}, db=db, user=USER))
    row = db.attestation()
    assert row["document_type"] == "draft_invoice" and row["document_number"] == "DRAFT"


def test_missing_items_and_amount_is_rejected_not_invented():
    db = _SigningDb()
    with pytest.raises(HTTPException) as exc:
        asyncio.run(invoice_pdf_response({"invoice_number": "X1", "client_name": "Acme"}, db=db, user=USER))
    assert exc.value.status_code == 422
    assert db.statements == []  # nothing is attested for a document that was never issued


def test_non_list_items_rejected():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(invoice_pdf_response({"items": "nope"}, db=_SigningDb(), user=USER))
    assert exc.value.status_code == 422


def test_filename_is_sanitised():
    assert invoice_pdf_filename({"invoice_number": "../../etc/passwd"}) == "SNC_Invoice_etcpasswd.pdf"
    assert invoice_pdf_filename({}) == "SNC_Invoice_draft.pdf"


def test_renders_without_optional_client_fields():
    pdf = render_invoice_pdf_bytes({"items": [{"description": "Works", "amount_excl_vat": 100}]})
    assert pdf.startswith(b"%PDF-")


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one(self):
        return self._value


class _FakeDb:
    """Mimics the ON CONFLICT upsert on core.sequences."""

    def __init__(self, last_value=None):
        self.last_value = last_value
        self.commits = 0

    async def execute(self, _stmt, params):
        floor = params["floor"]
        self.last_value = floor if self.last_value is None else max(self.last_value + 1, floor)
        return _FakeResult(self.last_value)

    async def commit(self):
        self.commits += 1


def test_invoice_numbers_start_above_numbers_in_circulation_and_increment():
    db = _FakeDb()
    assert asyncio.run(allocate_invoice_number(db, "org")) == "USD214"
    assert asyncio.run(allocate_invoice_number(db, "org")) == "USD215"
    assert db.commits == 2


def test_invoice_number_floor_does_not_rewind_an_existing_counter():
    db = _FakeDb(last_value=500)
    assert asyncio.run(allocate_invoice_number(db, "org")) == "USD501"


def test_every_invoice_route_requires_an_issuer_permission():
    from fastapi.routing import APIRoute

    from routers import documents, fleet, projects, quotations

    routes = [
        r
        for module in (documents, fleet, projects, quotations)
        for r in module.router.routes
        if isinstance(r, APIRoute) and r.path.endswith(("/invoices/generate-pdf", "/invoices/next-number"))
    ]
    assert len(routes) == 5
    for route in routes:
        dep_names = {d.call.__qualname__ for d in route.dependant.dependencies}
        assert any("require_any_permission" in n for n in dep_names), route.path
