"""Core GL-sourced financial statements (Phase 11A) - read-only.

Deliberately separate from routers/financial_performance.py's GET
/statements (a genuinely different, operational-table-based department
P&L) and from routers/general_ledger.py (accounts/periods/journals CRUD,
not report generation) - see
app/services/finance/financial_statements.py's module docstring.
"""

from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import financial_statements, general_ledger
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()


@router.get("/income-statement")
async def income_statement(
    period_start: date = Query(...),
    period_end: date = Query(...),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await financial_statements.get_income_statement(
        db, org_id=user["org_id"], period_start=period_start, period_end=period_end
    )
    return ok(result, "Income statement computed.")


@router.get("/balance-sheet")
async def balance_sheet(
    as_of_date: date = Query(...),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await financial_statements.get_balance_sheet(db, org_id=user["org_id"], as_of_date=as_of_date)
    return ok(result, "Balance sheet computed.")


@router.get("/cash-movement")
async def cash_movement(
    period_start: date = Query(...),
    period_end: date = Query(...),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await financial_statements.get_cash_movement_statement(
        db, org_id=user["org_id"], period_start=period_start, period_end=period_end
    )
    return ok(result, "Cash movement statement computed.")


@router.get("/ar-aging")
async def ar_aging(
    as_of_date: date = Query(default=None),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await financial_statements.get_ar_aging(db, org_id=user["org_id"], as_of_date=as_of_date)
    return ok(result, "AR aging computed.", total=len(result))


@router.get("/ap-aging")
async def ap_aging(
    as_of_date: date = Query(default=None),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await financial_statements.get_ap_aging(db, org_id=user["org_id"], as_of_date=as_of_date)
    return ok(result, "AP aging computed.", total=len(result))


@router.get("/trial-balance")
async def trial_balance(
    as_of_date: date = Query(default=None),
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    """Thin passthrough to general_ledger.get_trial_balance - surfaced here
    too since an executive looking for financial statements would expect
    to find the trial balance alongside them, not only on the separate
    General Ledger tab."""
    result = await general_ledger.get_trial_balance(db, org_id=user["org_id"], as_of_date=as_of_date)
    return ok(result, "Trial balance computed.", total=len(result))
