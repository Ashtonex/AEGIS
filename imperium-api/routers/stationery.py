"""AEGIS registered stationery: print-ready books with a QR code on every leaf.

Staff (finance.stationery.*), mounted at /api/v1/finance/stationery:
    GET  /types                          book types and their defaults
    GET  /types/{key}/specimen           one-leaf SPECIMEN PDF (registers nothing)
    GET  /books                          the register, with leaf counts
    POST /books                          generate a batch of books (reserves serials)
    GET  /books/{id}                     one book and its leaves
    GET  /books/{id}/pdf                 the print-ready PDF of a book
    POST /books/{id}/status              printed | issue | completed | lost | cancelled
    POST /leaves/{id}/void               cancel one leaf
    GET  /lookup?q=                      find a leaf by QR link, token or serial

Public (no login), mounted at /api/v1/public/stationery:
    GET  /{token}                        what a scanned leaf is (genuine? recorded?)
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.stationery import service
from app.services.stationery.render import LayoutError
from app.shared.pagination import ok
from core.database import get_db
from core.rate_limit import PUBLIC_READ_LIMIT, limiter
from core.security import require_permission

router = APIRouter()
public_router = APIRouter()

READ = "finance.stationery.read"
MANAGE = "finance.stationery.manage"


def _pdf(content: bytes, filename: str, inline: bool = False) -> Response:
    disposition = "inline" if inline else "attachment"
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disposition}; filename="{filename}"', "Cache-Control": "no-store"},
    )


class GenerateBooks(BaseModel):
    book_type: str
    count: int = Field(1, ge=1, le=service.MAX_BOOKS_PER_BATCH)
    leaves_per_book: Optional[int] = Field(None, ge=service.MIN_LEAVES, le=service.MAX_LEAVES)
    copies: Optional[int] = Field(None, ge=1, le=3)
    page_size: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=500)


class BookStatusChange(BaseModel):
    action: str
    issued_to_user_id: Optional[str] = None
    issued_to_name: Optional[str] = Field(None, max_length=200)
    issued_department: Optional[str] = Field(None, max_length=200)
    reason: Optional[str] = Field(None, max_length=500)


class VoidLeaf(BaseModel):
    reason: str = Field(..., min_length=3, max_length=500)
    spoiled: bool = False


@router.get("/types")
async def book_types(user: dict = Depends(require_permission(READ))):
    return ok(service.list_book_types())


@router.get("/types/{book_type}/specimen")
async def book_type_specimen(
    book_type: str,
    page_size: Optional[str] = Query(None),
    user: dict = Depends(require_permission(READ)),
):
    try:
        pdf = await service.specimen_pdf(book_type, page_size)
    except (service.StationeryError, LayoutError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _pdf(pdf, f"SPECIMEN_{book_type}_{page_size or 'default'}.pdf", inline=True)


@router.get("/books")
async def list_books(
    book_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    holder_group: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: dict = Depends(require_permission(READ)),
    db: AsyncSession = Depends(get_db),
):
    books, total = await service.list_books(
        db, str(user["org_id"]), book_type=book_type, status=status, holder_group=holder_group, limit=limit, offset=offset
    )
    return ok(books, total=total)


@router.post("/books")
async def generate_books(
    body: GenerateBooks,
    user: dict = Depends(require_permission(MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await service.generate_books(
            db,
            user,
            book_type=body.book_type,
            count=body.count,
            leaves_per_book=body.leaves_per_book,
            copies=body.copies,
            page_size=body.page_size,
            notes=body.notes,
        )
    except service.StationeryError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    count = len(result["books"])
    return ok(result, f"{count} book{'s' if count != 1 else ''} registered.")


@router.get("/books/{book_id}")
async def get_book(book_id: str, user: dict = Depends(require_permission(READ)), db: AsyncSession = Depends(get_db)):
    try:
        return ok(await service.get_book(db, str(user["org_id"]), book_id))
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/books/{book_id}/pdf")
async def book_pdf(
    book_id: str,
    cover: bool = Query(True),
    user: dict = Depends(require_permission(MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    try:
        pdf, filename = await service.book_pdf(db, str(user["org_id"]), book_id, cover=cover)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return _pdf(pdf, filename)


@router.post("/books/{book_id}/status")
async def change_book_status(
    book_id: str,
    body: BookStatusChange,
    user: dict = Depends(require_permission(MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    try:
        book = await service.update_book_status(
            db,
            user,
            book_id,
            action=body.action,
            issued_to_user_id=body.issued_to_user_id,
            issued_to_name=body.issued_to_name,
            issued_department=body.issued_department,
            reason=body.reason,
        )
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except service.StationeryError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return ok(book, f"{book['book_label']} is now {book['status']}.")


@router.post("/leaves/{leaf_id}/void")
async def void_leaf(
    leaf_id: str,
    body: VoidLeaf,
    user: dict = Depends(require_permission(MANAGE)),
    db: AsyncSession = Depends(get_db),
):
    try:
        leaf = await service.void_leaf(db, user, leaf_id, reason=body.reason, spoiled=body.spoiled)
    except service.StationeryError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    await db.commit()
    return ok(leaf, f"{leaf['serial_label']} voided.")


@router.get("/lookup")
async def lookup_leaf(
    q: str = Query(..., min_length=3, max_length=300),
    user: dict = Depends(require_permission(READ)),
    db: AsyncSession = Depends(get_db),
):
    leaf = await service.find_leaf(db, str(user["org_id"]), q)
    if not leaf:
        raise HTTPException(status_code=404, detail="No registered leaf matches that QR code or serial number.")
    return ok(leaf)


@public_router.get("/{token}")
@limiter.limit(PUBLIC_READ_LIMIT, key_func=get_remote_address)
async def public_scan(request: Request, token: str, db: AsyncSession = Depends(get_db)):
    result = await service.public_scan(db, token)
    if not result:
        raise HTTPException(status_code=404, detail="This QR code was not issued by Six Nine Construction.")
    await db.commit()
    return ok(result, "Stationery found.")
