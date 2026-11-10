"""_single_row_reads runs several one-row reads as one statement, and falls
back to one statement per read (degrading only the broken source) when the
combined statement fails."""

import asyncio
from decimal import Decimal
from types import SimpleNamespace

from routers import executive

READS = {
    "a.counts": "SELECT COUNT(*) AS value FROM a.counts WHERE organization_id = :org_id",
    "b.totals": "SELECT SUM(x) AS value FROM b.totals WHERE organization_id = :org_id",
    "c.latest": "SELECT y FROM c.latest WHERE organization_id = :org_id LIMIT 1",
}


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def one(self):
        return self._rows[0]

    def __iter__(self):
        return iter(self._rows)


class _Session:
    def __init__(self, fail_combined=False, broken_source=None):
        self.statements = []
        self.rollbacks = 0
        self.fail_combined = fail_combined
        self.broken_source = broken_source

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append(sql)
        if "row_to_json" in sql:
            if self.fail_combined:
                raise RuntimeError("relation does not exist")
            # asyncpg hands json back as text; c.latest found no row.
            return _Result([('{"value": 4}', '{"value": 1234.50}', None)])
        if self.broken_source and self.broken_source in sql:
            raise RuntimeError("relation does not exist")
        return _Result([SimpleNamespace(_mapping={"value": 7})])

    async def rollback(self):
        self.rollbacks += 1


def test_reads_run_as_one_statement_with_exact_numbers():
    session = _Session()
    errors = []
    result = asyncio.run(executive._single_row_reads(session, READS, {"org_id": "org"}, source_errors=errors))
    assert len(session.statements) == 1
    assert result == {
        "a.counts": [{"value": 4}],
        "b.totals": [{"value": Decimal("1234.50")}],
        "c.latest": [],
    }
    assert errors == []


def test_failed_combined_statement_degrades_only_the_broken_source():
    session = _Session(fail_combined=True, broken_source="b.totals")
    errors = []
    result = asyncio.run(executive._single_row_reads(session, READS, {"org_id": "org"}, source_errors=errors))
    assert len(session.statements) == 4  # combined + one per read
    assert result["a.counts"] == [{"value": 7}]
    assert result["b.totals"] == []
    assert [e["source"] for e in errors] == ["b.totals"]
    assert session.rollbacks >= 2
