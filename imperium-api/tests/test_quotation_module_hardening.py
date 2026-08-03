"""
Regression tests locking in the Estimating & Quotations module correctness
fixes from the "make it squeaky clean / perfect and accurate" audit.

Each test targets a specific bug that was found and fixed - not a smoke
check, but an assertion tied to the exact defect so a future regression is
caught immediately.
"""

import unittest
from decimal import Decimal

from app.services.quotations.calculator import QuotationCalculator
from app.services.quotations.intelligence_engine import (
    CommercialGuard,
    DocumentWatcher,
    QuotationBrain,
    RateIntelligenceEngine,
    ScenarioSimulator,
    SpendForecaster,
    SubcontractorBenchmarkEngine,
)
from app.services.quotations.boq_importer import BOQImporter


class QuotationBrainMarginGateTests(unittest.TestCase):
    def test_high_score_with_thin_margin_is_not_highly_viable(self):
        """A project scoring >=80 on rate-sanity/cost-per-sqm alone, but with
        only 5% margin, must NOT be classified HIGHLY_VIABLE - margin
        adequacy is a hard gate, not a bonus criterion."""
        payload = {
            "quotation_id": "QT-THIN-MARGIN",
            "profit_rate": 0.05,  # 5% - below the 10% minimum
            "built_area_sqm": 500.0,
            "items": [
                {"description": "Concrete Works", "quantity": 500, "rate": 1000.0}
            ],
        }
        result = QuotationBrain.evaluate_project(payload)
        self.assertNotEqual(result["worthiness_rating"], "HIGHLY_VIABLE")
        self.assertFalse(result["is_worth_taking"])

    def test_adequate_margin_and_clean_rates_can_be_highly_viable(self):
        payload = {
            "quotation_id": "QT-HEALTHY-MARGIN",
            "profit_rate": 0.20,
            "built_area_sqm": 500.0,
            "items": [
                {"description": "Concrete Works", "quantity": 500, "rate": 1000.0}
            ],
        }
        result = QuotationBrain.evaluate_project(payload)
        self.assertGreaterEqual(result["worthiness_score"], 80)
        self.assertEqual(result["worthiness_rating"], "HIGHLY_VIABLE")

    def test_unset_built_area_is_not_applicable_not_fabricated(self):
        payload = {"quotation_id": "QT-NO-AREA", "profit_rate": 0.15, "items": []}
        result = QuotationBrain.evaluate_project(payload)
        self.assertEqual(result["metrics"]["sqm_benchmark_status"], "not_applicable")
        self.assertEqual(result["metrics"]["cost_per_built_sqm"], 0.0)


class SpendForecasterHardeningTests(unittest.TestCase):
    def test_labour_histogram_scales_with_project_size(self):
        """The histogram must reflect real labour $ spend, not just the week
        index - a $10 project and a $1,000,000 project must not produce
        identical headcounts."""
        small = SpendForecaster.generate_forecast(
            [{"description": "x", "quantity": 1, "rate": 10, "labour_rate": 5}],
            project_duration_weeks=4, profit_margin_pct=15.0,
        )
        large = SpendForecaster.generate_forecast(
            [{"description": "x", "quantity": 100000, "rate": 1000, "labour_rate": 500}],
            project_duration_weeks=4, profit_margin_pct=15.0,
        )
        small_total_heads = sum(w["artisans_count"] + w["labourers_count"] for w in small["labour_histogram"])
        large_total_heads = sum(w["artisans_count"] + w["labourers_count"] for w in large["labour_histogram"])
        self.assertGreater(large_total_heads, small_total_heads)

    def test_expected_billing_uses_real_margin_not_hardcoded_18pct(self):
        """expected_billing must reflect the actual profit/contingency rates
        passed in, not a hardcoded 1.18x regardless of input."""
        forecast_low_margin = SpendForecaster.generate_forecast(
            [{"description": "x", "quantity": 100, "rate": 100}],
            project_duration_weeks=4, profit_margin_pct=5.0, contingency_pct=0.0,
        )
        forecast_high_margin = SpendForecaster.generate_forecast(
            [{"description": "x", "quantity": 100, "rate": 100}],
            project_duration_weeks=4, profit_margin_pct=40.0, contingency_pct=0.0,
        )
        low_billing_total = sum(m["expected_billing"] for m in forecast_low_margin["monthly_cashflow"])
        high_billing_total = sum(m["expected_billing"] for m in forecast_high_margin["monthly_cashflow"])
        # Higher margin input must produce higher billing - the old hardcoded
        # 1.18x would make these two totals nearly identical.
        self.assertGreater(high_billing_total, low_billing_total * 1.15)


class RateIntelligenceMessageTests(unittest.TestCase):
    def test_outlier_message_cites_target_variance_when_only_target_triggers(self):
        """If only variance_vs_target exceeds its threshold (last-PO variance
        stays under 15%), the message must cite the target variance, not
        blindly blame the last-PO variance regardless of what tripped it."""
        # BRICK-COMMON: target=0.16, last_po=0.17. At 0.1938 the vs-target
        # variance (~21%) clears its 20% threshold while vs-last-po (~14%)
        # stays under its 15% threshold - isolates the target-only path.
        result = RateIntelligenceEngine.evaluate_rate("BRICK-COMMON", 0.1938)
        variance_vs_last_po = result["variance_vs_last_po_pct"]
        variance_vs_target = result["variance_vs_target_pct"]
        self.assertLessEqual(variance_vs_last_po, 15.0)
        self.assertGreater(variance_vs_target, 20.0)
        self.assertTrue(result["is_outlier"])
        self.assertIn("target rate", result["recommendation"])
        self.assertNotIn("historical PO rate", result["recommendation"])


class ScenarioSimulatorProductivityTests(unittest.TestCase):
    def test_productivity_change_actually_changes_cost(self):
        base_payload = {
            "built_area_sqm": 450.0,
            "profit_rate": 0.15,
            "project_duration_weeks": 16,
            "items": [{
                "description": "Concrete Works", "quantity": 100, "rate": 145.0,
                "material_rate": 70.0, "labour_rate": 45.0, "equipment_rate": 20.0, "subcontractor_rate": 10.0,
            }],
        }
        neutral = ScenarioSimulator.simulate_what_if(base_payload, productivity_change_pct=0.0)
        worse = ScenarioSimulator.simulate_what_if(base_payload, productivity_change_pct=-20.0)
        better = ScenarioSimulator.simulate_what_if(base_payload, productivity_change_pct=20.0)

        self.assertEqual(neutral["simulated_summary"]["direct_cost"], 14500.0)
        self.assertEqual(worse["simulated_summary"]["direct_cost"], 15625.0)
        self.assertEqual(better["simulated_summary"]["direct_cost"], 13750.0)


class CommercialGuardValueThresholdTests(unittest.TestCase):
    def test_zero_progress_rule_uses_dollar_value_not_raw_quantity(self):
        """150 units of a $0.01 item (trivial dollar value) must NOT trigger
        the CRITICAL zero-progress rule; 5 units of a $10,000 item (massive
        dollar value) MUST trigger it - the rule must key on money, not a
        bare unit count."""
        trivial_value = CommercialGuard.audit_request(
            requester_id="U1", requester_name="Test", document_type="SITE_MATERIAL_REQUEST",
            item_code_or_desc="Nails", requested_quantity=150, earned_quantity=0.0, unit_rate=0.01,
        )
        self.assertNotEqual(trivial_value["risk_level"], "CRITICAL")

        high_value = CommercialGuard.audit_request(
            requester_id="U2", requester_name="Test", document_type="SITE_MATERIAL_REQUEST",
            item_code_or_desc="Imported Marble", requested_quantity=5, earned_quantity=0.0, unit_rate=10000.0,
        )
        self.assertEqual(high_value["risk_level"], "CRITICAL")
        self.assertEqual(high_value["recommended_action"], "FREEZE_USER_AND_INVESTIGATE")

    def test_risk_level_never_downgraded_by_a_milder_later_rule(self):
        """Rule 3 (CRITICAL) must win even though it runs last in the
        function body - severity is tracked explicitly, not by rule order."""
        result = CommercialGuard.audit_request(
            requester_id="U3", requester_name="Test", document_type="SITE_MATERIAL_REQUEST",
            item_code_or_desc="Steel", requested_quantity=200, earned_quantity=0.0, unit_rate=50.0,
        )
        self.assertEqual(result["risk_level"], "CRITICAL")


class DocumentWatcherContractValueTests(unittest.TestCase):
    def test_zero_contract_value_does_not_fabricate_zero_percent_margin(self):
        """With no contract value set, a cost DECREASE must still auto-approve
        - it must not be forced into MD_APPROVAL_REQUIRED by a phantom 0%
        margin manufactured from dividing by an unset contract value."""
        result = DocumentWatcher.analyze_change(
            document_name="Test Doc", revision="R1",
            original_direct_cost=100000.0, revised_direct_cost=90000.0,
            current_margin_pct=15.0, contract_value=0.0,
        )
        self.assertIsNone(result["revised_margin_pct"])
        self.assertEqual(result["approval_level_required"], "AUTO_APPROVED")

    def test_known_contract_value_still_flags_margin_erosion(self):
        result = DocumentWatcher.analyze_change(
            document_name="Test Doc", revision="R1",
            original_direct_cost=100000.0, revised_direct_cost=100500.0,
            current_margin_pct=12.0, contract_value=20000.0,
        )
        self.assertIsNotNone(result["revised_margin_pct"])
        self.assertEqual(result["approval_level_required"], "MD_APPROVAL_REQUIRED")


class SubcontractorBenchmarkNoFalseFallbackTests(unittest.TestCase):
    def test_unmatched_category_returns_empty_not_all_vendors(self):
        """A category with zero real matches must not silently return every
        vendor as if they were all relevant recommendations."""
        result = SubcontractorBenchmarkEngine.recommend_vendors("Nonexistent Category XYZ")
        self.assertEqual(result, [])

    def test_matched_category_still_returns_real_matches(self):
        result = SubcontractorBenchmarkEngine.recommend_vendors("Masonry")
        self.assertTrue(len(result) > 0)
        self.assertTrue(all("masonry" in v["category"].lower() for v in result))


class CalculatorNegativeValueAndChecksumTests(unittest.TestCase):
    def test_negative_quantity_and_rate_are_flagged_not_silent(self):
        payload = {
            "quotation_id": "QT-NEG-TEST",
            "items": [
                {"description": "Credit line", "quantity": -10, "rate": -50.0},
            ],
        }
        result = QuotationCalculator.calculate(payload)
        alerts = result.breakdown_log["margin_alerts"]
        self.assertTrue(any("negative quantity" in a.lower() for a in alerts))
        self.assertTrue(any("negative rate" in a.lower() for a in alerts))
        self.assertEqual(result.direct_costs, Decimal("0.00"))

    def test_flat_rate_breakdown_mismatch_is_flagged(self):
        payload = {
            "quotation_id": "QT-MISMATCH-TEST",
            "items": [
                {
                    "description": "Inconsistent item", "quantity": 10, "rate": 100.0,
                    "material_rate": 40.0, "labour_rate": 40.0,  # sums to 80, not 100
                },
            ],
        }
        result = QuotationCalculator.calculate(payload)
        alerts = result.breakdown_log["margin_alerts"]
        self.assertTrue(any("does not match the sum of its cost" in a for a in alerts))
        # Flat rate still wins for the actual direct cost calc.
        self.assertEqual(result.direct_costs, Decimal("1000.00"))

    def test_checksum_changes_when_previously_excluded_fields_change(self):
        """Tampering with contingency_rate/tax_rate/discount/preliminaries/
        provisional_sums/items must change the audit hash - these were
        previously excluded from the tamper-detection checksum entirely."""
        base_payload = {
            "quotation_id": "QT-HASH-TEST",
            "items": [{"description": "Item", "quantity": 10, "rate": 100.0}],
            "overhead_rate": 0.05,
            "profit_rate": 0.10,
        }
        base_hash = QuotationCalculator.calculate(base_payload).audit_trail_hash

        for mutated_field, mutated_value in [
            ("contingency_rate", 0.08),
            ("tax_rate", 0.20),
            ("discount", 50.0),
            ("preliminaries", 500.0),
            ("provisional_sums", 1000.0),
        ]:
            mutated_payload = dict(base_payload)
            mutated_payload[mutated_field] = mutated_value
            mutated_hash = QuotationCalculator.calculate(mutated_payload).audit_trail_hash
            self.assertNotEqual(
                base_hash, mutated_hash,
                f"Changing '{mutated_field}' did not change the audit hash - tampering would go undetected."
            )

        mutated_items_payload = dict(base_payload)
        mutated_items_payload["items"] = [{"description": "Different Item", "quantity": 999, "rate": 1.0}]
        mutated_items_hash = QuotationCalculator.calculate(mutated_items_payload).audit_trail_hash
        self.assertNotEqual(base_hash, mutated_items_hash)


class BOQImporterParseFailureTests(unittest.TestCase):
    def test_unparseable_value_is_warned_not_silently_zeroed(self):
        csv = b"Description,Quantity,Unit,Rate\nBad rate item,50,m2,TBD\n"
        result = BOQImporter.import_boq(csv, ".csv")
        self.assertTrue(any("could not parse rate" in w.lower() for w in result.warnings))

    def test_accounting_style_negative_is_parsed_and_flagged(self):
        csv = b"Description,Quantity,Unit,Rate\nCredit line,10,item,(25.50)\n"
        result = BOQImporter.import_boq(csv, ".csv")
        self.assertTrue(any("negative rate" in w.lower() for w in result.warnings))
        self.assertEqual(result.items[0].rate, Decimal("0"))


if __name__ == "__main__":
    unittest.main()
