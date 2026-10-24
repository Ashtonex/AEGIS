"""Phase 3: sign-in check-in, the 16:30 cut-off and the Saturday-Friday week."""

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


def test_routes_and_jobs_exist():
    paths = {(r.path, tuple(sorted(r.methods))) for r in hr_time.router.routes}
    for expected in [("/check-in", ("POST",)), ("/me/week", ("GET",)), ("/me/week/confirm", ("POST",)),
                     ("/board", ("GET",)), ("/weeks", ("GET",)), ("/weeks/{week_id}/decision", ("POST",)), ("/absence", ("GET",))]:
        assert expected in paths
    worker = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
    assert "cron(close_attendance_day_job, hour=14, minute=35" in worker


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
