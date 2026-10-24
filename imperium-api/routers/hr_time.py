"""Time: automatic check-in, weekly hours confirmation, attendance board, absence.

Mounted at /api/v1/hr/time. Rules live in app/services/hr/time_tracking.py.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.hr import time_tracking as tt
from app.shared.events import emit_notification, emit_role_notification
from app.shared.pagination import ok
from core.database import get_db
from core.security import get_current_user, require_permission, user_has_permission

router = APIRouter()
HR_ROLES = ["HR Manager", "HR Officer", "Executive (Admin)"]


class DayHours(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    date: date
    hours: float = Field(ge=0, le=16)
    note: Optional[str] = Field(default=None, max_length=500)


class WeekConfirm(BaseModel):
    model_config = ConfigDict(extra="forbid")
    week_end: date
    days: list[DayHours] = Field(default_factory=list, max_length=7)


class WeekDecision(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    decision: Literal["approved", "queried"]
    note: Optional[str] = Field(default=None, max_length=1000)


@router.post("/check-in")
async def check_in(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Called by the dashboard on the first page load of the day. Safe to repeat."""
    return ok(await tt.check_in(db, user), "Checked in.")


@router.get("/me/week")
async def my_week(
    week_end: Optional[date] = None,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    employee = await tt.own_employee(db, user)
    if not employee:
        raise HTTPException(404, "Your login is not linked to a person record yet.")
    today = tt.local_now().date()
    we = week_end or tt.confirmation_week_due(today) or tt.week_end_for(today)
    return ok(await tt.week_view(db, user["org_id"], employee["id"], we), "Your week.")


@router.post("/me/week/confirm")
async def confirm_my_week(payload: WeekConfirm, user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    employee = await tt.own_employee(db, user)
    if not employee:
        raise HTTPException(404, "Your login is not linked to a person record yet.")
    result = await tt.confirm_week(db, user, employee["id"], payload.week_end,
                                   [tt.DayInput(d.date, d.hours, d.note) for d in payload.days])
    title = f"{employee['employee_name']} confirmed {result['confirmed_hours']}h for the week ending {payload.week_end:%d %b}"
    message = f"{result['corrections']} day(s) corrected - please review." if result["corrections"] else "No corrections."
    manager = await tt.line_manager_user(db, user["org_id"], employee["id"])
    if manager:
        await emit_notification(db, org_id=user["org_id"], user_id=str(manager), title=title, message=message,
                                notification_type="hr_hours", action_url="/dashboard/hr/attendance")
    if result["corrections"] or not manager:
        await emit_role_notification(db, org_id=user["org_id"], role_names=HR_ROLES, title=title, message=message,
                                     notification_type="hr_hours", action_url="/dashboard/hr/attendance")
    await db.commit()
    return ok({**result, "week": await tt.week_view(db, user["org_id"], employee["id"], payload.week_end)}, "Thank you, your week is submitted.")


@router.get("/board")
async def attendance_board(
    day: Optional[date] = Query(default=None, alias="date"),
    user: dict = Depends(require_permission("hr.attendance.read")),
    db: AsyncSession = Depends(get_db),
):
    d = day or tt.local_now().date()
    return ok({"date": d.isoformat(), "people": await tt.day_board(db, user["org_id"], d)}, "Attendance board.")


@router.get("/weeks")
async def weeks(
    week_end: Optional[date] = None,
    user: dict = Depends(require_permission("hr.attendance.read")),
    db: AsyncSession = Depends(get_db),
):
    """Who has confirmed the week, with corrections highlighted, and who has not."""
    today = tt.local_now().date()
    we = week_end or tt.last_closed_week_end(today)
    if we.weekday() != 4:
        raise HTTPException(422, "A week ends on a Friday")
    rows = (await db.execute(text("""
        SELECT e.id AS employee_id, e.employee_number, e.employee_name, p.name AS position_name,
               w.id, w.status, w.recorded_hours, w.confirmed_hours, w.leave_days, w.corrections, w.days,
               w.submitted_at, w.decided_at, w.decision_note, du.full_name AS decided_by_name
        FROM hr.employees e
        LEFT JOIN hr.positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
        LEFT JOIN hr.weekly_hours w ON w.organization_id=e.organization_id AND w.employee_id=e.id AND w.week_end=:we
        LEFT JOIN core.users du ON du.id = w.decided_by
        WHERE e.organization_id=:org AND e.is_deleted=false AND e.employment_status <> 'terminated'
          AND e.linked_user_id IS NOT NULL
        ORDER BY (w.status = 'submitted') DESC NULLS LAST, w.corrections DESC NULLS LAST, e.employee_name
    """), {"org": user["org_id"], "we": we})).mappings()
    people = [dict(r) for r in rows]
    return ok({
        "week_start": (we - timedelta(days=6)).isoformat(), "week_end": we.isoformat(), "people": people,
        "totals": {
            "submitted": sum(1 for p in people if p["status"] == "submitted"),
            "approved": sum(1 for p in people if p["status"] == "approved"),
            "queried": sum(1 for p in people if p["status"] == "queried"),
            "missing": sum(1 for p in people if not p["status"]),
            "with_corrections": sum(1 for p in people if (p["corrections"] or 0) > 0),
        },
    }, "Weekly hours.")


@router.post("/weeks/{week_id}/decision")
async def decide_week(
    week_id: UUID,
    payload: WeekDecision,
    user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """HR (hr.attendance.record) or the person's own line manager approves or queries a week."""
    row = (await db.execute(text("""SELECT w.employee_id, w.week_end, w.status, e.employee_name, e.linked_user_id
        FROM hr.weekly_hours w JOIN hr.employees e ON e.id=w.employee_id
        WHERE w.organization_id=:org AND w.id=:id"""), {"org": user["org_id"], "id": week_id})).mappings().first()
    if not row:
        raise HTTPException(404, "Week not found")
    manager = await tt.line_manager_user(db, user["org_id"], row["employee_id"])
    if not (await user_has_permission(db, user, "hr.attendance.record") or (manager and str(manager) == str(user["user_id"]))):
        raise HTTPException(403, "Only HR or the person's line manager can approve their hours")
    if row["linked_user_id"] and str(row["linked_user_id"]) == str(user["user_id"]):
        raise HTTPException(403, "You cannot approve your own hours")
    if payload.decision == "queried" and not payload.note:
        raise HTTPException(422, "Say what needs checking")
    await db.execute(text("""UPDATE hr.weekly_hours SET status=:d, decided_by=:uid, decided_at=now(), decision_note=:note, updated_at=now()
        WHERE id=:id"""), {"d": payload.decision, "uid": user["user_id"], "note": payload.note, "id": week_id})
    if row["linked_user_id"]:
        await emit_notification(
            db, org_id=user["org_id"], user_id=str(row["linked_user_id"]),
            title=f"Your hours for the week ending {row['week_end']:%d %b} were {payload.decision}",
            message=payload.note or "", notification_type="hr_hours", action_url="/dashboard/workforce/me",
        )
    await db.commit()
    return ok({"id": str(week_id), "status": payload.decision}, f"Week {payload.decision}.")


@router.get("/absence")
async def absence(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    user: dict = Depends(require_permission("hr.leave.read")),
    db: AsyncSession = Depends(get_db),
):
    today = tt.local_now().date()
    start = date_from or today.replace(day=1)
    end = date_to or today
    if end < start:
        raise HTTPException(422, "The end date is before the start date")
    if (end - start).days > 400:
        raise HTTPException(422, "Choose a period of at most 400 days")
    return ok({"date_from": start.isoformat(), "date_to": end.isoformat(),
               "people": await tt.absence_report(db, user["org_id"], start, end)}, "Absence report.")


@router.post("/close-day")
async def close_day(
    day: Optional[date] = Query(default=None, alias="date"),
    user: dict = Depends(require_permission("hr.attendance.record")),
    db: AsyncSession = Depends(get_db),
):
    """Stop the clock at 16:30 now instead of waiting for the afternoon job."""
    d = day or tt.local_now().date()
    if d == tt.local_now().date() and tt.local_now() < tt.day_end_at(d):
        raise HTTPException(409, "It is not 16:30 yet")
    return ok({"closed": await tt.close_day(db, d, user["org_id"])}, "Day closed.")
