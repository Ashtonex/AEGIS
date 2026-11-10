"""Print-ready PDFs for AEGIS registered stationery books.

One PDF per book: an optional cover, then every leaf in serial order with
its copies back to back (ORIGINAL, DUPLICATE ...) so the printer can collate
and bind straight from the file. Every leaf page carries:

  * the SNC letterhead and the form title,
  * the serial number in red and the book it belongs to,
  * a QR code that opens <PUBLIC_APP_URL>/q/<token> (unique per leaf, so it
    has to be printed digitally, not from a numbering-box litho plate),
  * a faded SNC logo watermark and a microtext security border, which
    breaks up on a photocopy,
  * the copy label, and a strip asking whoever captures it to scan it.

Layouts come from ``catalog.py``. A section marked as the line-item table
takes whatever height is left on the page, between a minimum and maximum
row height; if a form cannot fit, LayoutError is raised (tests render every
book type at every allowed size to catch that).
"""

from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence

from functools import lru_cache

from reportlab.graphics.barcode import qrencoder
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, A5, landscape
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.pdfgen.canvas import FILL_NON_ZERO

from app.services.documents.branding import ADDRESS_LINE, GENERAL_EMAIL, PHONES_LINE, WEBSITES_LINE
from app.services.stationery.catalog import (
    Amounts,
    BookType,
    Checks,
    Fields,
    Lines,
    Note,
    Signatures,
    Table,
    Title,
    copy_labels,
)

LOGO_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "assets", "logo.png"))

NAVY = colors.HexColor("#0B2F4E")
RED = colors.HexColor("#BE1E2D")
INK = colors.HexColor("#111827")
SLATE = colors.HexColor("#4B5563")
RULE = colors.HexColor("#9CA3AF")
HAIR = colors.HexColor("#D1D5DB")
TINT = colors.HexColor("#EEF2F7")
ZEBRA = colors.HexColor("#F7F9FC")

MICROTEXT = "SIX NINE CONSTRUCTION · AEGIS REGISTERED STATIONERY · "


class LayoutError(ValueError):
    """The form does not fit on the chosen page size."""


@dataclass(frozen=True)
class Profile:
    page: tuple
    margin: float
    header_h: float
    qr: float
    label_pt: float
    text_pt: float
    band_pt: float
    title_pt: float
    serial_pt: float
    field_h: float
    band_h: float
    row_min: float
    row_max: float
    line_h: float
    sig_h: float
    gap: float


PROFILES = {
    "A4": Profile(A4, 10 * mm, 28 * mm, 24 * mm, 6.2, 8.5, 7.2, 15, 15, 7.8 * mm, 5.2 * mm, 5.8 * mm, 8.0 * mm, 6.2 * mm, 8.0 * mm, 1.6 * mm),
    "A5": Profile(A5, 7.5 * mm, 25 * mm, 21 * mm, 5.0, 6.8, 6.0, 10.5, 11.5, 7.0 * mm, 4.4 * mm, 4.6 * mm, 6.5 * mm, 5.6 * mm, 7.2 * mm, 1.6 * mm),
    "A5L": Profile(landscape(A5), 7.5 * mm, 21.5 * mm, 19 * mm, 5.0, 6.8, 6.0, 10.5, 11.5, 7.0 * mm, 4.4 * mm, 5.0 * mm, 6.5 * mm, 5.6 * mm, 7.2 * mm, 1.6 * mm),
}


@dataclass(frozen=True)
class LeafPrint:
    serial_label: str
    url: str
    leaf_index: int  # 1-based position in the book
    leaf_count: int
    book_label: str


_logo_reader: Optional[ImageReader] = None
_mark_reader: Optional[ImageReader] = None
# The hexagon mark alone, without the name and strapline under it (the
# header prints the name as text). Pixel box within assets/logo.png.
MARK_BOX = (462, 0, 1428, 1100)


def _logo() -> Optional[ImageReader]:
    global _logo_reader
    if _logo_reader is None and os.path.exists(LOGO_PATH):
        _logo_reader = ImageReader(LOGO_PATH)
    return _logo_reader


def _mark() -> Optional[ImageReader]:
    global _mark_reader
    if _mark_reader is None and os.path.exists(LOGO_PATH):
        from PIL import Image

        with Image.open(LOGO_PATH) as img:
            _mark_reader = ImageReader(img.convert("RGBA").crop(MARK_BOX))
    return _mark_reader


def _fit(c: rl_canvas.Canvas, text: str, font: str, size: float, width: float, min_size: float = 4.0) -> float:
    """Largest font size <= size at which text fits width."""
    while size > min_size and c.stringWidth(text, font, size) > width:
        size -= 0.25
    return size


def _box(c: rl_canvas.Canvas, x: float, y: float, w: float, h: float, fill=None, stroke=RULE, width: float = 0.5) -> None:
    c.setLineWidth(width)
    c.setStrokeColor(stroke)
    if fill is not None:
        c.setFillColor(fill)
    c.rect(x, y, w, h, stroke=1, fill=1 if fill is not None else 0)


def _tick(c: rl_canvas.Canvas, x: float, y: float, size: float) -> None:
    c.setLineWidth(0.6)
    c.setStrokeColor(INK)
    c.rect(x, y, size, size, stroke=1, fill=0)


def _options(c: rl_canvas.Canvas, p: Profile, x: float, y: float, width: float, options: Sequence[str]) -> None:
    """Tick boxes laid out left to right from (x, y baseline)."""
    box = p.text_pt * 0.95
    font = "Helvetica"
    gap = box * 1.6
    total = sum(box + 3 + c.stringWidth(o, font, p.text_pt) + gap for o in options)
    size = p.text_pt if total <= width else p.text_pt * width / total
    box = size * 0.95
    cx = x
    for option in options:
        _tick(c, cx, y - 0.5, box)
        c.setFillColor(INK)
        c.setFont(font, size)
        c.drawString(cx + box + 3, y + 0.5, option)
        cx += box + 3 + c.stringWidth(option, font, size) + box * 1.6


# ── Section heights and drawing ──────────────────────────────────────────────


def _fields_heights(p: Profile, s: Fields) -> List[float]:
    return [p.field_h * (1.7 if i in s.tall else 1.0) for i in range(len(s.rows))]


def _height(p: Profile, s, width: float, c: rl_canvas.Canvas, row_h: float = 0.0) -> float:
    if isinstance(s, Fields):
        return sum(_fields_heights(p, s))
    if isinstance(s, Title):
        return p.band_h
    if isinstance(s, Table):
        return p.band_h + (s.rows + len(s.totals)) * row_h
    if isinstance(s, Amounts):
        return p.band_h + len(s.labels) * p.line_h
    if isinstance(s, Checks):
        rows = -(-len(s.items) // s.columns)
        return rows * p.line_h
    if isinstance(s, Lines):
        return s.count * p.line_h + (p.label_pt + 2 if s.count > 1 else 0)
    if isinstance(s, Signatures):
        return p.band_h * 0.85 + len(s.roles) * p.sig_h
    if isinstance(s, Note):
        lines = _wrap(c, s.text, "Helvetica-Oblique", p.label_pt + 0.6, width - 6)
        head = (p.label_pt + 4) if s.heading else 0
        return head + len(lines) * (p.label_pt + 2.4) + 3
    raise TypeError(type(s))


def _wrap(c: rl_canvas.Canvas, text: str, font: str, size: float, width: float) -> List[str]:
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = f"{line} {word}".strip()
        if c.stringWidth(trial, font, size) <= width:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def _draw_label(c: rl_canvas.Canvas, p: Profile, text: str, x: float, top: float, width: float) -> None:
    c.setFillColor(SLATE)
    size = _fit(c, text.upper(), "Helvetica-Bold", p.label_pt, width - 4)
    c.setFont("Helvetica-Bold", size)
    c.drawString(x + 2.2, top - size - 1.6, text.upper())


def _draw_fields(c: rl_canvas.Canvas, p: Profile, s: Fields, x0: float, top: float, width: float) -> float:
    y = top
    for row, h in zip(s.rows, _fields_heights(p, s)):
        spans = sum(f.span for f in row)
        cx = x0
        for f in row:
            w = width * f.span / spans
            _box(c, cx, y - h, w, h, fill=TINT if s.tint else colors.white)
            _draw_label(c, p, f.label, cx, y, w)
            if f.options:
                _options(c, p, cx + 2.5, y - h + 2.2, w - 5, f.options)
            cx += w
        y -= h
    return top - y


def _draw_band(c: rl_canvas.Canvas, p: Profile, text: str, x0: float, top: float, width: float, h: float) -> None:
    c.setFillColor(NAVY)
    c.rect(x0, top - h, width, h, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", p.band_pt)
    c.drawString(x0 + 3, top - h / 2 - p.band_pt * 0.35, text)


def _draw_heading(c: rl_canvas.Canvas, p: Profile, text: str, x0: float, top: float, width: float, h: float) -> None:
    """Section heading: red tab, navy capitals, navy rule underneath."""
    c.setFillColor(RED)
    c.rect(x0, top - h + 1.2, 2.2, h - 2.4, stroke=0, fill=1)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", p.band_pt + 0.6)
    c.drawString(x0 + 5.5, top - h / 2 - (p.band_pt + 0.6) * 0.35, text)
    c.setStrokeColor(NAVY)
    c.setLineWidth(0.8)
    c.line(x0, top - h + 0.4, x0 + width, top - h + 0.4)


def _draw_table(c: rl_canvas.Canvas, p: Profile, s: Table, x0: float, top: float, width: float, row_h: float) -> float:
    total_w = sum(col.weight for col in s.columns)
    widths = [width * col.weight / total_w for col in s.columns]
    # Header
    c.setFillColor(NAVY)
    c.rect(x0, top - p.band_h, width, p.band_h, stroke=0, fill=1)
    cx = x0
    for col, w in zip(s.columns, widths):
        size = _fit(c, col.header.upper(), "Helvetica-Bold", p.band_pt, w - 4)
        c.setFont("Helvetica-Bold", size)
        c.setFillColor(colors.white)
        ty = top - p.band_h / 2 - size * 0.35
        if col.align == "r":
            c.drawRightString(cx + w - 2.5, ty, col.header.upper())
        elif col.align == "c":
            c.drawCentredString(cx + w / 2, ty, col.header.upper())
        else:
            c.drawString(cx + 2.5, ty, col.header.upper())
        cx += w
    y = top - p.band_h
    # Body rows
    for i in range(s.rows):
        if i % 2 == 1:
            c.setFillColor(ZEBRA)
            c.rect(x0, y - row_h, width, row_h, stroke=0, fill=1)
        if s.numbered:
            c.setFillColor(SLATE)
            c.setFont("Helvetica", p.label_pt + 0.5)
            c.drawCentredString(x0 + widths[0] / 2, y - row_h / 2 - 2, str(i + 1))
        y -= row_h
    body_bottom = y
    c.setStrokeColor(HAIR)
    c.setLineWidth(0.4)
    for i in range(1, s.rows):
        yy = top - p.band_h - i * row_h
        c.line(x0, yy, x0 + width, yy)
    c.setStrokeColor(RULE)
    cx = x0
    for w in widths[:-1]:
        cx += w
        c.line(cx, top - p.band_h, cx, body_bottom)
    _box(c, x0, body_bottom, width, top - p.band_h - body_bottom, stroke=RULE, width=0.6)
    # Totals: label right-aligned across the leading columns, box in the money columns.
    # Totals go under the trailing run of money columns, except a unit price
    # (Received / Paid / Balance all get a box; Unit price / Amount only Amount).
    first_money = len(s.columns) - 1
    while first_money > 1 and s.columns[first_money - 1].align == "r" and not s.columns[first_money - 1].header.lower().startswith("unit"):
        first_money -= 1
    label_w = sum(widths[:first_money])
    for label in s.totals:
        size = _fit(c, label, "Helvetica-Bold", p.text_pt, label_w - 6)
        c.setFont("Helvetica-Bold", size)
        c.setFillColor(NAVY)
        c.drawRightString(x0 + label_w - 4, y - row_h / 2 - size * 0.35, label)
        bx = x0 + label_w
        for w in widths[first_money:]:
            _box(c, bx, y - row_h, w, row_h, fill=TINT, stroke=RULE, width=0.6)
            bx += w
        y -= row_h
    return top - y


def _draw_amounts(c: rl_canvas.Canvas, p: Profile, s: Amounts, x0: float, top: float, width: float) -> float:
    amount_w = width * 0.30
    _draw_band(c, p, "DESCRIPTION", x0, top, width - amount_w, p.band_h)
    _draw_band(c, p, "", x0 + width - amount_w, top, amount_w, p.band_h)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", p.band_pt)
    c.drawRightString(x0 + width - 3, top - p.band_h / 2 - p.band_pt * 0.35, s.amount_header.upper())
    y = top - p.band_h
    for label in s.labels:
        _box(c, x0, y - p.line_h, width - amount_w, p.line_h)
        _box(c, x0 + width - amount_w, y - p.line_h, amount_w, p.line_h)
        c.setFillColor(INK)
        c.setFont("Helvetica", p.text_pt)
        c.drawString(x0 + 3, y - p.line_h / 2 - p.text_pt * 0.35, label)
        y -= p.line_h
    return top - y


def _draw_checks(c: rl_canvas.Canvas, p: Profile, s: Checks, x0: float, top: float, width: float) -> float:
    col_w = width / s.columns
    box = p.text_pt * 0.95
    for i, item in enumerate(s.items):
        r, k = divmod(i, s.columns)
        x = x0 + k * col_w
        base = top - (r + 1) * p.line_h + (p.line_h - box) / 2
        c.setFillColor(INK)
        if isinstance(item, tuple):
            text, options = item
            size = _fit(c, text + ":", "Helvetica", p.text_pt, col_w * 0.68)
            c.setFont("Helvetica", size)
            c.drawString(x + 2, base + 0.5, text + ":")
            _options(c, p, x + col_w * 0.72, base, col_w * 0.28, options)
        else:
            _tick(c, x + 2, base - 0.5, box)
            size = _fit(c, item, "Helvetica", p.text_pt, col_w - box - 8)
            c.setFillColor(INK)
            c.setFont("Helvetica", size)
            c.drawString(x + box + 5, base + 0.5, item)
    rows = -(-len(s.items) // s.columns)
    return rows * p.line_h


def _draw_lines(c: rl_canvas.Canvas, p: Profile, s: Lines, x0: float, top: float, width: float) -> float:
    c.setFillColor(SLATE)
    c.setFont("Helvetica-Bold", p.label_pt)
    c.setStrokeColor(RULE)
    c.setLineWidth(0.5)
    if s.count == 1:
        label = s.label.upper() + ":"
        lw = c.stringWidth(label, "Helvetica-Bold", p.label_pt) + 5
        c.drawString(x0 + 1, top - p.line_h + 2.5, label)
        c.line(x0 + lw, top - p.line_h + 2, x0 + width, top - p.line_h + 2)
        return p.line_h
    c.drawString(x0 + 1, top - p.label_pt - 1, s.label.upper())
    y = top - p.label_pt - 2
    for _ in range(s.count):
        y -= p.line_h
        c.line(x0, y + 2, x0 + width, y + 2)
    return top - y


def _draw_signatures(c: rl_canvas.Canvas, p: Profile, s: Signatures, x0: float, top: float, width: float) -> float:
    head_h = p.band_h * 0.85
    role_w = width * 0.24
    rest = (width - role_w) / len(s.columns)
    weights = {"Name": 1.15, "Signature": 1.1, "Date": 0.75}
    total = sum(weights.get(col, 1.0) for col in s.columns)
    widths = [role_w] + [(width - role_w) * weights.get(col, 1.0) / total for col in s.columns]
    del rest
    c.setFillColor(TINT)
    c.rect(x0, top - head_h, width, head_h, stroke=0, fill=1)
    cx = x0
    for text, w in zip(("Role",) + tuple(s.columns), widths):
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", p.label_pt)
        c.drawString(cx + 2.5, top - head_h / 2 - p.label_pt * 0.35, text.upper())
        cx += w
    y = top - head_h
    for role in s.roles:
        cx = x0
        for j, w in enumerate(widths):
            _box(c, cx, y - p.sig_h, w, p.sig_h)
            if j == 0:
                size = _fit(c, role, "Helvetica-Bold", p.text_pt, w - 5)
                c.setFillColor(INK)
                c.setFont("Helvetica-Bold", size)
                c.drawString(cx + 2.5, y - p.sig_h / 2 - size * 0.35, role)
            cx += w
        y -= p.sig_h
    _box(c, x0, y, width, top - y, width=0.6)
    return top - y


def _draw_note(c: rl_canvas.Canvas, p: Profile, s: Note, x0: float, top: float, width: float) -> float:
    y = top
    if s.heading:
        c.setFillColor(NAVY)
        c.setFont("Helvetica-Bold", p.label_pt + 0.8)
        c.drawString(x0 + 1, y - p.label_pt - 2, s.heading)
        y -= p.label_pt + 4
    size = p.label_pt + 0.6
    c.setFont("Helvetica-Oblique", size)
    c.setFillColor(SLATE)
    for line in _wrap(c, s.text, "Helvetica-Oblique", size, width - 6):
        y -= p.label_pt + 2.4
        c.drawString(x0 + 1, y, line)
    return top - y + 3


def _draw_section(c, p, s, x0, top, width, row_h) -> float:
    if isinstance(s, Fields):
        return _draw_fields(c, p, s, x0, top, width)
    if isinstance(s, Title):
        _draw_heading(c, p, s.text, x0, top, width, p.band_h)
        return p.band_h
    if isinstance(s, Table):
        return _draw_table(c, p, s, x0, top, width, row_h)
    if isinstance(s, Amounts):
        return _draw_amounts(c, p, s, x0, top, width)
    if isinstance(s, Checks):
        return _draw_checks(c, p, s, x0, top, width)
    if isinstance(s, Lines):
        return _draw_lines(c, p, s, x0, top, width)
    if isinstance(s, Signatures):
        return _draw_signatures(c, p, s, x0, top, width)
    if isinstance(s, Note):
        return _draw_note(c, p, s, x0, top, width)
    raise TypeError(type(s))


# ── Page furniture ───────────────────────────────────────────────────────────


def _microtext_border(c: rl_canvas.Canvas, w: float, h: float, inset: float) -> None:
    """A frame drawn in 2.2 pt text: reads as a fine line, smudges on a copy."""
    size = 2.2
    c.saveState()
    c.setFillColor(NAVY)
    c.setFont("Helvetica", size)
    run = MICROTEXT * 40
    # top and bottom edges
    for y in (h - inset, inset - size * 0.7):
        c.saveState()
        p = c.beginPath()
        p.rect(inset, y - 1, w - 2 * inset, size + 2)
        c.clipPath(p, stroke=0, fill=0)
        c.drawString(inset, y, run)
        c.restoreState()
    # left and right edges (rotated)
    for x, angle in ((inset - 0.4, 90), (w - inset + 0.4, -90)):
        c.saveState()
        c.translate(x, inset if angle == 90 else h - inset)
        c.rotate(angle)
        p = c.beginPath()
        p.rect(0, -1, h - 2 * inset, size + 2)
        c.clipPath(p, stroke=0, fill=0)
        c.drawString(0, 0, run)
        c.restoreState()
    c.restoreState()


def _watermark(c: rl_canvas.Canvas, w: float, h: float) -> None:
    logo = _logo()
    if not logo:
        return
    c.saveState()
    try:
        c.setFillAlpha(0.055)
    except AttributeError:  # pragma: no cover - very old reportlab
        pass
    size = min(w, h) * 0.62
    iw, ih = logo.getSize()
    dh = size * ih / iw
    c.drawImage(logo, (w - size) / 2, (h - dh) / 2 - h * 0.03, width=size, height=dh, mask="auto")
    c.restoreState()


QR_BORDER = 4  # the standard 4-module quiet zone: 2 measurably hurts decoding on A5


@lru_cache(maxsize=512)
def _qr_runs(url: str) -> tuple:
    """(module count, dark runs as (row, first col, length)) for a QR code at
    error-correction level M. Cached: every copy of a leaf has the same code."""
    qr = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)
    qr.addData(url)
    qr.make()
    n = qr.getModuleCount()
    runs = []
    for r in range(n):
        col = 0
        while col < n:
            if qr.isDark(r, col):
                start = col
                while col < n and qr.isDark(r, col):
                    col += 1
                runs.append((r, start, col - start))
            else:
                col += 1
    return n, tuple(runs)


def _qr(c: rl_canvas.Canvas, url: str, x: float, y: float, size: float) -> None:
    """Draw the QR code as one filled path (fast, and crisp at any scale)."""
    n, runs = _qr_runs(url)
    box = size / (n + 2 * QR_BORDER)
    path = c.beginPath()
    bleed = box * 0.04  # overlap neighbouring runs: no hairline seams when rasterised
    for r, col, length in runs:
        path.rect(
            x + (col + QR_BORDER) * box - bleed,
            y + size - (r + 1 + QR_BORDER) * box - bleed,
            length * box + 2 * bleed,
            box + 2 * bleed,
        )
    c.saveState()
    c.setFillColor(colors.black)
    # Non-zero winding: the overlapping edges stay dark (even-odd, the
    # default, would punch white seams through every row).
    c.drawPath(path, stroke=0, fill=1, fillMode=FILL_NON_ZERO)
    c.restoreState()


def _form(c: rl_canvas.Canvas, name: str, draw) -> None:
    """Draw static artwork once per PDF as a form XObject, then reuse it on
    every page (the logo images are embedded and encoded only once)."""
    done = c.__dict__.setdefault("_aegis_forms", set())
    if name not in done:
        c.beginForm(name)
        draw()
        c.endForm()
        done.add(name)
    c.doForm(name)


def _display_url(url: str) -> str:
    """HTTPS://HOST/Q/TOKEN (as encoded in the QR) -> host/q/TOKEN."""
    head, sep, token = url.rpartition("/Q/") if "/Q/" in url else url.rpartition("/q/")
    host = head.split("://", 1)[-1].lower()
    return f"{host}/q/{token}" if sep else host


def _header(c: rl_canvas.Canvas, p: Profile, bt: BookType, leaf: LeafPrint, copy_label: str, w: float, h: float) -> float:
    m = p.margin
    top = h - m
    qr = p.qr
    # QR, top right, with the serial under it
    _qr(c, leaf.url, w - m - qr, top - qr, qr)
    # Logo and company block, top left
    logo = _mark()
    logo_h = p.header_h * 0.78
    text_x = m
    if logo:
        iw, ih = logo.getSize()
        logo_w = logo_h * iw / ih
        _form(c, "aegis_mark", lambda: c.drawImage(logo, m, top - logo_h, width=logo_w, height=logo_h, mask="auto"))
        text_x = m + logo_w + 2.5 * mm
    right_limit = w - m - qr - 3 * mm
    # Title, serial and book on the right, left of the QR
    title_pt = _fit(c, bt.title, "Helvetica-Bold", p.title_pt, (right_limit - text_x) * 0.62)
    right_w = max(
        c.stringWidth(bt.title, "Helvetica-Bold", title_pt),
        c.stringWidth(f"No. {leaf.serial_label}", "Courier-Bold", p.serial_pt),
    )
    detail_w = right_limit - right_w - 4 * mm - text_x
    c.setFillColor(NAVY)
    name_pt = _fit(c, "SIX NINE CONSTRUCTION", "Helvetica-Bold", p.title_pt * 0.82, detail_w)
    c.setFont("Helvetica-Bold", name_pt)
    c.drawString(text_x, top - name_pt - 1, "SIX NINE CONSTRUCTION")
    c.setFillColor(RED)
    tag_pt = max(p.label_pt - 0.2, 4)
    c.setFont("Helvetica-Oblique", tag_pt)
    c.drawString(text_x, top - name_pt - tag_pt - 3, "bringing your construction dreams to life")
    detail_pt = p.label_pt + 0.3
    c.setFillColor(SLATE)
    details = [ADDRESS_LINE, PHONES_LINE, f"{GENERAL_EMAIL} · {WEBSITES_LINE}"]
    dy = top - name_pt - tag_pt - 4
    for line in details:
        size = _fit(c, line, "Helvetica", detail_pt, detail_w, min_size=3.6)
        c.setFont("Helvetica", size)
        dy -= detail_pt + 1.3
        c.drawString(text_x, dy, line)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", title_pt)
    c.drawRightString(right_limit, top - title_pt, bt.title)
    c.setFillColor(RED)
    c.setFont("Courier-Bold", p.serial_pt)
    serial_y = top - title_pt - p.serial_pt - 2
    c.drawRightString(right_limit, serial_y, f"No. {leaf.serial_label}")
    c.setFillColor(SLATE)
    c.setFont("Helvetica", p.label_pt + 0.4)
    word = bt.leaf_word.capitalize()
    c.drawRightString(right_limit, serial_y - p.label_pt - 3, f"{leaf.book_label} · {word} {leaf.leaf_index} of {leaf.leaf_count}")
    # Copy label pill under the book line
    pill_pt = p.label_pt + 0.5
    pill_w = c.stringWidth(copy_label, "Helvetica-Bold", pill_pt) + 8
    pill_y = serial_y - 2 * p.label_pt - 9
    original = copy_label == "ORIGINAL"
    c.setFillColor(NAVY if original else RED)
    c.roundRect(right_limit - pill_w, pill_y, pill_w, pill_pt + 4, 2, stroke=0, fill=1)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", pill_pt)
    c.drawCentredString(right_limit - pill_w / 2, pill_y + 2.3, copy_label)
    # Scan hint under the QR
    c.setFillColor(SLATE)
    hint_pt = max(p.label_pt - 0.8, 3.8)
    c.setFont("Helvetica-Bold", hint_pt)
    c.drawCentredString(w - m - qr / 2, top - qr - hint_pt - 1, "SCAN TO VERIFY")
    bottom = top - p.header_h
    c.setStrokeColor(RED)
    c.setLineWidth(1.1)
    c.line(m, bottom + 1.5, w - m, bottom + 1.5)
    c.setStrokeColor(NAVY)
    c.setLineWidth(0.5)
    c.line(m, bottom, w - m, bottom)
    return bottom - p.gap


def _footer(c: rl_canvas.Canvas, p: Profile, bt: BookType, leaf: LeafPrint, w: float) -> float:
    """AEGIS capture strip and the verification footer; returns the top of it."""
    m = p.margin
    foot_pt = max(p.label_pt - 0.3, 4.2)
    y = m + 1
    c.setFillColor(SLATE)
    c.setFont("Helvetica", foot_pt)
    line2 = (
        f"AEGIS registered stationery · {leaf.serial_label} · {leaf.book_label}. "
        f"Verify: scan the QR code or visit {_display_url(leaf.url)}"
    )
    c.drawCentredString(w / 2, y, line2[:200])
    y += foot_pt + 2
    c.setFillColor(RED)
    c.setFont("Helvetica-Bold", foot_pt)
    c.drawCentredString(
        w / 2,
        y,
        "This form is valid only once it is recorded and approved in AEGIS. Never remove a leaf: write VOID across a spoilt one.",
    )
    y += foot_pt + 3
    # Capture strip
    strip_h = p.line_h
    _box(c, m, y, w - 2 * m, strip_h, fill=TINT, stroke=RULE, width=0.5)
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", p.label_pt)
    parts = ("AEGIS CAPTURE  —  Captured by:", "Date:", "AEGIS ref.:")
    widths = (0.46, 0.22, 0.32)
    x = m + 3
    inner = w - 2 * m - 6
    for part, frac in zip(parts, widths):
        c.drawString(x, y + strip_h / 2 - p.label_pt * 0.35, part)
        lw = c.stringWidth(part, "Helvetica-Bold", p.label_pt) + 3
        c.setStrokeColor(RULE)
        c.line(x + lw, y + 2.2, x + inner * frac - 6, y + 2.2)
        x += inner * frac
    return y + strip_h + p.gap


def _specimen(c: rl_canvas.Canvas, w: float, h: float) -> None:
    c.saveState()
    c.setFillColor(RED)
    try:
        c.setFillAlpha(0.14)
    except AttributeError:  # pragma: no cover
        pass
    c.setFont("Helvetica-Bold", min(w, h) * 0.11)
    c.translate(w / 2, h / 2)
    c.rotate(35)
    c.drawCentredString(0, 0, "SPECIMEN · NOT VALID")
    c.restoreState()


def _layout_row_height(c, p: Profile, bt: BookType, avail: float, width: float) -> float:
    fixed = 0.0
    table: Optional[Table] = None
    for s in bt.sections:
        if isinstance(s, Table):
            table = s
        else:
            fixed += _height(p, s, width, c)
        fixed += p.gap
    fixed -= p.gap
    if table is None:
        if fixed > avail + 0.5:
            raise LayoutError(f"{bt.key} needs {fixed / mm:.0f} mm but the page has {avail / mm:.0f} mm.")
        return 0.0
    rows = table.rows + len(table.totals)
    row_h = (avail - fixed - p.band_h) / rows
    if row_h < p.row_min - 0.01:
        raise LayoutError(
            f"{bt.key}: line-item rows would be {row_h / mm:.1f} mm, below the {p.row_min / mm:.1f} mm minimum."
        )
    return min(row_h, p.row_max)


def _stretched(c, p: Profile, bt: BookType, avail: float, width: float) -> Profile:
    """A form without a line-item table: grow its writing space (up to 30%)
    into the room left on the page instead of leaving it blank."""
    from dataclasses import replace

    fixed = sum(_height(p, s, width, c) for s in bt.sections) + p.gap * (len(bt.sections) - 1)
    stretchable = sum(
        _height(p, s, width, c) for s in bt.sections if isinstance(s, (Fields, Lines, Signatures, Checks))
    )
    if stretchable <= 0 or avail <= fixed:
        return p
    k = min(1.30, 1 + (avail - fixed) / stretchable)
    return replace(p, field_h=p.field_h * k, line_h=p.line_h * k, sig_h=p.sig_h * k)


def draw_leaf(c: rl_canvas.Canvas, bt: BookType, size_key: str, leaf: LeafPrint, copy_label: str, specimen: bool = False) -> None:
    p = PROFILES[size_key]
    w, h = p.page
    _form(c, "aegis_leaf_furniture", lambda: (_watermark(c, w, h), _microtext_border(c, w, h, p.margin * 0.45)))
    top = _header(c, p, bt, leaf, copy_label, w, h)
    bottom = _footer(c, p, bt, leaf, w)
    x0, width = p.margin, w - 2 * p.margin
    if not any(isinstance(s, Table) for s in bt.sections):
        p = _stretched(c, p, bt, top - bottom, width)
    row_h = _layout_row_height(c, p, bt, top - bottom, width)
    y = top
    for s in bt.sections:
        y -= _draw_section(c, p, s, x0, y, width, row_h) + p.gap
    if specimen:
        _specimen(c, w, h)


def draw_cover(c: rl_canvas.Canvas, bt: BookType, size_key: str, book: dict) -> None:
    p = PROFILES[size_key]
    w, h = p.page
    _microtext_border(c, w, h, p.margin * 0.45)
    logo = _logo()
    y = h - p.margin - 6 * mm
    if logo:
        iw, ih = logo.getSize()
        lw = min(w * 0.42, (h * 0.30) * iw / ih)
        lh = lw * ih / iw
        c.drawImage(logo, (w - lw) / 2, y - lh, width=lw, height=lh, mask="auto")
        y -= lh + 6 * mm
    scale = p.title_pt / 15
    y -= 20 * scale
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 26 * scale)
    c.drawCentredString(w / 2, y, bt.book_title.upper())
    y -= 13 * scale * mm / 2.2 + 6 * mm
    c.setFillColor(RED)
    c.setFont("Courier-Bold", 22 * scale)
    c.drawCentredString(w / 2, y, book["book_label"])
    y -= 9 * mm * scale
    c.setFillColor(INK)
    c.setFont("Helvetica", 11 * scale)
    word = "leaves" if bt.leaf_word == "leaf" else bt.leaf_word + "s"
    c.drawCentredString(
        w / 2,
        y,
        f"{book['first_label']}  to  {book['last_label']}  ·  {book['leaf_count']} {word}  ·  "
        f"{book['copies']} cop{'y' if book['copies'] == 1 else 'ies'} each",
    )
    y -= 12 * mm * scale
    # Holder box
    bw = w - 2 * p.margin - 16 * mm * scale
    bx = (w - bw) / 2
    rows = ("Issued to", "Department", "Date issued", "Issued by (Finance)")
    rh = 9 * mm * scale
    for i, label in enumerate(rows):
        _box(c, bx, y - (i + 1) * rh, bw, rh)
        c.setFillColor(SLATE)
        c.setFont("Helvetica-Bold", 7.5 * scale)
        c.drawString(bx + 3, y - i * rh - 7.5 * scale - 2, label.upper())
    y -= len(rows) * rh + 9 * mm * scale
    c.setFillColor(NAVY)
    c.setFont("Helvetica-Bold", 10 * scale)
    c.drawString(bx, y, "RULES FOR THIS BOOK")
    rules = (
        "This book is registered in AEGIS. Every leaf has its own serial number and QR code.",
        "Use the leaves in order. Never tear out or destroy a leaf: write VOID across every copy of a spoilt one and record it in AEGIS.",
        "A form is only valid once it is recorded and approved in AEGIS. Scan its QR code to record it, or to check it.",
        "Anyone handed one of these forms can scan the QR code to confirm it is a genuine SNC document.",
        "Report a lost or stolen book to Finance immediately so its leaves are blocked in AEGIS.",
    )
    c.setFont("Helvetica", 8.5 * scale)
    c.setFillColor(INK)
    for i, rule in enumerate(rules, 1):
        for j, line in enumerate(_wrap(c, f"{i}. {rule}", "Helvetica", 8.5 * scale, bw)):
            y -= 8.5 * scale + 3.5
            c.drawString(bx + (0 if j == 0 else 9 * scale), y, line)
    c.setFillColor(SLATE)
    c.setFont("Helvetica", 6.5 * scale)
    c.drawCentredString(w / 2, p.margin + 2, f"Six Nine Construction · {WEBSITES_LINE} · Generated by AEGIS")


def render_book(
    bt: BookType,
    size_key: str,
    book: dict,
    leaves: Iterable[LeafPrint],
    copies: int,
    cover: bool = True,
    specimen: bool = False,
) -> bytes:
    """The whole book as one PDF: cover, then each leaf's copies in turn."""
    if size_key not in bt.allowed_sizes:
        raise LayoutError(f"{bt.book_title} cannot be printed on {size_key}; use {', '.join(bt.allowed_sizes)}.")
    p = PROFILES[size_key]
    buf = io.BytesIO()
    c = rl_canvas.Canvas(buf, pagesize=p.page, pageCompression=1)
    c.setTitle(f"{bt.book_title} — {book['book_label']}")
    c.setAuthor("Six Nine Construction · AEGIS")
    c.setSubject(f"{book['first_label']} to {book['last_label']}")
    if cover:
        draw_cover(c, bt, size_key, book)
        c.showPage()
    labels = copy_labels(bt, copies)
    for leaf in leaves:
        for label in labels:
            draw_leaf(c, bt, size_key, leaf, label, specimen=specimen)
            c.showPage()
    c.save()
    return buf.getvalue()
