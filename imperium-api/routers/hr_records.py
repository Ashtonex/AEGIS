from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field

from core.database import get_db
from core.security import require_permission, get_current_user
from app.shared.pagination import ok

router = APIRouter()


class LeaveRequestCreate(BaseModel):
    employee_id: UUID
    leave_type: str = Field(min_length=1, max_length=40)
    start_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    end_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    days_requested: float = 1.0
    reason: Optional[str] = None


class LeaveDecision(BaseModel):
    decision: str = Field(min_length=1, max_length=40)
    reason: Optional[str] = None


@router.get("/leave")
async def list_leave_requests(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    employee_id: Optional[UUID] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List leave requests under the organization.
    """
    query_str = """
        SELECT lr.*, e.employee_name
        FROM hr.leave_requests lr
        JOIN hr.employees e ON e.id = lr.employee_id AND e.organization_id = lr.organization_id
        WHERE lr.organization_id = :org_id AND lr.is_deleted = false
    """
    params = {"org_id": user["org_id"]}
    if employee_id:
        query_str += " AND lr.employee_id = :employee_id"
        params["employee_id"] = employee_id
    if status_filter:
        query_str += " AND lr.status = :status"
        params["status"] = status_filter

    query_str += " ORDER BY lr.created_at DESC"

    result = await db.execute(text(query_str), params)
    items = [dict(row._mapping) for row in result]
    return ok(items, "Leave requests listed.")


@router.post("/leave", status_code=status.HTTP_201_CREATED)
async def create_leave_request(
    payload: LeaveRequestCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new leave request in hr.leave_requests.
    """
    # Verify employee
    emp = await db.execute(
        text(
            "SELECT 1 FROM hr.employees WHERE id = :id AND organization_id = :org_id AND is_deleted = false"
        ),
        {"id": payload.employee_id, "org_id": user["org_id"]},
    )
    if not emp.first():
        raise HTTPException(status_code=404, detail="Employee not found.")

    try:
        leave_id = (
            await db.execute(
                text("""
            INSERT INTO hr.leave_requests (
                organization_id, employee_id, leave_type, start_date, end_date,
                days_requested, reason, status, created_by
            ) VALUES (
                :org_id, :employee_id, :leave_type, CAST(:start_date AS date), CAST(:end_date AS date),
                :days_requested, :reason, 'pending', :user_id
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "employee_id": payload.employee_id,
                    "leave_type": payload.leave_type,
                    "start_date": payload.start_date,
                    "end_date": payload.end_date,
                    "days_requested": payload.days_requested,
                    "reason": payload.reason,
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        await db.commit()
        return ok({"id": str(leave_id)}, "Leave request submitted.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/leave/{leave_id}/decision")
async def decide_leave_request(
    leave_id: UUID,
    payload: LeaveDecision,
    user: dict = Depends(require_permission("hr.leave.approve")),
    db: AsyncSession = Depends(get_db),
):
    """
    Approve or reject a leave request.
    """
    result = await db.execute(
        text("""
        UPDATE hr.leave_requests
        SET status = :decision,
            approved_by = CASE WHEN :decision = 'approved' THEN :user_id ELSE approved_by END,
            approved_at = CASE WHEN :decision = 'approved' THEN NOW() ELSE approved_at END,
            rejection_reason = CASE WHEN :decision = 'rejected' THEN :reason ELSE NULL END,
            updated_at = NOW()
        WHERE id = :id AND organization_id = :org_id AND is_deleted = false
        RETURNING id
    """),
        {
            "id": leave_id,
            "decision": payload.decision,
            "reason": payload.reason,
            "user_id": user["user_id"],
            "org_id": user["org_id"],
        },
    )
    if not result.first():
        await db.rollback()
        raise HTTPException(status_code=404, detail="Leave request not found.")
    await db.commit()
    return ok({"id": str(leave_id)}, f"Leave request {payload.decision}.")
