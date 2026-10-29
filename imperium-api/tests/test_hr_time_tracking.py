"""Sign-in check-in, standard office/site hours and the Saturday-Friday week."""

from datetime import date, datetime
from pathlib import Path

import pytest

from app.services.hr import time_tracking as tt
from routers import hr_time

ROOT = Path(__file__).resolve().parents[1]
H = tt.HARARE


@pytest.mark.parametrize(
    "day, friday",
    [
        (date(2026, 9, 26), date(2026, 10, 2)),  # Saturday starts the week
        (date(2026, 9, 28), date(2026, 10, 2)),  # Monday
        (date(2026, 10, 2), date(2026, 10, 2)),  # Friday closes it
        (date(2026, 10, 3), date(2026, 10, 9)),  # next Saturday is a new week
    ],
)
def test_week_runs_saturday_to_friday(day, friday):
    assert tt.week_end_for(day) == friday


def test_confirmation_is_asked_from_friday_with_catch_up_to_monday():
    assert tt.confirmation_week_due(date(2026, 10, 1)) is None  # Thursday
    assert tt.confirmation_week_due(date(2026, 10, 2)) == date(2026, 10, 2)  # Friday
    assert tt.confirmation_week_due(date(2026, 10, 5)) == date(2026, 10, 2)  # Monday catch-up
    assert tt.confirmation_week_due(date(2026, 10, 6)) is None  # Tuesday: too late, HR chases


def test_clock_stops_at_1630():
    day = date(2026, 10, 1)
    check_in = datetime(2026, 10, 1, 8, 0, tzinfo=H)
    # Still running at 11:00 today.
    assert tt.worked_hours(check_in, None, day, datetime(2026, 10, 1, 11, 0, tzinfo=H)) == 3.0
    # After 16:30 it stops counting.
    assert tt.worked_hours(check_in, None, day, datetime(2026, 10, 1, 20, 0, tzinfo=H)) == 8.5
    # A past day with no check-out is counted to 16:30.
    assert tt.worked_hours(check_in, None, day, datetime(2026, 10, 3, 9, 0, tzinfo=H)) == 8.5
    # Signing in after 16:30 earns nothing.
    late = datetime(2026, 10, 1, 17, 0, tzinfo=H)
    assert tt.worked_hours(late, None, day, datetime(2026, 10, 2, 9, 0, tzinfo=H)) == 0.0


@pytest.mark.parametrize(
    "day, office, site",
    [
        (date(2026, 10, 26), 8.5, 9.0),  # Monday
        (date(2026, 10, 29), 8.5, 9.0),  # Thursday
        (date(2026, 10, 30), 8.0, 8.0),  # Friday
        (date(2026, 10, 31), 5.0, 5.0),  # Saturday
        (date(2026, 11, 1), 0.0, 0.0),  # Sunday
    ],
)
def test_standard_hours_by_pattern(day, office, site):
    assert tt.standard_hours(day, "office") == office
    assert tt.standard_hours(day, "site") == site
    assert tt.standard_hours(day, None) == office  # unclassified people work office hours


def test_on_time_sign_in_earns_the_standard_day():
    later = datetime(2026, 11, 2, 9, 0, tzinfo=H)
    friday, saturday, thursday = date(2026, 10, 30), date(2026, 10, 31), date(2026, 10, 29)
    assert tt.worked_hours(datetime(2026, 10, 30, 8, 10, tzinfo=H), None, friday, later) == 8.0
    assert tt.worked_hours(datetime(2026, 10, 31, 8, 0, tzinfo=H), None, saturday, later, "site") == 5.0
    # 29 minutes late is still on time; site staff get their 9-hour day.
    assert tt.worked_hours(datetime(2026, 10, 29, 8, 29, tzinfo=H), None, thursday, later, "site") == 9.0
    # The auto check-out written at the old 16:30 doesn't cut an on-time day short.
    old_close = datetime(2026, 10, 29, 16, 30, tzinfo=H)
    assert tt.worked_hours(datetime(2026, 10, 29, 7, 55, tzinfo=H), old_close, thursday, later, "site") == 9.0


def test_thirty_minutes_late_counts_only_actual_hours():
    later = datetime(2026, 11, 2, 9, 0, tzinfo=H)
    thursday = date(2026, 10, 29)
    assert tt.arrived_late(datetime(2026, 10, 29, 8, 30, tzinfo=H), thursday)
    assert not tt.arrived_late(datetime(2026, 10, 29, 8, 29, tzinfo=H), thursday)
    # Office day ends 16:30: in at 09:00 -> 7.5 h. Site day ends 17:00 -> 8 h.
    assert tt.worked_hours(datetime(2026, 10, 29, 9, 0, tzinfo=H), None, thursday, later) == 7.5
    assert tt.worked_hours(datetime(2026, 10, 29, 9, 0, tzinfo=H), None, thursday, later, "site") == 8.0


def test_saturday_is_a_working_day_and_sunday_is_not():
    assert tt.is_workday(date(2026, 10, 31), set())
    assert not tt.is_workday(date(2026, 11, 1), set())
    assert not tt.is_workday(date(2026, 10, 31), {date(2026, 10, 31)})
    assert tt.day_end_at(date(2026, 10, 31)).strftime("%H:%M") == "13:00"
    assert tt.latest_day_end_at(date(2026, 10, 29)).strftime("%H:%M") == "17:00"


def test_routes_and_jobs_exist():
    paths = {(r.path, tuple(sorted(r.methods))) for r in hr_time.router.routes}
    for expected in [("/check-in", ("POST",)), ("/me/week", ("GET",)), ("/me/week/confirm", ("POST",)),
                     ("/board", ("GET",)), ("/weeks", ("GET",)), ("/weeks/{week_id}/decision", ("POST",)), ("/absence", ("GET",))]:
        assert expected in paths
    worker = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
    assert "cron(close_attendance_day_job, hour=15, minute=5" in worker


def test_leave_days_are_never_claimed_and_corrections_need_a_reason():
    source = (ROOT / "app" / "services" / "hr" / "time_tracking.py").read_text(encoding="utf-8")
    assert 'if day["kind"] == "leave":\n            hours = 0.0' in source
    assert "say why the hours differ" in source
    router = (ROOT / "routers" / "hr_time.py").read_text(encoding="utf-8")
    assert "You cannot approve your own hours" in router


def test_dashboard_checks_in_on_load():
    web = ROOT.parent / "aegis-web" / "src"
    shell = (web / "app" / "dashboard" / "DashboardShell.tsx").read_text(encoding="utf-8")
    assert "<AttendanceCheckIn />" in shell
    widget = (web / "components" / "people" / "AttendanceCheckIn.tsx").read_text(encoding="utf-8")
    assert "checkInToday" in widget and "WeeklyHoursModal" in widget
