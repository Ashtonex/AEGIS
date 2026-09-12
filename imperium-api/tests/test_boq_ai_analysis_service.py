"""
Unit tests for AI-assisted BOQ analysis (app/services/quotations/boq_ai_analysis.py
and boq_ai_client.py). Covers the deterministic checks (duplicates, blank/zero
rates, unit mismatches, partial-coverage rate-outlier reuse), the
deterministic/degraded/completed status transitions in analyze_boq, and the
value_class discipline that keeps every AI finding a proposal, never an
approved fact. No live network calls - the Perplexity client is mocked.
"""

import unittest
from decimal import Decimal
from unittest.mock import AsyncMock, patch

from app.services.quotations.boq_ai_analysis import (
    AnalysisResult,
    analyze_boq,
    compute_input_hash,
    detect_blank_or_zero_rates,
    detect_duplicate_items,
    detect_rate_outliers,
    detect_unit_inconsistencies,
    run_deterministic_checks,
)
from app.services.quotations.boq_ai_client import AiBoqAnalysisResponse, AiBoqFinding
from app.services.quotations.calculator import BOQItem


def _item(description="150mm reinforced concrete slab", quantity="10", unit="m3", rate="120.00", **kw):
    return BOQItem(description=description, quantity=Decimal(quantity), unit=unit, rate=Decimal(rate), **kw)


class DuplicateDetectionTests(unittest.TestCase):
    def test_flags_two_identical_lines(self):
        items = [_item(), _item()]
        findings = detect_duplicate_items(items)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["finding_type"], "duplicate_line_item")
        self.assertEqual(findings[0]["original_value"], "2")
        self.assertEqual(findings[0]["value_class"], "system_calculated_value")

    def test_does_not_flag_distinct_descriptions(self):
        items = [_item(description="Slab"), _item(description="Column")]
        self.assertEqual(detect_duplicate_items(items), [])

    def test_different_units_are_not_duplicates(self):
        items = [_item(unit="m3"), _item(unit="m2")]
        self.assertEqual(detect_duplicate_items(items), [])


class BlankOrZeroRateTests(unittest.TestCase):
    def test_flags_nonzero_quantity_with_zero_rate(self):
        items = [_item(rate="0")]
        findings = detect_blank_or_zero_rates(items)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["finding_type"], "blank_or_zero_rate")

    def test_does_not_flag_genuine_nil_item(self):
        items = [_item(quantity="0", rate="0")]
        self.assertEqual(detect_blank_or_zero_rates(items), [])

    def test_does_not_flag_priced_item(self):
        items = [_item(rate="50")]
        self.assertEqual(detect_blank_or_zero_rates(items), [])


class UnitInconsistencyTests(unittest.TestCase):
    def test_flags_same_description_different_units(self):
        items = [_item(unit="m3"), _item(unit="m2")]
        findings = detect_unit_inconsistencies(items)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["finding_type"], "unit_mismatch")

    def test_does_not_flag_consistent_units(self):
        items = [_item(unit="m3"), _item(unit="m3")]
        self.assertEqual(detect_unit_inconsistencies(items), [])


class RateOutlierReuseTests(unittest.TestCase):
    def test_skips_items_with_no_resolvable_benchmark(self):
        items = [_item(description="Something entirely unmatched")]
        self.assertEqual(detect_rate_outliers(items, {}), [])

    def test_flags_item_matching_a_benchmark_far_above_target(self):
        items = [_item(description="Cement 50kg bags", rate="50.00")]
        benchmarks = {
            "CEMENT-50KG": {
                "item_code": "CEMENT-50KG",
                "description": "Cement 50kg bags",
                "unit": "bag",
                "target_rate": 15.0,
                "supplier_rate": 14.0,
                "subcontractor_rate": 0,
                "last_po_rate": 15.0,
                "currency": "USD",
            }
        }
        findings = detect_rate_outliers(items, benchmarks)
        self.assertEqual(len(findings), 1)
        self.assertEqual(findings[0]["finding_type"], "rate_outlier")
        self.assertEqual(findings[0]["value_class"], "system_calculated_value")
        self.assertEqual(findings[0]["confidence"], 0.8)

    def test_never_fabricates_a_match_on_a_short_generic_word(self):
        # "wall" alone is far too short/generic to trust as an item_code match.
        items = [_item(description="wall")]
        benchmarks = {
            "SOME-CODE": {
                "item_code": "SOME-CODE",
                "description": "External masonry wall finish",
                "unit": "m2",
                "target_rate": 10.0,
                "supplier_rate": 9.0,
                "subcontractor_rate": 0,
                "last_po_rate": 10.0,
                "currency": "USD",
            }
        }
        self.assertEqual(detect_rate_outliers(items, benchmarks), [])

    def test_zero_rate_items_are_skipped_not_double_flagged(self):
        # Blank-rate items are already covered by detect_blank_or_zero_rates;
        # the rate-outlier check must not also fire on rate == 0.
        items = [_item(description="Cement 50kg bags", rate="0")]
        benchmarks = {
            "CEMENT-50KG": {
                "item_code": "CEMENT-50KG", "description": "Cement 50kg bags", "unit": "bag",
                "target_rate": 15.0, "supplier_rate": 14.0, "subcontractor_rate": 0,
                "last_po_rate": 15.0, "currency": "USD",
            }
        }
        self.assertEqual(detect_rate_outliers(items, benchmarks), [])


class InputHashTests(unittest.TestCase):
    def test_stable_across_calls_on_identical_input(self):
        items = [_item(), _item(description="Column", quantity="4")]
        self.assertEqual(compute_input_hash(items, "scope text"), compute_input_hash(items, "scope text"))

    def test_order_independent(self):
        a = [_item(description="A"), _item(description="B")]
        b = [_item(description="B"), _item(description="A")]
        self.assertEqual(compute_input_hash(a, None), compute_input_hash(b, None))

    def test_changes_when_a_rate_changes(self):
        original = compute_input_hash([_item(rate="120")], None)
        changed = compute_input_hash([_item(rate="130")], None)
        self.assertNotEqual(original, changed)

    def test_changes_when_scope_text_changes(self):
        items = [_item()]
        self.assertNotEqual(compute_input_hash(items, "scope A"), compute_input_hash(items, "scope B"))


class RunDeterministicChecksTests(unittest.TestCase):
    def test_never_produces_an_approved_commercial_value(self):
        items = [_item(), _item(), _item(rate="0", description="Unpriced item"), _item(unit="m2", description="Unit mismatch item")]
        findings = run_deterministic_checks(items, {})
        self.assertTrue(findings)
        for f in findings:
            self.assertNotEqual(f["value_class"], "approved_commercial_value")
            self.assertEqual(f["value_class"], "system_calculated_value")


class AnalyzeBoqOrchestrationTests(unittest.IsolatedAsyncioTestCase):
    async def test_deterministic_only_when_perplexity_not_configured(self):
        items = [_item(), _item()]  # duplicate -> one deterministic finding
        result = await analyze_boq(items, {}, perplexity_configured=False)
        self.assertIsInstance(result, AnalysisResult)
        self.assertEqual(result.status, "deterministic_only")
        self.assertTrue(all(f["value_class"] == "system_calculated_value" for f in result.findings))

    async def test_degrades_to_deterministic_on_ai_failure(self):
        items = [_item(), _item()]
        with patch(
            "app.services.quotations.boq_ai_analysis.run_boq_analysis",
            new=AsyncMock(return_value=(None, {"model": "sonar-reasoning-pro"}, "invalid_response_schema")),
        ):
            result = await analyze_boq(items, {}, perplexity_configured=True)
        self.assertEqual(result.status, "degraded")
        self.assertEqual(result.error, "invalid_response_schema")
        self.assertTrue(all(f["value_class"] == "system_calculated_value" for f in result.findings))

    async def test_completed_merges_ai_findings_as_proposals(self):
        items = [_item(description="Unique unduplicated item")]
        ai_response = AiBoqAnalysisResponse(
            findings=[
                AiBoqFinding(
                    finding_type="missing_scope_item",
                    reason="Scope mentions waterproofing but no BOQ line covers it.",
                    evidence_text="scope: '...including waterproofing to all wet areas...'",
                    citations=[],
                    confidence=0.9,
                )
            ],
            summary="One missing scope item found.",
        )
        with patch(
            "app.services.quotations.boq_ai_analysis.run_boq_analysis",
            new=AsyncMock(return_value=(ai_response, {"model": "sonar-reasoning-pro", "latency_ms": 500}, None)),
        ):
            result = await analyze_boq(items, {}, project_scope_text="...", perplexity_configured=True)

        self.assertEqual(result.status, "completed")
        ai_findings = [f for f in result.findings if f["value_class"] == "ai_proposal"]
        self.assertEqual(len(ai_findings), 1)
        self.assertEqual(ai_findings[0]["finding_type"], "missing_scope_item")
        self.assertEqual(ai_findings[0]["confidence"], 0.9)
        # Never silently promoted to an approved value.
        self.assertTrue(all(f["value_class"] != "approved_commercial_value" for f in result.findings))

    async def test_never_calls_the_ai_client_when_not_configured(self):
        # Regression guard: perplexity_configured=False must short-circuit
        # before any network-shaped call is attempted.
        items = [_item()]
        with patch(
            "app.services.quotations.boq_ai_analysis.run_boq_analysis", new=AsyncMock()
        ) as mock_run:
            await analyze_boq(items, {}, perplexity_configured=False)
        mock_run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
