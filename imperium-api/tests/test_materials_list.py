"""Materials list import (text extraction) and project materials status."""

import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from starlette.datastructures import Headers

from routers import procurement

USER = {"org_id": "org", "sub": "u1"}


def _upload(content: bytes, filename: str) -> UploadFile:
    return UploadFile(file=io.BytesIO(content), filename=filename, headers=Headers({}))


def _pdf(lines):
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    for line in lines:
        c.drawString(40, y, line)
        y -= 16
    c.save()
    return buf.getvalue()


def test_pdf_text_is_extracted():
    pdf = _pdf(["Troutbeck canopy tour", "*Gum poles 8mx150 dia. - 60", "*Wire nails 6inch - 45kg"])
    result = asyncio.run(procurement.extract_materials_list_text(file=_upload(pdf, "Canopy tour .pdf"), user=USER))
    text = result["data"]["text"]
    assert "Gum poles 8mx150 dia." in text and "45kg" in text


def test_plain_text_and_csv_pass_through():
    result = asyncio.run(procurement.extract_materials_list_text(file=_upload(b"Cement - 120 bags\n", "list.txt"), user=USER))
    assert result["data"]["text"] == "Cement - 120 bags\n"


def test_rejects_other_files_and_oversized_uploads():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(procurement.extract_materials_list_text(file=_upload(b"PK\x03\x04", "list.xlsx"), user=USER))
    assert exc.value.status_code == 415
    big = b"a" * (procurement.MATERIALS_LIST_MAX_BYTES + 1)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(procurement.extract_materials_list_text(file=_upload(big, "list.txt"), user=USER))
    assert exc.value.status_code == 413


def test_scanned_pdf_without_text_is_explained():
    with pytest.raises(HTTPException) as exc:
        asyncio.run(procurement.extract_materials_list_text(file=_upload(_pdf([]), "scan.pdf"), user=USER))
    assert exc.value.status_code == 422
    assert "Paste the list" in exc.value.detail


def test_materials_routes_are_permission_gated():
    from fastapi.routing import APIRoute

    want = {"/materials-list/extract-text": "POST", "/projects/{project_id}/materials": "GET"}
    for route in procurement.router.routes:
        if isinstance(route, APIRoute) and route.path in want:
            assert want.pop(route.path) in route.methods
            assert any("require_permission" in d.call.__qualname__ for d in route.dependant.dependencies)
    assert not want
