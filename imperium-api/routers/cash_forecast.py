from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok
from app.services.finance import cash_position

router = APIRouter()


@router.get("")
async def get_cash_forecast(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await cash_position.compute_cash_forecast(db, user["org_id"])
    return ok(result, "Cash forecast computed.")


@router.get("/runway")
async def get_runway(
    user: dict = Depends(require_permission("finance.cash.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await cash_position.compute_cash_runway(db, user["org_id"])
    return ok(result, "Cash runway computed.")
