"""The structured site day (migration 252).

Mounted twice:
  router     -> /api/v1/site-operations   site day, labour register, timers, daily targets
  hr_router  -> /api/v1/hr/project-hires  HR's register of project hires and their hours

The day runs in a fixed order. The engineer / agent / clerk opens the day,
registers who is on site (registering anyone AEGIS doesn't know yet as a
project hire), ticks each person's PPE, gives the toolbox talk and records
any safety concern with the action taken. Starting the day stamps a clock-in
for everyone present and unlocks daily reports and material requests
(enforced in site_reports via ensure_site_day_started). Closing the day clocks
everyone out and sends the hours to HR; only HR-accepted hours become
finance.site_time_entries, which the existing site pay runs pick up.

Approved/submitted weekly budgets are split into daily targets that the
project's engineers receive in AEGIS and on Teams.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.microsoft import teams_notify
from app.shared.events import emit_event, emit_notification, emit_role_notification
from core.database import get_db
from core.security import SUPERADMIN_ROLE, get_current_user, get_user_permission_keys, require_permission

router = APIRouter()
hr_router = APIRouter()

HARARE = ZoneInfo("Africa/Harare")
HR_ROLES = ["HR Manager", "HR Officer", "Payroll Administrator"]
ENGINEER_ROLES = ["Site Engineer", "Site Agent", "Site Manager", "FOREMAN"]
QUARTER = Decimal("0.25")


SITE_DAY_READ = ("site_operations.daily_report.read", "site_operations.labour_register.manage",
                 "site_operations.daily_targets.manage")


def require_any_permission(*keys: str):
    """Site clerks and agents run the day without holding the daily-report
    read key, so reading the day accepts any of the site-day keys."""

    async def checker(user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
        if user.get("role") == SUPERADMIN_ROLE:
            return user
        if not user.get("org_id") or not set(keys) & await get_user_permission_keys(db, user):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing required permission: {keys[0]}")
        return user

    return checker


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def result(data: Any, message: str, total: Optional[int] = None) -> dict[str, Any]:
    return {"success": True, "data": data, "message": message, "meta": {} if total is None else {"total": total}}


def harare_today() -> date:
    return datetime.now(HARARE).date()


def _rows(res) -> list[dict[str, Any]]:
    return [dict(row._mapping) for row in res]


def split_hours(clock_in: datetime, clock_out: datetime, *, cap: Decimal, break_minutes: int) -> tuple[Decimal, Decimal]:
    """Worked time to (regular, overtime), rounded to the quarter hour. The
    lunch break is only deducted from a shift long enough to include one."""
    minutes = max((clock_out - clock_in).total_seconds() / 60, 0)
    if minutes > 5 * 60:
        minutes = max(minutes - break_minutes, 0)
    worked = (Decimal(str(minutes)) / 60 / QUARTER).quantize(Decimal("1"), rounding=ROUND_HALF_UP) * QUARTER
    worked = min(worked, Decimal("24"))
    regular = min(worked, cap)
    return regular, worked - regular


# ----------------------------------------------------------------------------- payloads
class DayOpen(Payload):
    project_id: UUID
    briefing_date: Optional[date] = None
    shift: Literal["day", "night", "double"] = "day"
    site_id: Optional[UUID] = None


class DayUpdate(Payload):
    toolbox_topic: Optional[str] = Field(default=None, max_length=200)
    toolbox_notes: Optional[str] = Field(default=None, max_length=4000)
    toolbox_talk_completed: Optional[bool] = None
    ppe_check_completed: Optional[bool] = None
    safety_concern_raised: Optional[bool] = None
    safety_concerns: Optional[str] = Field(default=None, max_length=4000)
    safety_actions: Optional[str] = Field(default=None, max_length=4000)
    regular_hours_cap: Optional[Decimal] = Field(default=None, gt=0, le=12)
    break_minutes: Optional[int] = Field(default=None, ge=0, le=240)


class AttendanceAdd(Payload):
    site_worker_id: Optional[UUID] = None
    employee_id: Optional[UUID] = None
    ppe_ok: bool = False


class AttendanceUpdate(Payload):
    ppe_ok: Optional[bool] = None
    notes: Optional[str] = Field(default=None, max_length=300)


class ProjectHireCreate(Payload):
    project_id: UUID
    full_name: str = Field(min_length=2, max_length=160)
    national_id: Optional[str] = Field(default=None, max_length=40)
    phone: Optional[str] = Field(default=None, max_length=40)
    trade: Optional[str] = Field(default=None, max_length=80)
    hourly_rate: Decimal = Field(ge=0, le=1000)
    overtime_rate: Optional[Decimal] = Field(default=None, ge=0, le=1000)
    payment_method: Literal["cash", "mobile_money", "bank_transfer"] = "cash"
    payment_details: Optional[str] = Field(default=None, max_length=160)
    briefing_id: Optional[UUID] = None
    ppe_ok: bool = False


class TargetGenerate(Payload):
    working_days: list[int] = Field(default_factory=lambda: [0, 1, 2, 3, 4, 5], min_length=1, max_length=7)
    replace_open: bool = True
    notify: bool = True


class TargetUpdate(Payload):
    achieved_qty: Optional[Decimal] = Field(default=None, ge=0)
    status: Optional[Literal["open", "partial", "done", "missed"]] = None
    notes: Optional[str] = Field(default=None, max_length=500)


class TargetNotify(Payload):
    project_id: UUID
    target_date: date


class HireStatus(Payload):
    status: Literal["active", "inactive"]
    reason: Optional[str] = Field(default=None, max_length=500)


class HireUpdate(Payload):
    project_id: Optional[UUID] = None
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    national_id: Optional[str] = Field(default=None, max_length=40)
    phone: Optional[str] = Field(default=None, max_length=40)
    trade: Optional[str] = Field(default=None, max_length=80)
    hourly_rate: Optional[Decimal] = Field(default=None, ge=0, le=1000)
    overtime_rate: Optional[Decimal] = Field(default=None, ge=0, le=1000)
    payment_method: Optional[Literal["cash", "mobile_money", "bank_transfer"]] = None
    payment_details: Optional[str] = Field(default=None, max_length=160)


class HoursDecision(Payload):
    attendance_ids: list[UUID] = Field(min_length=1, max_length=500)
    decision: Literal["accepted", "rejected"]
    reason: Optional[str] = Field(default=None, max_length=300)


# ----------------------------------------------------------------------------- shared lookups
async def _project_name(db: AsyncSession, org_id: str, project_id: UUID) -> str:
    name = (
        await db.execute(
            text("SELECT name FROM projects.projects WHERE id=:id AND organization_id=:org_id AND is_deleted=false"),
            {"id": project_id, "org_id": org_id},
        )
    ).scalar()
    if not name:
        raise HTTPException(status_code=404, detail="Project not found.")
    return name


async def _briefing(db: AsyncSession, org_id: str, briefing_id: UUID) -> dict[str, Any]:
    row = (
        await db.execute(
            text("SELECT * FROM projects.site_day_briefings WHERE id=:id AND organization_id=:org_id AND is_deleted=false"),
            {"id": briefing_id, "org_id": org_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Site day not found.")
    return dict(row)


async def _attendance_row(db: AsyncSession, org_id: str, attendance_id: UUID) -> dict[str, Any]:
    row = (
        await db.execute(
            text("""
            SELECT a.*, b.status AS day_status, b.regular_hours_cap, b.break_minutes
            FROM projects.site_day_attendance a
            JOIN projects.site_day_briefings b ON b.id=a.briefing_id
            WHERE a.id=:id AND a.organization_id=:org_id
        """),
            {"id": attendance_id, "org_id": org_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Attendance line not found.")
    return dict(row)


async def ensure_site_day_started(db: AsyncSession, *, org_id: str, project_id: UUID, on_date: date) -> None:
    """Used by daily reports and material requests: nothing is recorded for
    today until the labour register, PPE check and toolbox talk are done.
    Earlier dates are left open so missed days can still be written up."""
    if on_date < harare_today():
        return
    started = (
        await db.execute(
            text("""
            SELECT 1 FROM projects.site_day_briefings
            WHERE organization_id=:org_id AND project_id=:project_id AND briefing_date=:on_date
              AND status IN ('started', 'closed') AND is_deleted=false
            LIMIT 1
        """),
            {"org_id": org_id, "project_id": project_id, "on_date": on_date},
        )
    ).scalar()
    if not started:
        raise HTTPException(
            status_code=409,
            detail="Start the site day first: complete the labour register, PPE check and toolbox talk in the Labour Register tab.",
        )


async def _day_payload(db: AsyncSession, org_id: str, briefing: Optional[dict[str, Any]]) -> dict[str, Any]:
    if not briefing:
        return {"briefing": None, "attendance": []}
    attendance = _rows(
        await db.execute(
            text("""
            SELECT a.*, w.hr_verified, w.status AS worker_status, w.phone
            FROM projects.site_day_attendance a
            LEFT JOIN finance.site_workers w ON w.id=a.site_worker_id
            WHERE a.briefing_id=:id AND a.organization_id=:org_id
            ORDER BY a.worker_kind DESC, a.worker_name
        """),
            {"id": briefing["id"], "org_id": org_id},
        )
    )
    return {"briefing": briefing, "attendance": attendance}


# ============================================================================= site day
@router.get("/day")
async def get_site_day(
    project_id: UUID,
    briefing_date: Optional[date] = Query(default=None, alias="date"),
    shift: Literal["day", "night", "double"] = "day",
    user: dict = Depends(require_any_permission(*SITE_DAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    """Everything a tab needs for one project day: the briefing and register,
    whether the day is unlocked, today's targets and who can be registered."""
    org_id = user["org_id"]
    on_date = briefing_date or harare_today()
    project_name = await _project_name(db, org_id, project_id)
    briefing = (
        await db.execute(
            text("""
            SELECT b.*, starter.full_name AS started_by_name, closer.full_name AS closed_by_name
            FROM projects.site_day_briefings b
            LEFT JOIN core.users starter ON starter.id=b.started_by
            LEFT JOIN core.users closer ON closer.id=b.closed_by
            WHERE b.organization_id=:org_id AND b.project_id=:project_id AND b.briefing_date=:on_date
              AND b.shift=:shift AND b.is_deleted=false
        """),
            {"org_id": org_id, "project_id": project_id, "on_date": on_date, "shift": shift},
        )
    ).mappings().first()
    day = await _day_payload(db, org_id, dict(briefing) if briefing else None)
    targets = _rows(
        await db.execute(
            text("""
            SELECT t.*, wb.week_start, wb.status AS budget_status
            FROM projects.site_daily_targets t
            JOIN projects.weekly_budgets wb ON wb.id=t.weekly_budget_id
            WHERE t.organization_id=:org_id AND t.project_id=:project_id AND t.target_date=:on_date AND t.is_deleted=false
            ORDER BY t.work_package NULLS LAST, t.description
        """),
            {"org_id": org_id, "project_id": project_id, "on_date": on_date},
        )
    )
    hires = _rows(
        await db.execute(
            text("""
            SELECT id, full_name, trade, hourly_rate, overtime_rate, phone, national_id, hr_verified,
                   project_id, (project_id = :project_id) AS on_this_project
            FROM finance.site_workers
            WHERE organization_id=:org_id AND is_deleted=false AND status='active'
            ORDER BY (project_id = :project_id) DESC NULLS LAST, full_name
        """),
            {"org_id": org_id, "project_id": project_id},
        )
    )
    employees = _rows(
        await db.execute(
            text("""
            SELECT DISTINCT e.id, e.employee_name AS full_name, e.employee_number,
                   COALESCE(pos.name, e.job_title) AS trade
            FROM hr.project_allocations a
            JOIN hr.employees e ON e.id=a.employee_id AND e.organization_id=a.organization_id
            LEFT JOIN hr.positions pos ON pos.id=e.position_id
            WHERE a.organization_id=:org_id AND a.project_id=:project_id AND a.is_deleted=false
              AND a.status IN ('planned', 'active') AND (a.ends_on IS NULL OR a.ends_on >= :on_date)
              AND COALESCE(e.employment_status, 'active') <> 'terminated'
            ORDER BY full_name
        """),
            {"org_id": org_id, "project_id": project_id, "on_date": on_date},
        )
    )
    b = day["briefing"]
    started = bool(b and b["status"] in ("started", "closed"))
    return result(
        {
            **day,
            "project_name": project_name,
            "date": on_date.isoformat(),
            "is_today": on_date == harare_today(),
            "gate": {
                "opened": bool(b),
                "started": started,
                "closed": bool(b and b["status"] == "closed"),
                "unlocked": started or on_date < harare_today(),
            },
            "targets": targets,
            "roster": {"project_hires": hires, "employees": employees},
        },
        "Site day loaded.",
    )


@router.post("/day/open", status_code=status.HTTP_201_CREATED)
async def open_site_day(
    payload: DayOpen,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    await _project_name(db, org_id, payload.project_id)
    on_date = payload.briefing_date or harare_today()
    if on_date > harare_today():
        raise HTTPException(status_code=422, detail="A site day can't be opened in advance.")
    briefing_id = (
        await db.execute(
            text("""
            INSERT INTO projects.site_day_briefings (organization_id, project_id, site_id, briefing_date, shift, created_by)
            VALUES (:org_id, :project_id, :site_id, :on_date, :shift, :user_id)
            ON CONFLICT (organization_id, project_id, briefing_date, shift) WHERE NOT is_deleted
            DO UPDATE SET updated_at=projects.site_day_briefings.updated_at
            RETURNING id
        """),
            {"org_id": org_id, "project_id": payload.project_id, "site_id": payload.site_id, "on_date": on_date,
             "shift": payload.shift, "user_id": user["user_id"]},
        )
    ).scalar()
    await db.commit()
    return result(await _day_payload(db, org_id, await _briefing(db, org_id, briefing_id)), "Site day opened.")


@router.patch("/day/{briefing_id}")
async def update_site_day(
    briefing_id: UUID,
    payload: DayUpdate,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    briefing = await _briefing(db, org_id, briefing_id)
    changes = payload.model_dump(exclude_unset=True)
    if briefing["status"] == "closed":
        raise HTTPException(status_code=409, detail="This site day is closed.")
    if briefing["status"] == "started":
        # Once work is under way only safety can still be recorded.
        changes = {k: v for k, v in changes.items() if k in ("safety_concern_raised", "safety_concerns", "safety_actions")}
        if changes.get("safety_concern_raised") and not (changes.get("safety_actions") or briefing.get("safety_actions")):
            raise HTTPException(status_code=422, detail="Record the action taken on the safety concern.")
    if not changes:
        return result(await _day_payload(db, org_id, briefing), "Nothing to change.")
    sets = ", ".join(f"{key}=:{key}" for key in changes)
    await db.execute(
        text(f"UPDATE projects.site_day_briefings SET {sets}, updated_at=NOW() WHERE id=:id AND organization_id=:org_id"),
        {**changes, "id": briefing_id, "org_id": org_id},
    )
    if changes.get("safety_concern_raised"):
        await emit_role_notification(
            db, org_id=org_id, role_names=["HSE / Safety Officer", "Project Manager"],
            title="Safety concern raised on site",
            message=(changes.get("safety_concerns") or briefing.get("safety_concerns") or "A safety concern was raised at the site day start.")[:300],
            priority="high", action_url="/dashboard/site-operations",
        )
    await db.commit()
    return result(await _day_payload(db, org_id, await _briefing(db, org_id, briefing_id)), "Site day updated.")


async def _insert_attendance(
    db: AsyncSession, *, user: dict, briefing: dict[str, Any], site_worker_id: Optional[UUID],
    employee_id: Optional[UUID], ppe_ok: bool,
) -> None:
    org_id = user["org_id"]
    if bool(site_worker_id) == bool(employee_id):
        raise HTTPException(status_code=422, detail="Choose one person: a project hire or an employee.")
    if briefing["status"] == "closed":
        raise HTTPException(status_code=409, detail="This site day is closed.")
    if site_worker_id:
        person = (
            await db.execute(
                text("""SELECT full_name, trade, hourly_rate, status FROM finance.site_workers
                        WHERE id=:id AND organization_id=:org_id AND is_deleted=false"""),
                {"id": site_worker_id, "org_id": org_id},
            )
        ).mappings().first()
        if not person:
            raise HTTPException(status_code=404, detail="Project hire not found.")
        if person["status"] != "active":
            raise HTTPException(status_code=409, detail=f"{person['full_name']} is deactivated. HR must reactivate them first.")
        kind, name, trade, rate = "project_hire", person["full_name"], person["trade"], person["hourly_rate"]
    else:
        person = (
            await db.execute(
                text("""SELECT e.employee_name, COALESCE(pos.name, e.job_title) AS trade
                        FROM hr.employees e LEFT JOIN hr.positions pos ON pos.id=e.position_id
                        WHERE e.id=:id AND e.organization_id=:org_id"""),
                {"id": employee_id, "org_id": org_id},
            )
        ).mappings().first()
        if not person:
            raise HTTPException(status_code=404, detail="Employee not found.")
        kind, name, trade, rate = "employee", person["employee_name"], person["trade"], None
    # Late arrivals after the day has started clock in from now.
    clock_in = datetime.now(timezone.utc) if briefing["status"] == "started" else None
    if clock_in and not ppe_ok:
        raise HTTPException(status_code=422, detail="Confirm PPE before a late arrival starts work.")
    try:
        await db.execute(
            text("""
            INSERT INTO projects.site_day_attendance (
                organization_id, briefing_id, project_id, worker_kind, site_worker_id, employee_id,
                worker_name, trade, hourly_rate, ppe_ok, clock_in_at, created_by
            ) VALUES (:org_id, :briefing_id, :project_id, :kind, :site_worker_id, :employee_id,
                      :name, :trade, :rate, :ppe_ok, :clock_in, :user_id)
        """),
            {"org_id": org_id, "briefing_id": briefing["id"], "project_id": briefing["project_id"], "kind": kind,
             "site_worker_id": site_worker_id, "employee_id": employee_id, "name": name, "trade": trade,
             "rate": rate, "ppe_ok": ppe_ok, "clock_in": clock_in, "user_id": user["user_id"]},
        )
    except Exception as exc:  # unique index: already on today's register
        if "site_day_attendance_" in str(exc):
            await db.rollback()
            raise HTTPException(status_code=409, detail=f"{name} is already on today's register.") from exc
        raise


@router.post("/day/{briefing_id}/attendance", status_code=status.HTTP_201_CREATED)
async def add_attendance(
    briefing_id: UUID,
    payload: AttendanceAdd,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    briefing = await _briefing(db, user["org_id"], briefing_id)
    await _insert_attendance(db, user=user, briefing=briefing, site_worker_id=payload.site_worker_id,
                             employee_id=payload.employee_id, ppe_ok=payload.ppe_ok)
    await db.commit()
    return result(await _day_payload(db, user["org_id"], briefing), "Added to today's register.")


@router.patch("/day/attendance/{attendance_id}")
async def update_attendance(
    attendance_id: UUID,
    payload: AttendanceUpdate,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _attendance_row(db, user["org_id"], attendance_id)
    if row["day_status"] == "closed":
        raise HTTPException(status_code=409, detail="This site day is closed.")
    changes = payload.model_dump(exclude_unset=True)
    if row["clock_in_at"] and changes.get("ppe_ok") is False:
        raise HTTPException(status_code=409, detail="This person is already working. Clock them out instead of removing PPE.")
    if changes:
        sets = ", ".join(f"{key}=:{key}" for key in changes)
        await db.execute(
            text(f"UPDATE projects.site_day_attendance SET {sets}, updated_at=NOW() WHERE id=:id"),
            {**changes, "id": attendance_id},
        )
        await db.commit()
    briefing = await _briefing(db, user["org_id"], row["briefing_id"])
    return result(await _day_payload(db, user["org_id"], briefing), "Register updated.")


@router.delete("/day/attendance/{attendance_id}")
async def remove_attendance(
    attendance_id: UUID,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _attendance_row(db, user["org_id"], attendance_id)
    if row["clock_in_at"]:
        raise HTTPException(status_code=409, detail="This person has already clocked in. Clock them out instead.")
    await db.execute(text("DELETE FROM projects.site_day_attendance WHERE id=:id"), {"id": attendance_id})
    await db.commit()
    briefing = await _briefing(db, user["org_id"], row["briefing_id"])
    return result(await _day_payload(db, user["org_id"], briefing), "Removed from today's register.")


@router.post("/day/project-hires", status_code=status.HTTP_201_CREATED)
async def register_project_hire(
    payload: ProjectHireCreate,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Someone on site who isn't in AEGIS yet: hourly, semi-skilled, hired
    for this project. They can work today; HR verifies them afterwards."""
    org_id = user["org_id"]
    project_name = await _project_name(db, org_id, payload.project_id)
    if payload.national_id:
        dup = (
            await db.execute(
                text("""SELECT full_name FROM finance.site_workers
                        WHERE organization_id=:org_id AND is_deleted=false AND UPPER(national_id)=UPPER(:nid)"""),
                {"org_id": org_id, "nid": payload.national_id},
            )
        ).scalar()
        if dup:
            raise HTTPException(status_code=409, detail=f"National ID already registered to {dup}. Add them from the list instead.")
    worker_id = (
        await db.execute(
            text("""
            INSERT INTO finance.site_workers (
                organization_id, project_id, full_name, national_id, phone, trade, hourly_rate, overtime_rate,
                payment_method, payment_details, status, start_date, registered_via, hr_verified, created_by
            ) VALUES (:org_id, :project_id, :full_name, :national_id, :phone, :trade, :hourly_rate, :overtime_rate,
                      :payment_method, :payment_details, 'active', :today, 'site_register', false, :user_id)
            RETURNING id
        """),
            {**payload.model_dump(exclude={"briefing_id", "ppe_ok"}), "org_id": org_id, "user_id": user["user_id"],
             "today": harare_today()},
        )
    ).scalar()
    if payload.briefing_id:
        briefing = await _briefing(db, org_id, payload.briefing_id)
        await _insert_attendance(db, user=user, briefing=briefing, site_worker_id=worker_id, employee_id=None, ppe_ok=payload.ppe_ok)
    await emit_role_notification(
        db, org_id=org_id, role_names=HR_ROLES,
        title="New project hire registered on site",
        message=f"{payload.full_name} ({payload.trade or 'general hand'}, ${payload.hourly_rate}/h) was registered on {project_name}. Verify their details.",
        action_url="/dashboard/hr/project-hires",
    )
    await db.commit()
    return result({"id": str(worker_id)}, f"{payload.full_name} registered as a project hire.")


@router.post("/day/{briefing_id}/start")
async def start_site_day(
    briefing_id: UUID,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    briefing = await _briefing(db, org_id, briefing_id)
    if briefing["status"] != "open":
        raise HTTPException(status_code=409, detail="This site day has already started.")
    attendance = (await _day_payload(db, org_id, briefing))["attendance"]
    problems = []
    if not attendance:
        problems.append("register at least one person on site")
    missing_ppe = [a["worker_name"] for a in attendance if not a["ppe_ok"]]
    if missing_ppe:
        problems.append(f"confirm PPE for {', '.join(missing_ppe[:5])}{'…' if len(missing_ppe) > 5 else ''} (or remove them)")
    if not briefing["ppe_check_completed"]:
        problems.append("tick the PPE check")
    if not briefing["toolbox_talk_completed"] or not (briefing["toolbox_topic"] or "").strip():
        problems.append("record and tick the toolbox talk")
    if briefing["safety_concern_raised"] and not (briefing["safety_actions"] or "").strip():
        problems.append("record the action taken on the safety concern")
    if problems:
        raise HTTPException(status_code=422, detail="Before starting the day: " + "; ".join(problems) + ".")
    now = datetime.now(timezone.utc)
    await db.execute(
        text("""UPDATE projects.site_day_briefings
                SET status='started', labour_count_completed=true, started_at=:now, started_by=:user_id, updated_at=NOW()
                WHERE id=:id"""),
        {"now": now, "user_id": user["user_id"], "id": briefing_id},
    )
    await db.execute(
        text("UPDATE projects.site_day_attendance SET clock_in_at=:now, updated_at=NOW() WHERE briefing_id=:id AND clock_in_at IS NULL"),
        {"now": now, "id": briefing_id},
    )
    await emit_event(
        db, user=user, event_type="site.day.started.v1", aggregate_type="site_day_briefing", aggregate_id=briefing_id,
        project_id=briefing["project_id"],
        event_data={"headcount": len(attendance), "toolbox_topic": briefing["toolbox_topic"],
                    "safety_concern_raised": briefing["safety_concern_raised"]},
    )
    await db.commit()
    return result(await _day_payload(db, org_id, await _briefing(db, org_id, briefing_id)),
                  f"Site day started. {len(attendance)} people clocked in.")


async def _clock_out(db: AsyncSession, row: dict[str, Any], at: datetime, cap: Decimal, break_minutes: int) -> None:
    if not row["clock_in_at"] or row["clock_out_at"]:
        return
    regular, overtime = split_hours(row["clock_in_at"], at, cap=Decimal(str(cap)), break_minutes=int(break_minutes))
    await db.execute(
        text("""UPDATE projects.site_day_attendance
                SET clock_out_at=:at, regular_hours=:regular, overtime_hours=:overtime, updated_at=NOW()
                WHERE id=:id"""),
        {"at": at, "regular": regular, "overtime": overtime, "id": row["id"]},
    )


@router.post("/day/attendance/{attendance_id}/clock-out")
async def clock_out_attendance(
    attendance_id: UUID,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = await _attendance_row(db, user["org_id"], attendance_id)
    if not row["clock_in_at"]:
        raise HTTPException(status_code=409, detail="This person hasn't clocked in yet.")
    if row["clock_out_at"]:
        raise HTTPException(status_code=409, detail="Already clocked out.")
    await _clock_out(db, row, datetime.now(timezone.utc), row["regular_hours_cap"], row["break_minutes"])
    await db.commit()
    briefing = await _briefing(db, user["org_id"], row["briefing_id"])
    return result(await _day_payload(db, user["org_id"], briefing), f"{row['worker_name']} clocked out.")


@router.post("/day/{briefing_id}/close")
async def close_site_day(
    briefing_id: UUID,
    user: dict = Depends(require_permission("site_operations.labour_register.manage")),
    db: AsyncSession = Depends(get_db),
):
    org_id = user["org_id"]
    briefing = await _briefing(db, org_id, briefing_id)
    if briefing["status"] != "started":
        raise HTTPException(status_code=409, detail="Only a started site day can be closed.")
    now = datetime.now(timezone.utc)
    rows = (await _day_payload(db, org_id, briefing))["attendance"]
    for row in rows:
        await _clock_out(db, row, now, briefing["regular_hours_cap"], briefing["break_minutes"])
    await db.execute(
        text("UPDATE projects.site_day_attendance SET hr_status='pending', updated_at=NOW() WHERE briefing_id=:id AND hr_status='open'"),
        {"id": briefing_id},
    )
    await db.execute(
        text("""UPDATE projects.site_day_briefings
                SET status='closed', closed_at=:now, closed_by=:user_id, hr_status='pending', updated_at=NOW()
                WHERE id=:id"""),
        {"now": now, "user_id": user["user_id"], "id": briefing_id},
    )
    project_name = await _project_name(db, org_id, briefing["project_id"])
    hires = sum(1 for r in rows if r["worker_kind"] == "project_hire")
    await emit_role_notification(
        db, org_id=org_id, role_names=HR_ROLES,
        title="Site hours waiting for acceptance",
        message=f"{project_name}, {briefing['briefing_date']}: {len(rows)} people ({hires} project hires) clocked out. Accept the hours for billing.",
        action_url="/dashboard/hr/project-hires",
    )
    await emit_event(
        db, user=user, event_type="site.day.closed.v1", aggregate_type="site_day_briefing", aggregate_id=briefing_id,
        project_id=briefing["project_id"], event_data={"headcount": len(rows), "project_hires": hires},
    )
    await db.commit()
    return result(await _day_payload(db, org_id, await _briefing(db, org_id, briefing_id)),
                  "Site day closed. Hours sent to HR for acceptance.")


# ============================================================================= daily targets
async def _engineer_user_ids(db: AsyncSession, org_id: str, project_id: UUID) -> list[str]:
    """The project's own engineers (allocated in HR and holding a site role);
    if nobody is allocated yet, everyone holding a site role."""
    params = {"org_id": org_id, "project_id": project_id, "roles": [r.upper() for r in ENGINEER_ROLES]}
    role_join = """
        JOIN core.user_roles ur ON ur.user_id=u.id AND ur.organization_id=u.organization_id
        JOIN core.roles r ON r.id=ur.role_id AND r.is_deleted=false AND upper(r.name) = ANY(:roles)
    """
    allocated = (
        await db.execute(
            text(f"""
            SELECT DISTINCT u.id::text FROM hr.project_allocations a
            JOIN hr.employees e ON e.id=a.employee_id
            JOIN core.users u ON u.id=e.linked_user_id AND u.is_active=true AND u.is_deleted=false
            {role_join}
            WHERE a.organization_id=:org_id AND a.project_id=:project_id AND a.is_deleted=false
              AND a.status IN ('planned', 'active') AND (a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE)
        """),
            params,
        )
    ).scalars().all()
    if allocated:
        return list(allocated)
    return list(
        (
            await db.execute(
                text(f"""SELECT DISTINCT u.id::text FROM core.users u {role_join}
                         WHERE u.organization_id=:org_id AND u.is_active=true AND u.is_deleted=false"""),
                params,
            )
        ).scalars().all()
    )


async def _send_targets(db: AsyncSession, *, user: dict, project_id: UUID, target_date: date) -> tuple[int, list]:
    """In-app notification plus a Teams card to each engineer, for one day."""
    org_id = user["org_id"]
    targets = _rows(
        await db.execute(
            text("""SELECT description, work_package, unit, target_qty FROM projects.site_daily_targets
                    WHERE organization_id=:org_id AND project_id=:project_id AND target_date=:d AND is_deleted=false
                    ORDER BY work_package NULLS LAST, description"""),
            {"org_id": org_id, "project_id": project_id, "d": target_date},
        )
    )
    if not targets:
        return 0, []
    project_name = await _project_name(db, org_id, project_id)
    user_ids = await _engineer_user_ids(db, org_id, project_id)
    day_label = target_date.strftime("%A %d %b")
    for uid in user_ids:
        await emit_notification(
            db, org_id=org_id, user_id=uid, title=f"Site targets for {day_label}",
            message=f"{project_name}: {len(targets)} target(s) to complete.",
            action_url=f"/dashboard/site-operations?tab=targets&project={project_id}&date={target_date}",
        )
    await db.execute(
        text("""UPDATE projects.site_daily_targets SET notified_at=NOW()
                WHERE organization_id=:org_id AND project_id=:project_id AND target_date=:d AND is_deleted=false"""),
        {"org_id": org_id, "project_id": project_id, "d": target_date},
    )
    deliveries = await teams_notify.prepare_daily_target_deliveries(
        db, org_id, user_ids, project_name=project_name, project_id=str(project_id), target_date=target_date,
        targets=targets,
    )
    return len(user_ids), deliveries


@router.post("/weekly-budgets/{budget_id}/daily-targets", status_code=status.HTTP_201_CREATED)
async def generate_daily_targets(
    budget_id: UUID,
    payload: TargetGenerate,
    background: BackgroundTasks,
    user: dict = Depends(require_permission("site_operations.daily_targets.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Splits each weekly budget line evenly across the chosen working days
    (0 = the week's first day)."""
    org_id = user["org_id"]
    budget = (
        await db.execute(
            text("SELECT * FROM projects.weekly_budgets WHERE id=:id AND organization_id=:org_id AND is_deleted=false"),
            {"id": budget_id, "org_id": org_id},
        )
    ).mappings().first()
    if not budget:
        raise HTTPException(status_code=404, detail="Weekly budget not found.")
    if budget["status"] not in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail="Only a submitted or approved weekly budget can be broken into daily targets.")
    days = sorted({d for d in payload.working_days if 0 <= d <= 6})
    if not days:
        raise HTTPException(status_code=422, detail="Choose at least one working day.")
    dates = [budget["week_start"] + timedelta(days=d) for d in days]
    items = _rows(
        await db.execute(
            text("""SELECT id, work_package, description, unit, planned_qty, planned_amount
                    FROM projects.weekly_budget_items
                    WHERE weekly_budget_id=:id AND organization_id=:org_id AND is_deleted=false
                    ORDER BY created_at"""),
            {"id": budget_id, "org_id": org_id},
        )
    )
    if not items:
        raise HTTPException(status_code=422, detail="This weekly budget has no lines to break down.")
    if payload.replace_open:
        await db.execute(
            text("""UPDATE projects.site_daily_targets SET is_deleted=true, updated_at=NOW()
                    WHERE weekly_budget_id=:id AND organization_id=:org_id AND is_deleted=false
                      AND status='open' AND achieved_qty=0"""),
            {"id": budget_id, "org_id": org_id},
        )
    n = Decimal(len(dates))
    created = 0
    for item in items:
        qty = Decimal(str(item["planned_qty"] or 0))
        amount = Decimal(str(item["planned_amount"] or 0))
        per_qty = (qty / n).quantize(Decimal("0.001"))
        per_amount = (amount / n).quantize(Decimal("0.01"))
        for i, d in enumerate(dates):
            last = i == len(dates) - 1
            # The last day takes the rounding remainder so the week adds up.
            day_qty = qty - per_qty * (n - 1) if last else per_qty
            day_amount = amount - per_amount * (n - 1) if last else per_amount
            await db.execute(
                text("""
                INSERT INTO projects.site_daily_targets (
                    organization_id, project_id, weekly_budget_id, weekly_budget_item_id, target_date,
                    work_package, description, unit, target_qty, planned_amount, created_by
                ) VALUES (:org_id, :project_id, :budget_id, :item_id, :d, :wp, :descr, :unit, :qty, :amount, :user_id)
            """),
                {"org_id": org_id, "project_id": budget["project_id"], "budget_id": budget_id, "item_id": item["id"],
                 "d": d, "wp": item["work_package"], "descr": item["description"] or item["work_package"] or "Planned work",
                 "unit": item["unit"], "qty": max(day_qty, Decimal("0")), "amount": max(day_amount, Decimal("0")),
                 "user_id": user["user_id"]},
            )
            created += 1
    sent_to = 0
    deliveries: list = []
    if payload.notify:
        today = harare_today()
        first = next((d for d in dates if d >= today), None)
        if first:
            sent_to, deliveries = await _send_targets(db, user=user, project_id=budget["project_id"], target_date=first)
    await emit_event(
        db, user=user, event_type="site.daily_targets.generated.v1", aggregate_type="weekly_budget",
        aggregate_id=budget_id, project_id=budget["project_id"],
        event_data={"targets": created, "days": [d.isoformat() for d in dates]},
    )
    await db.commit()
    if deliveries:
        background.add_task(teams_notify.deliver, deliveries)
    return result({"created": created, "days": [d.isoformat() for d in dates], "notified": sent_to},
                  f"{created} daily targets created across {len(dates)} days.")


@router.get("/daily-targets")
async def list_daily_targets(
    project_id: UUID,
    date_from: date,
    date_to: date,
    user: dict = Depends(require_any_permission(*SITE_DAY_READ)),
    db: AsyncSession = Depends(get_db),
):
    if (date_to - date_from).days > 62:
        raise HTTPException(status_code=422, detail="Ask for at most two months of targets at a time.")
    data = _rows(
        await db.execute(
            text("""
            SELECT t.*, u.full_name AS updated_by_name
            FROM projects.site_daily_targets t
            LEFT JOIN core.users u ON u.id=t.updated_by
            WHERE t.organization_id=:org_id AND t.project_id=:project_id AND t.is_deleted=false
              AND t.target_date BETWEEN :date_from AND :date_to
            ORDER BY t.target_date, t.work_package NULLS LAST, t.description
        """),
            {"org_id": user["org_id"], "project_id": project_id, "date_from": date_from, "date_to": date_to},
        )
    )
    return result(data, "Daily targets listed.", len(data))


@router.patch("/daily-targets/{target_id}")
async def update_daily_target(
    target_id: UUID,
    payload: TargetUpdate,
    user: dict = Depends(require_permission("site_operations.daily_targets.manage")),
    db: AsyncSession = Depends(get_db),
):
    row = (
        await db.execute(
            text("SELECT * FROM projects.site_daily_targets WHERE id=:id AND organization_id=:org_id AND is_deleted=false"),
            {"id": target_id, "org_id": user["org_id"]},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Daily target not found.")
    achieved = payload.achieved_qty if payload.achieved_qty is not None else row["achieved_qty"]
    new_status = payload.status
    if new_status is None and payload.achieved_qty is not None:
        target = Decimal(str(row["target_qty"]))
        new_status = "done" if target > 0 and achieved >= target else ("partial" if achieved > 0 else "open")
    await db.execute(
        text("""UPDATE projects.site_daily_targets
                SET achieved_qty=:achieved, status=:status, notes=COALESCE(:notes, notes), updated_by=:user_id, updated_at=NOW()
                WHERE id=:id"""),
        {"achieved": achieved, "status": new_status or row["status"], "notes": payload.notes,
         "user_id": user["user_id"], "id": target_id},
    )
    await db.commit()
    return result({"id": str(target_id), "achieved_qty": str(achieved), "status": new_status or row["status"]}, "Target updated.")


@router.post("/daily-targets/notify")
async def notify_daily_targets(
    payload: TargetNotify,
    background: BackgroundTasks,
    user: dict = Depends(require_permission("site_operations.daily_targets.manage")),
    db: AsyncSession = Depends(get_db),
):
    sent_to, deliveries = await _send_targets(db, user=user, project_id=payload.project_id, target_date=payload.target_date)
    if not sent_to:
        raise HTTPException(status_code=404, detail="No targets (or no engineers) for that day.")
    await db.commit()
    if deliveries:
        background.add_task(teams_notify.deliver, deliveries)
    return result({"notified": sent_to, "teams": len(deliveries)}, f"Targets sent to {sent_to} engineer(s).")


# ============================================================================= HR: project hires
@hr_router.get("")
async def list_project_hires(
    status_filter: Optional[Literal["active", "inactive", "all"]] = Query(default="all", alias="status"),
    project_id: Optional[UUID] = None,
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    data = _rows(
        await db.execute(
            text("""
            SELECT w.id, w.full_name, w.national_id, w.phone, w.trade, w.hourly_rate, w.overtime_rate,
                   w.payment_method, w.payment_details, w.status, w.start_date, w.end_date, w.registered_via,
                   w.hr_verified, w.hr_verified_at, w.status_reason, w.status_changed_at, w.created_at,
                   w.project_id, p.name AS project_name, reg.full_name AS registered_by_name,
                   (SELECT MAX(b.briefing_date) FROM projects.site_day_attendance a
                     JOIN projects.site_day_briefings b ON b.id=a.briefing_id WHERE a.site_worker_id=w.id) AS last_on_site,
                   (SELECT COALESCE(SUM(a.regular_hours + COALESCE(a.overtime_hours, 0)), 0) FROM projects.site_day_attendance a
                     WHERE a.site_worker_id=w.id AND a.hr_status='pending') AS pending_hours,
                   (SELECT COALESCE(SUM(te.regular_hours + te.overtime_hours), 0) FROM finance.site_time_entries te
                     WHERE te.worker_id=w.id AND te.pay_run_id IS NULL) AS unpaid_hours
            FROM finance.site_workers w
            LEFT JOIN projects.projects p ON p.id=w.project_id
            LEFT JOIN core.users reg ON reg.id=w.created_by
            WHERE w.organization_id=:org_id AND w.is_deleted=false
              AND (CAST(:status AS varchar) = 'all' OR w.status=CAST(:status AS varchar))
              AND (CAST(:project_id AS uuid) IS NULL OR w.project_id=CAST(:project_id AS uuid))
            ORDER BY w.hr_verified, w.status, w.full_name
        """),
            {"org_id": user["org_id"], "status": status_filter or "all",
             "project_id": str(project_id) if project_id else None},
        )
    )
    return result(data, "Project hires listed.", len(data))


@hr_router.post("/{worker_id}/verify")
async def verify_project_hire(
    worker_id: UUID,
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    updated = (
        await db.execute(
            text("""UPDATE finance.site_workers SET hr_verified=true, hr_verified_by=:user_id, hr_verified_at=NOW(), updated_at=NOW()
                    WHERE id=:id AND organization_id=:org_id AND is_deleted=false RETURNING full_name"""),
            {"id": worker_id, "org_id": user["org_id"], "user_id": user["user_id"]},
        )
    ).scalar()
    if not updated:
        raise HTTPException(status_code=404, detail="Project hire not found.")
    await db.commit()
    return result({"id": str(worker_id)}, f"{updated} verified.")


@hr_router.post("/{worker_id}/status")
async def set_project_hire_status(
    worker_id: UUID,
    payload: HireStatus,
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    if payload.status == "inactive" and not payload.reason:
        raise HTTPException(status_code=422, detail="Give a reason for deactivating.")
    updated = (
        await db.execute(
            text("""
            UPDATE finance.site_workers
            SET status=CAST(:status AS varchar), status_reason=:reason, status_changed_by=:user_id, status_changed_at=NOW(),
                end_date=CASE WHEN CAST(:status AS varchar)='inactive' THEN CAST(:today AS date) ELSE NULL END, updated_at=NOW()
            WHERE id=:id AND organization_id=:org_id AND is_deleted=false
            RETURNING full_name
        """),
            {"status": payload.status, "reason": payload.reason, "user_id": user["user_id"], "id": worker_id,
             "org_id": user["org_id"], "today": harare_today()},
        )
    ).scalar()
    if not updated:
        raise HTTPException(status_code=404, detail="Project hire not found.")
    await db.commit()
    return result({"id": str(worker_id), "status": payload.status},
                  f"{updated} {'activated' if payload.status == 'active' else 'deactivated'}.")


@hr_router.patch("/{worker_id}")
async def update_project_hire(
    worker_id: UUID,
    payload: HireUpdate,
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        return result({"id": str(worker_id)}, "Nothing to change.")
    sets = ", ".join(f"{key}=:{key}" for key in changes)
    updated = (
        await db.execute(
            text(f"""UPDATE finance.site_workers SET {sets}, updated_at=NOW()
                     WHERE id=:id AND organization_id=:org_id AND is_deleted=false RETURNING id"""),
            {**changes, "id": worker_id, "org_id": user["org_id"]},
        )
    ).scalar()
    if not updated:
        raise HTTPException(status_code=404, detail="Project hire not found.")
    await db.commit()
    return result({"id": str(worker_id)}, "Project hire updated.")


@hr_router.get("/hours")
async def list_pending_hours(
    status_filter: Literal["pending", "accepted", "rejected"] = Query(default="pending", alias="status"),
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Closed site days, one row per person, for HR to accept or reject."""
    data = _rows(
        await db.execute(
            text("""
            SELECT a.id, a.briefing_id, a.worker_kind, a.worker_name, a.trade, a.hourly_rate, a.ppe_ok,
                   a.clock_in_at, a.clock_out_at, a.regular_hours, a.overtime_hours, a.hr_status, a.hr_reason,
                   b.briefing_date, b.shift, b.toolbox_topic, b.safety_concern_raised, p.name AS project_name,
                   w.hr_verified, w.overtime_rate,
                   ROUND(COALESCE(a.regular_hours, 0) * COALESCE(a.hourly_rate, 0)
                       + COALESCE(a.overtime_hours, 0) * COALESCE(w.overtime_rate, a.hourly_rate * 1.5, 0), 2) AS estimated_pay
            FROM projects.site_day_attendance a
            JOIN projects.site_day_briefings b ON b.id=a.briefing_id
            JOIN projects.projects p ON p.id=a.project_id
            LEFT JOIN finance.site_workers w ON w.id=a.site_worker_id
            WHERE a.organization_id=:org_id AND a.hr_status=:status
            ORDER BY b.briefing_date DESC, p.name, a.worker_kind DESC, a.worker_name
            LIMIT 1000
        """),
            {"org_id": user["org_id"], "status": status_filter},
        )
    )
    return result(data, "Site hours listed.", len(data))


@hr_router.post("/hours/decision")
async def decide_hours(
    payload: HoursDecision,
    user: dict = Depends(require_permission("workforce.project_hires.manage")),
    db: AsyncSession = Depends(get_db),
):
    """Accepted project-hire hours become site time entries (billing via the
    existing site pay runs). Employees' attendance is accepted as a record only;
    staff are paid through payroll."""
    org_id = user["org_id"]
    if payload.decision == "rejected" and not payload.reason:
        raise HTTPException(status_code=422, detail="Give a reason for rejecting hours.")
    rows = _rows(
        await db.execute(
            text("""
            SELECT a.*, b.briefing_date FROM projects.site_day_attendance a
            JOIN projects.site_day_briefings b ON b.id=a.briefing_id
            WHERE a.organization_id=:org_id AND a.id = ANY(CAST(:ids AS uuid[])) AND a.hr_status='pending'
        """),
            {"org_id": org_id, "ids": [str(i) for i in payload.attendance_ids]},
        )
    )
    if not rows:
        raise HTTPException(status_code=409, detail="None of those hours are waiting for a decision.")
    for row in rows:
        entry_id = None
        if payload.decision == "accepted" and row["worker_kind"] == "project_hire":
            entry_id = (
                await db.execute(
                    text("""
                    INSERT INTO finance.site_time_entries (
                        organization_id, worker_id, project_id, work_date, regular_hours, overtime_hours, notes, created_by
                    ) VALUES (:org_id, :worker_id, :project_id, :work_date, :regular, :overtime, :notes, :user_id)
                    ON CONFLICT (worker_id, project_id, work_date) DO UPDATE
                    SET regular_hours=EXCLUDED.regular_hours, overtime_hours=EXCLUDED.overtime_hours,
                        notes=EXCLUDED.notes, updated_at=NOW()
                    WHERE finance.site_time_entries.pay_run_id IS NULL
                    RETURNING id
                """),
                    {"org_id": org_id, "worker_id": row["site_worker_id"], "project_id": row["project_id"],
                     "work_date": row["briefing_date"], "regular": row["regular_hours"] or 0,
                     "overtime": row["overtime_hours"] or 0, "notes": "Site register, HR accepted",
                     "user_id": user["user_id"]},
                )
            ).scalar()
            if entry_id is None:
                raise HTTPException(
                    status_code=409,
                    detail=f"{row['worker_name']}'s hours for {row['briefing_date']} are already in a site pay run.",
                )
        await db.execute(
            text("""UPDATE projects.site_day_attendance
                    SET hr_status=:decision, hr_reason=:reason, time_entry_id=:entry_id, updated_at=NOW()
                    WHERE id=:id"""),
            {"decision": payload.decision, "reason": payload.reason, "entry_id": entry_id, "id": row["id"]},
        )
    # Roll each touched day up: accepted / rejected / partially accepted.
    briefing_ids = list({str(r["briefing_id"]) for r in rows})
    await db.execute(
        text("""
        UPDATE projects.site_day_briefings b SET
            hr_status = CASE
                WHEN s.pending > 0 THEN 'pending'
                WHEN s.rejected = 0 THEN 'accepted'
                WHEN s.accepted = 0 THEN 'rejected'
                ELSE 'partially_accepted' END,
            hr_reviewed_by=:user_id, hr_reviewed_at=NOW(), updated_at=NOW()
        FROM (
            SELECT briefing_id,
                   COUNT(*) FILTER (WHERE hr_status='pending') AS pending,
                   COUNT(*) FILTER (WHERE hr_status='accepted') AS accepted,
                   COUNT(*) FILTER (WHERE hr_status='rejected') AS rejected
            FROM projects.site_day_attendance WHERE briefing_id = ANY(CAST(:ids AS uuid[])) GROUP BY briefing_id
        ) s
        WHERE b.id=s.briefing_id
    """),
        {"ids": briefing_ids, "user_id": user["user_id"]},
    )
    await db.commit()
    return result({"updated": len(rows), "decision": payload.decision},
                  f"{len(rows)} line(s) {payload.decision}.")
