"""Public verification of AEGIS-signed documents (no login).

GET /api/v1/public/verify/{code} returns what the document claims (issuer,
type, number, counterparty, amount, issue date, file hash) and whether the
Ed25519 signature over that record still holds. The verify page compares the
hash with a PDF the visitor drops in, entirely in the browser.
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from slowapi.util import get_remote_address
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.documents.attestation import verify
from app.shared.pagination import ok
from core.database import get_db
from core.rate_limit import PUBLIC_READ_LIMIT, limiter

router = APIRouter()


@router.get("/{code}")
@limiter.limit(PUBLIC_READ_LIMIT, key_func=get_remote_address)
async def verify_document(request: Request, code: str, db: AsyncSession = Depends(get_db)):
    result = await verify(db, code)
    if not result:
        raise HTTPException(status_code=404, detail="No AEGIS document has this verification code.")
    return ok(result, "Document found.")
