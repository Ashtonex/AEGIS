"""The accounting calendar must never run out: the worker opens the current
month and the two after it, every day and at startup."""
import asyncio
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SERVICE = (ROOT / "app" / "services" / "finance" / "accounting_period_rollover.py").read_text(encoding="utf-8")


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows


class _Db:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.commits = 0

    async def execute(self, statement, params=None):
        self.calls.append((str(statement), params))
        return _Result(self.rows)

    async def commit(self):
        self.commits += 1


def test_job_is_registered_daily_and_at_startup():
    from app.workers.arq_worker import WorkerSettings, ensure_accounting_periods_job

    assert ensure_accounting_periods_job in WorkerSettings.functions
    jobs = [j for j in WorkerSettings.cron_jobs if getattr(j, "coroutine", None) is ensure_accounting_periods_job]
    assert len(jobs) == 1
    # Without run_at_startup a deploy on the 30th would leave the gap open
    # until the next nightly run.
    assert jobs[0].run_at_startup is True


def test_opens_current_month_and_two_ahead_and_reports_what_it_created():
    from app.services.finance import accounting_period_rollover as rollover

    db = _Db([{"organization_id": "00000000-0000-0000-0000-000000000001", "period_code": "2026-12"}])
    created = asyncio.run(rollover.ensure_upcoming_periods(db))

    assert created == [{"organization_id": "00000000-0000-0000-0000-000000000001", "period_code": "2026-12"}]
    assert db.commits == 1
    _sql, params = db.calls[0]
    assert params == {"tz": "Africa/Harare", "months_ahead": 2}


def test_insert_never_touches_or_doubles_an_existing_period():
    # Insert-only: a closed month must stay closed.
    assert "UPDATE" not in SERVICE.split('"""', 2)[2]
    assert "ON CONFLICT (organization_id, period_code) DO NOTHING" in SERVICE
    # A hand-made period with unusual dates blocks the month it overlaps.
    assert "p.period_start <= (m.period_start + INTERVAL '1 month - 1 day')::DATE" in SERVICE
    assert "p.period_end >= m.period_start" in SERVICE
    # Organisations that never kept books are left alone.
    assert "FROM finance.accounting_periods have" in SERVICE
    assert "o.is_deleted = false" in SERVICE
