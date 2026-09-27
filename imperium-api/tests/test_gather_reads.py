import asyncio

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from core import database
from core.database import gather_reads


class FakeBorrowedSession:
    """Stands in for an AsyncSessionLocal() session - never touches a DB."""

    def __init__(self, registry, *, connect_error=None):
        self.registry = registry
        self.connect_error = connect_error

    async def __aenter__(self):
        self.registry["opened"] += 1
        return self

    async def __aexit__(self, *exc):
        self.registry["closed"] += 1
        return False

    async def connection(self):
        if self.connect_error:
            raise self.connect_error


class FakePool:
    def __init__(self, checked_out=1):
        self.checked_out = checked_out

    def checkedout(self):
        return self.checked_out


@pytest.fixture
def lanes(monkeypatch):
    """A real AsyncSession object as the request session (never used for I/O
    here) plus fake borrowed sessions, so the concurrent path runs offline."""
    registry = {"opened": 0, "closed": 0, "connect_errors": []}

    def session_factory():
        error = registry["connect_errors"].pop(0) if registry["connect_errors"] else None
        return FakeBorrowedSession(registry, connect_error=error)

    monkeypatch.setattr(database, "AsyncSessionLocal", session_factory)
    monkeypatch.setattr(database, "_pool", FakePool(checked_out=1))
    monkeypatch.setattr(database, "_POOL_CAPACITY", 5)
    monkeypatch.setattr(database, "_PARALLEL_READ_LIMIT", 3)
    monkeypatch.setattr(database, "_parallel_reads_in_flight", 0)
    registry["request_session"] = AsyncSession()
    return registry


@pytest.mark.asyncio
async def test_non_session_db_runs_sequentially_in_call_order():
    calls = []

    class FakeDb:
        pass

    db = FakeDb()

    def read(name):
        async def run(session):
            assert session is db
            calls.append(name)
            return name

        return run

    assert await gather_reads(db, read("a"), read("b"), read("c")) == ["a", "b", "c"]
    assert calls == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_reads_overlap_across_lanes_and_results_keep_call_order(lanes):
    started = 0
    all_started = asyncio.Event()
    sessions = []

    def read(value):
        async def run(session):
            nonlocal started
            sessions.append(session)
            started += 1
            if started == 4:
                all_started.set()
            # Every read blocks until four are in flight at once - this only
            # finishes if the reads really run concurrently.
            await asyncio.wait_for(all_started.wait(), timeout=2)
            return value

        return run

    result = await gather_reads(lanes["request_session"], *(read(n) for n in range(4)))

    assert result == [0, 1, 2, 3]
    assert lanes["request_session"] in sessions
    assert lanes["opened"] == 3 and lanes["closed"] == 3
    assert database._parallel_reads_in_flight == 0


@pytest.mark.asyncio
async def test_more_reads_than_lanes_are_all_run_exactly_once(lanes):
    seen = []

    def read(value):
        async def run(session):
            await asyncio.sleep(0)
            seen.append(value)
            return value * 10

        return run

    result = await gather_reads(lanes["request_session"], *(read(n) for n in range(11)))

    assert result == [n * 10 for n in range(11)]
    assert sorted(seen) == list(range(11))
    assert lanes["opened"] == 3


@pytest.mark.asyncio
async def test_busy_pool_falls_back_to_request_session_without_waiting(lanes, monkeypatch):
    monkeypatch.setattr(database, "_pool", FakePool(checked_out=4))  # capacity 5, headroom 1
    sessions = []

    async def read(session):
        sessions.append(session)
        return 1

    assert await gather_reads(lanes["request_session"], read, read, read) == [1, 1, 1]
    assert lanes["opened"] == 0
    assert sessions == [lanes["request_session"]] * 3


@pytest.mark.asyncio
async def test_lane_that_cannot_connect_leaves_its_reads_to_other_lanes(lanes):
    lanes["connect_errors"] = [ConnectionError("pool timeout"), None, None]

    def read(value):
        async def run(session):
            await asyncio.sleep(0)
            return value

        return run

    assert await gather_reads(lanes["request_session"], *(read(n) for n in range(6))) == list(range(6))
    assert database._parallel_reads_in_flight == 0


@pytest.mark.asyncio
async def test_failing_read_propagates_and_releases_every_slot(lanes):
    async def ok(session):
        await asyncio.sleep(0.05)
        return "ok"

    async def boom(session):
        raise ValueError("query failed")

    with pytest.raises(ValueError):
        await gather_reads(lanes["request_session"], boom, ok, ok, ok)

    assert database._parallel_reads_in_flight == 0
    assert lanes["opened"] == lanes["closed"]
