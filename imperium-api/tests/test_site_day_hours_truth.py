"""
Regression tests for REG-018..REG-020 (SYSTEM_REPAIR_REGISTER.md).

* Daily-report labour defaulted to 8 h for anyone without register hours -
  including people who never clocked in - and was never updated at close,
  because the close/clock-out sync read site_day_briefings.daily_report_id,
  a column nothing populates.
* Closing a day late clocked everyone out at the close time: a day closed
  the next morning booked 8 h regular + 16 h overtime per person.
* A sync failure was swallowed inside the caller's transaction.
"""

import re
import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import HTTPException

from routers.site_day import HARARE, clock_out_time, split_hours

ROOT = Path(__file__).resolve().parents[1]
SITE_DAY = (ROOT / "routers" / "site_day.py").read_text(encoding="utf-8")


def local(d: date, h: int, m: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, h, m, tzinfo=HARARE)


DAY = date(2026, 10, 21)


class ClockOutTimeTests(unittest.TestCase):
    def test_same_day_close_uses_now(self):
        now = local(DAY, 17)
        self.assertEqual(clock_out_time(briefing_date=DAY, shift="day", clock_in_at=local(DAY, 7), now=now, left_site_at=None), now)

    def test_day_shift_closed_next_morning_needs_leaving_time(self):
        with self.assertRaises(HTTPException) as ctx:
            clock_out_time(briefing_date=DAY, shift="day", clock_in_at=local(DAY, 7), now=local(DAY + timedelta(days=1), 8), left_site_at=None)
        self.assertEqual(ctx.exception.status_code, 422)

    def test_night_shift_may_close_next_morning(self):
        now = local(DAY + timedelta(days=1), 6)
        self.assertEqual(clock_out_time(briefing_date=DAY, shift="night", clock_in_at=local(DAY, 18), now=now, left_site_at=None), now)
        with self.assertRaises(HTTPException):
            clock_out_time(briefing_date=DAY, shift="night", clock_in_at=local(DAY, 18), now=local(DAY + timedelta(days=2), 9), left_site_at=None)

    def test_given_leaving_time_is_used_and_validated(self):
        at = local(DAY, 16, 30)
        got = clock_out_time(briefing_date=DAY, shift="day", clock_in_at=local(DAY, 7), now=local(DAY + timedelta(days=1), 8), left_site_at=at)
        self.assertEqual(got, at)
        with self.assertRaises(HTTPException):  # before clock-in
            clock_out_time(briefing_date=DAY, shift="day", clock_in_at=local(DAY, 7), now=local(DAY, 9), left_site_at=local(DAY, 6))
        with self.assertRaises(HTTPException):  # in the future
            clock_out_time(briefing_date=DAY, shift="day", clock_in_at=local(DAY, 7), now=local(DAY, 9), left_site_at=local(DAY, 15))

    def test_naive_leaving_time_is_site_local(self):
        got = clock_out_time(briefing_date=DAY, shift="day", clock_in_at=None, now=local(DAY + timedelta(days=1), 8),
                             left_site_at=datetime(DAY.year, DAY.month, DAY.day, 16, 30))
        self.assertEqual(got.astimezone(timezone.utc).hour, 14)

    def test_the_bug_it_replaces(self):
        # What a next-morning close used to book for one person.
        regular, overtime = split_hours(local(DAY, 8, 14), local(DAY + timedelta(days=1), 10, 6), cap=8, break_minutes=30)
        self.assertEqual((regular, overtime), (8, 16))


class DailyReportSyncContract(unittest.TestCase):
    def _fn(self, name):
        start = SITE_DAY.index(f"async def {name}(")
        nxt = re.search(r"\n(async )?def |\n@router\.", SITE_DAY[start + 10:])
        return SITE_DAY[start: start + 10 + nxt.start()]

    def test_no_default_eight_hours(self):
        sync = self._fn("_sync_attendance_rows")
        self.assertNotIn("regular_hours, 8)", sync)
        self.assertNotIn("or 8)", sync)
        self.assertIn("SET is_deleted = true", sync)  # placeholder lines withdrawn

    def test_sync_is_isolated_and_only_touches_unsigned_reports(self):
        sync = self._fn("sync_attendance_to_daily_report")
        self.assertIn("async with db.begin_nested():", sync)
        self.assertIn('if status not in ("draft", "rejected"):', sync)
        self.assertIn("logger.error", sync)

    def test_report_found_through_its_briefing_link(self):
        self.assertNotIn('briefing.get("daily_report_id")', SITE_DAY)
        self.assertIn("WHERE briefing_id = :briefing_id", self._fn("_linked_report_id"))

    def test_close_and_clock_out_use_the_leaving_time(self):
        self.assertIn("clock_out_time(", self._fn("close_site_day"))
        self.assertIn("clock_out_time(", self._fn("clock_out_attendance"))


if __name__ == "__main__":
    unittest.main()
