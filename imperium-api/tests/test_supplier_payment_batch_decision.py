"""The payment batch decision endpoint may only write statuses the table allows.

034 created finance.supplier_payment_batches.status with
CHECK (status IN ('draft', 'posted', 'cancelled')) while
POST /payments/{id}/decision moved draft -> 'approved' -> 'posted', so
approving failed in Postgres and nothing could ever be posted (238 fixes it).
"""

import asyncio
import re
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

import routers.payments as payments

MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"
CREATOR = str(uuid4())
APPROVER = str(uuid4())


def allowed_batch_statuses() -> set[str]:
    """Statuses allowed by the newest migration statement that sets the CHECK."""
    latest = None
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9]_*.sql")):
        for statement in path.read_text(encoding="utf-8").split(";"):
            if "finance.supplier_payment_batches" not in statement:
                continue
            match = re.search(r"CHECK\s*\(\s*status\s+IN\s*\(([^)]*)\)", statement, re.I)
            if match:
                latest = match.group(1)
    assert latest, "no status CHECK found for finance.supplier_payment_batches"
    return set(re.findall(r"'([a-z_]+)'", latest))


class FakeSession:
    def __init__(self, status: str):
        self.batch = SimpleNamespace(
            id=uuid4(), status=status, cash_account_id=uuid4(),
            payment_date=None, payment_method="bank_transfer", created_by=CREATOR,
        )
        self.updates: list[dict] = []
        self.committed = False

    async def execute(self, statement, params=None):
        sql = str(statement)
        if sql.lstrip().startswith("SELECT id, status"):
            return SimpleNamespace(first=lambda: self.batch)
        if "UPDATE finance.supplier_payment_batches" in sql:
            self.updates.append({"sql": sql, **params})
            return SimpleNamespace()
        raise AssertionError(f"unexpected query: {sql[:80]}")

    async def commit(self):
        self.committed = True

    async def rollback(self):
        pass


def decide(db: FakeSession, action: str, user_id: str = APPROVER):
    return asyncio.run(
        payments.decide_payment_batch(
            batch_id=db.batch.id,
            payload=payments.PaymentBatchDecision(action=action),
            user={"org_id": str(uuid4()), "sub": user_id},
            db=db,
            _={},
        )
    )


def test_approve_writes_an_allowed_status_and_records_the_approver():
    db = FakeSession("draft")
    decide(db, "approve")

    assert db.committed
    [update] = db.updates
    assert update["status"] == "approved"
    assert update["status"] in allowed_batch_statuses()
    assert update["approved_by"] == APPROVER
    assert "approved_at = NOW()" in update["sql"]


def test_every_decision_target_status_is_allowed_by_the_table():
    # draft -> approved -> posted, and cancelled, must all be writable.
    assert {"draft", "approved", "posted", "cancelled"} <= allowed_batch_statuses()


def test_post_requires_an_approved_batch():
    with pytest.raises(HTTPException) as exc:
        decide(FakeSession("draft"), "post")
    assert exc.value.status_code == 409


def test_creator_cannot_approve_their_own_batch():
    db = FakeSession("draft")
    with pytest.raises(HTTPException) as exc:
        decide(db, "approve", user_id=CREATOR)
    assert exc.value.status_code == 409
    assert db.updates == []
