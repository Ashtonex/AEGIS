"""AEGIS registered stationery: the register of printed books and leaves.

Generating books reserves a block of serial numbers per book type in one
atomic UPDATE (core.stationery_counters), so two people generating books at
once can never print the same serial. Each leaf gets a random 10-character
token; the QR code on the leaf is <PUBLIC_APP_URL>/q/<token>. The token is
the only thing the public scan endpoint accepts, so a QR code AEGIS did not
print resolves to nothing.

Book lifecycle:  generated -> printed -> issued -> completed
                 generated | printed -> cancelled   (never handed out)
                 issued -> lost                     (all its leaves blocked)
Leaf lifecycle:  blank -> captured -> approved      (capture/approval: phase 2)
                 blank | captured -> voided | spoiled
"""

from __future__ import annotations

import asyncio
import secrets
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.stationery.catalog import BOOK_TYPES, get_book_type
from app.services.stationery.render import LeafPrint, render_book
from core.config import settings

# Crockford base32 without I, L, O, U (same alphabet as attestation codes).
TOKEN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
TOKEN_LENGTH = 10
SPECIMEN_TOKEN = "SPECIMEN"

MAX_BOOKS_PER_BATCH = 50
MIN_LEAVES, MAX_LEAVES = 10, 200

BOOK_TRANSITIONS: Dict[str, Dict[str, str]] = {
    # action: {from_status: to_status}
    "printed": {"generated": "printed"},
    "issue": {"generated": "issued", "printed": "issued", "issued": "issued"},
    "completed": {"issued": "completed"},
    "lost": {"issued": "lost", "printed": "lost"},
    "cancelled": {"generated": "cancelled", "printed": "cancelled"},
}


class StationeryError(ValueError):
    """A request the register refuses (bad input or a disallowed transition)."""


# ── Tokens and links ─────────────────────────────────────────────────────────


def new_token() -> str:
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(TOKEN_LENGTH))


def normalize_token(raw: str) -> str:
    """Upper-case, drop separators, read O as 0 and I/L as 1. '' if malformed."""
    value = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())
    if value == SPECIMEN_TOKEN:
        return value
    value = value.replace("O", "0").replace("I", "1").replace("L", "1")
    if len(value) != TOKEN_LENGTH or any(ch not in TOKEN_ALPHABET for ch in value):
        return ""
    return value


def scan_url(token: str) -> str:
    """The link printed in a leaf's QR code. Upper case on purpose: an
    all-capitals URL fits QR alphanumeric mode, which needs a smaller, less
    dense code than byte mode (more robust on small forms and cheap paper).
    Scheme and host are case-insensitive; the web app serves /Q/ and /q/."""
    return f"{settings.PUBLIC_APP_URL.strip().rstrip('/').upper()}/Q/{token}"


def display_url(token: str) -> str:
    """The same link as people would type it, printed under the QR code."""
    host = settings.PUBLIC_APP_URL.strip().rstrip("/").split("://", 1)[-1].lower()
    return f"{host}/q/{token}"


def _iso(value: Any) -> Optional[str]:
    return value.isoformat() if isinstance(value, datetime) else value


def _row(row: Any) -> Dict[str, Any]:
    out = dict(row._mapping)
    for key, value in list(out.items()):
        if isinstance(value, uuid.UUID):
            out[key] = str(value)
        elif isinstance(value, datetime):
            out[key] = value.isoformat()
    return out


# ── Catalogue ────────────────────────────────────────────────────────────────


def list_book_types() -> List[Dict[str, Any]]:
    return [
        {
            "key": bt.key,
            "prefix": bt.prefix,
            "title": bt.title,
            "book_title": bt.book_title,
            "holder_group": bt.holder_group,
            "page_size": bt.page_size,
            "allowed_sizes": list(bt.allowed_sizes),
            "default_leaves": bt.default_leaves,
            "default_copies": bt.default_copies,
            "leaf_word": bt.leaf_word,
            "description": bt.description,
        }
        for bt in BOOK_TYPES.values()
    ]


async def specimen_pdf(book_type: str, page_size: Optional[str] = None) -> bytes:
    """One leaf of a book type, stamped SPECIMEN, with its cover: for checking
    the design and showing the printer. Nothing is registered."""
    bt = get_book_type(book_type)
    size = page_size or bt.page_size
    if size not in bt.allowed_sizes:
        raise StationeryError(f"{bt.book_title} can be printed on {', '.join(bt.allowed_sizes)} only.")
    book = {
        "book_label": bt.book_label(0),
        "first_label": bt.serial_label(0),
        "last_label": bt.serial_label(bt.default_leaves - 1),
        "leaf_count": bt.default_leaves,
        "copies": bt.default_copies,
    }
    leaf = LeafPrint(bt.serial_label(0), scan_url(SPECIMEN_TOKEN), 1, bt.default_leaves, bt.book_label(0))
    return await asyncio.to_thread(render_book, bt, size, book, [leaf], bt.default_copies, True, True)


# ── Generating books ─────────────────────────────────────────────────────────


async def generate_books(
    db: AsyncSession,
    user: Dict[str, Any],
    *,
    book_type: str,
    count: int,
    leaves_per_book: Optional[int] = None,
    copies: Optional[int] = None,
    page_size: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Register ``count`` new books of one type with consecutive serials.
    Returns the batch id and the books. The caller commits."""
    try:
        bt = get_book_type(book_type)
    except ValueError as exc:
        raise StationeryError(str(exc)) from None
    leaves = int(leaves_per_book or bt.default_leaves)
    copies = int(copies or bt.default_copies)
    size = page_size or bt.page_size
    if not 1 <= count <= MAX_BOOKS_PER_BATCH:
        raise StationeryError(f"Generate between 1 and {MAX_BOOKS_PER_BATCH} books at a time.")
    if not MIN_LEAVES <= leaves <= MAX_LEAVES:
        raise StationeryError(f"A book holds between {MIN_LEAVES} and {MAX_LEAVES} leaves.")
    if copies not in (1, 2, 3):
        raise StationeryError("Copies must be 1 (original only), 2 (duplicate) or 3 (triplicate).")
    if size not in bt.allowed_sizes:
        raise StationeryError(f"{bt.book_title} can be printed on {', '.join(bt.allowed_sizes)} only.")

    org_id = str(user["org_id"])
    user_id = user.get("user_id") or user.get("sub")
    total = count * leaves
    reserved = (
        await db.execute(
            text(
                """
                INSERT INTO core.stationery_counters (organization_id, book_type, last_serial, last_book_number)
                VALUES (CAST(:org AS uuid), :book_type, :total, :count)
                ON CONFLICT (organization_id, book_type) DO UPDATE
                   SET last_serial = core.stationery_counters.last_serial + EXCLUDED.last_serial,
                       last_book_number = core.stationery_counters.last_book_number + EXCLUDED.last_book_number,
                       updated_at = now()
                RETURNING last_serial, last_book_number
                """
            ),
            {"org": org_id, "book_type": bt.key, "total": total, "count": count},
        )
    ).one()
    first_serial = reserved.last_serial - total + 1
    first_book = reserved.last_book_number - count + 1
    batch_id = str(uuid.uuid4())

    books: List[Dict[str, Any]] = []
    for i in range(count):
        number = first_book + i
        start = first_serial + i * leaves
        end = start + leaves - 1
        book = (
            await db.execute(
                text(
                    """
                    INSERT INTO core.stationery_books
                        (organization_id, book_type, book_number, book_label, first_serial, last_serial,
                         leaf_count, copies, page_size, holder_group, status, batch_id, notes, created_by)
                    VALUES (CAST(:org AS uuid), :book_type, :number, :label, :first, :last,
                            :leaves, :copies, :size, :holder, 'generated', CAST(:batch AS uuid), :notes,
                            CAST(:user_id AS uuid))
                    RETURNING id, book_label, first_serial, last_serial
                    """
                ),
                {
                    "org": org_id,
                    "book_type": bt.key,
                    "number": number,
                    "label": bt.book_label(number),
                    "first": start,
                    "last": end,
                    "leaves": leaves,
                    "copies": copies,
                    "size": size,
                    "holder": bt.holder_group,
                    "batch": batch_id,
                    "notes": (notes or "").strip() or None,
                    "user_id": str(user_id) if user_id else None,
                },
            )
        ).one()
        serials = list(range(start, end + 1))
        await db.execute(
            text(
                """
                INSERT INTO core.stationery_leaves
                    (organization_id, book_id, book_type, serial, serial_label, leaf_index, token)
                SELECT CAST(:org AS uuid), CAST(:book_id AS uuid), :book_type, s.serial, s.label, s.idx, s.token
                FROM unnest(CAST(:serials AS integer[]), CAST(:labels AS text[]),
                            CAST(:idxs AS integer[]), CAST(:tokens AS text[]))
                     AS s(serial, label, idx, token)
                """
            ),
            {
                "org": org_id,
                "book_id": str(book.id),
                "book_type": bt.key,
                "serials": serials,
                "labels": [bt.serial_label(s) for s in serials],
                "idxs": list(range(1, leaves + 1)),
                "tokens": [new_token() for _ in serials],
            },
        )
        books.append(
            {
                "id": str(book.id),
                "book_label": book.book_label,
                "first_label": bt.serial_label(book.first_serial),
                "last_label": bt.serial_label(book.last_serial),
            }
        )
    return {"batch_id": batch_id, "book_type": bt.key, "books": books}


# ── Reading the register ─────────────────────────────────────────────────────

_BOOK_COLUMNS = """
    b.id, b.book_type, b.book_number, b.book_label, b.first_serial, b.last_serial, b.leaf_count,
    b.copies, b.page_size, b.holder_group, b.status, b.batch_id, b.issued_to_user_id, b.issued_to_name,
    b.issued_department, b.issued_at, b.printed_at, b.closed_at, b.closed_reason, b.notes, b.created_at,
    iu.full_name AS issued_to_user_name,
    COALESCE(lc.blank, 0) AS leaves_blank, COALESCE(lc.captured, 0) AS leaves_captured,
    COALESCE(lc.approved, 0) AS leaves_approved, COALESCE(lc.voided, 0) AS leaves_voided,
    COALESCE(lc.scanned, 0) AS leaves_scanned
"""

_BOOK_FROM = """
    FROM core.stationery_books b
    LEFT JOIN core.users iu ON iu.id = b.issued_to_user_id
    LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE l.status = 'blank') AS blank,
               count(*) FILTER (WHERE l.status = 'captured') AS captured,
               count(*) FILTER (WHERE l.status = 'approved') AS approved,
               count(*) FILTER (WHERE l.status IN ('voided', 'spoiled')) AS voided,
               count(*) FILTER (WHERE l.scan_count > 0) AS scanned
        FROM core.stationery_leaves l WHERE l.book_id = b.id
    ) lc ON true
"""


def _book_out(row: Any) -> Dict[str, Any]:
    out = _row(row)
    bt = BOOK_TYPES.get(out["book_type"])
    out["book_title"] = bt.book_title if bt else out["book_type"]
    out["first_label"] = bt.serial_label(out["first_serial"]) if bt else str(out["first_serial"])
    out["last_label"] = bt.serial_label(out["last_serial"]) if bt else str(out["last_serial"])
    return out


async def list_books(
    db: AsyncSession,
    org_id: str,
    *,
    book_type: Optional[str] = None,
    status: Optional[str] = None,
    holder_group: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    where = ["b.organization_id = CAST(:org AS uuid)"]
    params: Dict[str, Any] = {"org": org_id, "limit": max(1, min(int(limit), 500))}
    if book_type:
        where.append("b.book_type = :book_type")
        params["book_type"] = book_type
    if status:
        where.append("b.status = :status")
        params["status"] = status
    if holder_group:
        where.append("b.holder_group = :holder")
        params["holder"] = holder_group
    rows = (
        await db.execute(
            text(
                f"SELECT {_BOOK_COLUMNS} {_BOOK_FROM} WHERE {' AND '.join(where)} "
                "ORDER BY b.created_at DESC, b.book_type, b.book_number DESC LIMIT :limit"
            ),
            params,
        )
    ).all()
    return [_book_out(r) for r in rows]


async def get_book(db: AsyncSession, org_id: str, book_id: str, with_leaves: bool = True) -> Dict[str, Any]:
    row = (
        await db.execute(
            text(f"SELECT {_BOOK_COLUMNS} {_BOOK_FROM} WHERE b.organization_id = CAST(:org AS uuid) AND b.id = CAST(:id AS uuid)"),
            {"org": org_id, "id": book_id},
        )
    ).first()
    if not row:
        raise LookupError("Book not found.")
    book = _book_out(row)
    if with_leaves:
        leaves = (
            await db.execute(
                text(
                    """
                    SELECT id, serial, serial_label, leaf_index, status, captured_entity_type, captured_entity_id,
                           captured_at, voided_at, void_reason, scan_count, first_scanned_at, last_scanned_at
                    FROM core.stationery_leaves
                    WHERE book_id = CAST(:id AS uuid)
                    ORDER BY leaf_index
                    """
                ),
                {"id": book_id},
            )
        ).all()
        book["leaves"] = [_row(r) for r in leaves]
    return book


async def book_pdf(db: AsyncSession, org_id: str, book_id: str, cover: bool = True) -> tuple[bytes, str]:
    """The print-ready PDF of a registered book and its filename."""
    book = await get_book(db, org_id, book_id, with_leaves=False)
    bt = get_book_type(book["book_type"])
    leaves = (
        await db.execute(
            text("SELECT serial_label, leaf_index, token FROM core.stationery_leaves WHERE book_id = CAST(:id AS uuid) ORDER BY leaf_index"),
            {"id": book_id},
        )
    ).all()
    prints = [LeafPrint(r.serial_label, scan_url(r.token), r.leaf_index, book["leaf_count"], book["book_label"]) for r in leaves]
    pdf = await asyncio.to_thread(render_book, bt, book["page_size"], book, prints, book["copies"], cover)
    filename = f"{book['book_label'].replace(' ', '-')}_{book['first_label']}-{book['last_label']}.pdf"
    return pdf, filename


# ── Changing the register ────────────────────────────────────────────────────


async def update_book_status(
    db: AsyncSession,
    user: Dict[str, Any],
    book_id: str,
    *,
    action: str,
    issued_to_user_id: Optional[str] = None,
    issued_to_name: Optional[str] = None,
    issued_department: Optional[str] = None,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    """Move a book along its lifecycle. The caller commits."""
    org_id = str(user["org_id"])
    actor = user.get("user_id") or user.get("sub")
    if action not in BOOK_TRANSITIONS:
        raise StationeryError(f"Unknown action '{action}'.")
    current = (
        await db.execute(
            text("SELECT status FROM core.stationery_books WHERE organization_id = CAST(:org AS uuid) AND id = CAST(:id AS uuid) FOR UPDATE"),
            {"org": org_id, "id": book_id},
        )
    ).scalar()
    if current is None:
        raise LookupError("Book not found.")
    target = BOOK_TRANSITIONS[action].get(current)
    if target is None:
        raise StationeryError(f"A {current} book cannot be marked {action}.")

    params: Dict[str, Any] = {"org": org_id, "id": book_id, "status": target, "actor": str(actor) if actor else None}
    sets = ["status = :status", "updated_at = now()"]
    if action == "printed":
        sets.append("printed_at = now()")
    elif action == "issue":
        name = (issued_to_name or "").strip()
        if issued_to_user_id and not name:
            name = (
                await db.execute(
                    text("SELECT full_name FROM core.users WHERE id = CAST(:u AS uuid)"), {"u": issued_to_user_id}
                )
            ).scalar() or ""
        if not name:
            raise StationeryError("Say who the book is issued to.")
        sets += [
            "issued_to_user_id = CAST(:to_user AS uuid)",
            "issued_to_name = :to_name",
            "issued_department = :dept",
            "issued_at = now()",
            "issued_by = CAST(:actor AS uuid)",
            "printed_at = COALESCE(printed_at, now())",
        ]
        params.update({"to_user": issued_to_user_id or None, "to_name": name, "dept": (issued_department or "").strip() or None})
    else:
        if action in ("lost", "cancelled") and not (reason or "").strip():
            raise StationeryError("Give a reason.")
        if action == "cancelled":
            used = (
                await db.execute(
                    text("SELECT count(*) FROM core.stationery_leaves WHERE book_id = CAST(:id AS uuid) AND status <> 'blank'"),
                    {"id": book_id},
                )
            ).scalar()
            if used:
                raise StationeryError("This book has leaves in use; it cannot be cancelled.")
        sets += ["closed_at = now()", "closed_by = CAST(:actor AS uuid)", "closed_reason = :reason"]
        params["reason"] = (reason or "").strip() or None
    await db.execute(
        text(f"UPDATE core.stationery_books SET {', '.join(sets)} WHERE organization_id = CAST(:org AS uuid) AND id = CAST(:id AS uuid)"),
        params,
    )
    return await get_book(db, org_id, book_id, with_leaves=False)


async def void_leaf(db: AsyncSession, user: Dict[str, Any], leaf_id: str, *, reason: str, spoiled: bool = False) -> Dict[str, Any]:
    """Cancel one leaf (written VOID on paper). The caller commits."""
    if not (reason or "").strip():
        raise StationeryError("Give a reason for voiding the leaf.")
    actor = user.get("user_id") or user.get("sub")
    row = (
        await db.execute(
            text(
                """
                UPDATE core.stationery_leaves
                   SET status = :new_status, voided_at = now(), voided_by = CAST(:actor AS uuid),
                       void_reason = :reason, updated_at = now()
                 WHERE organization_id = CAST(:org AS uuid) AND id = CAST(:id AS uuid)
                   AND status IN ('blank', 'captured')
                RETURNING id, serial_label, status
                """
            ),
            {
                "org": str(user["org_id"]),
                "id": leaf_id,
                "new_status": "spoiled" if spoiled else "voided",
                "actor": str(actor) if actor else None,
                "reason": reason.strip(),
            },
        )
    ).first()
    if not row:
        raise StationeryError("Leaf not found, or it is already approved or voided.")
    return _row(row)


async def find_leaf(db: AsyncSession, org_id: str, query: str) -> Optional[Dict[str, Any]]:
    """Staff lookup by QR token, scan URL or printed serial (e.g. PV-000123)."""
    raw = str(query or "").strip()
    if "/q/" in raw.lower():
        raw = raw[raw.lower().rindex("/q/") + 3 :]
    token = normalize_token(raw)
    serial_label = raw.upper().replace(" ", "")
    row = (
        await db.execute(
            text(
                """
                SELECT l.id, l.serial_label, l.status, l.leaf_index, l.scan_count, l.token, l.captured_at,
                       l.voided_at, l.void_reason, b.id AS book_id, b.book_label, b.book_type, b.status AS book_status,
                       b.issued_to_name, b.issued_department
                FROM core.stationery_leaves l
                JOIN core.stationery_books b ON b.id = l.book_id
                WHERE l.organization_id = CAST(:org AS uuid)
                  AND (l.token = :token OR upper(l.serial_label) = :serial)
                LIMIT 1
                """
            ),
            {"org": org_id, "token": token or "-", "serial": serial_label},
        )
    ).first()
    if not row:
        return None
    out = _row(row)
    out["scan_url"] = scan_url(out.pop("token"))
    return out


# ── Public scan ──────────────────────────────────────────────────────────────

PUBLIC_MESSAGES = {
    "approved": "Genuine Six Nine Construction form, recorded and approved in AEGIS.",
    "recorded": "Genuine Six Nine Construction form, recorded in AEGIS and awaiting approval. It is not yet authorised.",
    "unrecorded": (
        "Genuine Six Nine Construction stationery, but this form has not been recorded in AEGIS. "
        "It is not valid until it is recorded and approved."
    ),
    "not_issued": "Genuine stationery from a book that has not been issued yet. Do not accept this form.",
    "voided": "This leaf was cancelled (VOID) in AEGIS. Do not accept this form.",
    "lost": "This book was reported lost or stolen. Do not accept this form; contact Six Nine Construction.",
    "cancelled": "This book was withdrawn and never issued. Do not accept this form.",
}


def _public_result(leaf_status: str, book_status: str) -> str:
    if book_status == "lost":
        return "lost"
    if book_status == "cancelled":
        return "cancelled"
    if leaf_status in ("voided", "spoiled"):
        return "voided"
    if book_status in ("generated", "printed"):
        return "not_issued"
    if leaf_status == "approved":
        return "approved"
    if leaf_status == "captured":
        return "recorded"
    return "unrecorded"


async def public_scan(db: AsyncSession, raw_token: str) -> Optional[Dict[str, Any]]:
    """What anyone scanning a leaf's QR code is told. Records the scan.
    Returns None when the token is not one AEGIS printed. The caller commits."""
    token = normalize_token(raw_token)
    if not token:
        return None
    if token == SPECIMEN_TOKEN:
        return {
            "result": "specimen",
            "message": "This is a design specimen. It is not a valid form.",
            "token": token,
        }
    leaf = (
        await db.execute(
            text(
                """
                UPDATE core.stationery_leaves
                   SET scan_count = scan_count + 1,
                       first_scanned_at = COALESCE(first_scanned_at, now()),
                       last_scanned_at = now()
                 WHERE token = :token
                RETURNING book_id, book_type, serial_label, leaf_index, status, captured_at,
                          scan_count, first_scanned_at
                """
            ),
            {"token": token},
        )
    ).first()
    if not leaf:
        return None
    book = (
        await db.execute(
            text(
                """
                SELECT book_label, status, holder_group, issued_department, issued_at, leaf_count
                FROM core.stationery_books WHERE id = :id
                """
            ),
            {"id": leaf.book_id},
        )
    ).one()
    bt = BOOK_TYPES.get(leaf.book_type)
    result = _public_result(leaf.status, book.status)
    return {
        "result": result,
        "message": PUBLIC_MESSAGES[result],
        "token": token,
        "issuer": "Six Nine Construction",
        "document_type": leaf.book_type,
        "document_title": bt.title.title() if bt else leaf.book_type,
        "serial_label": leaf.serial_label,
        "book_label": book.book_label,
        "leaf_index": leaf.leaf_index,
        "leaf_count": book.leaf_count,
        "holder": "Finance" if book.holder_group == "finance" else "Front Desk",
        "issued_department": book.issued_department,
        "issued_at": _iso(book.issued_at),
        "recorded_at": _iso(leaf.captured_at),
        "scan_count": leaf.scan_count,
        "first_scanned_at": _iso(leaf.first_scanned_at),
    }

