from datetime import date

import pytest

import routers.executive as executive


def project(name, budget, actual, committed=0):
    return {
        "project_id": f"id-{name}",
        "project_name": name,
        "project_status": "active",
        "approved_budget": budget,
        "actual_cost": actual,
        "committed_cost": committed,
        "budget_version": 1,
    }


def test_project_status_bands():
    line = executive._project_budget_line
    assert line(project("a", 1000, 500))["status"] == "on_track"
    # Spent is under budget, but spent + committed crosses 90%.
    at_risk = line(project("b", 1000, 600, 300))
    assert (at_risk["status"], at_risk["exposure_percent"], at_risk["remaining"]) == ("at_risk", 90.0, 100.0)
    assert line(project("c", 1000, 1000.01))["status"] == "over_budget"
    zero = line(project("d", 0, 50))
    assert (zero["status"], zero["spent_percent"]) == ("no_budget_value", None)


VARIANCE = {
    "fiscal_year": 2026,
    "no_baseline_budget": False,
    "budget_label": "FY2026 baseline",
    "months": [
        {"month": "2026-08-01", "budget_revenue": 100.0, "actual_revenue": 90.0, "budget_cost": 60.0,
         "actual_cost": 70.0, "budget_net": 40.0, "actual_net": 20.0},
        {"month": "2026-09-01", "budget_revenue": 100.0, "actual_revenue": 120.0, "budget_cost": 60.0,
         "actual_cost": 50.0, "budget_net": 40.0, "actual_net": 70.0},
        {"month": "2026-10-01", "budget_revenue": 999.0, "actual_revenue": 0.0, "budget_cost": 999.0,
         "actual_cost": 0.0, "budget_net": 0.0, "actual_net": 0.0},
    ],
}


def test_company_ytd_stops_at_the_current_month():
    ytd = executive._company_budget_ytd(VARIANCE, date(2026, 9, 1))["ytd"]
    assert (ytd["budget_revenue"], ytd["actual_revenue"], ytd["revenue_variance"]) == (200.0, 210.0, 10.0)
    assert (ytd["budget_cost"], ytd["actual_cost"], ytd["cost_variance"]) == (120.0, 120.0, 0.0)
    assert (ytd["budget_net"], ytd["actual_net"], ytd["net_variance"]) == (80.0, 90.0, 10.0)


def test_company_without_approved_budget_reports_none_not_zero():
    result = executive._company_budget_ytd(
        {**VARIANCE, "no_baseline_budget": True, "budget_label": None}, date(2026, 9, 1)
    )
    assert result["has_approved_budget"] is False
    assert result["ytd"]["budget_cost"] is None and result["ytd"]["cost_variance"] is None
    assert result["ytd"]["actual_cost"] == 120.0


@pytest.mark.asyncio
async def test_endpoint_sorts_projects_by_exposure(monkeypatch):
    async def fake_variance(db, *, org_id, fiscal_year):
        assert org_id == "org-1"
        return {**VARIANCE, "fiscal_year": fiscal_year}

    async def fake_rows(db, query, params, *, source, source_errors=None):
        return [project("low", 1000, 100), project("over", 500, 600), project("risk", 1000, 500, 450)]

    monkeypatch.setattr(executive.budgets, "get_company_variance", fake_variance)
    monkeypatch.setattr(executive, "_rows", fake_rows)
    result = await executive.get_executive_budget_vs_actual(user={"org_id": "org-1"}, db=None)
    data = result["data"]

    assert [line["project_name"] for line in data["projects"]] == ["over", "risk", "low"]
    assert (data["over_budget_count"], data["at_risk_count"]) == (1, 1)
    assert data["project_totals"] == {
        "approved_budget": 2500.0, "actual_cost": 1200.0, "committed_cost": 450.0, "remaining": 850.0,
    }
    assert data["company"]["has_approved_budget"] is True
