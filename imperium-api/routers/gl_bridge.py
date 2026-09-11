from datetime import date
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from core.database import get_db
from core.security import require_permission
from app.shared.pagination import ok
from app.services.finance import gl_bridge as bridge

router = APIRouter()


class MappingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    account_id: UUID


class RejectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    reason: str = Field(min_length=1, max_length=1000)


def _raise(exc: bridge.GeneralLedgerError):
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


@router.get("/mappings")
async def list_mappings(
    user: dict = Depends(require_permission("finance.gl_bridge.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await bridge.list_mappings(db, org_id=user["org_id"])
    return ok(items, "GL account mappings listed.")


@router.patch("/mappings/{mapping_key}")
async def update_mapping(
    mapping_key: str,
    payload: MappingUpdate,
    user: dict = Depends(require_permission("finance.gl_bridge.configure")),
    db: AsyncSession = Depends(get_db),
):
    try:
        mapping = await bridge.update_mapping(db, org_id=user["org_id"], mapping_key=mapping_key, account_id=payload.account_id)
        await db.commit()
    except bridge.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(mapping, "Mapping updated.")


@router.get("/proposals")
async def list_proposals(
    proposal_status: Optional[str] = Query(default="pending_review", alias="status"),
    user: dict = Depends(require_permission("finance.gl_bridge.read")),
    db: AsyncSession = Depends(get_db),
):
    items = await bridge.list_proposals(db, org_id=user["org_id"], proposal_status=proposal_status)
    return ok(items, "Proposed journals listed.")


@router.post("/cost-transactions/{cost_transaction_id}/propose", status_code=status.HTTP_201_CREATED)
async def propose_cost_transaction(
    cost_transaction_id: UUID,
    user: dict = Depends(require_permission("finance.gl_bridge.propose")),
    db: AsyncSession = Depends(get_db),
):
    try:
        journal = await bridge.propose_journal_for_cost_transaction(
            db, org_id=user["org_id"], user_id=user["sub"], cost_transaction_id=cost_transaction_id
        )
        await db.commit()
    except bridge.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "GL journal proposed.")


@router.post("/projects/{project_id}/sync")
async def sync_project(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.gl_bridge.propose")),
    db: AsyncSession = Depends(get_db),
):
    try:
        summary = await bridge.sync_project_cost_transactions(db, org_id=user["org_id"], user_id=user["sub"], project_id=project_id)
        await db.commit()
    except bridge.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(summary, "Project cost transactions synced to the GL bridge.")


@router.post("/proposals/{journal_id}/approve")
async def approve_proposal(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.gl_bridge.approve")),
    db: AsyncSession = Depends(get_db),
):
    try:
        journal = await bridge.approve_proposal(db, org_id=user["org_id"], user_id=user["sub"], journal_id=journal_id)
        await db.commit()
    except bridge.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "Proposal approved and posted.")


@router.post("/proposals/{journal_id}/reject")
async def reject_proposal(
    journal_id: UUID,
    payload: RejectRequest,
    user: dict = Depends(require_permission("finance.gl_bridge.reject")),
    db: AsyncSession = Depends(get_db),
):
    try:
        journal = await bridge.reject_proposal(db, org_id=user["org_id"], user_id=user["sub"], journal_id=journal_id, reason=payload.reason)
        await db.commit()
    except bridge.GeneralLedgerError as exc:
        await db.rollback()
        _raise(exc)
    return ok(journal, "Proposal rejected.")


@router.get("/projects/{project_id}/ledger")
async def project_ledger(
    project_id: UUID,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    lines = await bridge.get_project_ledger(db, org_id=user["org_id"], project_id=project_id, date_from=date_from, date_to=date_to)
    return ok(lines, "Project GL ledger retrieved.")


@router.get("/projects/{project_id}/reconciliation")
async def project_reconciliation(
    project_id: UUID,
    user: dict = Depends(require_permission("finance.gl.read")),
    db: AsyncSession = Depends(get_db),
):
    summary = await bridge.get_project_gl_reconciliation(db, org_id=user["org_id"], project_id=project_id)
    return ok(summary, "Project GL reconciliation retrieved.")
