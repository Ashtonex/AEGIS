"""Finance operations workbench: payables ageing, draft budget reminder
timing/digest, and wiring (router mounted, cron job registered, migration
present). Pure-function and source-contract tests only - nothing here
touches the database."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from app.services.finance import draft_budget_reminders as reminders
from routers import finance_ops

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize(
    "days_overdue, bucket",
    [(-5, "current"), (0, "current"), (1, "1_30"), (30, "1_30"), (31, "31_60"), (60, "31_60"), (61, "61_90"), (90, "61_90"), (91, "90_plus"), (400, "90_plus")],
)
def test_age_bucket_edges(days_overdue, bucket):
    assert finance_ops._bucket(days_overdue) == bucket


def test_money_rounding_is_half_up_to_cents():
    assert finance_ops._d("10.005") == Decimal("10.01")
    assert finance_ops._d(None) == Decimal("0.00")


HARARE = timezone(timedelta(hours=2))


@pytest.mark.parametrize(
    "local, expected",
    [
        (datetime(2026, 10, 5, 6, 59, tzinfo=HARARE), False),  # Monday before 07:00
        (datetime(2026, 10, 5, 7, 0, tzinfo=HARARE), True),  # Monday 07:00
        (datetime(2026, 10, 9, 16, 0, tzinfo=HARARE), True),  # Friday afternoon
        (datetime(2026, 10, 10, 9, 0, tzinfo=HARARE), False),  # Saturday
        (datetime(2026, 10, 11, 9, 0, tzinfo=HARARE), False),  # Sunday
    ],
)
def test_reminders_only_on_weekday_mornings_harare_time(local, expected):
    assert reminders.is_send_time(local) is expected
    # Same instant expressed in UTC must give the same answer.
    assert reminders.is_send_time(local.astimezone(timezone.utc)) is expected


def test_md_and_nyasha_are_always_copied():
    always = reminders.always_recipients()
    assert "nyasha@sixnineconstruction.com" in always
    assert "cosmas@sixnineconstruction.com" in always


def test_digest_lists_each_draft_with_age_and_link():
    drafts = [
        {"project_name": "Trout Beck <Canopy>", "budget_version": 1, "label": "Execution budget review",
         "total_amount": Decimal("1234.5"), "created_at": datetime(2026, 10, 2, 9, 0, tzinfo=timezone.utc)},
        {"project_name": "Mutare Dry Port", "budget_version": 2, "label": None,
         "total_amount": 99, "created_at": datetime(2026, 9, 30, 9, 0, tzinfo=timezone.utc)},
    ]
    subject, html, text = reminders.build_digest("Gamu", drafts, date(2026, 10, 5), "https://app.example")
    assert subject.startswith("2 project budgets still in draft")
    assert "Trout Beck &lt;Canopy&gt;" in html  # escaped
    assert "US$1,234.50" in html
    assert "3 days" in html and "5 days" in html
    assert "https://app.example/dashboard/finance/budgets" in html
    assert "Mutare Dry Port v2" in text


def test_router_mounted_and_cron_registered():
    main_src = (ROOT / "main.py").read_text(encoding="utf-8")
    assert 'finance_ops.router, prefix="/api/v1/finance/ops"' in main_src
    worker = (ROOT / "app" / "workers" / "arq_worker.py").read_text(encoding="utf-8")
    functions_block = worker.split("functions = [")[1].split("]")[0]
    cron_block = worker.split("cron_jobs = [")[1]
    assert "draft_budget_reminder_job" in functions_block
    assert "cron(draft_budget_reminder_job" in cron_block


def test_migration_creates_site_payroll_and_payable_event_tables():
    sql = (ROOT / "migrations" / "247_site_payroll_and_payables.sql").read_text(encoding="utf-8")
    for table in ("site_workers", "site_pay_runs", "site_time_entries", "site_pay_run_lines", "payable_events"):
        assert f"CREATE TABLE IF NOT EXISTS finance.{table}" in sql
    assert "UNIQUE (worker_id, project_id, work_date)" in sql


def test_paying_unapproved_invoice_requires_override_reason_in_source():
    # The control that keeps 3-way match meaningful: paying an invoice that
    # isn't approved must demand a written reason and log it.
    src = (ROOT / "routers" / "finance_ops.py").read_text(encoding="utf-8")
    assert "if unapproved and not payload.override_reason" in src
    assert '"match_override"' in src
