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
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException

from routers.site_day import HARARE, booked_clock_in, clock_out_time, split_hours, work_start_time

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

    def test_day_close_accepts_leaving_time_before_a_late_start(self):
        # Register captured at 21:18, closed two days later: people left at
        # 17:00. The day close passes no clock-in, so this is not refused.
        at = local(DAY, 17)
        got = clock_out_time(briefing_date=DAY, shift="day", clock_in_at=None, now=local(DAY + timedelta(days=2), 10), left_site_at=at)
        self.assertEqual(got, at)
        self.assertEqual(split_hours(local(DAY, 21, 18), max(got, local(DAY, 21, 18)), cap=Decimal("8"), break_minutes=60), (Decimal("0"), Decimal("0")))

    def test_neither_clock_out_path_refuses_a_time_before_a_late_start(self):
        # Day close and single clock-out both pass no clock-in to the check,
        # and the single clock-out never books time before the clock-in.
        calls = re.findall(r"clock_in_at=([^,\n]+),\s*\n\s*now=", SITE_DAY)
        self.assertEqual(calls, ["None", "None"])
        self.assertIn('max(at, row["clock_in_at"])', SITE_DAY)

    def test_stated_work_start_books_a_register_captured_after_the_fact(self):
        # Start pressed at 21:18, everyone left at 17:00, work began 07:00.
        started, left = local(DAY, 21, 18), local(DAY, 17)
        work = work_start_time(briefing_date=DAY, shift="day", left_at=left, work_started_at=datetime(DAY.year, DAY.month, DAY.day, 7, 0))
        self.assertEqual(work, local(DAY, 7))
        got = booked_clock_in(clock_in_at=started, day_started_at=started, left_at=left, work_started_at=work)
        self.assertEqual(got, local(DAY, 7))
        self.assertEqual(split_hours(got, left, cap=Decimal("8"), break_minutes=60), (Decimal("8"), Decimal("1")))
        # A day started late in the morning (11:41) is restated too.
        self.assertEqual(booked_clock_in(clock_in_at=local(DAY, 11, 41), day_started_at=local(DAY, 11, 41), left_at=left, work_started_at=work), local(DAY, 7))

    def test_stated_work_start_leaves_real_clock_ins_alone(self):
        left, work = local(DAY, 17), local(DAY, 7)
        # Arrived at 10:00, after the day was started at 07:05: a real clock-in.
        self.assertEqual(booked_clock_in(clock_in_at=local(DAY, 10), day_started_at=local(DAY, 7, 5), left_at=left, work_started_at=work), local(DAY, 10))
        # No stated start: the system clock-in stands.
        self.assertEqual(booked_clock_in(clock_in_at=local(DAY, 7, 5), day_started_at=local(DAY, 7, 5), left_at=left, work_started_at=None), local(DAY, 7, 5))

    def test_clock_in_after_leaving_needs_a_work_start(self):
        with self.assertRaises(HTTPException) as ctx:
            booked_clock_in(clock_in_at=local(DAY, 21, 18), day_started_at=local(DAY, 21, 18), left_at=local(DAY, 17), work_started_at=None)
        self.assertEqual(ctx.exception.status_code, 422)
        self.assertIn("work actually started", ctx.exception.detail)

    def test_work_start_is_validated(self):
        left = local(DAY, 17)
        self.assertIsNone(work_start_time(briefing_date=DAY, shift="day", left_at=left, work_started_at=None))
        with self.assertRaises(HTTPException):  # not before leaving
            work_start_time(briefing_date=DAY, shift="day", left_at=left, work_started_at=local(DAY, 17))
        with self.assertRaises(HTTPException):  # another day
            work_start_time(briefing_date=DAY, shift="day", left_at=left, work_started_at=local(DAY - timedelta(days=1), 7))

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
