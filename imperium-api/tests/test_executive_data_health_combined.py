"""Data health reads every source in one statement, and falls back to one
statement per source (marking only the broken one unavailable) when the
combined statement fails."""

import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

from routers import executive

SOURCES = [("Projects", "projects.projects"), ("Fleet", "fleet.fleet")]
RECENT = datetime.now(timezone.utc)


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows

    def one(self):
        return self._rows[0]


class _Session:
    def __init__(self, fail_combined=False, broken_relation=None):
        self.statements = []
        self.rollbacks = 0
        self.fail_combined = fail_combined
        self.broken_relation = broken_relation

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append(sql)
        if "UNION ALL" in sql:
            if self.fail_combined:
                raise RuntimeError("relation does not exist")
            return _Result([
                SimpleNamespace(idx=0, record_count=3, last_updated=RECENT),
                SimpleNamespace(idx=1, record_count=0, last_updated=None),
            ])
        if self.broken_relation and self.broken_relation in sql:
            raise RuntimeError("relation does not exist")
        return _Result([SimpleNamespace(record_count=2, last_updated=RECENT)])

    async def rollback(self):
        self.rollbacks += 1


def test_all_sources_are_read_in_one_statement():
    session = _Session()
    result = asyncio.run(executive._all_sources_health(session, "org", SOURCES))
    assert len(session.statements) == 1
    assert [r["status"] for r in result] == ["current", "no_data"]
    assert [r["source"] for r in result] == ["Projects", "Fleet"]


def test_failed_combined_statement_falls_back_per_source():
    session = _Session(fail_combined=True, broken_relation="fleet.fleet")
    result = asyncio.run(executive._all_sources_health(session, "org", SOURCES))
    assert len(session.statements) == 3  # combined + one per source
    assert [r["status"] for r in result] == ["current", "unavailable"]
    assert session.rollbacks >= 2
