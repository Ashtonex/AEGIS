from datetime import date

import pytest

import routers.executive as executive
from app.services import executive_needs_you as needs

TODAY = date(2026, 11, 20)
PEOPLE = {
    "engineer": [{"user_id": "eng", "name": "Eng", "role": "Site Engineer", "account_active": True}],
    "clerk": [{"user_id": "clk", "name": "Clerk", "role": "Site Clerk", "account_active": True}],
    "foreman": [],
}


def site(pid="p1", name="Alpha", flags=None, people=PEOPLE):
    return {"project_id": pid, "name": name, "people": people, "week": {"last_worked_date": "2026-11-19"},
            "flags": flags if flags is not None else []}


def flag(code, level="warning", message=None):
    return {"code": code, "level": level, "message": message or code}


def approval(id_="a1", type_="purchase_order", waiting=1, amount=500.0):
    return {"id": id_, "type": type_, "module": "Procurement", "reference": "PO-1", "amount": amount,
            "created_at": "2026-11-19 08:00:00+02:00", "waiting_days": waiting, "reason": "Draft PO",
            "action_url": "/dashboard/procurement?tab=purchase-orders", "detail": None}


def report_exception(id_, project_id="p1", exposure=100):
    return {"id": id_, "project_id": project_id, "title": "Alpha", "category": "Site report exception",
            "action": "Review approved site report cost exposure", "evidence_date": "2026-10-20",
            "evidence": {"cost_exposure": exposure}}


def test_site_with_only_idle_flag_is_not_an_item_and_owner_follows_the_problem():
    sites = [
        site("idle", flags=[flag("idle", "info")]),
        site("rec", flags=[flag("not_clocked_out", "critical"), flag("no_targets")]),
        site("tgt", flags=[flag("targets_missed")]),
        site("gap", flags=[flag("no_foreman")]),
    ]
    items = {item["project_id"]: item for item in needs.site_items(sites)}
    assert set(items) == {"rec", "tgt", "gap"}
    assert items["rec"]["severity"] == "critical" and items["rec"]["suggested_owner"]["user_id"] == "clk"
    assert items["rec"]["signature"] == ["no_targets", "not_clocked_out"]
    assert items["rec"]["points"] == ["no_targets"]
    assert items["tgt"]["suggested_owner"]["user_id"] == "eng"
    assert items["gap"]["suggested_owner"] is None


def test_deactivated_people_are_never_suggested_owners():
    people = {"engineer": [{"user_id": "eng", "name": "Eng", "account_active": False}], "clerk": [], "foreman": []}
    item = needs.site_items([site(flags=[flag("targets_missed")], people=people)])[0]
    assert item["suggested_owner"] is None


def test_exceptions_on_one_project_are_grouped_with_summed_exposure():
    rows = [report_exception("r1", exposure=100), report_exception("r2", exposure=250),
            report_exception("r3", project_id="p2")]
    items = needs.exception_items(rows, {"p1": site()}, TODAY)
    grouped = next(item for item in items if item["project_id"] == "p1")
    assert grouped["title"] == "Alpha: 2 approved site reports with cost, delay or safety issues"
    assert grouped["amount"] == 350.0 and grouped["signature"] == ["r1", "r2"]
    assert grouped["age_days"] == 31 and grouped["action_url"] == "/dashboard/projects/p1"
    assert grouped["suggested_owner"]["user_id"] == "eng"
    assert len(items) == 2


def test_future_compliance_expiry_is_due_not_aged():
    row = {"id": "c1", "title": "Fire cert", "category": "Compliance expiry", "expiry_date": date(2026, 12, 1),
           "action": "Renew or resolve certificate"}
    item = needs.exception_items([row], {}, TODAY)[0]
    assert item["due"] == date(2026, 12, 1) and item["age_days"] is None and item["severity"] == "warning"
    expired = needs.exception_items([{**row, "expiry_date": date(2026, 11, 1)}], {}, TODAY)[0]
    assert expired["severity"] == "critical"


def test_decisions_escalate_with_waiting_time_and_offer_quick_decide_only_where_supported():
    items = needs.decision_items([approval("a", waiting=1), approval("b", waiting=4),
                                  approval("c", "leave_request", waiting=9, amount=None)])
    assert [item["severity"] for item in items] == ["info", "warning", "critical"]
    assert items[0]["title"] == "Decide purchase order PO-1 ($500)" and items[0]["decide"] is None
    assert items[2]["decide"] == {"type": "leave_request", "id": "c"}


def _state(key, **fields):
    return {"item_key": key, "status": "open", "signature": [], "snoozed_until": None, "assigned_to": None,
            "assigned_at": None, "note": None, "assigned_name": None, **fields}


def test_snooze_and_dismiss_hide_until_something_new_appears():
    sites = [site("p1", flags=[flag("targets_missed")]), site("p2", flags=[flag("no_targets")])]
    exceptions = [report_exception("r1")]
    states = [
        _state("site:p1", status="snoozed", signature=["targets_missed"], snoozed_until=date(2026, 11, 27)),
        _state("site:p2", status="snoozed", signature=["other"], snoozed_until=date(2026, 11, 27)),
        _state("exception:Site report exception:p1", status="dismissed", signature=["r1"],
               assigned_to="u9", assigned_name="Nine"),
    ]
    result = needs.build([], exceptions, sites, states, TODAY, "u9")
    by_key = {item["key"]: item for item in result["items"]}
    assert by_key["site:p1"]["hidden"] and by_key["site:p1"]["state"]["status"] == "snoozed"
    assert not by_key["site:p2"]["hidden"] and by_key["site:p2"]["state"]["returned"]
    dismissed = by_key["exception:Site report exception:p1"]
    assert dismissed["hidden"] and dismissed["state"]["assigned_to"] == {"user_id": "u9", "name": "Nine"}
    assert result["items"][-1]["hidden"] and result["items"][-2]["hidden"]
    assert result["summary"]["open"] == 1 and result["summary"]["snoozed"] == 1
    assert result["summary"]["dismissed"] == 1 and result["summary"]["mine"] == 0

    # A second report on the dismissed group brings it back; an ended snooze too.
    result = needs.build([], exceptions + [report_exception("r2")], sites, states, date(2026, 11, 28), "u9")
    by_key = {item["key"]: item for item in result["items"]}
    assert not by_key["exception:Site report exception:p1"]["hidden"]
    assert by_key["site:p1"]["state"]["returned"] == "Snooze ended"
    assert result["summary"]["mine"] == 1


def test_rank_puts_worst_first_then_sites_then_money():
    items = needs.decision_items([approval("small", waiting=8, amount=10), approval("big", waiting=8, amount=900)])
    items += needs.site_items([site(flags=[flag("not_clocked_out", "critical")])])
    needs.apply_states(items, [], TODAY)
    assert [item["kind"] for item in needs.rank(items)] == ["site", "decision", "decision"]
    assert needs.rank(items)[1]["amount"] == 900


@pytest.mark.asyncio
async def test_dismissing_a_decision_is_refused(monkeypatch):
    async def fake_payload(user, db):
        items = needs.decision_items([approval()])
        needs.apply_states(items, [], TODAY)
        return {"data": {"items": items, "assignees": []}, "source_errors": []}

    monkeypatch.setattr(executive, "_needs_you_payload", fake_payload)
    with pytest.raises(executive.HTTPException) as exc:
        await executive.act_on_executive_needs_you(
            {"item_key": "decision:purchase_order:a1", "action": "dismiss", "note": "x"},
            user={"org_id": "o", "user_id": "u"}, db=None)
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_assigning_to_someone_outside_the_org_is_refused(monkeypatch):
    async def fake_payload(user, db):
        items = needs.site_items([site(flags=[flag("targets_missed")])])
        needs.apply_states(items, [], TODAY)
        return {"data": {"items": items, "assignees": [{"user_id": "eng"}]}, "source_errors": []}

    monkeypatch.setattr(executive, "_needs_you_payload", fake_payload)
    with pytest.raises(executive.HTTPException) as exc:
        await executive.act_on_executive_needs_you(
            {"item_key": "site:p1", "action": "assign", "assignee_user_id": "stranger"},
            user={"org_id": "o", "user_id": "u"}, db=None)
    assert exc.value.status_code == 400
