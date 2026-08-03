"""
Tests for the generic Idempotency-Key mechanism (core/idempotency.py):
claiming a key, replaying a completed response instead of re-running side
effects, rejecting a still-in-flight duplicate, rejecting a reused key with
a different body, and releasing a claimed key after a handler failure.

Exercised against a mocked AsyncSession since live DB access is unavailable
in this environment - matches the pattern in test_project_forecast_bridge.py.
"""

import asyncio
import unittest
from unittest.mock import AsyncMock, MagicMock

from fastapi import HTTPException

from core.idempotency import (
    begin_idempotent_request,
    complete_idempotent_request,
    fail_idempotent_request,
)


def _claim_succeeds_db():
    db = AsyncMock()
    db.execute = AsyncMock(return_value=MagicMock(first=MagicMock(return_value=("row-id",))))
    return db


def _claim_conflicts_then(existing_row):
    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[
        MagicMock(first=MagicMock(return_value=None)),  # INSERT ... ON CONFLICT DO NOTHING found nothing
        MagicMock(mappings=MagicMock(return_value=MagicMock(first=MagicMock(return_value=existing_row)))),
    ])
    return db


class BeginIdempotentRequestTests(unittest.TestCase):
    def test_fresh_key_claims_and_returns_none(self):
        db = _claim_succeeds_db()
        result = asyncio.run(begin_idempotent_request(
            db, org_id="org-1", key="key-1", endpoint="POST /quotations", request_body={"a": 1},
        ))
        self.assertIsNone(result)
        db.commit.assert_awaited()

    def test_replayed_key_with_completed_status_returns_cached_response(self):
        existing = {
            "status": "completed",
            "request_hash": None,  # replaced below once we know the real hash
            "response_body": {"success": True, "data": {"id": "abc"}},
        }
        # compute the real hash the same way the module does, so the
        # "same request body" branch is what's actually under test
        from core.idempotency import _request_hash
        existing["request_hash"] = _request_hash({"a": 1})

        db = _claim_conflicts_then(existing)
        result = asyncio.run(begin_idempotent_request(
            db, org_id="org-1", key="key-1", endpoint="POST /quotations", request_body={"a": 1},
        ))
        self.assertEqual(result, {"success": True, "data": {"id": "abc"}})

    def test_replayed_key_with_string_jsonb_response_body_is_decoded(self):
        from core.idempotency import _request_hash
        existing = {
            "status": "completed",
            "request_hash": _request_hash({"a": 1}),
            "response_body": '{"success": true, "data": {"id": "abc"}}',
        }
        db = _claim_conflicts_then(existing)
        result = asyncio.run(begin_idempotent_request(
            db, org_id="org-1", key="key-1", endpoint="POST /quotations", request_body={"a": 1},
        ))
        self.assertEqual(result, {"success": True, "data": {"id": "abc"}})

    def test_still_in_progress_raises_409(self):
        from core.idempotency import _request_hash
        existing = {
            "status": "in_progress",
            "request_hash": _request_hash({"a": 1}),
            "response_body": None,
        }
        db = _claim_conflicts_then(existing)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(begin_idempotent_request(
                db, org_id="org-1", key="key-1", endpoint="POST /quotations", request_body={"a": 1},
            ))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_reused_key_with_different_body_raises_422(self):
        from core.idempotency import _request_hash
        existing = {
            "status": "completed",
            "request_hash": _request_hash({"a": 1}),
            "response_body": {"success": True},
        }
        db = _claim_conflicts_then(existing)
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(begin_idempotent_request(
                db, org_id="org-1", key="key-1", endpoint="POST /quotations", request_body={"a": 999},
            ))
        self.assertEqual(ctx.exception.status_code, 422)


class CompleteAndFailIdempotentRequestTests(unittest.TestCase):
    def test_complete_stores_response_and_commits(self):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock())
        asyncio.run(complete_idempotent_request(
            db, org_id="org-1", key="key-1", endpoint="POST /quotations",
            response_status=200, response_body={"success": True},
        ))
        db.execute.assert_awaited_once()
        db.commit.assert_awaited()
        params = db.execute.await_args.args[1]
        self.assertEqual(params["response_status"], 200)
        self.assertIn('"success": true', params["response_body"])

    def test_fail_deletes_only_in_progress_rows_and_commits(self):
        db = AsyncMock()
        db.execute = AsyncMock(return_value=MagicMock())
        asyncio.run(fail_idempotent_request(db, org_id="org-1", key="key-1", endpoint="POST /quotations"))
        db.execute.assert_awaited_once()
        db.commit.assert_awaited()
        query_text = str(db.execute.await_args.args[0])
        self.assertIn("status = 'in_progress'", query_text)


if __name__ == "__main__":
    unittest.main()
