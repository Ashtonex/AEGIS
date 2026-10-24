from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

import routers.fleet as fleet

ROOT = Path(__file__).resolve().parents[1]
APPROVER = {"org_id": "org-1", "sub": "approver-1", "user_id": "approver-1"}


class FakeResult:
    def __init__(self, row=None, scalar=None):
        self._row, self._scalar = row, scalar

    def mappings(self):
        return self

    def first(self):
        return self._row

    def scalar(self):
        return self._scalar


class FakeDB:
    """Replays one result per execute() call and records the SQL and params."""

    def __init__(self, *results):
        self.results = list(results)
        self.calls = []
        self.committed = False

    async def execute(self, statement, params=None):
        self.calls.append((str(statement), params or {}))
        return self.results.pop(0) if self.results else FakeResult()

    async def commit(self):
        self.committed = True


def work_order(status="awaiting_approval", created_by="raiser-1", parts=None):
    return {
        "id": "wo-1", "work_order_number": "WO-7", "status": status,
        "created_by": created_by, "parts_request_reference": parts, "project_id": None,
    }


async def decide(db, decision, reason=None, user=APPROVER):
    payload = fleet.WorkOrderApproval(decision=decision, reason=reason)
    return await fleet.approve_work_order(uuid4(), payload, user=user, db=db)


@pytest.mark.asyncio
async def test_approve_records_the_approver_and_schedules():
    db = FakeDB(FakeResult(row=work_order()), FakeResult(scalar="wo-1"))
    response = await decide(db, "approve")

    assert response["data"]["status"] == "scheduled"
    update_sql, params = db.calls[1]
    assert "repair_approved_by" in update_sql and params["approved"] is True
    assert params["user_id"] == "approver-1"
    assert db.committed


@pytest.mark.asyncio
async def test_approve_with_a_parts_request_goes_to_awaiting_parts():
    db = FakeDB(FakeResult(row=work_order(parts="PR-12")), FakeResult(scalar="wo-1"))
    assert (await decide(db, "approve"))["data"]["status"] == "awaiting_parts"


@pytest.mark.asyncio
async def test_reject_needs_a_reason_and_cancels():
    with pytest.raises(HTTPException) as missing:
        await decide(FakeDB(FakeResult(row=work_order())), "reject", reason="  ")
    assert missing.value.status_code == 422

    db = FakeDB(FakeResult(row=work_order()), FakeResult(scalar="wo-1"))
    response = await decide(db, "reject", reason="Quote too high")
    assert response["data"]["status"] == "cancelled"
    assert db.calls[1][1]["reason"] == "Quote too high"


@pytest.mark.asyncio
async def test_self_approval_is_blocked():
    db = FakeDB(FakeResult(row=work_order(created_by="approver-1")))
    with pytest.raises(HTTPException) as blocked:
        await decide(db, "approve")
    assert blocked.value.status_code == 403
    assert not db.committed


@pytest.mark.asyncio
async def test_only_awaiting_approval_can_be_decided():
    with pytest.raises(HTTPException) as wrong_state:
        await decide(FakeDB(FakeResult(row=work_order(status="assessed"))), "approve")
    assert wrong_state.value.status_code == 409


@pytest.mark.asyncio
async def test_losing_a_race_reports_a_conflict():
    db = FakeDB(FakeResult(row=work_order()), FakeResult(scalar=None))
    with pytest.raises(HTTPException) as raced:
        await decide(db, "approve")
    assert raced.value.status_code == 409
    assert not db.committed


@pytest.mark.asyncio
async def test_generic_status_endpoint_cannot_bypass_approval():
    row = {**work_order(), "assignment_project_id": None}
    db = FakeDB(FakeResult(row=row))
    payload = fleet.WorkOrderDecision(status="scheduled")
    with pytest.raises(HTTPException) as bypass:
        await fleet.decide_work_order(uuid4(), payload, user=APPROVER, db=db)
    assert bypass.value.status_code == 409


def test_migration_adds_the_permission_to_the_plant_approver_roles():
    sql = (ROOT / "migrations" / "239_fleet_work_order_approval.sql").read_text(encoding="utf-8")
    assert "'fleet.work_order.approve'" in sql
    assert "WHERE r.name IN ('Executive (Admin)', 'Fleet Supervisor', 'Equipment Manager')" in sql
    assert 'require_permission("fleet.work_order.approve")' in (ROOT / "routers" / "fleet.py").read_text(encoding="utf-8")
