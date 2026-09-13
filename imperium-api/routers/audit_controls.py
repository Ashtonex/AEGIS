"""Audit & Bankability Controls (Phase 12) - month-end close readiness and
the auditor drill-down workspace.

Deliberately a thin bundling layer: every piece here reuses an
already-shipped, already-tested function (general_ledger.get_journal,
general_ledger.get_audit_history, close_readiness.get_close_readiness/
resolve_journal_source) rather than re-querying live data itself.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.finance import close_readiness
from app.services.finance import general_ledger as gl
from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()


@router.get("/close-readiness")
async def get_close_readiness(
    period_id: Optional[UUID] = Query(default=None),
    user: dict = Depends(require_permission("finance.audit.read")),
    db: AsyncSession = Depends(get_db),
):
    result = await close_readiness.get_close_readiness(db, org_id=user["org_id"], period_id=period_id)
    return ok(result, "Close readiness computed.")


@router.get("/journals/{journal_id}")
async def get_journal_drill_down(
    journal_id: UUID,
    user: dict = Depends(require_permission("finance.audit.read")),
    db: AsyncSession = Depends(get_db),
):
    journal = await gl.get_journal(db, org_id=user["org_id"], journal_id=journal_id)
    if not journal:
        raise HTTPException(status_code=404, detail="Journal entry not found.")

    audit_history = await gl.get_audit_history(db, table_name="finance.journal_entries", record_id=journal_id)
    source = await close_readiness.resolve_journal_source(
        db, org_id=user["org_id"], source_type=journal.get("source_type"), source_id=journal.get("source_id")
    )

    return ok(
        {"journal": journal, "audit_history": audit_history, "source": source},
        "Journal drill-down retrieved.",
    )
