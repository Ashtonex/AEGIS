"""Public procurement notices: status rules, public payload and the PO QR.

The database side (migration 283 triggers, backfill, SQL) is exercised end to
end by scripts/verify_procurement_notices.py against an isolated database.
"""

import io
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pypdf
import pytest

from app.services import procurement_notices as pn

NOW = datetime(2026, 11, 4, 9, 0, tzinfo=timezone.utc)
ROOT = Path(__file__).resolve().parents[1]


def status(rfq_status="issued", closing_days=5, pos=(), quiet_days=1):
    return pn.derive_status(
        rfq_status=rfq_status,
        closing_date=None if closing_days is None else NOW + timedelta(days=closing_days),
        po_statuses=list(pos),
        last_activity_at=NOW - timedelta(days=quiet_days),
        now=NOW,
    )


@pytest.mark.parametrize("kwargs, expected", [
    ({}, "open"),
    ({"closing_days": None}, "open"),
    ({"closing_days": -2}, "evaluating"),
    ({"closing_days": -2, "quiet_days": 40}, "evaluating"),  # closing date itself is recent movement
    ({"closing_days": -31, "quiet_days": 45}, "dormant"),
    ({"rfq_status": "closed"}, "dormant"),  # closed without an award
    ({"rfq_status": "cancelled"}, "cancelled"),
    ({"pos": ["issued"]}, "awarded"),
    ({"pos": ["issued"], "quiet_days": 30}, "dormant"),
    ({"pos": ["issued"], "quiet_days": 29}, "awarded"),
    ({"pos": ["partially_received"]}, "in_delivery"),
    ({"pos": ["received", "issued"]}, "in_delivery"),
    ({"pos": ["received", "invoiced"]}, "fulfilled"),
    ({"pos": ["closed"], "quiet_days": 400}, "fulfilled"),  # finished work never goes dormant
    ({"pos": ["cancelled", "received"]}, "fulfilled"),
    ({"pos": ["cancelled"]}, "open"),  # RFQ still open after its only order was cancelled
    ({"rfq_status": "closed", "pos": ["cancelled"]}, "cancelled"),
    ({"rfq_status": None, "closing_days": None, "pos": ["issued"]}, "awarded"),  # direct PO
    ({"rfq_status": None, "closing_days": None, "pos": ["cancelled"]}, "cancelled"),
])
def test_status_rules(kwargs, expected):
    assert status(**kwargs) == expected


def test_every_status_has_a_label_and_explanation():
    assert set(pn.STATUS_LABELS) == set(pn.STATUS_DESCRIPTIONS)
    assert pn.STATUS_LABELS["open"] == "Active" and pn.STATUS_LABELS["dormant"] == "Dormant"


def test_public_payload_has_no_money_supplier_or_notes():
    row = {
        "reference": "SNC-PN-2026-0007", "rfq_id": None, "purchase_order_id": "x", "po_title": None,
        "rfq_title": None, "rfq_description": "should not show for a PO", "project_name": "Willowton Civil",
        "po_statuses": ["issued"], "last_activity_at": NOW, "published_at": NOW, "awarded_at": NOW,
        "closing_date": None, "rfq_status": None,
        # Columns the public must never get, even if a query ever selected them:
        "total_amount": 1250, "supplier_name": "Halsteds", "notes": "internal",
    }
    out = pn.serialize(row, now=NOW)
    assert out["title"] == "Supply order - Willowton Civil"
    assert out["description"] is None and out["type"] == "Direct purchase order"
    assert out["contact_email"] == "procurement@sixnineconstruction.com"
    assert not {"total_amount", "supplier_name", "notes", "amount", "supplier"} & set(out)
    assert "Halsteds" not in repr(out) and "1250" not in repr(out)


def test_public_sql_never_selects_amounts_or_suppliers():
    sql = pn.NOTICE_SQL.lower()
    for column in ("total_amount", "subtotal", "supplier", "notes", "rfq_responses"):
        assert column not in sql, column


def test_po_qr_opens_the_notice_but_prints_the_verify_link():
    from app.services.documents.attestation import notice_verification
    from app.services.documents.po_renderer import render_purchase_order_pdf

    base = {"code": "SNC-ABCD-EFGH-JKMN", "url": "https://sixnineconstruction.com/verify/SNC-ABCD-EFGH-JKMN"}
    v = notice_verification(base, "SNC-PN-2026-0003")
    assert v["url"] == "https://sixnineconstruction.com/tenders/SNC-PN-2026-0003?code=SNC-ABCD-EFGH-JKMN"
    assert v["verify_url"] == base["url"] and v["code"] == base["code"]

    po = {
        "po_number": "PO-000009", "status": "issued", "supplier": {"supplier_name": "Halsteds"},
        "notice_reference": "SNC-PN-2026-0003",
        "lines": [{"description": "Cement", "quantity": 10, "unit_price": 12, "line_total": 120}],
        "subtotal": 120, "tax_amount": 0, "total_amount": 120,
    }
    text = " ".join(" ".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(render_purchase_order_pdf(po, None, v))).pages).split())
    assert "Public notice: SNC-PN-2026-0003" in text
    assert "Procurement notice SNC-PN-2026-0003" in text
    assert base["url"] in text  # the printed link stays the plain verification page
    assert "procurement@sixnineconstruction.com" in text


def test_migration_keeps_drafts_private_and_hides_test_records():
    sql = (ROOT / "migrations" / "283_procurement_public_notices.sql").read_text(encoding="utf-8")
    assert "NEW.status IN ('draft', 'approved')" in sql
    assert "NEW.status = 'draft'" in sql
    assert "ILIKE '%TEST%'" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql


def test_routes_are_wired():
    from fastapi.routing import APIRoute

    from routers import procurement, public_intake

    public = {r.path for r in public_intake.router.routes if isinstance(r, APIRoute)}
    assert {"/tenders", "/tenders/{reference}"} <= public
    route = next(r for r in procurement.router.routes if isinstance(r, APIRoute) and r.path == "/notices/{reference}/visibility")
    assert any("require_any_permission" in d.call.__qualname__ for d in route.dependant.dependencies)
