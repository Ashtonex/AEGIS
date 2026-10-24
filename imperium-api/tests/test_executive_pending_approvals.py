import re
from datetime import datetime, timedelta
from pathlib import Path

import pytest

import routers.executive as executive

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT.parent / "aegis-web" / "src" / "app" / "dashboard"
SOURCES = executive._PENDING_APPROVAL_SOURCES


def row(ref, days_ago, amount=None):
    return {
        "id": f"id-{ref}",
        "reference": ref,
        "amount": amount,
        "waiting_since": datetime.now().astimezone() - timedelta(days=days_ago, hours=1),
        "detail": None,
    }


async def call_with(monkeypatch, rows_by_source):
    async def fake_rows(db, query, params, *, source, source_errors=None):
        assert params == {"org_id": "org-1"}
        return rows_by_source.get(source, [])

    monkeypatch.setattr(executive, "_rows", fake_rows)
    return await executive.get_pending_approvals(user={"org_id": "org-1"}, db=None)


@pytest.mark.asyncio
async def test_queue_merges_every_module_longest_waiting_first(monkeypatch):
    result = await call_with(
        monkeypatch,
        {
            "procurement.purchase_orders": [row("PO-7", 2, 1200)],
            "finance.journal_entries": [row("JE-1", 9, 55.5)],
            "hr.leave_requests": [row("Tendai", 0)],
            "core.approval_instances": [row("Norton fence", 4)],
        },
    )

    items = result["data"]
    assert [item["reference"] for item in items] == ["JE-1", "Norton fence", "PO-7", "Tendai"]
    assert [item["waiting_days"] for item in items] == [9, 4, 2, 0]
    assert items[2]["amount"] == 1200.0 and items[3]["amount"] is None
    assert result["meta"]["by_module"] == {"Finance": 1, "Projects": 1, "Procurement": 1, "HR": 1}


@pytest.mark.asyncio
async def test_empty_queue_keeps_the_honest_message(monkeypatch):
    result = await call_with(monkeypatch, {})
    assert result["data"] == []
    assert result["message"] == "No items currently awaiting executive-visible approval."


def test_every_source_is_org_scoped_and_filters_a_pending_state():
    for source in SOURCES:
        sql = source["sql"]
        assert "organization_id = :org_id" in sql, source["type"]
        assert re.search(r"status (=|IN) |proposal_status = |verification_stage = ", sql), source["type"]


def test_every_decide_via_is_a_real_route():
    from main import app

    def shape(path):
        return re.sub(r"\{[^}]+\}", "{}", path)

    real = {shape(path) for path, _ in executive._openapi_route_tags(app)}
    for source in SOURCES:
        _, path = source["decide_via"].split(" ")
        assert shape(path) in real, source["decide_via"]


def test_every_action_url_is_a_real_dashboard_page():
    for source in SOURCES:
        path = source["action_url"].split("?")[0].removeprefix("/dashboard")
        assert (DASHBOARD / path.lstrip("/") / "page.tsx").exists(), source["action_url"]
