from datetime import date, datetime, timedelta

import pytest

import routers.executive as executive


def liability(liability_type, amount, days_until_due, currency="USD", filed_at=None):
    return {
        "id": f"{liability_type}-{currency}-{days_until_due}",
        "authority": "zimra",
        "liability_type": liability_type,
        "currency": currency,
        "period_type": "month",
        "period_start": date(2026, 8, 1),
        "period_end": date(2026, 8, 31),
        "due_date": None if days_until_due is None else date.today() + timedelta(days=days_until_due),
        "status": "due",
        "filed_at": filed_at,
        "outstanding_amount": amount,
        "days_until_due": days_until_due,
    }


async def call_with(monkeypatch, rows):
    async def fake_rows(db, query, params, *, source, source_errors=None):
        assert params == {"org_id": "org-1"}
        return rows

    monkeypatch.setattr(executive, "_rows", fake_rows)
    return await executive.get_executive_statutory_liabilities(user={"org_id": "org-1"}, db=None)


@pytest.mark.asyncio
async def test_totals_split_overdue_and_due_soon_per_currency(monkeypatch):
    result = await call_with(
        monkeypatch,
        [
            liability("paye", 1000, -5),
            liability("vat", 250.5, 10),
            liability("nssa_employer", 100, 60),
            liability("vat", 9000, None),
            liability("paye", 40000, 3, currency="ZWG"),
        ],
    )
    data = result["data"]

    assert data["totals"] == [
        {"currency": "USD", "outstanding": 10350.5, "overdue": 1000.0, "due_soon": 250.5, "count": 4},
        {"currency": "ZWG", "outstanding": 40000.0, "overdue": 0.0, "due_soon": 40000.0, "count": 1},
    ]
    assert data["overdue_count"] == 1
    flags = [(item["overdue"], item["due_soon"]) for item in data["items"]]
    assert flags == [(True, False), (False, True), (False, False), (False, False), (False, True)]


@pytest.mark.asyncio
async def test_filed_flag_and_empty_register(monkeypatch):
    result = await call_with(monkeypatch, [liability("vat", 10, 2, filed_at=datetime(2026, 9, 20))])
    assert result["data"]["items"][0]["filed"] is True

    empty = await call_with(monkeypatch, [])
    assert empty["data"]["totals"] == [] and empty["data"]["items"] == []


def test_query_excludes_settled_and_refund_rows():
    sql = executive._EXECUTIVE_STATUTORY_SQL
    assert "status NOT IN ('paid', 'waived', 'refund_due')" in sql
    assert "outstanding_amount > 0" in sql
    assert "organization_id = :org_id AND is_deleted = false" in sql


def test_snapshot_staleness():
    today = date.today()
    assert executive._snapshot_is_stale(None)
    assert not executive._snapshot_is_stale(today)
    assert not executive._snapshot_is_stale(today - timedelta(days=7))
    assert executive._snapshot_is_stale(today - timedelta(days=8))
    assert executive._snapshot_is_stale(str(today - timedelta(days=30)))
    assert executive._snapshot_is_stale("not a date")
