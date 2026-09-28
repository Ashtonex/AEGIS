import re
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import routers.crm as crm

ROOT = Path(__file__).resolve().parents[1]
KANBAN_PAGE = (ROOT.parent / "aegis-web" / "src" / "app" / "dashboard" / "crm" / "opportunities" / "page.tsx").read_text(
    encoding="utf-8"
)


def _page_stage_map() -> dict[str, str]:
    block = re.search(r"const BACKEND_TO_FRONTEND_STAGE[^{]*\{(.*?)\};", KANBAN_PAGE, re.S).group(1)
    return dict(re.findall(r"'([^']+)':\s*'([^']+)'", block))


def _server_stage_map() -> tuple[dict[str, str], str]:
    sql = crm._OPPORTUNITY_BOARD_COLUMN_SQL
    return dict(re.findall(r"WHEN '([^']+)' THEN '([^']+)'", sql)), re.search(r"ELSE '([^']+)'", sql).group(1)


def test_server_board_columns_match_the_kanban_page_stage_mapping():
    """The page still maps stages itself (drag moves, optimistic updates), so
    the server's column assignment must agree with it exactly or cards would
    appear in one column and move to another."""
    page = _page_stage_map()
    explicit, fallback = _server_stage_map()
    assert fallback == "Qualification"
    for backend_stage, column in page.items():
        assert explicit.get(backend_stage, fallback) == column, backend_stage
    for backend_stage, column in explicit.items():
        assert page.get(backend_stage) == column, backend_stage
    page_columns = re.search(r"const STAGES = \[(.*?)\];", KANBAN_PAGE, re.S).group(1)
    assert tuple(re.findall(r"'([^']+)'", page_columns)) == crm.OPPORTUNITY_BOARD_COLUMNS


def test_card_select_includes_originating_department():
    # Missing it broke the department filter and made every edit save a
    # blank department over the real one.
    assert "o.originating_department_id" in crm._OPPORTUNITY_CARD_SELECT


class Result:
    def __init__(self, rows=(), one=None):
        self.rows = list(rows)
        self._one = one

    def __iter__(self):
        return iter(self.rows)

    def one(self):
        return self._one


class Row(dict):
    """Row-like: attribute access plus ._mapping."""

    def __getattr__(self, name):
        return self[name]

    @property
    def _mapping(self):
        return self


class FakeDb:
    def __init__(self, cards, totals, summary):
        self.cards, self.totals, self.summary = cards, totals, summary
        self.calls = []

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.calls.append((sql, params))
        if "board_rank" in sql:
            return Result(Row(card) for card in self.cards)
        if "GROUP BY 1" in sql:
            return Result(Row(board_column=k, count=c, total_budget=b) for k, (c, b) in self.totals.items())
        if "pipeline_total" in sql:
            return Result(one=Row(self.summary))
        raise AssertionError(sql[:80])


USER = {"user_id": "u-1", "org_id": "org-1", "role": "SUPERADMIN"}
SUMMARY = {
    "pipeline_total": 100, "weighted_total": 50, "average_margin": 12.5, "missing_next_action": 2,
    "overdue_next_action": 1, "stale": 0, "weighted_high_risk": 0, "weighted_medium_risk": 0, "weighted_low_risk": 50,
}


def board_args(**kw):
    args = dict(search=None, min_budget=None, value_range=None, risk_level=None, department_id=None,
                column=None, per_column=2, offset=0)
    args.update(kw)
    return args


@pytest.mark.asyncio
async def test_board_lists_every_column_with_exact_counts_and_has_more():
    cards = [
        {"id": "a", "name": "A", "board_column": "Proposal", "board_rank": 1, "board_created_at": None,
         "board_column_count": 3, "board_column_budget": 90},
        {"id": "b", "name": "B", "board_column": "Proposal", "board_rank": 2, "board_created_at": None,
         "board_column_count": 3, "board_column_budget": 90},
    ]
    db = FakeDb(cards, {"Proposal": (3, 90)}, SUMMARY)
    out = await crm.opportunity_board(user=USER, db=db, **board_args())

    columns = {c["key"]: c for c in out["data"]["columns"]}
    assert list(columns) == list(crm.OPPORTUNITY_BOARD_COLUMNS)  # empty columns still listed
    assert columns["Proposal"]["count"] == 3 and columns["Proposal"]["total_budget"] == 90.0
    assert columns["Proposal"]["has_more"] is True
    assert [c["id"] for c in columns["Proposal"]["cards"]] == ["a", "b"]
    assert not any(k.startswith("board_") for k in columns["Proposal"]["cards"][0])  # internals stripped
    assert columns["Won"] == {"key": "Won", "count": 0, "total_budget": 0.0, "cards": [], "offset": 0, "has_more": False}
    assert out["data"]["summary"]["missing_next_action"] == 2


@pytest.mark.asyncio
async def test_single_column_request_pages_and_skips_the_summary():
    cards = [{"id": "c", "board_column": "Proposal", "board_rank": 3, "board_created_at": None,
              "board_column_count": 3, "board_column_budget": 90}]
    db = FakeDb(cards, {"Proposal": (3, 90)}, SUMMARY)
    out = await crm.opportunity_board(user=USER, db=db, **board_args(column="Proposal", offset=2))

    assert [c["key"] for c in out["data"]["columns"]] == ["Proposal"]
    assert out["data"]["columns"][0]["has_more"] is False
    assert "summary" not in out["data"]
    assert not any("pipeline_total" in sql for sql, _ in db.calls)
    cards_params = next(params for sql, params in db.calls if "board_rank" in sql)
    assert cards_params["column"] == "Proposal" and cards_params["offset"] == 2


@pytest.mark.asyncio
async def test_filters_reach_both_cards_and_column_totals():
    db = FakeDb([], {}, SUMMARY)
    await crm.opportunity_board(
        user=USER, db=db,
        **board_args(search=" Mutare ", min_budget=5000, value_range="Over 250k", risk_level="Low", department_id="dept-1"),
    )
    cards_sql, cards_params = next((sql, p) for sql, p in db.calls if "board_rank" in sql)
    totals_sql, totals_params = next((sql, p) for sql, p in db.calls if "GROUP BY 1" in sql)
    for sql in (cards_sql, totals_sql):
        assert "ILIKE :search" in sql and "COALESCE(o.budget, 0) > 250000" in sql
        assert "o.risk_level = :risk_level" in sql and "o.originating_department_id = :department_id" in sql
    assert cards_params["search"] == totals_params["search"] == "%Mutare%"
    # the summary always covers the whole pipeline - no filters
    summary_sql, summary_params = next((sql, p) for sql, p in db.calls if "pipeline_total" in sql)
    assert summary_params == {"org_id": "org-1"}


@pytest.mark.asyncio
@pytest.mark.parametrize("kwargs", [{"column": "Won-ish"}, {"value_range": "Huge"}])
async def test_board_rejects_unknown_column_or_range(kwargs):
    with pytest.raises(HTTPException) as exc:
        await crm.opportunity_board(user=USER, db=FakeDb([], {}, SUMMARY), **board_args(**kwargs))
    assert exc.value.status_code == 422
