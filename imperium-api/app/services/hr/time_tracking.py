"""Automatic attendance, the weekly hours confirmation, and absence figures.

The rules the business asked for (2026-10-04):

* Signing in to AEGIS checks you in. The first sign-in of the day (Harare time)
  is the check-in time, and later sign-ins change nothing.
* The clock stops at 16:30. hours = 16:30 (or now, if earlier today) minus
  check-in. app.workers.arq_worker.close_attendance_day_job writes the 16:30
  check-out each afternoon.
* The working week runs Saturday to Friday. From Friday (with catch-up until
  Monday) the first sign-in shows the person their week, and they confirm it or
  correct it with a reason. A day on approved leave is excluded (0 hours) and
  flagged. Their line manager or HR then approves the week, and payroll reads
  approved weeks.
* A Zimbabwe public holiday (hr.public_holidays) is neither worked nor absent.

A second time source (Teams presence, later a hardware clock) writes
hr.attendance_events with its own source and is compared against these
records. That matching is not built yet.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

HARARE = timezone(timedelta(hours=2), "CAT")
DAY_END = time(16, 30)
LATE_AFTER = time(8, 15)
STANDARD_HOURS = 8.5  # 08:00-16:30
CATCH_UP_DAYS = 3  # Friday's confirmation is still offered Sat, Sun and Mon


def local_now() -> datetime:
    return datetime.now(HARARE)


def day_end_at(day: date) -> datetime:
    return datetime.combine(day, DAY_END, tzinfo=HARARE)


def week_end_for(day: date) -> date:
    """The Friday that closes the Saturday-Friday week containing `day`."""
    return day + timedelta(days=(4 - day.weekday()) % 7)


def last_closed_week_end(today: date) -> date:
    """The most recent Friday on or before today."""
    return today - timedelta(days=(today.weekday() - 4) % 7)


def confirmation_week_due(today: date) -> Optional[date]:
    """Which week the sign-in popup should ask about today, if any."""
    friday = last_closed_week_end(today)
    return friday if (today - friday).days <= CATCH_UP_DAYS else None


def worked_hours(check_in: Optional[datetime], check_out: Optional[datetime], day: date, now: datetime) -> float:
    """Hours from check-in to check-out, or to 16:30 (or now, while today is still running)."""
    if not check_in:
        return 0.0
    if check_out:
        end = check_out
    elif day < now.astimezone(HARARE).date():
        end = day_end_at(day)
    else:
        end = min(now, day_end_at(day))
    return round(max(0.0, (end - check_in).total_seconds() / 3600), 2)


async def own_employee(db: AsyncSession, user: dict) -> Optional[dict]:
    row = (await db.execute(text("""
        SELECT id, employee_name, employee_number, employment_status, start_date FROM hr.employees
        WHERE organization_id=:org AND linked_user_id=:uid AND is_deleted=false
    """), {"org": user["org_id"], "uid": user["user_id"]})).mappings().first()
    return dict(row) if row else None


async def check_in(db: AsyncSession, user: dict, *, now: Optional[datetime] = None) -> dict[str, Any]:
    """Idempotent: creates today's record on the first call, returns it after that."""
    employee = await own_employee(db, user)
    if not employee or employee["employment_status"] == "terminated":
        return {"linked": False}
    now = (now or local_now()).astimezone(HARARE)
    today = now.date()
    status = "late" if today.weekday() < 5 and now.time() > LATE_AFTER else "present"
    created = (await db.execute(text("""
        INSERT INTO hr.attendance_records (organization_id, employee_id, attendance_date, check_in, status,
          regular_hours, overtime_hours, source, recorded_by, notes)
        VALUES (:org, :emp, :day, :now, :status, 0, 0, 'aegis_login', :uid, 'Checked in by signing in to AEGIS')
        ON CONFLICT (organization_id, employee_id, attendance_date) DO NOTHING
        RETURNING id
    """), {"org": user["org_id"], "emp": employee["id"], "day": today, "now": now, "status": status, "uid": user["user_id"]})).scalar()
    if created:
        await db.execute(text("""
            INSERT INTO hr.attendance_events (organization_id, employee_id, occurred_at, event_type, source, recorded_by)
            VALUES (:org, :emp, :now, 'clock_in', 'aegis_login', :uid)
        """), {"org": user["org_id"], "emp": employee["id"], "now": now, "uid": user["user_id"]})
        await db.commit()
    record = (await db.execute(text("""
        SELECT check_in, check_out, status, source FROM hr.attendance_records
        WHERE organization_id=:org AND employee_id=:emp AND attendance_date=:day AND is_deleted=false
    """), {"org": user["org_id"], "emp": employee["id"], "day": today})).mappings().first()
    due_week = confirmation_week_due(today)
    week_due = None
    if due_week:
        confirmed = (await db.execute(text("""
            SELECT status FROM hr.weekly_hours WHERE organization_id=:org AND employee_id=:emp AND week_end=:we
        """), {"org": user["org_id"], "emp": employee["id"], "we": due_week})).scalar()
        if not confirmed:
            week_due = due_week.isoformat()
    return {
        "linked": True,
        "employee_id": str(employee["id"]),
        "checked_in_now": bool(created),
        "check_in": record["check_in"] if record else None,
        "status": record["status"] if record else None,
        "hours_so_far": worked_hours(record["check_in"], record["check_out"], today, now) if record else 0,
        "day_ends_at": day_end_at(today).isoformat(),
        "weekly_confirmation_due": week_due,
    }


async def _holidays(db, org_id, start: date, end: date) -> dict[date, str]:
    rows = await db.execute(text("""SELECT holiday_date, name FROM hr.public_holidays
        WHERE organization_id=:org AND is_deleted=false AND holiday_date BETWEEN :s AND :e"""), {"org": org_id, "s": start, "e": end})
    return {r.holiday_date: r.name for r in rows}


async def _leave(db, org_id, employee_ids: Optional[list], start: date, end: date) -> dict[tuple, str]:
    rows = await db.execute(text("""SELECT employee_id, leave_type, start_date, end_date FROM hr.leave_requests
        WHERE organization_id=:org AND is_deleted=false AND status='approved' AND start_date <= :e AND end_date >= :s
          AND (CAST(:ids AS uuid[]) IS NULL OR employee_id = ANY(CAST(:ids AS uuid[])))"""),
        {"org": org_id, "s": start, "e": end, "ids": [str(i) for i in employee_ids] if employee_ids else None})
    out: dict[tuple, str] = {}
    for r in rows:
        d = max(r.start_date, start)
        while d <= min(r.end_date, end):
            out[(str(r.employee_id), d)] = r.leave_type
            d += timedelta(days=1)
    return out


async def week_view(db: AsyncSession, org_id, employee_id, week_end: date, *, now: Optional[datetime] = None) -> dict[str, Any]:
    if week_end.weekday() != 4:
        raise HTTPException(422, "A week ends on a Friday")
    now = (now or local_now()).astimezone(HARARE)
    today = now.date()
    start = week_end - timedelta(days=6)
    records = {r["attendance_date"]: dict(r) for r in (await db.execute(text("""
        SELECT attendance_date, check_in, check_out, status, source, regular_hours, overtime_hours, auto_closed
        FROM hr.attendance_records WHERE organization_id=:org AND employee_id=:emp AND is_deleted=false
          AND attendance_date BETWEEN :s AND :e
    """), {"org": org_id, "emp": employee_id, "s": start, "e": week_end})).mappings()}
    holidays = await _holidays(db, org_id, start, week_end)
    leave = await _leave(db, org_id, [employee_id], start, week_end)
    days = []
    for offset in range(7):
        d = start + timedelta(days=offset)
        rec = records.get(d)
        leave_type = leave.get((str(employee_id), d))
        workday = d.weekday() < 5 and d not in holidays
        if rec and rec["check_in"]:
            hours = worked_hours(rec["check_in"], rec["check_out"], d, now)
        else:
            hours = float(rec["regular_hours"] or 0) + float(rec["overtime_hours"] or 0) if rec else 0.0
        if leave_type and workday:
            kind = "leave"
        elif d in holidays:
            kind = "holiday"
        elif d > today:
            kind = "future"
        elif rec:
            kind = "worked"
        elif workday:
            kind = "absent"
        else:
            kind = "weekend"
        days.append({
            "date": d.isoformat(), "weekday": d.strftime("%A"), "workday": workday, "kind": kind,
            "holiday": holidays.get(d), "leave_type": leave_type,
            "check_in": rec["check_in"].astimezone(HARARE).strftime("%H:%M") if rec and rec["check_in"] else None,
            "check_out": rec["check_out"].astimezone(HARARE).strftime("%H:%M") if rec and rec["check_out"] else None,
            "auto_closed": bool(rec and rec["auto_closed"]),
            "source": rec["source"] if rec else None,
            "recorded_hours": 0.0 if kind == "leave" else hours,
        })
    existing = (await db.execute(text("""SELECT id, status, days, confirmed_hours, decision_note, submitted_at, decided_at
        FROM hr.weekly_hours WHERE organization_id=:org AND employee_id=:emp AND week_end=:we"""),
        {"org": org_id, "emp": employee_id, "we": week_end})).mappings().first()
    return {
        "week_start": start.isoformat(), "week_end": week_end.isoformat(), "days": days,
        "recorded_hours": round(sum(d["recorded_hours"] for d in days), 2),
        "leave_days": sum(1 for d in days if d["kind"] == "leave"),
        "absent_days": sum(1 for d in days if d["kind"] == "absent"),
        "standard_hours": STANDARD_HOURS * sum(1 for d in days if d["workday"] and d["kind"] != "leave"),
        "confirmation": dict(existing) if existing else None,
    }


@dataclass
class DayInput:
    date: date
    hours: float
    note: Optional[str]


async def confirm_week(db: AsyncSession, user: dict, employee_id, week_end: date, entries: list[DayInput]) -> dict[str, Any]:
    view = await week_view(db, user["org_id"], employee_id, week_end)
    if view["confirmation"] and view["confirmation"]["status"] == "approved":
        raise HTTPException(409, "This week has already been approved")
    if date.fromisoformat(view["week_end"]) > local_now().date():
        raise HTTPException(422, "You can only confirm a week from its Friday onwards")
    given = {e.date: e for e in entries}
    if any(d not in {date.fromisoformat(x["date"]) for x in view["days"]} for d in given):
        raise HTTPException(422, "Every day must fall inside the week")
    days, corrections, confirmed = [], 0, 0.0
    for day in view["days"]:
        d = date.fromisoformat(day["date"])
        entry = given.get(d)
        hours = float(entry.hours) if entry else day["recorded_hours"]
        if day["kind"] == "leave":
            hours = 0.0  # leave days are excluded, never claimed
        if not 0 <= hours <= 16:
            raise HTTPException(422, f"{day['weekday']}: hours must be between 0 and 16")
        changed = abs(hours - day["recorded_hours"]) >= 0.01
        note = (entry.note or "").strip() if entry else ""
        if changed and len(note) < 3:
            raise HTTPException(422, f"{day['weekday']}: say why the hours differ from what AEGIS recorded")
        corrections += int(changed)
        confirmed += hours
        days.append({**day, "confirmed_hours": round(hours, 2), "note": note or None, "corrected": changed})
    row = (await db.execute(text("""
        INSERT INTO hr.weekly_hours (organization_id, employee_id, week_start, week_end, days, recorded_hours,
          confirmed_hours, leave_days, corrections, status, submitted_by, submitted_at)
        VALUES (:org, :emp, :ws, :we, CAST(:days AS jsonb), :rec, :conf, :leave, :corr, 'submitted', :uid, now())
        ON CONFLICT (organization_id, employee_id, week_end) DO UPDATE SET days=EXCLUDED.days,
          recorded_hours=EXCLUDED.recorded_hours, confirmed_hours=EXCLUDED.confirmed_hours, leave_days=EXCLUDED.leave_days,
          corrections=EXCLUDED.corrections, status='submitted', submitted_by=EXCLUDED.submitted_by, submitted_at=now(),
          decided_by=NULL, decided_at=NULL, decision_note=NULL, updated_at=now()
        RETURNING id
    """), {"org": user["org_id"], "emp": employee_id, "ws": date.fromisoformat(view["week_start"]), "we": week_end,
           "days": json.dumps(days, default=str), "rec": view["recorded_hours"], "conf": round(confirmed, 2),
           "leave": view["leave_days"], "corr": corrections, "uid": user["user_id"]})).scalar_one()
    return {"id": str(row), "confirmed_hours": round(confirmed, 2), "corrections": corrections}


async def line_manager_user(db, org_id, employee_id) -> Optional[str]:
    return (await db.execute(text("""
        SELECT m.linked_user_id FROM hr.reporting_lines r JOIN hr.employees m ON m.id=r.manager_employee_id
        WHERE r.organization_id=:org AND r.employee_id=:emp AND r.is_deleted=false AND r.relationship_type='line_manager'
          AND r.effective_from <= CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to >= CURRENT_DATE)
        ORDER BY r.effective_from DESC LIMIT 1
    """), {"org": org_id, "emp": employee_id})).scalar()


async def close_day(db: AsyncSession, day: date, org_id: Optional[str] = None) -> int:
    """Stop the clock at 16:30 for every sign-in record of `day` still open."""
    result = await db.execute(text("""
        UPDATE hr.attendance_records r
        SET check_out = GREATEST(r.check_in, CAST(:end_at AS timestamptz)),
            regular_hours = ROUND(CAST(GREATEST(0, EXTRACT(EPOCH FROM (CAST(:end_at AS timestamptz) - r.check_in)) / 3600) AS numeric), 2),
            auto_closed = true, updated_at = now()
        WHERE r.attendance_date = :day AND r.check_out IS NULL AND r.check_in IS NOT NULL AND r.is_deleted = false
          AND r.source = 'aegis_login'
          AND (CAST(:org AS uuid) IS NULL OR r.organization_id = CAST(:org AS uuid))
    """), {"day": day, "end_at": day_end_at(day), "org": org_id})
    await db.commit()
    return result.rowcount or 0


async def day_board(db: AsyncSession, org_id, day: date) -> list[dict[str, Any]]:
    """Everyone current, with their record for `day`, leave or holiday."""
    now = local_now()
    holidays = await _holidays(db, org_id, day, day)
    leave = await _leave(db, org_id, None, day, day)
    rows = (await db.execute(text("""
        SELECT e.id, e.employee_number, e.employee_name, p.name AS position_name,
               r.check_in, r.check_out, r.status, r.source, r.regular_hours, r.overtime_hours, r.auto_closed
        FROM hr.employees e
        LEFT JOIN hr.positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
        LEFT JOIN hr.attendance_records r ON r.organization_id=e.organization_id AND r.employee_id=e.id
             AND r.attendance_date=:day AND r.is_deleted=false
        WHERE e.organization_id=:org AND e.is_deleted=false AND e.employment_status <> 'terminated'
        ORDER BY r.check_in NULLS LAST, e.employee_name
    """), {"org": org_id, "day": day})).mappings()
    out = []
    workday = day.weekday() < 5 and day not in holidays
    for r in rows:
        leave_type = leave.get((str(r["id"]), day))
        if r["check_in"]:
            hours = worked_hours(r["check_in"], r["check_out"], day, now)
            state = "late" if r["status"] == "late" else "in"
        elif r["status"]:
            hours = float(r["regular_hours"] or 0) + float(r["overtime_hours"] or 0)
            state = r["status"]
        else:
            hours = 0.0
            state = "leave" if leave_type else "holiday" if day in holidays else "not_in" if workday else "off"
        out.append({
            "employee_id": str(r["id"]), "employee_number": r["employee_number"], "employee_name": r["employee_name"],
            "position_name": r["position_name"], "state": state, "leave_type": leave_type,
            "check_in": r["check_in"].astimezone(HARARE).strftime("%H:%M") if r["check_in"] else None,
            "check_out": r["check_out"].astimezone(HARARE).strftime("%H:%M") if r["check_out"] else None,
            "auto_closed": bool(r["auto_closed"]), "source": r["source"], "hours": hours,
        })
    return out


async def absence_report(db: AsyncSession, org_id, start: date, end: date) -> list[dict[str, Any]]:
    """Per person between two dates: working days, days present, leave, absences, late arrivals."""
    today = local_now().date()
    last = min(end, today)
    holidays = await _holidays(db, org_id, start, end)
    leave = await _leave(db, org_id, None, start, end)
    people = (await db.execute(text("""
        SELECT e.id, e.employee_number, e.employee_name, e.start_date, e.end_date, p.name AS position_name
        FROM hr.employees e LEFT JOIN hr.positions p ON p.id=e.position_id AND p.organization_id=e.organization_id
        WHERE e.organization_id=:org AND e.is_deleted=false
          AND (e.employment_status <> 'terminated' OR e.end_date >= :s)
        ORDER BY e.employee_name
    """), {"org": org_id, "s": start})).mappings().all()
    records = (await db.execute(text("""
        SELECT employee_id, attendance_date, status, check_in, check_out, regular_hours, overtime_hours
        FROM hr.attendance_records WHERE organization_id=:org AND is_deleted=false AND attendance_date BETWEEN :s AND :e
    """), {"org": org_id, "s": start, "e": last})).mappings().all()
    by_person: dict[str, dict[date, dict]] = {}
    for r in records:
        by_person.setdefault(str(r["employee_id"]), {})[r["attendance_date"]] = dict(r)
    out = []
    now = local_now()
    for p in people:
        pid = str(p["id"])
        first = max(start, p["start_date"] or start)
        stop = min(last, p["end_date"] or last)
        workdays = present = on_leave = absent = late = 0
        hours = 0.0
        leave_by_type: dict[str, int] = {}
        absent_dates: list[str] = []
        d = first
        while d <= stop:
            rec = by_person.get(pid, {}).get(d)
            is_workday = d.weekday() < 5 and d not in holidays
            if rec:
                hours += worked_hours(rec["check_in"], rec["check_out"], d, now) if rec["check_in"] else float(rec["regular_hours"] or 0)
            if is_workday:
                workdays += 1
                lt = leave.get((pid, d))
                if lt:
                    on_leave += 1
                    leave_by_type[lt] = leave_by_type.get(lt, 0) + 1
                elif rec and rec["status"] not in ("absent",):
                    present += 1
                    late += int(rec["status"] == "late")
                elif d < today:
                    absent += 1
                    absent_dates.append(d.isoformat())
            d += timedelta(days=1)
        out.append({
            "employee_id": pid, "employee_number": p["employee_number"], "employee_name": p["employee_name"],
            "position_name": p["position_name"], "workdays": workdays, "present": present, "leave": on_leave,
            "leave_by_type": leave_by_type, "absent": absent, "absent_dates": absent_dates[-10:], "late": late,
            "hours": round(hours, 1),
            "attendance_rate": round(100 * present / max(1, workdays - on_leave)) if workdays - on_leave > 0 else None,
        })
    return out
