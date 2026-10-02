import asyncio
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest

import app.workers.arq_worker as worker
from app.services.hr import weekly_report as wr
from app.services.hr.weekly_report import (
    PendingVendor,
    WeeklyHrReport,
    WorkforceLine,
    estimate_weekly_gross,
    is_send_time,
    render_weekly_hr_report_html,
    render_weekly_hr_report_text,
    report_subject,
    report_week,
)


def utc(*args):
    return datetime(*args, tzinfo=timezone.utc)


# 2026-10-02 is a Friday. Harare is UTC+2.
def test_week_is_saturday_to_the_report_friday():
    assert report_week(utc(2026, 10, 2, 14, 5)) == (date(2026, 9, 26), date(2026, 10, 2))


def test_week_before_friday_is_the_previous_week():
    assert report_week(utc(2026, 10, 1, 9, 0)) == (date(2026, 9, 19), date(2026, 9, 25))


def test_sends_from_friday_1600_harare_only():
    assert not is_send_time(utc(2026, 10, 2, 13, 59))  # 15:59 Harare
    assert is_send_time(utc(2026, 10, 2, 14, 0))  # 16:00 Harare
    assert is_send_time(utc(2026, 10, 2, 21, 5))  # 23:05 Harare, retry window
    assert not is_send_time(utc(2026, 10, 2, 22, 5))  # Saturday 00:05 Harare
    assert not is_send_time(utc(2026, 10, 1, 14, 5))  # Thursday


def test_monthly_salary_is_a_weekly_share_plus_overtime():
    assert estimate_weekly_gross("monthly_salary", "1040.00", "10", 5, 40, 2) == Decimal("260.00")


def test_hourly_and_daily_follow_payroll_rules():
    assert estimate_weekly_gross("hourly", 5, None, 5, 40, 4) == Decimal("230.00")  # OT at 1.5x
    assert estimate_weekly_gross("daily", 40, None, 5, 40, 0) == Decimal("200.00")


def test_no_pay_profile_means_no_estimate():
    assert estimate_weekly_gross(None, None, None, 3, 24, 0) is None


def sample_report() -> WeeklyHrReport:
    return WeeklyHrReport(
        organization_name="Six Nine Construction",
        week_start=date(2026, 9, 26),
        week_end=date(2026, 10, 2),
        workforce=[
            WorkforceLine("Tendai <b>M</b>", "Foreman", 5, Decimal(40), Decimal(3), 1, "hourly", "USD", Decimal("215.00")),
            WorkforceLine("Rudo", None, 0, Decimal(0), Decimal(0), 0, None, None, None),
        ],
        pending_vendors=[
            PendingVendor("Haus of Bricks", "supplier", "system_verified", 12, "1234/2019", "ITF-1", "registered", "220123", None),
            PendingVendor("Best Buy", "supplier", "system_pending", 40, None, None, "not_registered", None,
                          "Missing profile fields: Company registration number"),
        ],
    )


def test_subject_leads_with_pending_vendors():
    assert report_subject(sample_report()) == "AEGIS weekly HR report, 26 Sep to 2 Oct 2026: 2 vendors pending verification"


def test_html_shows_vendors_workforce_and_escapes_names():
    html = render_weekly_hr_report_html(sample_report(), app_url="https://sixnineconstruction.com")
    assert html.index("Vendors pending verification (2)") < html.index("Workforce this week")
    assert "Awaiting HR decision" in html and "Missing information" in html
    assert "Not registered" in html  # VAT declared
    assert "Tendai &lt;b&gt;M&lt;/b&gt;" in html and "<b>M</b>" not in html
    assert "1 of 2" in html  # people working
    assert "No pay profile" in html and "No time recorded" in html
    assert "https://sixnineconstruction.com/dashboard/hr?tab=vendor-verification" in html


def test_text_version_lists_missing_key_fields():
    body = render_weekly_hr_report_text(sample_report())
    assert "Best Buy (supplier) - Missing information, waiting 40 days. Reg: MISSING; Tax clearance: MISSING; VAT: Not registered" in body


# --- the worker job --------------------------------------------------------

class FakeRedis:
    def __init__(self):
        self.store = {}

    async def get(self, key):
        return self.store.get(key)

    async def setex(self, key, ttl, value):
        self.store[key] = value


class FakeDb:
    def __init__(self, users):
        self.users = users

    async def execute(self, statement, params=None):
        rows = [u for u in self.users if u["email"] in params["emails"]]
        return SimpleNamespace(mappings=lambda: rows)

    async def commit(self):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.fixture
def job_env(monkeypatch):
    sent = []
    built_for = []
    outcome = {"ok": True}

    async def fake_send(to, subject, html, text=None):
        sent.append(to)
        return outcome["ok"]

    async def fake_build(db, *, org_id, week_start, week_end):
        built_for.append(org_id)
        return sample_report()

    refreshed = []

    async def fake_refresh(db, *, org_id):
        refreshed.append(org_id)
        return 0

    users = [
        {"email": "nyasha@sixnineconstruction.com", "organization_id": "org-1"},
        {"email": "cosmas@sixnineconstruction.com", "organization_id": "org-1"},
    ]
    monkeypatch.setattr(worker, "send_email", fake_send)
    monkeypatch.setattr(worker, "build_weekly_hr_report", fake_build)
    monkeypatch.setattr(worker, "refresh_pending_vendor_checks", fake_refresh)
    monkeypatch.setattr(worker, "AsyncSessionLocal", lambda: FakeDb(users))
    monkeypatch.setattr(worker.settings, "HR_WEEKLY_REPORT_RECIPIENTS",
                        "Nyasha@sixnineconstruction.com, cosmas@sixnineconstruction.com,stranger@example.com")
    monkeypatch.setattr(worker, "time_now", lambda: utc(2026, 10, 2, 14, 5))
    return SimpleNamespace(sent=sent, built_for=built_for, refreshed=refreshed, outcome=outcome, ctx={"redis": FakeRedis()})


def run_job(ctx):
    return asyncio.run(worker.weekly_hr_report_job(ctx))


def test_job_sends_once_per_recipient_per_week(job_env):
    result = run_job(job_env.ctx)
    assert sorted(result["sent"]) == ["cosmas@sixnineconstruction.com", "nyasha@sixnineconstruction.com"]
    assert job_env.built_for == ["org-1"]
    assert job_env.refreshed == ["org-1"]  # vendor checks re-run before the report is built
    assert "stranger@example.com" not in job_env.sent  # no AEGIS user, no report

    again = run_job(job_env.ctx)
    assert again["sent"] == [] and len(job_env.sent) == 2


def test_job_retries_a_failed_send_on_the_next_run(job_env):
    job_env.outcome["ok"] = False
    assert len(run_job(job_env.ctx)["failed"]) == 2
    job_env.outcome["ok"] = True
    assert len(run_job(job_env.ctx)["sent"]) == 2


def test_job_does_nothing_outside_send_time(job_env, monkeypatch):
    monkeypatch.setattr(worker, "time_now", lambda: utc(2026, 10, 2, 10, 5))  # 12:05 Harare
    assert "skipped" in run_job(job_env.ctx)
    assert job_env.sent == []
