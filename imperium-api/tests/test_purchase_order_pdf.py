"""Six Nine branded purchase order PDF."""

import io

import pypdf
import pytest

from app.services.documents.po_renderer import OFFICIAL_STATUSES, STATUS_STAMPS, render_purchase_order_pdf

PO = {
    "po_number": "PO-000004",
    "status": "issued",
    "currency": "USD",
    "project_name": "Trout Beck Canopy Tour",
    "supplier": {"supplier_name": "Halsteds Mutare & Co <Pvt>", "address": "Mutare"},
    "lines": [{"description": 'Wire nails 2" to 6"', "quantity": 249, "unit_of_measure": "kg", "unit_price": 1.85, "line_total": 460.65}],
    "subtotal": 460.65,
    "tax_amount": 0,
    "total_amount": 460.65,
}


def _text(pdf: bytes) -> str:
    return "\n".join(page.extract_text() for page in pypdf.PdfReader(io.BytesIO(pdf)).pages)


def test_issued_po_renders_branded_without_stamp():
    text = _text(render_purchase_order_pdf(PO))
    assert "PURCHASE ORDER" in text and "PO-000004" in text and "SIX NINE CONSTRUCTION" in text
    assert "Halsteds Mutare & Co <Pvt>" in text  # markup characters are escaped, not swallowed
    assert "$460.65" in text
    assert not any(stamp in text for stamp in STATUS_STAMPS.values())


@pytest.mark.parametrize("status", ["draft", "approved", "cancelled"])
def test_unissued_po_is_stamped(status):
    assert status not in OFFICIAL_STATUSES
    text = _text(render_purchase_order_pdf({**PO, "status": status}))
    assert STATUS_STAMPS[status] in text


def test_long_po_paginates():
    lines = PO["lines"] * 60
    pdf = render_purchase_order_pdf({**PO, "lines": lines, "subtotal": 460.65 * 60, "total_amount": 460.65 * 60})
    assert len(pypdf.PdfReader(io.BytesIO(pdf)).pages) > 1


def test_pdf_route_requires_po_read_permission():
    from fastapi.routing import APIRoute

    from routers import procurement

    route = next(r for r in procurement.router.routes if isinstance(r, APIRoute) and r.path == "/purchase-orders/{po_id}/pdf")
    assert "GET" in route.methods
    assert any("require_permission" in d.call.__qualname__ for d in route.dependant.dependencies)
