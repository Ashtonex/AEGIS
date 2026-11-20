from datetime import date

import pytest

import routers.executive as executive
from app.services import executive_sites as sites

TODAY = date(2026, 11, 20)
TEAM = [
    {"role": "Site Engineer", "user_id": "u1", "name": "Eng", "account_active": True},
    {"role": "Site Clerk", "user_id": "u2", "name": "Clerk", "account_active": True},
    {"role": "General Foreman", "user_id": "u3", "name": "Fore", "account_active": True},
]


def day(d, heads=0, reg=0, ot=0, cost=0, missing=0, open_=0, total=0, met=0, pv=0, ev=0,
        day_status=None, report_status="submitted", project="p1"):
    return {
        "project_id": project, "day": d, "worker_keys": [f"w{i}" for i in range(heads)],
        "regular_hours": reg, "overtime_hours": ot, "labour_cost": cost, "missing_rates": missing,
        "not_clocked_out": open_, "targets_total": total, "targets_met": met, "targets_progressed": met,
        "planned_value": pv, "earned_value": ev, "day_status": day_status, "report_status": report_status,
    }


def project(pid="p1", name="Site", team=TEAM):
    return {"project_id": pid, "name": name, "status": "active", "team": team}


def codes(site):
    return [flag["code"] for flag in site["flags"]]


def test_healthy_site_is_green_with_week_totals():
    rows = [
        day(date(2026, 11, 18), heads=10, reg=80, ot=5, cost=120, total=4, met=4, pv=400, ev=400),
        day(date(2026, 11, 19), heads=12, reg=96, cost=140, total=4, met=3, pv=400, ev=350),
    ]
    site = sites.build_site(project(), rows, TODAY, None)
    week = site["week"]
    assert (week["worked_days"], week["headcount"], week["total_hours"], week["labour_cost"]) == (2, 12, 181.0, 260.0)
    assert (week["targets_total"], week["targets_met"], week["earned_value"]) == (8, 7, 750.0)
    assert site["health"] == "green" and site["flags"] == []
    assert site["activity"] == "active_week"
    assert [m["name"] for m in site["people"]["foreman"]] == ["Fore"]


def test_full_register_with_no_hours_is_critical_even_when_the_week_average_looks_fine():
    rows = [
        day(date(2026, 11, 17), heads=20, reg=180, cost=200, total=1, met=1),
        day(date(2026, 11, 18), heads=20, reg=180, cost=200, total=1, met=1),
        day(date(2026, 11, 19), heads=19, reg=0, cost=0, total=1, met=1),
    ]
    site = sites.build_site(project(), rows, TODAY, None)
    assert site["week"]["unrecorded_days"] == 1
    assert site["flags"][0]["code"] == "hours_unrecorded"
    assert site["health"] == "red"


def test_people_still_clocked_in_today_are_not_missed_clock_outs():
    rows = [day(TODAY, heads=12, open_=12, total=5, day_status="started", report_status="draft")]
    site = sites.build_site(project(), rows, TODAY, None)
    assert site["activity"] == "working_today"
    assert site["week"]["not_clocked_out"] == 0
    assert "not_clocked_out" not in codes(site) and "hours_unrecorded" not in codes(site)
    assert "unreported_days" not in codes(site)


def test_past_open_clock_ins_missing_rates_targets_and_reports_are_flagged():
    rows = [day(date(2026, 11, 18), heads=13, reg=3.75, cost=3.75, missing=3, open_=12,
                total=5, met=0, report_status="draft")]
    site = sites.build_site(project(), rows, TODAY, None)
    assert {"not_clocked_out", "hours_unrecorded", "targets_missed", "missing_rates", "unreported_days"} <= set(codes(site))
    assert site["flags"][0]["level"] == "critical"


def test_working_without_targets_or_key_people():
    team = [{"role": "Site Clerk", "user_id": "u2", "name": "Clerk", "account_active": False}]
    rows = [day(date(2026, 11, 19), heads=5, reg=40, cost=50)]
    site = sites.build_site(project(team=team), rows, TODAY, None)
    assert {"no_targets", "no_engineer", "no_foreman", "inactive_member"} <= set(codes(site))
    assert "no_clerk" not in codes(site)
    assert site["health"] == "amber"


def test_idle_site_only_reports_idle_and_budget():
    budget = {"status": "over_budget", "spent_percent": 112.0}
    site = sites.build_site(project(team=[]), [], TODAY, budget)
    assert site["activity"] == "idle" and site["health"] == "idle"
    assert codes(site) == ["over_budget", "idle"]


def test_build_sites_orders_working_today_then_worst_and_summarises():
    rows = [
        day(TODAY, heads=4, day_status="started", project="today"),
        day(date(2026, 11, 19), heads=5, reg=40, cost=50, project="amber"),
        day(date(2026, 11, 19), heads=5, reg=0, cost=0, total=1, met=1, project="red"),
    ]
    projects = [project("idle", "Idle"), project("amber", "Amber"), project("red", "Red"), project("today", "Today")]
    result = sites.build_sites(projects, rows, TODAY, {})
    assert [s["project_id"] for s in result["sites"]] == ["today", "red", "amber", "idle"]
    summary = result["summary"]
    assert (summary["total"], summary["working_today"], summary["active_week"], summary["idle"]) == (4, 1, 3, 1)
    assert summary["today_headcount"] == 4 and summary["week_labour_cost"] == 50.0


def test_daily_series_is_zero_filled_oldest_first():
    rows = [day(date(2026, 11, 19), heads=3, reg=24, cost=30)]
    series = sites.daily_series(rows, date(2026, 11, 17), TODAY)
    assert [line["date"] for line in series] == ["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]
    assert [line["headcount"] for line in series] == [0, 0, 3, 0]


@pytest.mark.asyncio
async def test_sites_endpoint_attaches_budget_lines(monkeypatch):
    async def fake_rows(db, query, params, *, source, source_errors=None):
        assert params["org_id"] == "org-1"
        if source == "executive_sites.projects":
            return [project("p1", "Alpha")]
        if source == "executive_sites.days":
            return [day(date(2026, 11, 19), heads=2, reg=16, cost=20, total=1, met=1)]
        return [{"project_id": "p1", "project_name": "Alpha", "project_status": "active",
                 "approved_budget": 100, "actual_cost": 120, "committed_cost": 0, "budget_version": 1}]

    monkeypatch.setattr(executive, "_rows", fake_rows)
    monkeypatch.setattr(sites, "site_today", lambda: TODAY)
    result = await executive.get_executive_sites(user={"org_id": "org-1"}, db=None)
    site = result["data"]["sites"][0]
    assert site["budget"]["status"] == "over_budget"
    assert site["flags"][0]["code"] == "over_budget"


@pytest.mark.asyncio
async def test_site_detail_404s_for_unknown_or_closed_project(monkeypatch):
    async def fake_rows(db, query, params, *, source, source_errors=None):
        return []

    monkeypatch.setattr(executive, "_rows", fake_rows)
    with pytest.raises(executive.HTTPException) as exc:
        await executive.get_executive_site_detail(
            project_id="6c1b0d1e-3c62-4f0f-9d16-0f6f5f1d2a11", user={"org_id": "org-1"}, db=None)
    assert exc.value.status_code == 404
