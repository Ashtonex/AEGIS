"""Phase 2: contract / credential / asset expiry warnings and the HR files API."""

from datetime import date, datetime, timezone
from pathlib import Path

import pytest

from app.services.hr import expiry_alerts
from routers import hr_files

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    "days_left, tier",
    [(90, None), (61, None), (60, 60), (45, 60), (30, 30), (20, 30), (14, 14), (10, 14), (7, 7), (1, 7), (0, 0), (-5, 0)],
)
def test_tightest_tier_only(days_left, tier):
    assert expiry_alerts.tier_for(days_left) == tier


def test_review_meeting_is_14_days_out_or_next_working_day():
    # Plenty of notice: 14 days before the end, 10:00 Harare.
    start = expiry_alerts.review_meeting_start(date(2026, 12, 31), today=date(2026, 10, 4))
    assert start.date() == date(2026, 12, 17) and start.hour == 10
    # Too close: next working day (Saturday 2026-10-03 -> Monday 2026-10-05).
    start = expiry_alerts.review_meeting_start(date(2026, 10, 10), today=date(2026, 10, 2))
    assert start.date() == date(2026, 10, 5)
    assert start.astimezone(timezone.utc).hour == 8


def test_send_window_starts_at_seven_harare():
    assert not expiry_alerts.is_send_time(datetime(2026, 10, 5, 4, 59, tzinfo=timezone.utc))
    assert expiry_alerts.is_send_time(datetime(2026, 10, 5, 5, 0, tzinfo=timezone.utc))


def test_nyasha_always_hears_about_expiries():
    assert "nyasha@sixnineconstruction.com" in expiry_alerts.always_recipients()


def test_alert_log_prevents_repeat_sends():
    migration = (ROOT / "migrations" / "250_hr_contracts_credentials_assets.sql").read_text(encoding="utf-8")
    assert "UNIQUE (organization_id, source_type, source_id, threshold_days, expires_on)" in migration
    source = (ROOT / "app" / "services" / "hr" / "expiry_alerts.py").read_text(encoding="utf-8")
    assert "_already_sent" in source


def test_worker_runs_expiry_alerts_hourly():
    worker = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
    assert "cron(hr_expiry_alerts_job, minute=25" in worker


def test_files_routes_and_people_access_grants():
    paths = {(r.path, tuple(sorted(r.methods))) for r in hr_files.router.routes}
    for expected in [
        ("/overview", ("GET",)),
        ("/people/{employee_id}/contracts", ("POST",)),
        ("/contracts/{contract_id}/file", ("POST",)),
        ("/people/{employee_id}/credentials", ("POST",)),
        ("/people/{employee_id}/assets", ("POST",)),
        ("/assets/{assignment_id}/return", ("POST",)),
        ("/attachments/{attachment_id}/open", ("GET",)),
        ("/alerts/run", ("POST",)),
    ]:
        assert expected in paths
    migration = (ROOT / "migrations" / "250_hr_contracts_credentials_assets.sql").read_text(encoding="utf-8")
    assert "('Executive (Admin)',   'workforce.people.read')" in migration
    assert "('HR Officer',          'workforce.people.update')" in migration


def test_contract_states():
    today = date(2026, 10, 4)
    base = {"status": "active", "starts_on": date(2026, 1, 1), "ends_on": date(2026, 12, 31)}
    assert hr_files._contract_state(base, today) == "current"
    assert hr_files._contract_state({**base, "ends_on": date(2026, 9, 30)}, today) == "expired"
    assert hr_files._contract_state({**base, "starts_on": date(2026, 11, 1)}, today) == "upcoming"
    assert hr_files._contract_state({**base, "status": "renewed"}, today) == "renewed"
