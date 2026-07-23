"""
Unit tests for Quotation Intelligence Engine & Commercial Control Brain.
Verifies assembly recipes, rate intelligence, spend forecasting,
commercial guard ("BS Detector"), document change watching, and project evaluation.
"""

import unittest
from app.services.quotations.calculator import QuotationCalculator
from app.services.quotations.intelligence_engine import (
    AssemblyLibrary,
    RateIntelligenceEngine,
    SpendForecaster,
    CommercialGuard,
    DocumentWatcher,
    QuotationBrain,
    AutonomousQuoteBuilder,
)


class QuotationIntelligenceEngineTests(unittest.TestCase):

    def test_assembly_recipe_concrete_breakdown(self):
        """10m3 of 25MPa concrete should calculate exact cement, sand, stone, and water."""
        breakdown = AssemblyLibrary.calculate_breakdown("CONC-25MPA", 10.0)

        self.assertEqual(breakdown["assembly_code"], "CONC-25MPA")
        self.assertEqual(breakdown["quantity"], 10.0)
        self.assertEqual(breakdown["unit"], "m3")

        # 6.5 bags per m3 * 10m3 * 1.05 waste = 68.25 bags
        mats = {m["material"]: m for m in breakdown["materials"]}
        self.assertIn("Cement 42.5N (50kg bags)", mats)
        self.assertAlmostEqual(mats["Cement 42.5N (50kg bags)"]["total_quantity_with_waste"], 68.25, places=2)

        # Output per day is 15m3/day, so 10m3 takes 1 estimated day
        self.assertEqual(breakdown["estimated_production_days"], 1)

    def test_assembly_recipe_brickwork_breakdown(self):
        """100m2 of double skin 230mm brickwork calculation."""
        breakdown = AssemblyLibrary.calculate_breakdown("BRICK-DOUBLE-230", 100.0)

        self.assertEqual(breakdown["assembly_code"], "BRICK-DOUBLE-230")

        # 110 bricks/m2 * 100m2 * 1.05 = 11,550 bricks
        mats = {m["material"]: m for m in breakdown["materials"]}
        self.assertIn("Common Bricks", mats)
        self.assertAlmostEqual(mats["Common Bricks"]["total_quantity_with_waste"], 11550.0, places=1)

    def test_rate_intelligence_outlier_detection(self):
        """Proposed rate > 15% above historical PO rate should flag as OUTLIER_HIGH."""
        normal_eval = RateIntelligenceEngine.evaluate_rate("CEMENT-50KG", 12.50)
        self.assertFalse(normal_eval["is_outlier"])
        self.assertEqual(normal_eval["status"], "ACCEPTABLE")

        outlier_eval = RateIntelligenceEngine.evaluate_rate("CEMENT-50KG", 18.00)
        self.assertTrue(outlier_eval["is_outlier"])
        self.assertEqual(outlier_eval["status"], "OUTLIER_HIGH")
        self.assertIn("WARNING", outlier_eval["recommendation"])

    def test_spend_forecaster_s_curve(self):
        """Generating spend forecast produces weekly S-curve, cashflow, and labour histogram."""
        items = [
            {"description": "Concrete Works", "quantity": 50, "rate": 150.0, "material_rate": 80.0, "labour_rate": 40.0, "equipment_rate": 20.0, "subcontractor_rate": 10.0},
            {"description": "Brickwork", "quantity": 200, "rate": 50.0, "material_rate": 25.0, "labour_rate": 20.0, "equipment_rate": 0.0, "subcontractor_rate": 5.0},
        ]
        forecast = SpendForecaster.generate_forecast(items, project_duration_weeks=8, profit_margin_pct=15.0)

        self.assertEqual(forecast["project_duration_weeks"], 8)
        self.assertGreater(forecast["target_selling_price"], forecast["total_direct_cost"])
        self.assertEqual(len(forecast["weekly_cost_plan"]), 8)
        self.assertEqual(len(forecast["labour_histogram"]), 8)

    def test_commercial_guard_bs_detector_flags_excess_cement(self):
        """Foreman requests 500 bags of cement when earned progress only justifies 280 bags."""
        audit = CommercialGuard.audit_request(
            requester_id="USER-FOREMAN-09",
            requester_name="John Foreman",
            document_type="SITE_MATERIAL_REQUEST",
            item_code_or_desc="Cement 50kg bags",
            requested_quantity=500.0,
            earned_quantity=280.0,
            unit_rate=12.50,
            allowed_wastage_pct=5.0
        )

        self.assertTrue(audit["is_flagged"])
        self.assertEqual(audit["status"], "FLAGGED")
        self.assertIn("EXCESS REQUEST", audit["anomaly_reason"])
        self.assertEqual(audit["evidence_pack"]["requester"]["name"], "John Foreman")
        self.assertEqual(audit["evidence_pack"]["audit_metrics"]["requested_quantity"], 500.0)

    def test_document_watcher_flags_md_approval_on_margin_drop(self):
        """Scope change increasing direct cost by $18,400 requires MD approval."""
        doc_analysis = DocumentWatcher.analyze_change(
            document_name="Architectural Revision R2",
            revision="R2",
            original_direct_cost=100000.0,
            revised_direct_cost=118400.0,
            current_margin_pct=15.0,
            contract_value=130000.0
        )

        self.assertEqual(doc_analysis["cost_delta"], 18400.0)
        self.assertEqual(doc_analysis["approval_level_required"], "MD_APPROVAL_REQUIRED")
        self.assertIn("Managing Director approval mandatory", doc_analysis["governance_note"])

    def test_quotation_brain_evaluate_project(self):
        """Full project evaluation calculates worthiness score, selling price, and approvals."""
        payload = {
            "quotation_id": "QT-SNC-500K",
            "project_title": "Residential Complex 500K",
            "built_area_sqm": 450.0,
            "profit_rate": 0.18,
            "project_duration_weeks": 16,
            "items": [
                {"description": "Concrete Works", "quantity": 100, "rate": 145.0, "material_rate": 70.0, "labour_rate": 45.0, "equipment_rate": 20.0, "subcontractor_rate": 10.0},
                {"description": "Brickwork 230mm", "quantity": 500, "rate": 52.0, "material_rate": 28.0, "labour_rate": 20.0, "equipment_rate": 0.0, "subcontractor_rate": 4.0},
            ]
        }

        brain_eval = QuotationBrain.evaluate_project(payload)

        self.assertTrue(brain_eval["is_worth_taking"])
        self.assertGreaterEqual(brain_eval["worthiness_score"], 65)
        self.assertIn("metrics", brain_eval)
        self.assertGreater(brain_eval["metrics"]["target_selling_price"], 0)

    def test_fuzzy_assembly_matcher(self):
        """Fuzzy semantic matcher should match raw descriptions like 'c30 slab concrete' to CONC-25MPA."""
        from app.services.quotations.intelligence_engine import FuzzyAssemblyMatcher
        match = FuzzyAssemblyMatcher.match_description("150mm thick C30 slab concrete foundation")
        self.assertTrue(match["matched"])
        self.assertEqual(match["assembly_code"], "CONC-25MPA")

    def test_inflation_forecaster(self):
        """Inflation forecaster calculates annual rate and projected cost escalation."""
        from app.services.quotations.intelligence_engine import InflationForecaster
        fc = InflationForecaster.forecast_escalation(base_cost=100000.0, duration_weeks=52, currency="USD")
        self.assertGreater(fc["total_escalated_cost"], 100000.0)
        self.assertEqual(fc["currency"], "USD")

    def test_scenario_simulator(self):
        """Scenario simulator measures direct cost increase and worthiness score drop on material price hike."""
        from app.services.quotations.intelligence_engine import ScenarioSimulator
        base_payload = {
            "built_area_sqm": 450.0,
            "profit_rate": 0.15,
            "items": [{"description": "Concrete Works", "quantity": 100, "rate": 145.0, "material_rate": 70.0, "labour_rate": 45.0, "equipment_rate": 20.0, "subcontractor_rate": 10.0}]
        }
        sim = ScenarioSimulator.simulate_what_if(base_payload, material_price_hike_pct=20.0)
        self.assertGreater(sim["delta"]["cost_increase_amount"], 0)

    def test_subcontractor_benchmark_engine(self):
        """Recommends pre-vetted vendors matching category."""
        from app.services.quotations.intelligence_engine import SubcontractorBenchmarkEngine
        vendors = SubcontractorBenchmarkEngine.recommend_vendors("Concrete & Structure")
        self.assertGreater(len(vendors), 0)
        self.assertEqual(vendors[0]["category"], "Concrete & Structure")



    def test_autonomous_quote_builder_generates_from_crm_lead_context(self):
        """CRM lead context should become a calculable autonomous draft quotation payload."""
        payload = AutonomousQuoteBuilder.generate_quote_payload({
            "source_type": "lead",
            "source_id": "LEAD-001",
            "company_name": "Acme Developments",
            "scope_text": "Residential townhouse building package with roof and finishes",
            "estimated_budget": 420000,
            "built_area_sqm": 520,
        })

        self.assertEqual(payload["client_name"], "Acme Developments")
        self.assertGreater(len(payload["items"]), 0)
        self.assertEqual(payload["autonomous_metadata"]["source_type"], "lead")
        self.assertEqual(payload["autonomous_metadata"]["scope_profile"]["profile"], "building")

        calculation = QuotationCalculator.calculate(payload)
        self.assertGreater(calculation.grand_total, 0)

        brain_eval = QuotationBrain.evaluate_project(payload)
        self.assertIn("metrics", brain_eval)
        self.assertGreater(brain_eval["metrics"]["target_selling_price"], 0)

    def test_autonomous_quote_builder_generates_from_project_context(self):
        """Project context should infer scale from contract value and generate assembly-backed items."""
        payload = AutonomousQuoteBuilder.generate_quote_payload({
            "source_type": "project",
            "source_id": "PROJECT-001",
            "name": "Civil drainage platform upgrade",
            "client_name": "Mine Client",
            "project_type": "civil infrastructure",
            "contract_value": 260000,
        })

        self.assertEqual(payload["client_name"], "Mine Client")
        self.assertGreater(payload["built_area_sqm"], 0)
        self.assertGreater(len(payload["items"]), 0)
        self.assertEqual(payload["autonomous_metadata"]["scope_profile"]["profile"], "civil")
        self.assertTrue(all(item["autonomous_source"] == "assembly_allowance" for item in payload["items"]))

        calculation = QuotationCalculator.calculate(payload)
        self.assertGreater(calculation.direct_costs, 0)

if __name__ == "__main__":
    unittest.main()




