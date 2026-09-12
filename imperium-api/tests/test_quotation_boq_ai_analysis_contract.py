from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT.parent / "aegis-web" / "src"

MIGRATION = (ROOT / "migrations" / "216_quotations_boq_ai_analysis.sql").read_text(encoding="utf-8")
SUPABASE_MIGRATION = (
    ROOT.parent / "supabase" / "migrations" / "20260912002000_quotations_boq_ai_analysis.sql"
).read_text(encoding="utf-8")
CLIENT_MODULE = (ROOT / "app" / "services" / "quotations" / "boq_ai_client.py").read_text(encoding="utf-8")
SERVICE_MODULE = (ROOT / "app" / "services" / "quotations" / "boq_ai_analysis.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "quotations.py").read_text(encoding="utf-8")
CONFIG = (ROOT / "core" / "config.py").read_text(encoding="utf-8")
CALCULATOR = (ROOT / "app" / "services" / "quotations" / "calculator.py").read_text(encoding="utf-8")
BOQ_IMPORTER = (ROOT / "app" / "services" / "quotations" / "boq_importer.py").read_text(encoding="utf-8")
WEB_API = (WEB_ROOT / "lib" / "api.ts").read_text(encoding="utf-8")
CCB_PAGE = (WEB_ROOT / "app" / "dashboard" / "quotations" / "ccb" / "page.tsx").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_imperium_and_supabase_migrations_are_identical(self):
        self.assertEqual(MIGRATION, SUPABASE_MIGRATION)

    def test_both_tables_created(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.boq_analysis_runs", MIGRATION)
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.boq_analysis_findings", MIGRATION)

    def test_value_class_check_constraint_includes_every_required_category(self):
        for category in (
            "source_fact", "extracted_value", "system_calculated_value", "historical_benchmark",
            "supplier_supported_rate", "market_researched_rate", "user_assumption", "ai_proposal",
            "approved_commercial_value", "actual_incurred_value", "forecast_value",
        ):
            self.assertIn(f"'{category}'", MIGRATION)

    def test_reviewer_decision_starts_pending_and_is_constrained(self):
        self.assertIn("reviewer_decision       VARCHAR(20) NOT NULL DEFAULT 'pending'", MIGRATION)
        self.assertIn("reviewer_decision IN ('pending', 'accepted', 'rejected')", MIGRATION)

    def test_rls_locks_both_tables_to_service_role(self):
        for table in ("finance.boq_analysis_runs", "finance.boq_analysis_findings"):
            self.assertIn(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;", MIGRATION)
            self.assertIn(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY;", MIGRATION)
            self.assertIn(f"REVOKE ALL ON {table} FROM anon, authenticated;", MIGRATION)

    def test_both_permission_keys_granted_to_the_right_tier(self):
        self.assertIn("'quotations.ai_boq_analysis.use'", MIGRATION)
        self.assertIn("'quotations.ai_boq_analysis.review'", MIGRATION)
        self.assertIn("r.name = 'SUPERADMIN'", MIGRATION)
        self.assertIn("r.name = 'Quantity Surveyor'", MIGRATION)
        self.assertIn("r.name = 'Commercial Manager'", MIGRATION)


class EvidenceAnchorContractTests(unittest.TestCase):
    def test_boq_item_carries_optional_source_anchor(self):
        self.assertIn("source_sheet: Optional[str] = None", CALCULATOR)
        self.assertIn("source_row: Optional[int] = None", CALCULATOR)

    def test_importer_populates_the_anchor_instead_of_discarding_it(self):
        self.assertIn("source_sheet=sheet_title or None", BOQ_IMPORTER)
        self.assertIn("source_row=row_num", BOQ_IMPORTER)

    def test_metadata_persistence_carries_the_anchor_through(self):
        self.assertIn('"source_sheet": raw.get("source_sheet")', ROUTER)
        self.assertIn('"source_row": raw.get("source_row")', ROUTER)


class ProviderClientContractTests(unittest.TestCase):
    def test_circuit_breaker_and_retry_wrap_the_perplexity_call(self):
        self.assertIn('CircuitBreaker(\n    "perplexity_boq_analysis"', CLIENT_MODULE)
        self.assertIn("@retry(", CLIENT_MODULE)
        self.assertIn("RateLimitError", CLIENT_MODULE)

    def test_uses_perplexity_base_url_via_the_openai_sdk(self):
        self.assertIn('base_url="https://api.perplexity.ai"', CLIENT_MODULE)

    def test_does_not_use_the_openai_only_beta_parse_helper(self):
        # .beta.chat.completions.parse()'s guarantees are OpenAI-specific;
        # this integration must independently validate JSON itself instead.
        # (The module docstring names the helper in prose to explain why it's
        # avoided - check for an actual call site, not that substring.)
        self.assertNotIn("client.beta", CLIENT_MODULE)
        self.assertIn("model_validate_json(raw_content)", CLIENT_MODULE)

    def test_fails_closed_when_key_unset_without_calling_the_api(self):
        not_configured_block = CLIENT_MODULE.split("if not api_key:")[1].split("import openai")[0]
        self.assertIn("return None, usage_meta,", not_configured_block)

    def test_retries_once_on_schema_validation_failure_before_failing_closed(self):
        self.assertIn("repair_messages", CLIENT_MODULE)
        self.assertIn("Your previous response did not match the required schema", CLIENT_MODULE)

    def test_findings_schema_forbids_unknown_fields_and_bounds_confidence(self):
        self.assertIn('model_config = ConfigDict(extra="forbid")', CLIENT_MODULE)
        self.assertIn("confidence: float = Field(ge=0.0, le=1.0)", CLIENT_MODULE)

    def test_whitelists_only_safe_fields_never_the_internal_cost_breakdown(self):
        for banned in (
            "material_rate", "labour_rate", "equipment_rate",
            "subcontractor_rate", "transport_rate", "waste_allowance_rate",
        ):
            # These field names may appear in comments explaining the
            # exclusion, but must never appear inside the whitelist function.
            whitelist_fn = CLIENT_MODULE.split("def whitelist_items_for_external_research")[1].split("\ndef ")[0]
            self.assertNotIn(f'"{banned}"', whitelist_fn)


class ServiceOrchestrationContractTests(unittest.TestCase):
    def test_deterministic_checks_always_run_regardless_of_ai_availability(self):
        self.assertIn("deterministic_findings = run_deterministic_checks(items, rate_benchmarks)", SERVICE_MODULE)
        self.assertIn('if not perplexity_configured:', SERVICE_MODULE)
        self.assertIn('return AnalysisResult(status="deterministic_only"', SERVICE_MODULE)

    def test_ai_findings_are_always_tagged_as_proposals(self):
        self.assertIn('value_class="ai_proposal"', SERVICE_MODULE)

    def test_deterministic_findings_are_always_tagged_as_system_calculated(self):
        self.assertIn('value_class: str = "system_calculated_value"', SERVICE_MODULE)

    def test_ai_failure_degrades_rather_than_raises(self):
        self.assertIn('if ai_response is None:', SERVICE_MODULE)
        self.assertIn('status="degraded"', SERVICE_MODULE)

    def test_item_code_resolution_never_forces_a_match(self):
        self.assertIn("Returns None (never a forced or\n    fabricated match)", SERVICE_MODULE)


class RouterContractTests(unittest.TestCase):
    def test_run_endpoint_requires_use_permission(self):
        self.assertIn('require_permission("quotations.ai_boq_analysis.use")', ROUTER)

    def test_review_endpoint_requires_review_permission(self):
        self.assertIn('require_permission("quotations.ai_boq_analysis.review")', ROUTER)

    def test_review_never_mutates_the_boq_or_quotation(self):
        review_block = ROUTER.split("async def review_boq_ai_analysis_finding")[1].split("\n\n\n@router")[0]
        self.assertNotIn("UPDATE finance.quotations", review_block)
        self.assertIn("UPDATE finance.boq_analysis_findings", review_block)

    def test_request_models_forbid_unknown_fields(self):
        request_block = ROUTER.split("class BoqAiAnalysisRequest")[1].split("class BoqAnalysisReviewRequest")[0]
        self.assertIn('extra="forbid"', request_block)

    def test_idempotency_check_precedes_a_fresh_analysis_run(self):
        run_endpoint = ROUTER.split("async def run_boq_ai_analysis")[1].split("\n\n\n@router")[0]
        self.assertIn("_find_cached_boq_analysis_run", run_endpoint)
        self.assertIn("force_refresh", run_endpoint)

    def test_event_emitted_on_run_completion(self):
        self.assertIn('event_type="estimate.boq_analysis.completed.v1"', ROUTER)
        self.assertIn("emit_event(", ROUTER)

    def test_all_four_endpoints_registered(self):
        self.assertIn('@router.post("/boq/ai-analysis")', ROUTER)
        self.assertIn('@router.get("/boq/ai-analysis/{run_id}")', ROUTER)
        self.assertIn('@router.get("/boq/ai-analysis")', ROUTER)
        self.assertIn('@router.patch("/boq/ai-analysis/findings/{finding_id}")', ROUTER)


class ConfigContractTests(unittest.TestCase):
    def test_perplexity_settings_are_optional_and_fail_closed(self):
        self.assertIn("PERPLEXITY_API_KEY: Optional[str] = None", CONFIG)
        self.assertIn('QUOTATION_AI_ANALYSIS_MODEL: str = "sonar-reasoning-pro"', CONFIG)


class FrontendContractTests(unittest.TestCase):
    def test_api_wrapper_functions_exist(self):
        self.assertIn("export async function runBoqAiAnalysis", WEB_API)
        self.assertIn("export async function getBoqAiAnalysisHistory", WEB_API)
        self.assertIn("export async function reviewBoqAiAnalysisFinding", WEB_API)

    def test_ccb_page_gets_the_new_tab_not_the_sandbox_page(self):
        self.assertIn('setActiveTab("boqAi")', CCB_PAGE)
        self.assertIn("AI BOQ Analysis", CCB_PAGE)
        self.assertIn("runBoqAiAnalysis", CCB_PAGE)
        self.assertIn("reviewBoqAiAnalysisFinding", CCB_PAGE)

    def test_boq_never_mutated_from_the_review_action(self):
        # The frontend handler must only ever call the review endpoint, never
        # attempt to edit BOQ line items as a side effect of a review decision.
        handler_block = CCB_PAGE.split("const handleReviewBoqAiFinding")[1].split("\n  const handle")[0]
        self.assertIn("reviewBoqAiAnalysisFinding(findingId, decision)", handler_block)


if __name__ == "__main__":
    unittest.main()
