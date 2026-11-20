"""Active sites for the executive dashboard.

A "site" here is an open project, seen through what actually happened on it:
who is assigned (engineer, clerk, foreman), who clocked in, the hours and
labour cost, the daily targets set against them, and whether the day was
closed and reported. The SQL returns one row per project per day; the pure
functions below roll those rows up so the rules can be unit tested.

Labour cost follows the site-day module (routers/site_day.py `_day_payload`):
recorded hours (regular + overtime) x the attendance rate, falling back to the
worker's register rate, overtime at the same rate. Entries with no rate at all
are counted, never priced at zero silently.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional
from zoneinfo import ZoneInfo

SITE_TIMEZONE = ZoneInfo("Africa/Harare")
LIST_WINDOW_DAYS = 7
DETAIL_WINDOW_DAYS = 14

CLOSED_PROJECT_STATUSES = ("cancelled", "canceled", "closed", "complete", "completed", "archived", "lost")

# The three people the owner expects on every working site.
KEY_ROLES = (
    ("engineer", "Site Engineer"),
    ("clerk", "Site Clerk"),
    ("foreman", "Foreman"),
)

# Fewer recorded hours per person-day than this means people were clocked in
# and never clocked out (or the register wasn't kept), not a short shift.
MIN_HOURS_PER_PERSON_DAY = 2.0
TARGETS_MET_WARN_RATIO = 0.5


def site_today() -> date:
    return datetime.now(SITE_TIMEZONE).date()


_ACTIVE_PROJECTS_CTE = f"""
    active AS (
        SELECT p.id, p.name, p.project_code, p.client_name, p.status,
               p.start_date, p.planned_completion_date, p.contract_value
        FROM projects.projects p
        WHERE p.organization_id = :org_id AND p.is_deleted = false
          AND lower(COALESCE(p.status, '')) NOT IN ({", ".join(f"'{s}'" for s in CLOSED_PROJECT_STATUSES)})
          AND (CAST(:project_id AS uuid) IS NULL OR p.id = CAST(:project_id AS uuid))
    )
"""

SITES_PROJECTS_SQL = f"""
    WITH {_ACTIVE_PROJECTS_CTE}
    SELECT a.id AS project_id, a.name, a.project_code, a.client_name, a.status,
           a.start_date, a.planned_completion_date, a.contract_value,
           COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                          'role', sra.role_name,
                          'user_id', sra.user_id,
                          'name', COALESCE(NULLIF(u.full_name, ''), split_part(u.email, '@', 1)),
                          'email', u.email,
                          'account_active', COALESCE(u.is_active AND NOT u.is_deleted, false),
                          'starts_on', sra.starts_on
                      ) ORDER BY sra.role_name, u.full_name)
               FROM projects.site_role_assignments sra
               LEFT JOIN core.users u ON u.id = sra.user_id
               WHERE sra.project_id = a.id AND sra.organization_id = :org_id
                 AND sra.is_active = true AND sra.is_deleted = false
                 AND (sra.ends_on IS NULL OR sra.ends_on >= CAST(:today AS date))
           ), '[]'::jsonb) AS team
    FROM active a
    ORDER BY a.name
"""

# One row per (project, day) that had any attendance, target, briefing or report.
SITES_DAYS_SQL = f"""
    WITH {_ACTIVE_PROJECTS_CTE},
    att AS (
        SELECT a.project_id, b.briefing_date AS day,
               array_agg(DISTINCT COALESCE(a.site_worker_id::text, a.employee_id::text,
                                           lower(COALESCE(a.worker_name, a.id::text)))) AS worker_keys,
               SUM(COALESCE(a.regular_hours, 0)) AS regular_hours,
               SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours,
               SUM((COALESCE(a.regular_hours, 0) + COALESCE(a.overtime_hours, 0))
                   * COALESCE(a.hourly_rate, w.hourly_rate, 0)) AS labour_cost,
               COUNT(*) FILTER (WHERE COALESCE(a.hourly_rate, w.hourly_rate) IS NULL) AS missing_rates,
               COUNT(*) FILTER (WHERE a.clock_in_at IS NOT NULL AND a.clock_out_at IS NULL
                                  AND NOT COALESCE(a.hours_overridden, false)) AS not_clocked_out
        FROM projects.site_day_attendance a
        JOIN projects.site_day_briefings b ON b.id = a.briefing_id AND b.is_deleted = false
        LEFT JOIN finance.site_workers w ON w.id = a.site_worker_id
        WHERE a.organization_id = :org_id
          AND a.project_id IN (SELECT id FROM active)
          AND b.briefing_date BETWEEN CAST(:since AS date) AND CAST(:today AS date)
        GROUP BY a.project_id, b.briefing_date
    ),
    tgt AS (
        SELECT t.project_id, t.target_date AS day,
               COUNT(*) AS targets_total,
               COUNT(*) FILTER (WHERE t.status = 'done'
                                  OR (t.target_qty > 0 AND t.achieved_qty >= t.target_qty)) AS targets_met,
               COUNT(*) FILTER (WHERE COALESCE(t.achieved_qty, 0) > 0) AS targets_progressed,
               SUM(COALESCE(t.planned_amount, 0)) AS planned_value,
               SUM(CASE
                       WHEN t.status = 'done' THEN COALESCE(t.planned_amount, 0)
                       WHEN t.target_qty > 0 THEN COALESCE(t.planned_amount, 0)
                            * LEAST(COALESCE(t.achieved_qty, 0) / t.target_qty, 1)
                       ELSE 0
                   END) AS earned_value
        FROM projects.site_daily_targets t
        WHERE t.organization_id = :org_id AND t.is_deleted = false
          AND t.project_id IN (SELECT id FROM active)
          AND t.target_date BETWEEN CAST(:since AS date) AND CAST(:today AS date)
        GROUP BY t.project_id, t.target_date
    ),
    brf AS (
        SELECT DISTINCT ON (b.project_id, b.briefing_date)
               b.project_id, b.briefing_date AS day, b.status AS day_status
        FROM projects.site_day_briefings b
        WHERE b.organization_id = :org_id AND b.is_deleted = false
          AND b.project_id IN (SELECT id FROM active)
          AND b.briefing_date BETWEEN CAST(:since AS date) AND CAST(:today AS date)
        ORDER BY b.project_id, b.briefing_date,
                 CASE b.status WHEN 'closed' THEN 0 WHEN 'started' THEN 1 ELSE 2 END
    ),
    rpt AS (
        SELECT DISTINCT ON (r.project_id, r.report_date)
               r.project_id, r.report_date AS day, r.status AS report_status
        FROM projects.daily_site_reports r
        WHERE r.organization_id = :org_id AND r.is_deleted = false
          AND r.project_id IN (SELECT id FROM active)
          AND r.report_date BETWEEN CAST(:since AS date) AND CAST(:today AS date)
        ORDER BY r.project_id, r.report_date,
                 CASE r.status WHEN 'approved' THEN 0 WHEN 'submitted' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END
    ),
    keys AS (
        SELECT project_id, day FROM att UNION SELECT project_id, day FROM tgt
        UNION SELECT project_id, day FROM brf UNION SELECT project_id, day FROM rpt
    )
    SELECT k.project_id, k.day,
           COALESCE(att.worker_keys, ARRAY[]::text[]) AS worker_keys,
           COALESCE(att.regular_hours, 0) AS regular_hours,
           COALESCE(att.overtime_hours, 0) AS overtime_hours,
           COALESCE(att.labour_cost, 0) AS labour_cost,
           COALESCE(att.missing_rates, 0) AS missing_rates,
           COALESCE(att.not_clocked_out, 0) AS not_clocked_out,
           COALESCE(tgt.targets_total, 0) AS targets_total,
           COALESCE(tgt.targets_met, 0) AS targets_met,
           COALESCE(tgt.targets_progressed, 0) AS targets_progressed,
           COALESCE(tgt.planned_value, 0) AS planned_value,
           COALESCE(tgt.earned_value, 0) AS earned_value,
           brf.day_status, rpt.report_status
    FROM keys k
    LEFT JOIN att ON att.project_id = k.project_id AND att.day = k.day
    LEFT JOIN tgt ON tgt.project_id = k.project_id AND tgt.day = k.day
    LEFT JOIN brf ON brf.project_id = k.project_id AND brf.day = k.day
    LEFT JOIN rpt ON rpt.project_id = k.project_id AND rpt.day = k.day
    ORDER BY k.project_id, k.day
"""

SITE_TARGETS_SQL = """
    SELECT t.id, t.target_date, t.work_package, t.description, t.unit,
           t.target_qty, t.achieved_qty, t.planned_amount, t.status, t.notes
    FROM projects.site_daily_targets t
    WHERE t.organization_id = :org_id AND t.project_id = CAST(:project_id AS uuid)
      AND t.is_deleted = false
      AND t.target_date = (
          SELECT MAX(t2.target_date) FROM projects.site_daily_targets t2
          WHERE t2.organization_id = :org_id AND t2.project_id = CAST(:project_id AS uuid)
            AND t2.is_deleted = false AND t2.target_date <= CAST(:today AS date)
      )
    ORDER BY t.work_package NULLS LAST, t.description
    LIMIT 100
"""

SITE_LATEST_REPORT_SQL = """
    SELECT r.id, r.report_date, r.shift, r.status, r.planned_work, r.actual_work,
           r.delays, r.safety_notes, r.cost_exposure, r.submitted_at, r.approved_at,
           r.engineer_review_status
    FROM projects.daily_site_reports r
    WHERE r.organization_id = :org_id AND r.project_id = CAST(:project_id AS uuid)
      AND r.is_deleted = false AND r.report_date <= CAST(:today AS date)
    ORDER BY r.report_date DESC, r.updated_at DESC
    LIMIT 1
"""

SITE_LAST_RECON_SQL = """
    SELECT w.week_ending, w.status, w.completed_at
    FROM projects.weekly_site_reconciliations w
    WHERE w.organization_id = :org_id AND w.project_id = CAST(:project_id AS uuid)
    ORDER BY w.week_ending DESC
    LIMIT 1
"""


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat() if hasattr(value, "isoformat") else str(value)


def day_line(row: Dict[str, Any]) -> Dict[str, Any]:
    regular = _num(row.get("regular_hours"))
    overtime = _num(row.get("overtime_hours"))
    return {
        "date": _iso(row.get("day")),
        "headcount": len(row.get("worker_keys") or []),
        "regular_hours": round(regular, 2),
        "overtime_hours": round(overtime, 2),
        "total_hours": round(regular + overtime, 2),
        "labour_cost": round(_num(row.get("labour_cost")), 2),
        "missing_rates": int(row.get("missing_rates") or 0),
        "not_clocked_out": int(row.get("not_clocked_out") or 0),
        "targets_total": int(row.get("targets_total") or 0),
        "targets_met": int(row.get("targets_met") or 0),
        "targets_progressed": int(row.get("targets_progressed") or 0),
        "planned_value": round(_num(row.get("planned_value")), 2),
        "earned_value": round(_num(row.get("earned_value")), 2),
        "day_status": row.get("day_status"),
        "report_status": row.get("report_status"),
    }


def _team(raw: Any) -> List[Dict[str, Any]]:
    members = raw if isinstance(raw, list) else []
    return [
        {
            "role": m.get("role"),
            "user_id": str(m["user_id"]) if m.get("user_id") else None,
            "name": m.get("name"),
            "email": m.get("email"),
            "account_active": bool(m.get("account_active")),
        }
        for m in members
        if isinstance(m, dict)
    ]


def key_people(team: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """Group the team under engineer / clerk / foreman (others under 'other')."""
    grouped: Dict[str, List[Dict[str, Any]]] = {key: [] for key, _ in KEY_ROLES}
    grouped["other"] = []
    for member in team:
        role = str(member.get("role") or "").lower()
        for key, _label in KEY_ROLES:
            if key in role:
                grouped[key].append(member)
                break
        else:
            grouped["other"].append(member)
    return grouped


def summarise_window(days: Iterable[Dict[str, Any]], today: date) -> Dict[str, Any]:
    """Roll day rows (raw SQL rows) into window totals for one project."""
    workers: set[str] = set()
    totals = {
        "regular_hours": 0.0, "overtime_hours": 0.0, "labour_cost": 0.0,
        "missing_rates": 0, "not_clocked_out_past": 0,
        "targets_total": 0, "targets_met": 0, "planned_value": 0.0, "earned_value": 0.0,
    }
    worked_days = 0
    person_days = 0
    unreported_days = 0
    unrecorded_days = 0
    today_line: Optional[Dict[str, Any]] = None
    last_worked: Optional[str] = None
    for row in days:
        line = day_line(row)
        keys = row.get("worker_keys") or []
        workers.update(keys)
        totals["regular_hours"] += line["regular_hours"]
        totals["overtime_hours"] += line["overtime_hours"]
        totals["labour_cost"] += line["labour_cost"]
        totals["missing_rates"] += line["missing_rates"]
        totals["targets_total"] += line["targets_total"]
        totals["targets_met"] += line["targets_met"]
        totals["planned_value"] += line["planned_value"]
        totals["earned_value"] += line["earned_value"]
        is_today = row.get("day") == today
        if is_today:
            today_line = line
        else:
            # Someone still clocked in today is on site, not a missed clock-out.
            totals["not_clocked_out_past"] += line["not_clocked_out"]
        if line["headcount"]:
            worked_days += 1
            person_days += line["headcount"]
            last_worked = line["date"]
            if not is_today and line["report_status"] not in ("submitted", "approved"):
                unreported_days += 1
            # Judged per day: a week average hides a day with a full register
            # and no hours. Today is still in progress, so it isn't judged.
            if not is_today and line["total_hours"] / line["headcount"] < MIN_HOURS_PER_PERSON_DAY:
                unrecorded_days += 1
    total_hours = totals["regular_hours"] + totals["overtime_hours"]
    return {
        "worked_days": worked_days,
        "headcount": len(workers),
        "person_days": person_days,
        "regular_hours": round(totals["regular_hours"], 2),
        "overtime_hours": round(totals["overtime_hours"], 2),
        "total_hours": round(total_hours, 2),
        "hours_per_person_day": round(total_hours / person_days, 2) if person_days else None,
        "labour_cost": round(totals["labour_cost"], 2),
        "missing_rates": totals["missing_rates"],
        "not_clocked_out": totals["not_clocked_out_past"],
        "targets_total": totals["targets_total"],
        "targets_met": totals["targets_met"],
        "planned_value": round(totals["planned_value"], 2),
        "earned_value": round(totals["earned_value"], 2),
        "unreported_days": unreported_days,
        "unrecorded_days": unrecorded_days,
        "last_worked_date": last_worked,
        "today": today_line,
    }


def site_flags(week: Dict[str, Any], people: Dict[str, List[Dict[str, Any]]],
               budget: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Plain-language problems worth an executive's attention, worst first."""
    flags: List[Dict[str, str]] = []

    def add(level: str, code: str, message: str) -> None:
        flags.append({"level": level, "code": code, "message": message})

    working = week["worked_days"] > 0
    if budget:
        if budget.get("status") == "over_budget":
            add("critical", "over_budget", f"Over budget: {budget.get('spent_percent')}% of the approved budget spent")
        elif budget.get("status") == "at_risk":
            add("warning", "budget_at_risk", f"Budget at risk: {budget.get('exposure_percent')}% spent or committed")
    if working:
        if week["not_clocked_out"]:
            add("critical", "not_clocked_out",
                f"{week['not_clocked_out']} clock-in(s) never clocked out - hours and cost are understated")
        if week["unrecorded_days"]:
            add("critical", "hours_unrecorded",
                f"{week['unrecorded_days']} day(s) with people on the register but almost no hours recorded")
        if week["targets_total"] == 0:
            add("warning", "no_targets", "People are working but no daily targets were set")
        elif week["targets_met"] / week["targets_total"] < TARGETS_MET_WARN_RATIO:
            add("warning", "targets_missed", f"Only {week['targets_met']} of {week['targets_total']} daily targets met")
        if week["missing_rates"]:
            add("warning", "missing_rates", f"{week['missing_rates']} attendance entries have no pay rate - labour cost is understated")
        if week["unreported_days"]:
            add("warning", "unreported_days", f"{week['unreported_days']} worked day(s) without a submitted site report")
        for key, label in KEY_ROLES:
            if not people.get(key):
                add("warning", f"no_{key}", f"No {label.lower()} assigned")
    for key, _label in KEY_ROLES:
        for member in people.get(key, []):
            if not member.get("account_active"):
                add("warning", "inactive_member",
                    f"{member.get('name') or 'A team member'} ({member.get('role')}) is assigned but their account is deactivated")
    if not working:
        add("info", "idle", "No labour recorded in the last 7 days")
    order = {"critical": 0, "warning": 1, "info": 2}
    flags.sort(key=lambda flag: order[flag["level"]])
    return flags


def site_health(flags: List[Dict[str, str]], working: bool) -> str:
    if not working:
        return "idle"
    levels = {flag["level"] for flag in flags}
    if "critical" in levels:
        return "red"
    if "warning" in levels:
        return "amber"
    return "green"


def activity_state(week: Dict[str, Any]) -> str:
    today_line = week.get("today")
    if today_line and (today_line["headcount"] or today_line["day_status"] in ("started", "closed")):
        return "working_today"
    return "active_week" if week["worked_days"] else "idle"


def build_site(project: Dict[str, Any], days: List[Dict[str, Any]], today: date,
               budget: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    team = _team(project.get("team"))
    people = key_people(team)
    week = summarise_window(days, today)
    flags = site_flags(week, people, budget)
    return {
        "project_id": str(project["project_id"]),
        "name": project.get("name"),
        "project_code": project.get("project_code"),
        "client_name": project.get("client_name"),
        "status": project.get("status"),
        "start_date": _iso(project.get("start_date")),
        "planned_completion_date": _iso(project.get("planned_completion_date")),
        "contract_value": _num(project.get("contract_value")) if project.get("contract_value") is not None else None,
        "team": team,
        "people": people,
        "week": week,
        "budget": budget,
        "flags": flags,
        "health": site_health(flags, week["worked_days"] > 0),
        "activity": activity_state(week),
    }


_ACTIVITY_ORDER = {"working_today": 0, "active_week": 1, "idle": 2}
_HEALTH_ORDER = {"red": 0, "amber": 1, "green": 2, "idle": 3}


def build_sites(projects: List[Dict[str, Any]], day_rows: List[Dict[str, Any]], today: date,
                budgets_by_project: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    by_project: Dict[str, List[Dict[str, Any]]] = {}
    for row in day_rows:
        by_project.setdefault(str(row["project_id"]), []).append(row)
    sites = [
        build_site(p, by_project.get(str(p["project_id"]), []), today, budgets_by_project.get(str(p["project_id"])))
        for p in projects
    ]
    sites.sort(key=lambda s: (_ACTIVITY_ORDER[s["activity"]], _HEALTH_ORDER[s["health"]], -s["week"]["labour_cost"]))
    working = [s for s in sites if s["activity"] != "idle"]
    return {
        "sites": sites,
        "summary": {
            "total": len(sites),
            "working_today": sum(1 for s in sites if s["activity"] == "working_today"),
            "active_week": len(working),
            "idle": len(sites) - len(working),
            "needs_attention": sum(1 for s in sites if s["health"] in ("red", "amber")),
            "week_headcount": sum(s["week"]["headcount"] for s in working),
            "week_hours": round(sum(s["week"]["total_hours"] for s in working), 2),
            "week_labour_cost": round(sum(s["week"]["labour_cost"] for s in working), 2),
            "today_headcount": sum((s["week"]["today"] or {}).get("headcount", 0) for s in sites),
        },
        "as_of": today.isoformat(),
        "window_days": LIST_WINDOW_DAYS,
    }


def daily_series(day_rows: List[Dict[str, Any]], since: date, today: date) -> List[Dict[str, Any]]:
    """One line per calendar day in the window, zero-filled, oldest first."""
    by_day = {row["day"]: day_line(row) for row in day_rows}
    series = []
    current = since
    while current <= today:
        series.append(by_day.get(current) or day_line({"day": current}))
        current += timedelta(days=1)
    return series


def window_start(today: date, days: int) -> date:
    return today - timedelta(days=days - 1)
