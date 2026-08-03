"""
Tests for the CCB-to-Finance budget bridge: bridging the quotation baseline
into the real budget-vs-actual tracking (finance.project_budgets,
finance.project_forecasts) and the margin-threat alert that fires when
costs run over the approved budget without a matching approved variation.

These tests exercise the pure calculation logic directly (derive_forecast_
metrics has no DB dependency by design) and the DB-touching functions via a
mocked AsyncSession, since live DB access is unavailable in this environment.
"""

import asyncio
import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock

from app.services.finance.project_forecast import (
    derive_forecast_metrics,
    seed_project_budget_from_quotation,
)
from app.services.quotations.calculator import QuotationCalculator
from routers.quotations import _sum_buildup_by_type


class DeriveForecastMetricsTests(unittest.TestCase):
    def _financials(self, **overrides):
        base = dict(
            contract_value=200000, approved_variations=10000, actual_cost_to_date=150000,
            committed_cost=30000, certified_to_date=100000, cash_collected=80000, approved_budget=170000,
        )
        base.update(overrides)
        return base

    def test_overrun_fully_covered_by_approved_variation_is_not_a_threat(self):
        metrics = derive_forecast_metrics(self._financials())
        self.assertTrue(metrics["cost_overrun_risk"])  # EAC (180k) > approved_budget (170k)
        self.assertEqual(metrics["unexplained_overrun_amount"], 0.0)  # but the 10k variation covers it

    def test_overrun_with_no_variation_is_an_unexplained_threat(self):
        metrics = derive_forecast_metrics(self._financials(approved_variations=0))
        self.assertTrue(metrics["cost_overrun_risk"])
        self.assertEqual(metrics["unexplained_overrun_amount"], 10000.0)

    def test_overrun_partially_covered_by_variation_still_flags_the_remainder(self):
        # EAC 180k, budget 170k, variation only 4k -> 6k unexplained.
        metrics = derive_forecast_metrics(self._financials(approved_variations=4000))
        self.assertEqual(metrics["unexplained_overrun_amount"], 6000.0)

    def test_no_approved_budget_never_flags_overrun(self):
        """An unset budget (0) can't meaningfully signal an overrun - must
        not produce a false alarm just because approved_budget is 0."""
        metrics = derive_forecast_metrics(self._financials(approved_budget=0))
        self.assertFalse(metrics["cost_overrun_risk"])
        self.assertEqual(metrics["unexplained_overrun_amount"], 0.0)

    def test_margin_pct_reflects_revised_contract_value(self):
        metrics = derive_forecast_metrics(self._financials())
        # revised_contract_value = 200000+10000=210000, EAC=180000
        self.assertAlmostEqual(metrics["forecast_margin_pct"], (210000 - 180000) / 210000 * 100, places=2)


class SumBuildupByTypeTests(unittest.TestCase):
    def test_sums_only_matching_type(self):
        item = {
            "buildup": [
                {"type": "material", "qty": 2, "rate": 10.0},
                {"type": "material", "qty": 1, "rate": 5.0},
                {"type": "labour", "qty": 3, "rate": 20.0},
            ]
        }
        self.assertEqual(_sum_buildup_by_type(item, "material"), 25.0)
        self.assertEqual(_sum_buildup_by_type(item, "labour"), 60.0)
        self.assertEqual(_sum_buildup_by_type(item, "equipment"), 0.0)

    def test_no_buildup_returns_zero(self):
        self.assertEqual(_sum_buildup_by_type({}, "material"), 0.0)


class SeedProjectBudgetFromQuotationTests(unittest.TestCase):
    def test_budget_total_excludes_profit_and_includes_execution_costs(self):
        """The seeded execution budget must be direct_costs + preliminaries +
        overhead + contingency - explicitly NOT including profit_amount,
        which is protected margin, not money available to spend on site."""
        calc_input = {
            "quotation_id": "QT-BRIDGE-TEST",
            "items": [{"description": "Concrete", "quantity": 100, "rate": 200.0,
                       "material_rate": 120.0, "labour_rate": 60.0, "equipment_rate": 20.0}],
            "preliminaries": 2000,
            "overhead_rate": 0.05,
            "contingency_rate": 0.05,
            "profit_rate": 0.15,
        }
        calculation = QuotationCalculator.calculate(calc_input)

        # direct_costs = 100*200 = 20000; base=22000; overhead=1100; contingency=1100
        expected_execution_total = round(
            float(calculation.direct_costs) + float(calculation.preliminaries)
            + float(calculation.overhead_amount) + float(calculation.contingency_amount), 2
        )
        self.assertGreater(float(calculation.profit_amount), 0)

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            MagicMock(),  # UPDATE ... supersede
            MagicMock(scalar=MagicMock(return_value=1)),  # SELECT next version
            MagicMock(scalar=MagicMock(return_value="budget-uuid-123")),  # INSERT project_budgets RETURNING id
            MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock(), MagicMock(),  # budget_lines inserts
        ])

        budget_id = asyncio.run(seed_project_budget_from_quotation(
            mock_db, "org-1", "project-1", "QT-BRIDGE-TEST", calculation, created_by="user-1",
        ))
        self.assertEqual(budget_id, "budget-uuid-123")

        insert_budget_call = mock_db.execute.await_args_list[2]
        call_params = insert_budget_call.args[1]
        self.assertEqual(call_params["total_amount"], expected_execution_total)
        # The execution budget total must be strictly less than the grand
        # total (sell price) - the gap is exactly the excluded profit margin.
        self.assertLess(call_params["total_amount"], float(calculation.grand_total))


if __name__ == "__main__":
    unittest.main()
