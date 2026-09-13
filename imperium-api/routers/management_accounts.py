"""Management Accounts pack lifecycle + Project Portfolio/Health (Phase 11B).

Pack endpoints mirror the accounting-period lifecycle router shape
exactly - each transition is its own endpoint, gated by its own
permission key, delegating validation entirely to
app/services/finance/management_accounts_pack.py so the same rules
apply everywhere this could ever be called from.
"""

from datetime import date
from pathlib import Path
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.documents.renderers import ManagementAccountsPackPDFRenderer
from app.services.finance import management_accounts_pack as packs
from app.services.finance import project_portfolio
from app.services.finance.management_accounts_pack import ManagementAccountsError
from app.shared.pagination import ok
from core.config import settings
from core.database import get_db
from core.security import require_permission

router = APIRouter()


def _handle(exc: ManagementAccountsError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


class PackCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    period_start: date
    period_end: date


class PackReopenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1)


@router.post("/packs")
async def create_pack(
    payload: PackCreateRequest,
    user: dict = Depends(require_permission("finance.pack.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.create_pack(
            db, org_id=user["org_id"], user_id=user.get("user_id"),
            period_start=payload.period_start, period_end=payload.period_end,
        )
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack created.")


@router.get("/packs")
async def list_packs(
    user: dict = Depends(require_permission("finance.pack.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await packs.list_packs(db, org_id=user["org_id"])
    return ok(result, "Management accounts packs listed.", total=len(result))


@router.get("/packs/{pack_id}")
async def get_pack(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.get_pack(db, org_id=user["org_id"], pack_id=pack_id)
    except ManagementAccountsError as exc:
        _handle(exc)
    return ok(result, "Management accounts pack retrieved.")


@router.post("/packs/{pack_id}/recompute")
async def recompute_pack(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.recompute_pack(db, org_id=user["org_id"], pack_id=pack_id)
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack recomputed.")


@router.post("/packs/{pack_id}/submit-review")
async def submit_for_review(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.submit_for_review(db, org_id=user["org_id"], user_id=user.get("user_id"), pack_id=pack_id)
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack submitted for review.")


@router.post("/packs/{pack_id}/approve")
async def approve_pack(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.approve_pack(db, org_id=user["org_id"], user_id=user.get("user_id"), pack_id=pack_id)
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack approved.")


@router.post("/packs/{pack_id}/lock")
async def lock_pack(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.lock")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.lock_pack(db, org_id=user["org_id"], user_id=user.get("user_id"), pack_id=pack_id)
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack locked.")


@router.post("/packs/{pack_id}/reopen")
async def reopen_pack(
    pack_id: UUID,
    payload: PackReopenRequest,
    user: dict = Depends(require_permission("finance.pack.reopen")),
    db: AsyncSession = Depends(get_db),
):
    try:
        result = await packs.reopen_pack(
            db, org_id=user["org_id"], user_id=user.get("user_id"), pack_id=pack_id, reason=payload.reason
        )
        await db.commit()
    except ManagementAccountsError as exc:
        await db.rollback()
        _handle(exc)
    return ok(result, "Management accounts pack reopened.")


@router.get("/packs/{pack_id}/export-pdf")
async def export_pack_pdf(
    pack_id: UUID,
    user: dict = Depends(require_permission("finance.pack.read")),
    db: AsyncSession = Depends(get_db),
):
    try:
        pack = await packs.get_pack(db, org_id=user["org_id"], pack_id=pack_id)
    except ManagementAccountsError as exc:
        _handle(exc)

    output_dir = Path(settings.GENERATED_DOCUMENT_DIR) / "management-accounts"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{pack_id}.pdf"
    ManagementAccountsPackPDFRenderer().render_pdf(pack, str(output_path))
    return FileResponse(
        path=str(output_path),
        media_type="application/pdf",
        filename=f"management-accounts-{pack['period_start']}-to-{pack['period_end']}.pdf",
    )


@router.get("/portfolio")
async def get_portfolio(
    as_of_date: Optional[date] = Query(default=None),
    user: dict = Depends(require_permission("finance.portfolio.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await project_portfolio.list_project_portfolio(db, org_id=user["org_id"], as_of=as_of_date)
    return ok(result, "Project portfolio computed.", total=len(result))
