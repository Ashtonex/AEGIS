from datetime import date, timedelta

import httpx
import pytest

from app.services.finance import project_cash_curve as cc
from app.services.finance.project_cash_curve import (
    CashCurveAssumptions,
    build_cash_curve,
    build_cash_events,
    cumulative_progress,
    derive_quotation_economics,
)

START = date(2027, 1, 4)


def simple(**overrides) -> CashCurveAssumptions:
    """4-week job, all labour (paid as incurred), one claim at completion,
    no deposit/retention/funding cost - easy to reason about by hand."""
    base = dict(
        contract_value=500, project_cost=400, duration_weeks=4, start_date=START,
        cost_profile="even", materials_share=0, labour_share=1, plant_share=0, subcontract_share=0,
        preliminaries=0, mobilisation_cost=0, deposit_pct=0, retention_pct=0,
        claim_frequency_days=28, client_payment_days=14, finance_rate_pct=0, granularity="week",
    )
    base.update(overrides)
    return CashCurveAssumptions.from_dict(base)


def by_category(events, category):
    return [e for e in events if e["category"] == category]


class TestProfiles:
    @pytest.mark.parametrize("profile", ["front", "even", "s_curve", "back"])
    def test_profiles_run_zero_to_one_monotonically(self, profile):
        values = [cumulative_progress(i / 20, profile) for i in range(21)]
        assert values[0] == 0 and values[-1] == pytest.approx(1)
        assert all(b >= a for a, b in zip(values, values[1:]))

    def test_front_loaded_spends_earlier_than_back_loaded(self):
        assert cumulative_progress(0.3, "front") > cumulative_progress(0.3, "s_curve") > cumulative_progress(0.3, "back")


class TestPeakDetection:
    def test_hand_worked_curve(self):
        curve = build_cash_curve(simple())
        cumulative = [p["cumulative"] for p in curve["periods"]]
        # Wages of 100 go out at the end of each week (days 7/14/21/28, i.e.
        # periods W2..W5); the single claim of 500 lands on day 28 + 14 = 42 (W7).
        assert cumulative[:7] == [0, -100, -200, -300, -400, -400, 100]
        s = curve["summary"]
        assert s["peak_funding"] == 400
        assert s["peak_period"] == "W5"
        assert s["peak_date"] == (START + timedelta(days=34)).isoformat()
        assert s["cash_positive_period"] == "W7"
        assert s["margin"] == 100
        assert s["never_cash_positive"] is False

    def test_never_cash_positive_when_loss_making(self):
        s = build_cash_curve(simple(project_cost=600))["summary"]
        assert s["never_cash_positive"] is True
        assert s["cash_positive_period"] is None

    def test_funding_cost_is_interest_on_the_overdrawn_balance(self):
        s = build_cash_curve(simple(finance_rate_pct=36.5))["summary"]
        # 7 days each at 100, 200, 300, 400, 400 overdrawn = 9,800 dollar-days at 0.1%/day.
        assert s["funding_cost"] == pytest.approx(9.8, abs=0.01)
        assert s["margin_after_funding"] == pytest.approx(100 - 9.8, abs=0.01)


class TestDeposit:
    def test_deposit_received_on_deposit_day_and_recovered_from_claims(self):
        a = simple(deposit_pct=20, deposit_day=3)
        events = build_cash_events(a)
        deposits = by_category(events, "deposit")
        assert deposits == [{"day": 3, "amount": 100.0, "direction": "inflow", "category": "deposit"}]
        claims = by_category(events, "claims")
        assert sum(e["amount"] for e in claims) == pytest.approx(400)  # 500 less 100 recovered
        assert sum(e["amount"] for e in events if e["direction"] == "inflow") == pytest.approx(500)

    def test_deposit_cuts_peak_funding(self):
        without = build_cash_curve(simple())["summary"]["peak_funding"]
        with_deposit = build_cash_curve(simple(deposit_pct=20))["summary"]["peak_funding"]
        assert with_deposit == pytest.approx(without - 100)


class TestRetention:
    def test_retention_held_from_claims_and_released_in_two_parts(self):
        a = simple(retention_pct=10, retention_release_at_pc_pct=50, defects_period_days=180)
        events = build_cash_events(a)
        assert sum(e["amount"] for e in by_category(events, "claims")) == pytest.approx(450)
        releases = by_category(events, "retention_release")
        assert [(e["day"], e["amount"]) for e in releases] == [(28 + 14, 25.0), (28 + 180 + 14, 25.0)]
        s = build_cash_curve(a)["summary"]
        assert s["retention_locked"] == 50
        assert s["retention_held_through_defects"] == 25
        assert s["total_inflow"] == pytest.approx(500)

    def test_full_release_at_completion_has_no_defects_tail(self):
        releases = by_category(build_cash_events(simple(retention_pct=5, retention_release_at_pc_pct=100)), "retention_release")
        assert len(releases) == 1 and releases[0]["amount"] == 25


class TestPaymentDelays:
    def test_client_payment_days_shift_every_inflow(self):
        quick = by_category(build_cash_events(simple(client_payment_days=0, claim_frequency_days=7)), "claims")
        slow = by_category(build_cash_events(simple(client_payment_days=90, claim_frequency_days=7)), "claims")
        assert [e["day"] + 90 for e in quick] == [e["day"] for e in slow]
        assert [e["amount"] for e in quick] == [e["amount"] for e in slow]

    def test_slower_client_raises_peak_funding(self):
        p0 = build_cash_curve(simple(client_payment_days=0, claim_frequency_days=7))["summary"]["peak_funding"]
        p90 = build_cash_curve(simple(client_payment_days=90, claim_frequency_days=7))["summary"]["peak_funding"]
        # Paid weekly with no delay the job funds itself after week 1; at 90
        # days every wage is paid before any claim comes back.
        assert p0 < p90 == 400

    def test_supplier_terms_delay_materials_but_not_labour(self):
        a = simple(materials_share=1, labour_share=1, supplier_payment_days=30)
        events = build_cash_events(a)
        assert [e["day"] for e in by_category(events, "materials")] == [37, 44, 51, 58]
        assert [e["day"] for e in by_category(events, "labour")] == [7, 14, 21, 28]
        assert sum(e["amount"] for e in events if e["direction"] == "outflow") == pytest.approx(400)


class TestCostsAndPeriods:
    def test_mobilisation_and_preliminaries(self):
        events = build_cash_events(simple(preliminaries=80, mobilisation_cost=20))
        assert by_category(events, "mobilisation")[0] == {"day": 0, "amount": 20.0, "direction": "outflow", "category": "mobilisation"}
        assert [e["amount"] for e in by_category(events, "preliminaries")] == [20.0] * 4
        assert sum(e["amount"] for e in by_category(events, "labour")) == pytest.approx(300)

    def test_monthly_periods_for_long_jobs(self):
        curve = build_cash_curve(simple(duration_weeks=52, granularity="auto"))
        assert curve["granularity"] == "month"
        assert curve["periods"][0]["label"] == "M1"
        assert curve["periods"][1]["start_date"] == "2027-02-04"

    def test_overrides_are_coerced_and_unknown_keys_ignored(self):
        a = simple().merged({"duration_weeks": "10", "deposit_pct": 150, "cost_profile": "wiggly", "bogus": 1, "start_date": "2027-03-01"})
        assert a.duration_weeks == 10 and a.deposit_pct == 100 and a.cost_profile == "s_curve"
        assert a.start_date == date(2027, 3, 1)


class TestQuotationEconomics:
    def test_cost_build_up_used_when_present(self):
        econ = derive_quotation_economics(1000, {
            "taxable_amount": 1200, "direct_costs": 900, "preliminaries": 50, "contingency_amount": 20,
            "provisional_sums": 30, "overhead_pct": 5, "profit_pct": 10, "contingency_pct": 2,
        })
        assert econ["contract_value"] == 1200
        assert econ["project_cost"] == 1000
        assert econ["preliminaries"] == 50

    def test_back_calculated_from_markups(self):
        econ = derive_quotation_economics(1200, {"subtotal": 1200, "overhead_pct": 5, "contingency_pct": 5, "profit_pct": 10})
        assert econ["project_cost"] == pytest.approx(1000 * 1.05)

    def test_priced_boq_without_markup_is_not_taken_as_cost(self):
        econ = derive_quotation_economics(1200, {"subtotal": 1200, "direct_costs": 1200, "preliminaries": 0})
        assert econ["project_cost"] == pytest.approx(1000)
        assert "selling price" in econ["notes"]["project_cost"]

    def test_rate_build_up_sets_the_cost_mix(self):
        econ = derive_quotation_economics(100, {"breakdown_log": {"direct_costs_breakdown": {
            "materials": "50", "transport": "10", "labour": "20", "equipment": "0", "subcontractors": "20"}}})
        assert econ["mix"] == {"materials": 0.6, "labour": 0.2, "plant": 0.0, "subcontract": 0.2}


# --- Endpoint -------------------------------------------------------------

@pytest.fixture
def api(monkeypatch):
    from fastapi.middleware.trustedhost import TrustedHostMiddleware
    from core.database import get_db
    from core.security import get_current_user
    from main import app

    for middleware in app.user_middleware:
        if middleware.cls == TrustedHostMiddleware:
            middleware.kwargs["allowed_hosts"] = ["*"]
    app.middleware_stack = None

    class FakeDb:
        info: dict = {}

    async def fake_db():
        yield FakeDb()

    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "00000000-0000-0000-0000-000000000001",
        "org_id": "00000000-0000-0000-0000-000000000001",
        "role": "SUPERADMIN",
    }
    app.dependency_overrides[get_db] = fake_db

    async def fake_load(db, org_id, quotation_id):
        if quotation_id != "q-1":
            return None
        return simple(), {"client_payment_days": "Company default"}, {"kind": "quotation", "id": "q-1", "label": "Q1"}

    monkeypatch.setattr(cc, "load_quotation_defaults", fake_load)
    yield httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver")
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_db, None)


@pytest.mark.asyncio
async def test_compute_endpoint_returns_one_curve_per_scenario(api):
    async with api as client:
        res = await client.post("/api/v1/finance/cash-curves/quotations/q-1", json={"scenarios": [
            {"name": "As priced", "assumptions": {}},
            {"name": "20% deposit", "assumptions": {"deposit_pct": 20}},
        ]})
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["context"]["id"] == "q-1"
    assert data["defaults"]["contract_value"] == 500
    assert data["default_sources"]["client_payment_days"] == "Company default"
    names = [s["name"] for s in data["scenarios"]]
    assert names == ["As priced", "20% deposit"]
    base, deposit = (s["summary"]["peak_funding"] for s in data["scenarios"])
    assert base == 400 and deposit == 300
    assert data["scenarios"][1]["assumptions"]["deposit_pct"] == 20


@pytest.mark.asyncio
async def test_compute_endpoint_defaults_to_a_base_case_and_404s_unknown_quotes(api):
    async with api as client:
        ok = await client.post("/api/v1/finance/cash-curves/quotations/q-1", json={})
        missing = await client.post("/api/v1/finance/cash-curves/quotations/nope", json={})
    assert ok.status_code == 200
    assert [s["name"] for s in ok.json()["data"]["scenarios"]] == ["Base case"]
    assert missing.status_code == 404
