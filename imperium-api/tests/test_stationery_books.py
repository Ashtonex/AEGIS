"""AEGIS registered stationery: layouts, tokens and lifecycle rules (no DB)."""

import io

import pytest
from pypdf import PdfReader

from app.services.stationery import service
from app.services.stationery.catalog import BOOK_TYPES, copy_labels, get_book_type
from app.services.stationery.render import LayoutError, LeafPrint, render_book


def _book(bt, leaves=3, copies=None):
    return {
        "book_label": bt.book_label(12),
        "first_label": bt.serial_label(551),
        "last_label": bt.serial_label(550 + leaves),
        "leaf_count": leaves,
        "copies": copies or bt.default_copies,
    }


@pytest.mark.parametrize("key,size", [(k, s) for k, bt in BOOK_TYPES.items() for s in bt.allowed_sizes])
def test_every_book_type_fits_every_allowed_size(key, size):
    bt = BOOK_TYPES[key]
    leaves = [
        LeafPrint(bt.serial_label(551 + i), "HTTPS://SIXNINECONSTRUCTION.COM/Q/0123456789", i + 1, 3, bt.book_label(12))
        for i in range(3)
    ]
    pdf = render_book(bt, size, _book(bt), leaves, bt.default_copies, cover=True)
    reader = PdfReader(io.BytesIO(pdf))
    assert len(reader.pages) == 1 + 3 * bt.default_copies
    leaf_text = reader.pages[1].extract_text()
    assert bt.serial_label(551) in leaf_text
    assert "ORIGINAL" in leaf_text
    if bt.default_copies > 1:
        assert "DUPLICATE" in reader.pages[2].extract_text()
        assert bt.serial_label(551) in reader.pages[2].extract_text()


def test_a4_forms_cannot_be_printed_on_a5():
    bt = get_book_type("payment_voucher")
    with pytest.raises(LayoutError):
        render_book(bt, "A5", _book(bt), [], 2)


def test_serial_prefixes_are_unique_and_lpo_never_collides_with_aegis_po():
    prefixes = [bt.prefix for bt in BOOK_TYPES.values()]
    assert len(prefixes) == len(set(prefixes))
    assert get_book_type("purchase_order").prefix == "LPO"
    assert get_book_type("payment_voucher").serial_label(42) == "PV-000042"


def test_requested_page_sizes():
    assert {k for k, bt in BOOK_TYPES.items() if bt.page_size == "A4"} == {
        "payment_request",
        "payment_voucher",
        "purchase_order",
        "petty_cash_replenishment",
    }
    assert {bt.holder_group for bt in BOOK_TYPES.values()} == {"finance", "front_desk"}


def test_copy_labels():
    assert copy_labels(get_book_type("petty_cash_book"), 1) == ("ORIGINAL",)
    assert copy_labels(get_book_type("purchase_order"), 3)[1].endswith("SUPPLIER COPY")
    assert copy_labels(get_book_type("payment_voucher"), 3)[1].endswith("PAYEE COPY")


def test_tokens_are_random_and_normalised():
    tokens = {service.new_token() for _ in range(2000)}
    assert len(tokens) == 2000
    for token in list(tokens)[:50]:
        assert len(token) == 10 and service.normalize_token(token.lower()) == token
    assert service.normalize_token("k7m2-q9xw 4b") == "K7M2Q9XW4B"
    assert service.normalize_token("O1IL000000") == "0111000000"
    assert service.normalize_token("short") == ""
    assert service.normalize_token("UUUUUUUUUU") == ""  # U is not in the alphabet
    assert service.normalize_token("specimen") == "SPECIMEN"


def test_scan_url_uses_public_app_url_in_qr_alphanumeric_form(monkeypatch):
    from reportlab.graphics.barcode import qrencoder

    monkeypatch.setattr(service.settings, "PUBLIC_APP_URL", "https://sixnineconstruction.com/")
    url = service.scan_url("K7M2Q9XW4B")
    assert url == "HTTPS://SIXNINECONSTRUCTION.COM/Q/K7M2Q9XW4B"
    assert service.display_url("K7M2Q9XW4B") == "sixnineconstruction.com/q/K7M2Q9XW4B"
    # Alphanumeric mode keeps the code at version 3 (29 modules), not 4 (33).
    qr = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    qr.addData(url)
    qr.make()
    assert qr.getModuleCount() == 29


@pytest.mark.parametrize(
    "leaf,book,expected",
    [
        ("blank", "issued", "unrecorded"),
        ("captured", "issued", "recorded"),
        ("approved", "issued", "approved"),
        ("approved", "completed", "approved"),
        ("blank", "generated", "not_issued"),
        ("blank", "printed", "not_issued"),
        ("voided", "issued", "voided"),
        ("spoiled", "issued", "voided"),
        ("approved", "lost", "lost"),
        ("blank", "cancelled", "cancelled"),
    ],
)
def test_public_result(leaf, book, expected):
    assert service._public_result(leaf, book) == expected
    assert service.PUBLIC_MESSAGES[expected]


def test_book_transitions():
    t = service.BOOK_TRANSITIONS
    assert t["issue"]["printed"] == "issued"
    assert "issued" not in t["cancelled"]  # an issued book is lost or completed, never cancelled
    assert "completed" not in t["lost"]


@pytest.mark.asyncio
async def test_specimen_pdf_is_stamped_and_registers_nothing():
    pdf = await service.specimen_pdf("petty_cash_voucher")
    text = PdfReader(io.BytesIO(pdf)).pages[1].extract_text()
    assert "SPECIMEN" in text
    assert "/q/SPECIMEN" in text  # footer shows the typed form of the link
    with pytest.raises(service.StationeryError):
        await service.specimen_pdf("payment_voucher", "A5")
