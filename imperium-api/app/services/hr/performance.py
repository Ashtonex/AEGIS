"""Weekly performance scorecards: every Friday morning each employee is graded
on the week that ended the night before (Friday to Thursday, Harare time),
from what AEGIS recorded - never from opinion.

Five areas, each scored 0-100 against a target anyone doing their job can hit:

  Delivery        40  tasks due this week closed on or before the due date
                      (70%) and the share of their open book that is not
                      overdue (30%); -10 per task closed without the evidence
                      it required
  Reliability     20  signed in to AEGIS on every working day (80%), by 08:15
                      (20%); approved leave and public holidays don't count
  Records         15  weekly hours confirmed on time; an outcome recorded on
                      every completed task
  Responsiveness  15  new tasks picked up (moved past not started) within 48h
  Work recorded   10  a working day with at least one piece of work written
                      to AEGIS, every working day

An area with nothing to measure is left out and the rest are re-weighted.
Someone with no tasks is still graded on reliability, records and work
recorded (45% of the weight); below that the week is "insufficient data" -
not graded, and flagged to the line manager, because work AEGIS can't see is
a problem in itself. Raw click/login counts are never scored.

Standing (live weeks only, the score is the override if a manager set one):
below par once -> watch; below par two live weeks running -> a two-week
assisted working period supervised by the line manager; both assisted weeks
at or above par -> passed, otherwise escalated to HR. Escalation is a flag
and an evidence trail: a person decides what happens next, never this code.

In shadow mode everything is computed and stored but only the management
digest goes out, and "would_assist" marks where live mode would have opened
an assisted working period.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.hr import time_tracking as tt

HARARE = timezone(timedelta(hours=2), "CAT")
SEND_WEEKDAY = 4  # Friday
SEND_HOUR = 7  # 07:00 Harare time
WEEK_END_WEEKDAY = 3  # Thursday
PICKUP_HOURS = 48
MIN_MEASURED_WEIGHT = 45  # reliability + records + work recorded: enough to grade someone with no tasks
DISPUTE_HOURS = 48

WEIGHTS = {"delivery": 40, "reliability": 20, "records": 15, "responsiveness": 15, "output": 10}
LABELS = {
    "delivery": "Delivery",
    "reliability": "Reliability",
    "records": "Records",
    "responsiveness": "Responsiveness",
    "output": "Work recorded",
}
TARGETS = {
    "delivery": "Every task closed by its due date, nothing overdue",
    "reliability": "Signed in every working day by 08:15",
    "records": "Hours confirmed; an outcome on every completed task",
    "responsiveness": "Every new task picked up within 48 hours",
    "output": "Work recorded in AEGIS every working day",
}
GRADE_BANDS = ((85, "A"), (70, "B"), (60, "C"), (50, "D"), (0, "F"))
INACTIVE_TASK_STATUSES = ("not_applicable", "superseded", "cancelled")
# Rows written for someone rather than by them, or housekeeping that isn't work.
NOT_WORK_TABLES = (
    "core.notifications", "core.users", "core.user_roles", "core.sequences",
    "hr.attendance_records", "hr.attendance_events", "hr.weekly_hours",
)
TABLE_LABELS = {
    "finance.journal_entries": "journal entries", "finance.journal_lines": "journal lines",
    "finance.bank_statement_lines": "bank lines", "finance.cashbook_transactions": "cashbook entries",
    "crm.activities": "CRM activities", "crm.opportunities": "opportunity updates", "crm.tenders": "tender updates",
    "crm.leads": "lead updates", "core.documents": "documents", "core.file_attachments": "files uploaded",
    "finance.quotations": "quotation updates", "projects.projects": "project updates",
    "crm.tender_requirements": "tender requirements", "procurement.purchase_requisitions": "requisitions",
    "procurement.supplier_invoices": "supplier invoices", "projects.daily_site_reports": "site reports",
    "crm.tasks": "task updates", "hr.employees": "employee records", "crm.subcontractors": "subcontractor updates",
}
STANDING_LABELS = {
    "good": "Good standing",
    "watch": "Watch - below par this week",
    "would_assist": "Would enter assisted working (shadow)",
    "assisted_opened": "Assisted working period starts",
    "assisted": "Assisted working period",
    "passed": "Assisted working period passed",
    "escalated": "Escalated to HR",
    "insufficient_data": "Insufficient data",
    "not_onboarded": "Never signed in to AEGIS",
}


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------
def scoring_week(now: datetime) -> tuple[date, date]:
    """(Friday, Thursday) of the last complete Friday-Thursday week before now."""
    today = now.astimezone(HARARE).date()
    back = (today.weekday() - WEEK_END_WEEKDAY) % 7 or 7
    end = today - timedelta(days=back)
    return end - timedelta(days=6), end


def week_for_end(week_end: date) -> tuple[date, date]:
    if week_end.weekday() != WEEK_END_WEEKDAY:
        raise ValueError("A scoring week ends on a Thursday.")
    return week_end - timedelta(days=6), week_end


def is_send_time(now: datetime) -> bool:
    """Friday from 07:00 Harare time; later hourly runs retry anything unsent."""
    local = now.astimezone(HARARE)
    return local.weekday() == SEND_WEEKDAY and local.hour >= SEND_HOUR


def day_start(day: date) -> datetime:
    return datetime.combine(day, time(0), tzinfo=HARARE)


def grade_for(score: Optional[float]) -> Optional[str]:
    if score is None:
        return None
    return next(letter for floor, letter in GRADE_BANDS if score >= floor)


def working_days(start: date, end: date, *, holidays: set[date], leave: set[date], employed_from: Optional[date]) -> list[date]:
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5 and d not in holidays and d not in leave and (employed_from is None or d >= employed_from):
            days.append(d)
        d += timedelta(days=1)
    return days


# ---------------------------------------------------------------------------
# Scoring (pure)
# ---------------------------------------------------------------------------
@dataclass
class WeekMetrics:
    workdays: list[date] = field(default_factory=list)
    attendance_tracked_days: list[date] = field(default_factory=list)
    present_days: int = 0
    late_days: int = 0
    tasks_due: int = 0
    tasks_on_time: int = 0
    tasks_closed_late: int = 0
    open_tasks: int = 0
    overdue_tasks: int = 0
    completed: int = 0
    missing_evidence: int = 0
    missing_outcome: int = 0
    new_tasks: int = 0
    picked_up: int = 0
    hours_week_end: Optional[date] = None
    hours_confirmation_applies: bool = False
    hours_confirmed: bool = False
    productive_days: int = 0
    work_by_kind: dict[str, int] = field(default_factory=dict)


def _clamp(value: float) -> float:
    return round(max(0.0, min(100.0, value)), 1)


def score_components(m: WeekMetrics) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}

    # Delivery
    delivery = None
    if m.tasks_due or m.open_tasks:
        health = 1.0 if not m.open_tasks else 1 - m.overdue_tasks / m.open_tasks
        if m.tasks_due:
            delivery = 70 * m.tasks_on_time / m.tasks_due + 30 * health
        else:
            delivery = 100 * health
        delivery = _clamp(delivery - 10 * m.missing_evidence)
    out["delivery"] = {
        "score": delivery,
        "metrics": {
            "tasks_due": m.tasks_due, "on_time": m.tasks_on_time, "closed_late": m.tasks_closed_late,
            "open_tasks": m.open_tasks, "overdue": m.overdue_tasks, "missing_evidence": m.missing_evidence,
        },
    }

    # Reliability
    reliability = None
    if m.attendance_tracked_days:
        days = len(m.attendance_tracked_days)
        punctual = (m.present_days - m.late_days) / m.present_days if m.present_days else 0
        reliability = _clamp(80 * m.present_days / days + 20 * punctual)
    out["reliability"] = {
        "score": reliability,
        "metrics": {"working_days": len(m.attendance_tracked_days), "present": m.present_days, "late": m.late_days},
    }

    # Records
    parts = []
    if m.hours_confirmation_applies:
        parts.append(100.0 if m.hours_confirmed else 0.0)
    if m.completed:
        parts.append(100 * (m.completed - m.missing_outcome) / m.completed)
    out["records"] = {
        "score": _clamp(sum(parts) / len(parts)) if parts else None,
        "metrics": {
            "hours_week_end": m.hours_week_end.isoformat() if m.hours_week_end and m.hours_confirmation_applies else None,
            "hours_confirmed": m.hours_confirmed if m.hours_confirmation_applies else None,
            "completed": m.completed, "missing_outcome": m.missing_outcome,
        },
    }

    # Responsiveness
    out["responsiveness"] = {
        "score": _clamp(100 * m.picked_up / m.new_tasks) if m.new_tasks else None,
        "metrics": {"new_tasks": m.new_tasks, "picked_up_in_48h": m.picked_up},
    }

    # Work recorded
    out["output"] = {
        "score": _clamp(100 * m.productive_days / len(m.workdays)) if m.workdays else None,
        "metrics": {"working_days": len(m.workdays), "days_with_work": m.productive_days, "work": m.work_by_kind},
    }

    for key, comp in out.items():
        comp["weight"] = WEIGHTS[key]
        comp["label"] = LABELS[key]
        comp["target"] = TARGETS[key]
    return out


def overall(components: dict[str, dict[str, Any]]) -> tuple[Optional[float], Optional[str], int]:
    measured = {k: c for k, c in components.items() if c["score"] is not None}
    weight = sum(WEIGHTS[k] for k in measured)
    if weight < MIN_MEASURED_WEIGHT:
        return None, None, weight
    score = round(sum(WEIGHTS[k] * c["score"] for k, c in measured.items()) / weight, 1)
    return score, grade_for(score), weight


def _plural(n: int, word: str) -> str:
    return f"{n} {word}" if n == 1 else f"{n} {word}s"


def narrative(components: dict[str, dict[str, Any]], score: Optional[float]) -> tuple[list[str], list[str]]:
    """(went well, to improve) - specific, with the numbers behind them."""
    well: list[str] = []
    improve: list[str] = []
    if score is None:
        improve.append(
            "AEGIS could not see enough of your week to grade it. Your work must be assigned and recorded "
            "in AEGIS - your line manager has been asked to make sure it is."
        )

    def say(key: str) -> tuple[str, str]:
        mt = components[key]["metrics"]
        if key == "delivery":
            good = f"Delivery: {mt['on_time']} of {mt['tasks_due']} tasks due this week closed on time" if mt["tasks_due"] else "Delivery: nothing in your open book is overdue"
            bad_bits = []
            if mt["tasks_due"]:
                bad_bits.append(f"{mt['on_time']} of {mt['tasks_due']} tasks due this week were closed on time")
            if mt["overdue"]:
                bad_bits.append(f"{mt['overdue']} of your {mt['open_tasks']} open tasks are past their due date - clear the oldest first")
            if mt["missing_evidence"]:
                bad_bits.append(f"{_plural(mt['missing_evidence'], 'task')} closed without the evidence required")
            return good + ".", "Delivery: " + "; ".join(bad_bits) + "."
        if key == "reliability":
            good = f"Reliability: signed in on {mt['present']} of {mt['working_days']} working days"
            if mt["late"]:
                good += f", late on {mt['late']}"
            bad = good + ". Sign in to AEGIS by 08:15 every working day."
            return good + ".", bad
        if key == "records":
            bits = []
            if mt["hours_confirmed"] is False:
                bits.append(f"hours for the week ending {date.fromisoformat(mt['hours_week_end']):%a %d %b} were not confirmed")
            if mt["missing_outcome"]:
                bits.append(f"{mt['missing_outcome']} of {mt['completed']} completed tasks have no outcome recorded")
            good = "Records: hours confirmed and outcomes recorded on completed work."
            return good, "Records: " + ("; ".join(bits) or "records incomplete") + "."
        if key == "responsiveness":
            line = f"Responsiveness: picked up {mt['picked_up_in_48h']} of {mt['new_tasks']} new tasks within 48 hours"
            return line + ".", line + ". Move a task to In progress as soon as you start it."
        line = f"Work recorded: AEGIS shows your work on {mt['days_with_work']} of {mt['working_days']} working days"
        return line + ".", line + ". If you worked, it must be recorded in AEGIS."

    measured = [(k, c["score"]) for k, c in components.items() if c["score"] is not None]
    if score is not None and components["delivery"]["score"] is None:
        improve.append("Delivery could not be measured: no tasks were assigned to you or due in AEGIS this week. "
                       "Make sure the work you do is set up as tasks in AEGIS.")
    for key, value in measured:
        good, bad = say(key)
        if value >= 85:
            well.append(good)
        elif value < 70:
            improve.append(bad)
    if score is not None and not improve:
        below = sorted((v, k) for k, v in measured if v < 85)
        if below:
            improve.append(say(below[0][1])[1])
    return well, improve


# ---------------------------------------------------------------------------
# Loading the week from AEGIS
# ---------------------------------------------------------------------------
async def get_settings(db: AsyncSession, org_id: str) -> dict[str, Any]:
    row = (await db.execute(text("""
        INSERT INTO hr.performance_settings (organization_id) VALUES (:org)
        ON CONFLICT (organization_id) DO UPDATE SET organization_id = EXCLUDED.organization_id
        RETURNING par_score, mode, live_from, digest_recipients, updated_at
    """), {"org": org_id})).mappings().one()
    return {
        "par_score": float(row["par_score"]),
        "mode": row["mode"],
        "live_from": row["live_from"],
        "digest_recipients": row["digest_recipients"] or "",
        "updated_at": row["updated_at"],
    }


def mode_for_week(settings: dict[str, Any], week_end: date) -> str:
    if settings["mode"] == "live" and (settings["live_from"] is None or week_end >= settings["live_from"]):
        return "live"
    return "shadow"


async def load_people(db: AsyncSession, org_id: str, week_end: date) -> list[dict[str, Any]]:
    rows = await db.execute(text("""
        SELECT e.id, e.employee_name, e.job_title, e.department, e.start_date, e.linked_user_id,
               u.email, u.full_name,
               lm.manager_employee_id, m.employee_name AS manager_name, m.linked_user_id AS manager_user_id,
               (a.last_sign_in_at IS NOT NULL OR EXISTS (
                   SELECT 1 FROM hr.attendance_records ar
                   WHERE ar.employee_id = e.id AND ar.source = 'aegis_login' AND ar.attendance_date <= :we
               )) AS onboarded
        FROM hr.employees e
        LEFT JOIN auth.users a ON a.id = e.linked_user_id
        JOIN core.users u ON u.id = e.linked_user_id AND u.is_deleted = false AND u.is_active = true
        LEFT JOIN LATERAL (
            SELECT r.manager_employee_id FROM hr.reporting_lines r
            WHERE r.organization_id = e.organization_id AND r.employee_id = e.id AND r.is_deleted = false
              AND r.relationship_type = 'line_manager' AND r.effective_from <= :we
              AND (r.effective_to IS NULL OR r.effective_to >= :we)
            ORDER BY r.effective_from DESC LIMIT 1
        ) lm ON true
        LEFT JOIN hr.employees m ON m.id = lm.manager_employee_id
        WHERE e.organization_id = :org AND e.is_deleted = false AND e.employment_status = 'active'
          AND (e.start_date IS NULL OR e.start_date <= :we)
        ORDER BY e.employee_name
    """), {"org": org_id, "we": week_end})
    return [dict(r) for r in rows.mappings()]


async def load_metrics(db: AsyncSession, org_id: str, people: list[dict[str, Any]], week_start: date, week_end: date) -> dict[str, WeekMetrics]:
    start_ts, cutoff = day_start(week_start), day_start(week_end + timedelta(days=1))
    pickup_cutoff = cutoff - timedelta(hours=PICKUP_HOURS)
    uids = [str(p["linked_user_id"]) for p in people]
    eids = [str(p["id"]) for p in people]
    by_user = {str(p["linked_user_id"]): str(p["id"]) for p in people}
    metrics = {str(p["id"]): WeekMetrics() for p in people}
    params = {"org": org_id, "uids": uids, "ws": week_start, "we": week_end, "start": start_ts,
              "cutoff": cutoff, "pickup_cutoff": pickup_cutoff, "inactive": list(INACTIVE_TASK_STATUSES)}

    holidays = set((await tt._holidays(db, org_id, week_start, week_end)).keys())
    leave = await tt._leave(db, org_id, eids, week_start, week_end)
    tracking_from = (await db.execute(text("""
        SELECT MIN(attendance_date) FROM hr.attendance_records
        WHERE organization_id = :org AND source = 'aegis_login' AND is_deleted = false
    """), {"org": org_id})).scalar()
    hours_from = (await db.execute(text(
        "SELECT MIN(week_end) FROM hr.weekly_hours WHERE organization_id = :org"), {"org": org_id})).scalar()

    for p in people:
        m = metrics[str(p["id"])]
        own_leave = {d for (emp, d) in leave if emp == str(p["id"])}
        m.workdays = working_days(week_start, week_end, holidays=holidays, leave=own_leave, employed_from=p["start_date"])
        m.attendance_tracked_days = [d for d in m.workdays if tracking_from and d >= tracking_from]
        # Hours are confirmed for the Saturday-Friday week that closed on this
        # scoring week's first day; the sign-in popup asks Friday to Monday.
        m.hours_week_end = week_start
        m.hours_confirmation_applies = bool(hours_from and week_start >= hours_from and m.workdays)

    tracked = {eid: set(m.attendance_tracked_days) for eid, m in metrics.items()}
    for r in (await db.execute(text("""
        SELECT employee_id, attendance_date, status FROM hr.attendance_records
        WHERE organization_id = :org AND is_deleted = false AND attendance_date BETWEEN :ws AND :we
          AND employee_id = ANY(CAST(:eids AS uuid[])) AND status IN ('present', 'late')
    """), {**params, "eids": eids})).mappings():
        eid = str(r["employee_id"])
        if r["attendance_date"] in tracked[eid]:
            metrics[eid].present_days += 1
            metrics[eid].late_days += r["status"] == "late"

    for r in (await db.execute(text("""
        SELECT employee_id FROM hr.weekly_hours
        WHERE organization_id = :org AND week_end = :ws AND submitted_at IS NOT NULL AND submitted_at < :cutoff
          AND employee_id = ANY(CAST(:eids AS uuid[]))
    """), {**params, "eids": eids})).mappings():
        metrics[str(r["employee_id"])].hours_confirmed = True

    for r in (await db.execute(text("""
        SELECT assigned_to_user_id AS uid,
               COUNT(*) AS due,
               COUNT(*) FILTER (WHERE completed_at IS NOT NULL
                                  AND CAST(completed_at AT TIME ZONE 'Africa/Harare' AS date) <= due_date) AS on_time,
               COUNT(*) FILTER (WHERE completed_at IS NOT NULL
                                  AND CAST(completed_at AT TIME ZONE 'Africa/Harare' AS date) > due_date) AS late
        FROM crm.tasks
        WHERE organization_id = :org AND is_deleted = false AND assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
          AND due_date BETWEEN :ws AND :we AND status <> ALL(CAST(:inactive AS text[]))
        GROUP BY 1
    """), params)).mappings():
        m = metrics[by_user[str(r["uid"])]]
        m.tasks_due, m.tasks_on_time, m.tasks_closed_late = r["due"], r["on_time"], r["late"]

    for r in (await db.execute(text("""
        SELECT assigned_to_user_id AS uid, COUNT(*) AS open,
               COUNT(*) FILTER (WHERE due_date <= :we) AS overdue
        FROM crm.tasks
        WHERE organization_id = :org AND is_deleted = false AND assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
          AND created_at < :cutoff AND (completed_at IS NULL OR completed_at >= :cutoff)
          AND status <> ALL(CAST(:inactive AS text[]))
        GROUP BY 1
    """), params)).mappings():
        m = metrics[by_user[str(r["uid"])]]
        m.open_tasks, m.overdue_tasks = r["open"], r["overdue"]

    for r in (await db.execute(text("""
        SELECT assigned_to_user_id AS uid, COUNT(*) AS completed,
               COUNT(*) FILTER (WHERE evidence_required AND evidence_ref IS NULL) AS missing_evidence,
               COUNT(*) FILTER (WHERE outcome IS NULL OR TRIM(outcome) = '') AS missing_outcome
        FROM crm.tasks
        WHERE organization_id = :org AND is_deleted = false AND assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
          AND completed_at >= :start AND completed_at < :cutoff
        GROUP BY 1
    """), params)).mappings():
        m = metrics[by_user[str(r["uid"])]]
        m.completed, m.missing_evidence, m.missing_outcome = r["completed"], r["missing_evidence"], r["missing_outcome"]

    # Tasks whose pick-up time isn't known (in progress before it was
    # recorded) are left out rather than counted against anyone.
    for r in (await db.execute(text("""
        SELECT assigned_to_user_id AS uid, COUNT(*) AS new_tasks,
               COUNT(*) FILTER (WHERE first_actioned_at <= COALESCE(auto_assigned_at, created_at) + INTERVAL '48 hours') AS picked
        FROM crm.tasks
        WHERE organization_id = :org AND is_deleted = false AND assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
          AND COALESCE(auto_assigned_at, created_at) >= :start AND COALESCE(auto_assigned_at, created_at) < :pickup_cutoff
          AND status <> ALL(CAST(:inactive AS text[]))
          AND NOT (first_actioned_at IS NULL AND status NOT IN ('not_started', 'ready'))
        GROUP BY 1
    """), params)).mappings():
        m = metrics[by_user[str(r["uid"])]]
        m.new_tasks, m.picked_up = r["new_tasks"], r["picked"]

    days_with_work: dict[str, set[date]] = {eid: set() for eid in metrics}
    for r in (await db.execute(text("""
        SELECT created_by AS uid, CAST(created_at AT TIME ZONE 'Africa/Harare' AS date) AS day, table_name, COUNT(*) AS n
        FROM core.audit_log
        WHERE created_by = ANY(CAST(:uids AS uuid[])) AND created_at >= :start AND created_at < :cutoff
          AND table_name <> ALL(CAST(:noise AS text[]))
        GROUP BY 1, 2, 3
    """), {**params, "noise": list(NOT_WORK_TABLES)})).mappings():
        eid = by_user.get(str(r["uid"]))
        if not eid:
            continue
        days_with_work[eid].add(r["day"])
        kind = TABLE_LABELS.get(r["table_name"], "other records")
        metrics[eid].work_by_kind[kind] = metrics[eid].work_by_kind.get(kind, 0) + r["n"]
    # Task work isn't in the audit log: picking up, submitting and closing tasks count too.
    for r in (await db.execute(text("""
        SELECT assigned_to_user_id AS uid, kind, CAST(at AT TIME ZONE 'Africa/Harare' AS date) AS day, COUNT(*) AS n
        FROM crm.tasks t
        CROSS JOIN LATERAL (VALUES ('tasks closed', t.completed_at), ('tasks submitted for review', t.review_submitted_at),
                                   ('tasks picked up', t.first_actioned_at)) AS ev(kind, at)
        WHERE t.organization_id = :org AND t.is_deleted = false AND t.assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
          AND at >= :start AND at < :cutoff
        GROUP BY 1, 2, 3
    """), params)).mappings():
        eid = by_user[str(r["uid"])]
        days_with_work[eid].add(r["day"])
        metrics[eid].work_by_kind[r["kind"]] = metrics[eid].work_by_kind.get(r["kind"], 0) + r["n"]
    for eid, m in metrics.items():
        m.productive_days = min(len(days_with_work[eid]), len(m.workdays))
    return metrics


async def load_next_focus(db: AsyncSession, org_id: str, user_ids: list[str], as_of: date) -> dict[str, list[dict[str, Any]]]:
    """The three oldest overdue open tasks per person, as they stand now."""
    out: dict[str, list[dict[str, Any]]] = {}
    rows = await db.execute(text("""
        SELECT uid, title, due_date FROM (
            SELECT assigned_to_user_id AS uid, title, due_date,
                   ROW_NUMBER() OVER (PARTITION BY assigned_to_user_id ORDER BY due_date, created_at) AS rn
            FROM crm.tasks
            WHERE organization_id = :org AND is_deleted = false AND assigned_to_user_id = ANY(CAST(:uids AS uuid[]))
              AND completed_at IS NULL AND due_date <= :as_of
              AND status NOT IN ('completed', 'not_applicable', 'superseded', 'cancelled')
        ) t WHERE rn <= 3
    """), {"org": org_id, "uids": user_ids, "as_of": as_of})
    for r in rows.mappings():
        out.setdefault(str(r["uid"]), []).append({"title": r["title"], "due_date": r["due_date"].isoformat()})
    return out


# ---------------------------------------------------------------------------
# Computing and freezing a week
# ---------------------------------------------------------------------------
def final_score(card: dict[str, Any]) -> Optional[float]:
    value = card.get("override_score")
    if value is None:
        value = card.get("score")
    return None if value is None else float(value)


async def week_is_frozen(db: AsyncSession, org_id: str, week_end: date) -> bool:
    """A live week that has been emailed to anyone can't be recomputed."""
    return bool((await db.execute(text("""
        SELECT 1 FROM hr.weekly_scorecards
        WHERE organization_id = :org AND week_end = :we AND mode = 'live' AND emailed_at IS NOT NULL LIMIT 1
    """), {"org": org_id, "we": week_end})).scalar())


async def compute_week(db: AsyncSession, org_id: str, week_end: date) -> dict[str, Any]:
    """Scores every active, linked employee for the week ending `week_end`
    (a Thursday) and stores the result. Recomputing replaces the scores but
    keeps overrides and disputes; a live week that has gone out is frozen.
    Caller commits. Returns {"week_end", "mode", "people", "assisted_opened",
    "escalated", "passed"}."""
    week_start, week_end = week_for_end(week_end)
    if await week_is_frozen(db, org_id, week_end):
        raise ValueError("This week has already been sent to staff and is frozen.")
    settings = await get_settings(db, org_id)
    par = settings["par_score"]
    mode = mode_for_week(settings, week_end)
    people = await load_people(db, org_id, week_end)
    if not people:
        return {"week_end": week_end.isoformat(), "mode": mode, "people": 0, "assisted_opened": [], "escalated": [], "passed": []}
    metrics = await load_metrics(db, org_id, people, week_start, week_end)
    focus = await load_next_focus(db, org_id, [str(p["linked_user_id"]) for p in people], week_end)

    previous = {
        str(r["employee_id"]): dict(r) for r in (await db.execute(text("""
            SELECT employee_id, score, override_score, mode FROM hr.weekly_scorecards
            WHERE organization_id = :org AND week_end = :prev
        """), {"org": org_id, "prev": week_end - timedelta(days=7)})).mappings()
    }
    existing = {
        str(r["employee_id"]): dict(r) for r in (await db.execute(text("""
            SELECT employee_id, override_score FROM hr.weekly_scorecards WHERE organization_id = :org AND week_end = :we
        """), {"org": org_id, "we": week_end})).mappings()
    }
    periods = {
        str(r["employee_id"]): dict(r) for r in (await db.execute(text("""
            SELECT DISTINCT ON (employee_id) id, employee_id, status, opened_week_end, first_week_end, last_week_end
            FROM hr.assisted_working_periods
            WHERE organization_id = :org AND status IN ('active', 'escalated') AND opened_week_end < :we
            ORDER BY employee_id, opened_week_end DESC
        """), {"org": org_id, "we": week_end})).mappings()
    } if mode == "live" else {}

    summary = {"week_end": week_end.isoformat(), "mode": mode, "people": len(people),
               "assisted_opened": [], "escalated": [], "passed": []}
    for person in people:
        eid = str(person["id"])
        components = score_components(metrics[eid])
        score, grade, _ = overall(components)
        well, improve = narrative(components, score)
        if not person["onboarded"]:
            # Never signed in: a set-up gap, not a verdict on their work.
            score, grade, well = None, None, []
            improve = ["You have not signed in to AEGIS yet, so your week could not be graded. Sign in today - "
                       "from your first sign-in every working day counts."]
        override = existing.get(eid, {}).get("override_score")
        final = float(override) if override is not None else score
        period = periods.get(eid)
        standing, period_id = await _standing(db, org_id, person, week_end, mode, par, final, previous.get(eid), period, summary)
        await db.execute(text("""
            INSERT INTO hr.weekly_scorecards (organization_id, employee_id, user_id, line_manager_employee_id,
                week_start, week_end, mode, score, grade, components, went_well, to_improve, next_focus,
                standing, assisted_period_id, computed_at)
            VALUES (:org, :emp, :uid, :mgr, :ws, :we, :mode, :score, :grade, CAST(:components AS jsonb),
                CAST(:well AS jsonb), CAST(:improve AS jsonb), CAST(:focus AS jsonb), :standing, :period, NOW())
            ON CONFLICT (organization_id, employee_id, week_end) DO UPDATE SET
                user_id = EXCLUDED.user_id, line_manager_employee_id = EXCLUDED.line_manager_employee_id,
                mode = EXCLUDED.mode, score = EXCLUDED.score, grade = EXCLUDED.grade,
                components = EXCLUDED.components, went_well = EXCLUDED.went_well,
                to_improve = EXCLUDED.to_improve, next_focus = EXCLUDED.next_focus,
                standing = EXCLUDED.standing, assisted_period_id = EXCLUDED.assisted_period_id,
                computed_at = NOW()
        """), {
            "org": org_id, "emp": eid, "uid": person["linked_user_id"], "mgr": person["manager_employee_id"],
            "ws": week_start, "we": week_end, "mode": mode, "score": score, "grade": grade,
            "components": _json(components), "well": _json(well), "improve": _json(improve),
            "focus": _json(focus.get(str(person["linked_user_id"]), [])), "standing": standing, "period": period_id,
        })
    return summary


async def _standing(db, org_id, person, week_end, mode, par, final, prev, period, summary) -> tuple[str, Any]:
    """(standing, assisted working period id). Opens, extends and closes
    assisted working periods as a side effect (live weeks only)."""
    eid = str(person["id"])
    if not person["onboarded"]:
        return "not_onboarded", None
    if period and period["status"] == "escalated":
        return "escalated", period["id"]
    if period and period["status"] == "active":
        if week_end < period["first_week_end"] or week_end < period["last_week_end"]:
            return "assisted", period["id"]
        if final is None:
            # An ungraded week (e.g. leave) can't count either way: extend by a week.
            await db.execute(text("""UPDATE hr.assisted_working_periods SET last_week_end = :next, updated_at = NOW()
                WHERE id = :id"""), {"id": period["id"], "next": week_end + timedelta(days=7)})
            return "assisted", period["id"]
        scores = [final_score(dict(r)) for r in (await db.execute(text("""
            SELECT score, override_score FROM hr.weekly_scorecards
            WHERE organization_id = :org AND employee_id = :emp AND week_end >= :first AND week_end < :we
        """), {"org": org_id, "emp": eid, "first": period["first_week_end"], "we": week_end})).mappings()]
        graded = [s for s in scores if s is not None] + [final]
        passed = all(s >= par for s in graded)
        await db.execute(text("""UPDATE hr.assisted_working_periods SET status = :status, updated_at = NOW(),
            outcome_note = COALESCE(outcome_note, :note) WHERE id = :id"""), {
            "id": period["id"], "status": "passed" if passed else "escalated",
            "note": "Every assisted week at or above par." if passed else "Below par during the assisted working period - escalated to HR for a decision.",
        })
        summary["passed" if passed else "escalated"].append(person["employee_name"])
        return ("passed" if passed else "escalated"), period["id"]
    if final is None:
        return "insufficient_data", None
    if final >= par:
        return "good", None
    prev_final = final_score(prev) if prev else None
    if not (prev and prev["mode"] == mode and prev_final is not None and prev_final < par):
        return "watch", None
    if mode != "live":
        return "would_assist", None
    reopened = (await db.execute(text("""
        SELECT id FROM hr.assisted_working_periods
        WHERE organization_id = :org AND employee_id = :emp AND opened_week_end = :we AND status <> 'cancelled'
    """), {"org": org_id, "emp": eid, "we": week_end})).scalar()
    if reopened:  # this week was computed before and already opened it
        return "assisted_opened", reopened
    # Migration 258's unique index makes a racing run reuse the same period.
    period_id = (await db.execute(text("""
        INSERT INTO hr.assisted_working_periods (organization_id, employee_id, supervisor_employee_id,
            opened_week_end, first_week_end, last_week_end, targets)
        VALUES (:org, :emp, :sup, :we, :first, :last, :targets)
        ON CONFLICT (organization_id, employee_id, opened_week_end) WHERE status <> 'cancelled' DO NOTHING
        RETURNING id
    """), {
        "org": org_id, "emp": eid, "sup": person["manager_employee_id"], "we": week_end,
        "first": week_end + timedelta(days=7), "last": week_end + timedelta(days=14),
        "targets": f"Score at or above {par:g} in both of the next two weeks.",
    })).scalar()
    if period_id is None:
        period_id = (await db.execute(text("""
            SELECT id FROM hr.assisted_working_periods
            WHERE organization_id = :org AND employee_id = :emp AND opened_week_end = :we AND status <> 'cancelled'
        """), {"org": org_id, "emp": eid, "we": week_end})).scalar()
    summary["assisted_opened"].append(person["employee_name"])
    return "assisted_opened", period_id


def _json(value: Any) -> str:
    return json.dumps(value, default=str)


def standing_after_override(card: dict[str, Any], par: float) -> Optional[str]:
    """An override only moves a week between good and watch, or cancels an
    assisted working period that this week's score opened. It never opens one
    retroactively. None means leave the standing alone."""
    new = final_score(card)
    if new is None:
        return None
    if card["standing"] in ("good", "watch"):
        return "good" if new >= par else "watch"
    if card["standing"] in ("assisted_opened", "would_assist") and new >= par:
        return "good"
    return None
    if card["standing"] in ("good", "watch"):
        return "good" if new >= par else "watch"
    if card["standing"] in ("assisted_opened", "would_assist") and new >= par:
        return "good"
    return None
