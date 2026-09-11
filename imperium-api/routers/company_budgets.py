from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok
from app.services.finance import company_budget as budgets
from app.services.finance.general_ledger import GeneralLedgerError

router = APIRouter()


class BudgetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    fiscal_year: int = Field(ge=2000, le=2100)
    label: str = Field(min_length=1, max_length=200)
    notes: Optional[str] = Field(default=None, max_length=2000)


class BudgetLineIn(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    department_id: Optional[UUID] = None
    line_type: str = Field(pattern=r"^(revenue|cost)$")
    category: str = Field(min_length=1, max_length=40)
    period_month: str
    amount: float = Field(ge=0)
    notes: Optional[str] = Field(default=None, max_length=1000)


class BudgetLinesReplace(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lines: list[BudgetLineIn]


class RejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=2000)


class FreezeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: Optional[str] = Field(default=None, max_length=2000)


class ReopenRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=2000)


class RevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    label: Optional[str] = Field(default=None, max_length=200)


def _raise(exc: GeneralLedgerError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("")
async def list_budgets(
    fiscal_year: Optional[int] = Query(default=None),
    user: dict = Depends(require_permission("finance.company_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await budgets.list_budgets(db, org_id=user["org_id"], fiscal_year=fiscal_year)
    return ok(items, "Company budgets listed.")


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_budget(
    payload: BudgetCreate,
    user: dict = Depends(require_permission("finance.company_budget.manage")),
    db: AsyncSession = Depends(get_db),
):
    budget = await budgets.create_budget(db, org_id=user["org_id"], user_id=user["sub"], fiscal_year=payload.fiscal_year, label=payload.label, notes=payload.notes)
    await db.commit()
    return ok(budget, "Company budget created as draft.")


@router.get("/{budget_id}")
async def get_budget(
    budget_id: UUID,
    user: dict = Depends(require_permission("finance.company_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    budget = await budgets.get_budget(db, org_id=user["org_id"], budget_id=budget_id)
    if not budget:
        raise HTTPException(status_code=404, detail="Company budget not found.")
    return ok(budget, "Company budget retrieved.")


@router.put("/{budget_id}/lines")
async def replace_lines(
    budget_id: UUID,
    payload: BudgetLinesReplace,
    user: dict = Depends(require_permission("finance.company_budget.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.replace_budget_lines(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id, lines=[line.model_dump() for line in payload.lines])
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget lines updated.")


@router.post("/{budget_id}/submit")
async def submit_budget(
    budget_id: UUID,
    user: dict = Depends(require_permission("finance.company_budget.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.submit_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget submitted for review.")


@router.post("/{budget_id}/start-review")
async def start_review(
    budget_id: UUID,
    user: dict = Depends(require_permission("finance.company_budget.approve")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.start_review(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget opened for review.")


@router.post("/{budget_id}/approve")
async def approve_budget(
    budget_id: UUID,
    user: dict = Depends(require_permission("finance.company_budget.approve")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.approve_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget approved as the fiscal year baseline.")


@router.post("/{budget_id}/reject")
async def reject_budget(
    budget_id: UUID,
    payload: RejectRequest,
    user: dict = Depends(require_permission("finance.company_budget.approve")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.reject_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id, reason=payload.reason)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget rejected back to draft.")


@router.post("/{budget_id}/cancel")
async def cancel_budget(
    budget_id: UUID,
    user: dict = Depends(require_permission("finance.company_budget.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.cancel_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget cancelled.")


@router.post("/{budget_id}/freeze")
async def freeze_budget(
    budget_id: UUID,
    payload: FreezeRequest,
    user: dict = Depends(require_permission("finance.company_budget.freeze")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.freeze_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id, reason=payload.reason)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget frozen.")


@router.post("/{budget_id}/reopen")
async def reopen_budget(
    budget_id: UUID,
    payload: ReopenRequest,
    user: dict = Depends(require_permission("finance.company_budget.reopen")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.reopen_budget(db, org_id=user["org_id"], user_id=user["sub"], budget_id=budget_id, reason=payload.reason)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Budget reopened.")


@router.post("/{budget_id}/revise")
async def create_revision(
    budget_id: UUID,
    payload: RevisionRequest,
    user: dict = Depends(require_permission("finance.company_budget.manage")),
    db: AsyncSession = Depends(get_db),
):
    try:
        budget = await budgets.create_revision(db, org_id=user["org_id"], user_id=user["sub"], source_budget_id=budget_id, label=payload.label)
        await db.commit()
    except GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(budget, "Revision created.")


@router.get("/variance/company")
async def company_variance(
    fiscal_year: int = Query(...),
    user: dict = Depends(require_permission("finance.company_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await budgets.get_company_variance(db, org_id=user["org_id"], fiscal_year=fiscal_year)
    return ok(result, "Company variance retrieved.")


@router.get("/variance/department/{department_id}")
async def department_variance(
    department_id: UUID,
    fiscal_year: int = Query(...),
    user: dict = Depends(require_permission("finance.company_budget.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await budgets.get_department_variance(db, org_id=user["org_id"], department_id=department_id, fiscal_year=fiscal_year)
    return ok(result, "Department variance retrieved.")
