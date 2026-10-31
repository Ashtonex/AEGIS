from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, Field

from core.database import get_db
from core.security import require_permission, get_current_user
from app.shared.pagination import ok
from app.shared.events import emit_notification, emit_role_notification
from app.shared.hr_self_service import resolve_own_employee_id

router = APIRouter()


class LeaveRequestCreate(BaseModel):
    employee_id: UUID
    leave_type: str = Field(min_length=1, max_length=40)
    start_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    end_date: str = Field(min_length=10, max_length=10)  # YYYY-MM-DD
    days_requested: float = 1.0
    reason: Optional[str] = None


class MyLeaveRequestCreate(BaseModel):
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
    _: dict = Depends(require_permission("hr.leave.read")),
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
    user: dict = Depends(require_permission("hr.leave.create")),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new leave request in hr.leave_requests.
    """
    if payload.days_requested <= 0:
        raise HTTPException(status_code=400, detail="Days requested must be greater than zero.")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after start date.")

    # Verify employee
    emp = (
        await db.execute(
            text(
                "SELECT employee_name FROM hr.employees WHERE id = :id AND organization_id = :org_id AND is_deleted = false"
            ),
            {"id": payload.employee_id, "org_id": user["org_id"]},
        )
    ).first()
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found.")

    try:
        leave_id = (
            await db.execute(
                text("""
            INSERT INTO hr.leave_requests (
                organization_id, employee_id, leave_type, start_date, end_date,
                days_requested, reason, status, submitted_by, calendar_status, calendar_title, created_by
            ) VALUES (
                CAST(:org_id AS uuid), :employee_id, :leave_type, CAST(:start_date AS date), CAST(:end_date AS date),
                :days_requested, :reason, 'pending', CAST(:user_id AS uuid), 'pending', :calendar_title, CAST(:user_id AS uuid)
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "employee_id": payload.employee_id,
                    "leave_type": payload.leave_type,
                    "start_date": date.fromisoformat(payload.start_date),
                    "end_date": date.fromisoformat(payload.end_date),
                    "days_requested": payload.days_requested,
                    "reason": payload.reason,
                    "calendar_title": f"{emp.employee_name} - {payload.leave_type}"[:200],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        try:
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["HR Manager", "HR Officer"],
                title="New leave request",
                message=f"{emp.employee_name} requested {payload.days_requested} day(s) of {payload.leave_type} leave ({payload.start_date} to {payload.end_date}).",
                notification_type="hr_leave_request",
                action_url="/dashboard/hr",
                metadata={"leave_id": str(leave_id), "employee_id": str(payload.employee_id)},
            )
        except Exception:
            pass
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
    decision_val = str(payload.decision).lower().strip()
    if decision_val not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Decision must be 'approved' or 'rejected'.")

    result = (
        await db.execute(
            text("""
        UPDATE hr.leave_requests lr
        SET status = CAST(:decision AS varchar),
            calendar_status = CASE WHEN CAST(:decision AS varchar) = 'approved' THEN 'approved' WHEN CAST(:decision AS varchar) = 'rejected' THEN 'declined' ELSE calendar_status END,
            calendar_title = COALESCE(calendar_title, e.employee_name || ' - ' || lr.leave_type),
            approved_by = CASE WHEN CAST(:decision AS varchar) = 'approved' THEN CAST(:user_id AS uuid) ELSE approved_by END,
            approved_at = CASE WHEN CAST(:decision AS varchar) = 'approved' THEN NOW() ELSE approved_at END,
            rejection_reason = CASE WHEN CAST(:decision AS varchar) = 'rejected' THEN CAST(:reason AS text) ELSE NULL END,
            updated_at = NOW()
        FROM hr.employees e
        WHERE lr.id = CAST(:id AS uuid) AND lr.organization_id = CAST(:org_id AS uuid) AND lr.is_deleted = false
          AND e.id = lr.employee_id
        RETURNING lr.id, e.employee_name, e.linked_user_id
    """),
            {
                "id": leave_id,
                "decision": decision_val,
                "reason": payload.reason,
                "user_id": user["user_id"],
                "org_id": user["org_id"],
            },
        )
    ).first()
    if not result:
        await db.rollback()
        raise HTTPException(status_code=404, detail="Leave request not found.")
    if result.linked_user_id:
        try:
            await emit_notification(
                db,
                org_id=user["org_id"],
                user_id=str(result.linked_user_id),
                title=f"Leave request {decision_val}",
                message=f"Your leave request has been {decision_val}."
                + (f" Reason: {payload.reason}" if decision_val == "rejected" and payload.reason else ""),
                notification_type="hr_leave_decision",
                action_url="/dashboard/hr",
                metadata={"leave_id": str(leave_id)},
            )
        except Exception:
            pass
    await db.commit()
    return ok({"id": str(leave_id)}, f"Leave request {decision_val}.")


@router.get("/leave/balances")
async def list_leave_balances(
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.leave.read")),
):
    """One row per current employee: annual entitlement, leave taken in the year and what is pending."""
    balance_year = year or date.today().year
    rows = await db.execute(
        text("""
        SELECT e.id AS employee_id, e.employee_name, e.employee_number, e.job_title, e.employment_status,
               e.annual_leave_days,
               COALESCE(SUM(lr.days_requested) FILTER (
                   WHERE lr.status = 'approved' AND lr.leave_type = 'annual'
                     AND EXTRACT(YEAR FROM lr.start_date) = CAST(:year AS integer)), 0) AS annual_taken,
               COALESCE(SUM(lr.days_requested) FILTER (
                   WHERE lr.status = 'approved' AND EXTRACT(YEAR FROM lr.start_date) = CAST(:year AS integer)), 0) AS days_taken,
               COUNT(lr.id) FILTER (WHERE lr.status = 'pending') AS pending_count,
               COUNT(lr.id) AS request_count,
               MAX(lr.end_date) FILTER (WHERE lr.status = 'approved' AND lr.start_date <= CURRENT_DATE) AS last_leave_end,
               BOOL_OR(lr.status = 'approved' AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date) AS on_leave_today
        FROM hr.employees e
        LEFT JOIN hr.leave_requests lr
            ON lr.employee_id = e.id AND lr.organization_id = e.organization_id AND lr.is_deleted = false
        WHERE e.organization_id = :org_id AND e.is_deleted = false AND e.employment_status <> 'terminated'
        GROUP BY e.id
        ORDER BY e.employee_name
        """),
        {"org_id": user["org_id"], "year": balance_year},
    )
    items = []
    for row in rows.mappings():
        item = dict(row)
        for key in ("annual_taken", "days_taken"):
            item[key] = float(item[key] or 0)
        item["annual_remaining"] = float(item["annual_leave_days"] or 0) - item["annual_taken"]
        item["on_leave_today"] = bool(item["on_leave_today"])
        items.append(item)
    return ok({"year": balance_year, "people": items}, "Leave balances listed.")


@router.get("/leave/employee/{employee_id}/pdf")
async def download_employee_leave_record(
    employee_id: UUID,
    year: Optional[int] = Query(default=None, ge=2000, le=2100),
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    _: dict = Depends(require_permission("hr.leave.read")),
):
    """Branded PDF of one employee's leave: every request with dates, days, reason and decision."""
    employee = (
        await db.execute(
            text("""
            SELECT e.*, p.name AS position_name, d.name AS department_name
            FROM hr.employees e
            LEFT JOIN hr.positions p ON p.id = e.position_id AND p.organization_id = e.organization_id
            LEFT JOIN finance.departments d ON d.id = e.department_id AND d.organization_id = e.organization_id
            WHERE e.id = :id AND e.organization_id = :org_id AND e.is_deleted = false
            """),
            {"id": employee_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    if not employee:
        raise HTTPException(status_code=404, detail="Employee not found.")

    query_str = """
        SELECT lr.id, lr.leave_type, lr.start_date, lr.end_date, lr.days_requested, lr.reason,
               lr.status, lr.approved_at, lr.rejection_reason, lr.created_at,
               approver.full_name AS approved_by_name
        FROM hr.leave_requests lr
        LEFT JOIN core.users approver ON approver.id = lr.approved_by
        WHERE lr.organization_id = :org_id AND lr.employee_id = :employee_id AND lr.is_deleted = false
    """
    params: dict = {"org_id": user["org_id"], "employee_id": employee_id}
    if year:
        query_str += " AND EXTRACT(YEAR FROM lr.start_date) = CAST(:year AS integer)"
        params["year"] = year
    query_str += " ORDER BY lr.start_date, lr.created_at"
    requests = [dict(r) for r in (await db.execute(text(query_str), params)).mappings()]

    balance_year = year or date.today().year
    annual_taken = (
        await db.execute(
            text("""
            SELECT COALESCE(SUM(days_requested), 0) FROM hr.leave_requests
            WHERE organization_id = :org_id AND employee_id = :employee_id AND is_deleted = false
              AND status = 'approved' AND leave_type = 'annual'
              AND EXTRACT(YEAR FROM start_date) = CAST(:balance_year AS integer)
            """),
            {"org_id": user["org_id"], "employee_id": employee_id, "balance_year": balance_year},
        )
    ).scalar()
    generated_by = (
        await db.execute(text("SELECT full_name FROM core.users WHERE id = CAST(:id AS uuid)"), {"id": user["user_id"]})
    ).scalar()

    from fastapi.concurrency import run_in_threadpool
    from fastapi.responses import Response
    from app.services.documents.leave_renderer import render_leave_record_pdf

    pdf = await run_in_threadpool(
        lambda: render_leave_record_pdf(
            dict(employee), requests, year=year, balance_year=balance_year,
            annual_taken=float(annual_taken or 0), generated_by=generated_by,
        )
    )
    slug = "".join(c if c.isalnum() else "_" for c in str(employee["employee_name"] or "employee")).strip("_") or "employee"
    filename = f"SNC_Leave_Record_{slug}{f'_{year}' if year else ''}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# --- Self-service ("me") endpoints ---
#
# No require_permission on any of these - every authenticated user gets
# their own HR record, leave history, balance and leave application,
# regardless of role. Scoped entirely by resolve_own_employee_id (linked_
# user_id), never by a client-supplied employee_id, so nobody can read or
# submit on another employee's behalf through these routes.


@router.get("/me")
async def get_my_employee_record(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("""
                SELECT id, employee_name, job_title, department, employment_status,
                       employment_type, start_date, work_location, annual_leave_days
                FROM hr.employees
                WHERE organization_id = :org_id AND linked_user_id = :user_id AND is_deleted = false
            """),
            {"org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Employee identity is not provisioned.")
    return ok(dict(row), "Employee record fetched.")


@router.get("/me/leave")
async def list_my_leave_requests(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    employee_id = await resolve_own_employee_id(db, org_id=user["org_id"], user_id=user["user_id"])
    if not employee_id:
        raise HTTPException(status_code=404, detail="Employee identity is not provisioned.")
    rows = await db.execute(
        text("""
            SELECT * FROM hr.leave_requests
            WHERE organization_id = :org_id AND employee_id = :employee_id AND is_deleted = false
            ORDER BY created_at DESC
        """),
        {"org_id": user["org_id"], "employee_id": employee_id},
    )
    return ok([dict(row._mapping) for row in rows], "Leave requests listed.")


@router.get("/me/leave-balance")
async def get_my_leave_balance(
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    employee_id = await resolve_own_employee_id(db, org_id=user["org_id"], user_id=user["user_id"])
    if not employee_id:
        raise HTTPException(status_code=404, detail="Employee identity is not provisioned.")
    row = (
        await db.execute(
            text("""
                SELECT
                    e.annual_leave_days,
                    COALESCE(SUM(lr.days_requested) FILTER (
                        WHERE lr.status = 'approved' AND lr.leave_type = 'annual'
                          AND lr.start_date >= date_trunc('year', CURRENT_DATE)
                    ), 0) AS days_taken
                FROM hr.employees e
                LEFT JOIN hr.leave_requests lr
                    ON lr.employee_id = e.id AND lr.organization_id = e.organization_id AND lr.is_deleted = false
                WHERE e.id = :employee_id AND e.organization_id = :org_id
                GROUP BY e.annual_leave_days
            """),
            {"employee_id": employee_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    entitlement = row["annual_leave_days"]
    taken = float(row["days_taken"])
    return ok(
        {"annual_leave_days": entitlement, "days_taken": taken, "days_remaining": float(entitlement) - taken},
        "Leave balance fetched.",
    )


@router.post("/me/leave", status_code=status.HTTP_201_CREATED)
async def create_my_leave_request(
    payload: MyLeaveRequestCreate,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.days_requested <= 0:
        raise HTTPException(status_code=400, detail="Days requested must be greater than zero.")
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=400, detail="End date must be on or after start date.")

    employee_id = await resolve_own_employee_id(db, org_id=user["org_id"], user_id=user["user_id"])
    if not employee_id:
        raise HTTPException(status_code=404, detail="Employee identity is not provisioned.")
    try:
        leave_id = (
            await db.execute(
                text("""
            INSERT INTO hr.leave_requests (
                organization_id, employee_id, leave_type, start_date, end_date,
                days_requested, reason, status, submitted_by, calendar_status, calendar_title, created_by
            ) VALUES (
                CAST(:org_id AS uuid), :employee_id, :leave_type, CAST(:start_date AS date), CAST(:end_date AS date),
                :days_requested, :reason, 'pending', CAST(:user_id AS uuid), 'pending', :calendar_title, CAST(:user_id AS uuid)
            ) RETURNING id
        """),
                {
                    "org_id": user["org_id"],
                    "employee_id": employee_id,
                    "leave_type": payload.leave_type,
                    "start_date": date.fromisoformat(payload.start_date),
                    "end_date": date.fromisoformat(payload.end_date),
                    "days_requested": payload.days_requested,
                    "reason": payload.reason,
                    "calendar_title": f"{user['email']} - {payload.leave_type}"[:200],
                    "user_id": user["user_id"],
                },
            )
        ).scalar()
        try:
            await emit_role_notification(
                db,
                org_id=user["org_id"],
                role_names=["HR Manager", "HR Officer"],
                title="New leave request",
                message=f"{user['email']} requested {payload.days_requested} day(s) of {payload.leave_type} leave ({payload.start_date} to {payload.end_date}).",
                notification_type="hr_leave_request",
                action_url="/dashboard/hr",
                metadata={"leave_id": str(leave_id), "employee_id": str(employee_id)},
            )
        except Exception:
            pass
        await db.commit()
        return ok({"id": str(leave_id)}, "Leave request submitted.")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
