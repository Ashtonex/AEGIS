"""Executable workforce input and transition tests, with no live database writes."""
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from routers.workforce import (
    TimesheetPayload, TimesheetDecision, UniversalAttendancePayload,
    decide_timesheet, list_timesheets, record_attendance,
)


def rows(mapping=None, scalar=None):
    result = MagicMock()
    result.mappings.return_value.first.return_value = mapping
    result.scalar.return_value = scalar
    return result


class WorkforceInputTests(unittest.TestCase):
    def test_total_hours_cannot_exceed_day(self):
        for model, day_field in [(TimesheetPayload, "work_date"), (UniversalAttendancePayload, "attendance_date")]:
            with self.subTest(model=model), self.assertRaises(ValidationError):
                model(employee_id=uuid4(), **{day_field: date.today()}, regular_hours=20, overtime_hours=5)

    def test_absence_cannot_claim_hours(self):
        with self.assertRaises(ValidationError):
            UniversalAttendancePayload(employee_id=uuid4(), attendance_date=date.today(), status="absent", regular_hours=8)
        record = UniversalAttendancePayload(employee_id=uuid4(), attendance_date=date.today(), status="absent", regular_hours=0)
        self.assertEqual(record.regular_hours, 0)

    def test_clock_and_register_formats_cannot_be_mixed(self):
        with self.assertRaises(ValidationError):
            UniversalAttendancePayload(employee_id=uuid4(), attendance_date=date.today(), event_type="clock_in")

    def test_invalid_status_and_negative_hours_are_rejected(self):
        for values in ({"status": "verified"}, {"regular_hours": -1}):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                UniversalAttendancePayload(employee_id=uuid4(), attendance_date=date.today(), **values)


class WorkforceOperationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.db = AsyncMock()
        self.user = {"org_id": str(uuid4()), "sub": str(uuid4())}
        self.sheet = {"id": uuid4(), "status": "submitted", "created_by": uuid4(), "linked_user_id": uuid4(),
                      "project_id": uuid4(), "employee_id": uuid4(), "work_date": date.today(),
                      "description": "Foundation concrete", "regular_hours": Decimal(8), "overtime_hours": Decimal(2)}

    async def decide(self, status="approved"):
        return await decide_timesheet(self.sheet["id"], TimesheetDecision(status=status), self.user, self.db)

    async def test_author_and_worker_cannot_review_own_time(self):
        for field in ("created_by", "linked_user_id"):
            with self.subTest(field=field):
                sheet = {**self.sheet, field: self.user["sub"]}
                self.db.execute.return_value = rows(sheet)
                with self.assertRaises(HTTPException) as error:
                    await self.decide()
                self.assertEqual(error.exception.status_code, 403)
        self.db.commit.assert_not_awaited()

    async def test_approval_requires_matching_hours_evidence(self):
        for evidence in (None, {"regular_hours": 7, "overtime_hours": 3}, {"regular_hours": 8, "overtime_hours": 0}):
            self.db.execute.side_effect = [rows(self.sheet), rows(evidence)]
            with self.assertRaises(HTTPException) as error:
                await self.decide()
            self.assertEqual(error.exception.status_code, 409)
        self.db.commit.assert_not_awaited()

    async def test_independent_review_succeeds_with_attendance(self):
        self.db.execute.side_effect = [rows(self.sheet), rows({"regular_hours": 8, "overtime_hours": 2}), rows(scalar=self.sheet["id"])]
        response = await self.decide()
        self.assertTrue(response["success"])
        self.db.commit.assert_awaited_once()
        for call in self.db.execute.call_args_list:
            self.assertEqual(call.args[1]["org_id"], self.user["org_id"])

    async def test_rejection_preserves_evidence_without_requiring_attendance(self):
        self.db.execute.side_effect = [rows(self.sheet), rows(scalar=self.sheet["id"])]
        await self.decide("rejected")
        self.assertEqual(self.db.execute.await_count, 2)
        self.db.commit.assert_awaited_once()

    async def test_approved_record_cannot_be_decided_again(self):
        self.db.execute.return_value = rows({**self.sheet, "status": "approved"})
        with self.assertRaises(HTTPException) as error:
            await self.decide()
        self.assertEqual(error.exception.status_code, 409)
        self.db.commit.assert_not_awaited()

    async def test_manual_attendance_uses_actual_schema_without_invented_clock_times(self):
        self.db.execute.side_effect = [rows(scalar=1), rows(scalar=1), rows(scalar=uuid4())]
        payload = UniversalAttendancePayload(employee_id=uuid4(), project_id=uuid4(), attendance_date=date.today())
        await record_attendance(payload, self.user, self.db)
        statement, params = self.db.execute.call_args.args
        self.assertIn("attendance_date", str(statement))
        self.assertIn("recorded_by", str(statement))
        self.assertNotIn("check_in", str(statement))
        self.assertEqual(params["user_id"], self.user["sub"])
        self.db.commit.assert_awaited_once()

    async def test_duplicate_attendance_does_not_overwrite_original(self):
        self.db.execute.side_effect = [rows(scalar=1), rows(scalar=None)]
        with self.assertRaises(HTTPException) as error:
            await record_attendance(UniversalAttendancePayload(employee_id=uuid4(), attendance_date=date.today()), self.user, self.db)
        self.assertEqual(error.exception.status_code, 409)
        self.db.commit.assert_not_awaited()

    async def test_timesheet_read_rejects_reversed_or_unbounded_period(self):
        for start, end in [(date(2026, 9, 5), date(2026, 9, 1)), (date(2026, 1, 1), date(2026, 9, 5))]:
            with self.assertRaises(HTTPException):
                await list_timesheets(start, end, None, self.user, self.db)
        self.db.execute.assert_not_awaited()
