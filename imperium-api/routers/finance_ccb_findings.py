"""CCB (Commercial Control Brain) automated monitoring findings.

Read/acknowledge/resolve endpoints over finance.ccb_monitor_findings - the
open/resolved-lifecycle feed written by app/services/finance/ccb_monitor.py's
background checks. Deliberately separate from routers/quotations.py's manual
CCB tools (Commercial Guard, Document Change Watcher, Master Commercial
Brain evaluator), which answer "what did someone check"; this answers
"what is still an open problem right now."
"""

from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.shared.pagination import ok
from core.database import get_db
from core.security import require_permission

router = APIRouter()

_VALID_STATUSES = {"open", "acknowledged", "resolved"}
_VALID_CHECK_TYPES = {"budget_boq_overrun", "requisition_budget_breach", "variance_stale_approval"}


class FindingActionPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["acknowledge", "resolve"]


@router.get("/")
async def list_ccb_findings(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    check_type: Optional[str] = Query(default=None),
    project_id: Optional[UUID] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    user: dict = Depends(require_permission("finance.ccb_findings.read")),
    db: AsyncSession = Depends(get_db),
):
    """List automated CCB findings, most recently active first. Defaults to
    every status/check_type - the frontend panel is expected to default its
    own view to open+acknowledged and let a user opt into seeing resolved
    history, rather than the API silently hiding resolved rows."""
    if status_filter is not None and status_filter not in _VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"status must be one of {sorted(_VALID_STATUSES)}")
    if check_type is not None and check_type not in _VALID_CHECK_TYPES:
        raise HTTPException(status_code=422, detail=f"check_type must be one of {sorted(_VALID_CHECK_TYPES)}")

    result = await db.execute(
        text("""
            SELECT f.id, f.project_id, p.name AS project_title, f.check_type,
                   f.severity, f.status, f.summary, f.evidence,
                   f.first_detected_at, f.last_seen_at, f.resolved_at,
                   f.resolved_by, ru.full_name AS resolved_by_name
            FROM finance.ccb_monitor_findings f
            JOIN projects.projects p ON p.id = f.project_id
            LEFT JOIN core.users ru ON ru.id = f.resolved_by
            WHERE f.organization_id = :org_id AND f.is_deleted = false
              AND (CAST(:status AS varchar) IS NULL OR f.status = CAST(:status AS varchar))
              AND (CAST(:check_type AS varchar) IS NULL OR f.check_type = CAST(:check_type AS varchar))
              AND (CAST(:project_id AS uuid) IS NULL OR f.project_id = CAST(:project_id AS uuid))
            ORDER BY
                CASE f.status WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END,
                f.last_seen_at DESC
            LIMIT :limit
        """),
        {
            "org_id": user["org_id"],
            "status": status_filter,
            "check_type": check_type,
            "project_id": str(project_id) if project_id else None,
            "limit": limit,
        },
    )
    items = [dict(row._mapping) for row in result]

    counts_result = await db.execute(
        text("""
            SELECT status, COUNT(*) AS count
            FROM finance.ccb_monitor_findings
            WHERE organization_id = :org_id AND is_deleted = false
            GROUP BY status
        """),
        {"org_id": user["org_id"]},
    )
    counts = {row.status: row.count for row in counts_result}

    response = ok(items, "CCB findings listed.", total=len(items))
    response["meta"]["status_counts"] = counts
    return response


@router.patch("/{finding_id}")
async def update_ccb_finding(
    finding_id: UUID,
    payload: FindingActionPayload,
    user: dict = Depends(require_permission("finance.ccb_findings.resolve")),
    db: AsyncSession = Depends(get_db),
):
    """Acknowledge (someone has seen it, still tracking) or resolve (the
    underlying condition no longer needs attention) a finding. Both are
    manual overrides - the background checks will still auto-resolve or
    auto-reopen (per finding type's own logic) on their next run regardless
    of this action, except resolve which stops re-notification for a
    finding that stays open, matching the checks' own dedup rule."""
    existing = (
        await db.execute(
            text("""
                SELECT status FROM finance.ccb_monitor_findings
                WHERE id = :id AND organization_id = :org_id AND is_deleted = false
            """),
            {"id": finding_id, "org_id": user["org_id"]},
        )
    ).first()
    if not existing:
        raise HTTPException(status_code=404, detail="CCB finding not found.")
    if existing.status == "resolved" and payload.action == "acknowledge":
        raise HTTPException(status_code=409, detail="Cannot acknowledge a resolved finding.")

    if payload.action == "acknowledge":
        await db.execute(
            text("""
                UPDATE finance.ccb_monitor_findings
                SET status = 'acknowledged', last_seen_at = NOW()
                WHERE id = :id AND organization_id = :org_id
            """),
            {"id": finding_id, "org_id": user["org_id"]},
        )
        message = "Finding acknowledged."
    else:
        await db.execute(
            text("""
                UPDATE finance.ccb_monitor_findings
                SET status = 'resolved', resolved_at = NOW(), resolved_by = CAST(:user_id AS uuid), last_seen_at = NOW()
                WHERE id = :id AND organization_id = :org_id
            """),
            {"id": finding_id, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
        message = "Finding resolved."

    await db.commit()
    return ok({"id": str(finding_id), "status": "acknowledged" if payload.action == "acknowledge" else "resolved"}, message)
