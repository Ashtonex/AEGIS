from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_211 = (ROOT / "migrations" / "211_finance_historical_evidence_quality.sql").read_text(encoding="utf-8")
MIGRATION_212 = (ROOT / "migrations" / "212_finance_historical_project_flag.sql").read_text(encoding="utf-8")
MIGRATION_213 = (ROOT / "migrations" / "213_finance_historical_reconciliation_baselines.sql").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
DOCUMENTS_ROUTER = (ROOT / "routers" / "documents.py").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_evidence_quality_added_nullable_to_both_tables(self):
        self.assertIn("ALTER TABLE finance.progress_claims", MIGRATION_211)
        self.assertIn("ALTER TABLE finance.cost_transactions", MIGRATION_211)
        self.assertEqual(MIGRATION_211.count("CHECK (evidence_quality IN ('A', 'B', 'C', 'D', 'E'))"), 2)
        self.assertNotIn("NOT NULL", MIGRATION_211)

    def test_is_historical_flag_is_nullable_safe(self):
        self.assertIn("ADD COLUMN IF NOT EXISTS is_historical BOOLEAN NOT NULL DEFAULT false", MIGRATION_212)

    def test_baselines_table_unique_per_project_and_category(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.historical_reconciliation_baselines", MIGRATION_213)
        self.assertIn("CHECK (category IN ('revenue', 'cost'))", MIGRATION_213)
        self.assertIn("UNIQUE (organization_id, project_id, category)", MIGRATION_213)

    def test_read_permission_granted_in_same_migration(self):
        self.assertIn("'finance.historical_entry.read'", MIGRATION_213)
        self.assertIn("'Managing Director'", MIGRATION_213)


class HistoricalEntryModelContractTests(unittest.TestCase):
    def test_evidence_quality_required_on_both_models(self):
        revenue_model = ROUTER.split("class HistoricalRevenueCreate")[1].split("class HistoricalCostActivityCreate")[0]
        activity_model = ROUTER.split("class HistoricalCostActivityCreate")[1].split("@router.post")[0]
        for model_body in (revenue_model, activity_model):
            self.assertIn('evidence_quality: str = Field(pattern=r"^[A-E]$")', model_body)
            self.assertIn("document_id: Optional[UUID] = None", model_body)


class HistoricalProjectContractTests(unittest.TestCase):
    def test_create_historical_project_sets_is_historical_true(self):
        fn_body = ROUTER.split("async def create_historical_project")[1].split("\n\n\n@router")[0]
        self.assertIn("is_historical", fn_body)
        self.assertIn(":name, 'active', :project_code, :project_type,\n                :client_name, :start_date, :client_org_id, :department_id, true", fn_body)


class HistoricalRevenueGlBridgeContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return ROUTER.split("async def create_historical_revenue")[1].split("\n\n\n@router.post(\"/historical/cost-activities\"")[0]

    def test_gl_bridge_call_is_now_present(self):
        # Regression guard for the Phase 9 bug fix: historical revenue used
        # to never reach the GL bridge at all.
        fn_body = self._fn_body()
        self.assertIn("gl_bridge.propose_journal_for_progress_claim(db, org_id=org_id, user_id=user[\"user_id\"], claim_id=claim_id)", fn_body)

    def test_gl_bridge_call_is_non_blocking(self):
        fn_body = self._fn_body()
        self.assertIn("except GeneralLedgerError as exc:", fn_body)
        self.assertIn("gl_proposal_warning", fn_body)

    def test_gl_bridge_call_happens_before_status_flips_to_paid(self):
        # propose_journal_for_progress_claim requires status='certified'.
        fn_body = self._fn_body()
        propose_idx = fn_body.index("gl_bridge.propose_journal_for_progress_claim")
        paid_idx = fn_body.index("SET status = 'paid'")
        self.assertLess(propose_idx, paid_idx)

    def test_stores_evidence_quality_and_optional_document_link(self):
        fn_body = self._fn_body()
        self.assertIn(":evidence_quality", fn_body)
        self.assertIn("_link_historical_evidence_document", fn_body)
        self.assertIn('entity_type="historical_revenue"', fn_body)


class HistoricalCostActivityContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return ROUTER.split("async def create_historical_cost_activity")[1].split("\n\n\nclass HistoricalReconciliationBaselineSet")[0]

    def test_stores_evidence_quality_and_optional_document_link(self):
        fn_body = self._fn_body()
        self.assertIn(":evidence_quality", fn_body)
        self.assertIn("_link_historical_evidence_document", fn_body)
        self.assertIn('entity_type="historical_cost_activity"', fn_body)

    def test_never_gains_an_auto_propose_gl_call(self):
        # Regression guard for design decision 3: historical cost activities
        # stay on-demand-bridge-only, exactly like every other cost_transactions
        # writer since Phase 2 - never auto-proposed inline.
        fn_body = self._fn_body()
        self.assertNotIn("propose_journal_for_cost_transaction", fn_body)
        self.assertNotIn("gl_bridge.propose", fn_body)


class DocumentLinkHelperContractTests(unittest.TestCase):
    def test_helper_bypasses_shared_allow_list_matching_established_precedent(self):
        fn_body = ROUTER.split("async def _link_historical_evidence_document")[1].split("\n\n\n@router")[0]
        self.assertIn("INSERT INTO core.document_links", fn_body)
        self.assertIn("link_role", fn_body)
        # Must not touch the generic /documents allow-list.
        self.assertNotIn("_DOCUMENT_LINK_ENTITY_TABLES", fn_body)

    def test_shared_allow_list_is_untouched(self):
        self.assertNotIn("historical_revenue", DOCUMENTS_ROUTER)
        self.assertNotIn("historical_cost_activity", DOCUMENTS_ROUTER)


class ReconciliationEndpointContractTests(unittest.TestCase):
    def _fn_body(self) -> str:
        return ROUTER.split("async def get_historical_reconciliation")[1].split("\n\n\n@router.get(\"/progress-claims\")")[0]

    def test_endpoint_exists_with_read_permission(self):
        self.assertIn('@router.get("/historical/reconciliation")', ROUTER)
        self.assertIn('require_permission("finance.historical_entry.read")', self._fn_body())

    def test_only_queries_is_historical_projects(self):
        fn_body = self._fn_body()
        self.assertIn("is_historical = true", fn_body)

    def test_variance_is_none_not_zero_when_no_baseline(self):
        fn_body = self._fn_body()
        self.assertIn("if expected_revenue is not None else None", fn_body)
        self.assertIn("if expected_cost is not None else None", fn_body)

    def test_mappings_rows_are_not_double_wrapped_with_mapping_attribute(self):
        # Regression guard for a real bug found during live verification:
        # a row from .mappings() is already a RowMapping - calling
        # dict(r._mapping) on it raises AttributeError (only plain Row
        # objects from .execute() have a ._mapping attribute).
        fn_body = self._fn_body()
        self.assertNotIn("dict(r._mapping) for r in revenue_rows.mappings()", fn_body)
        self.assertNotIn("dict(r._mapping) for r in cost_rows.mappings()", fn_body)
        self.assertIn("dict(r) for r in revenue_rows.mappings()", fn_body)
        self.assertIn("dict(r) for r in cost_rows.mappings()", fn_body)

    def test_baseline_upsert_scoped_to_historical_projects_only(self):
        set_fn_body = ROUTER.split("async def set_historical_reconciliation_baseline")[1].split("\n\n\n@router.get(\"/historical/reconciliation\")")[0]
        self.assertIn("is_historical = true", set_fn_body)
        self.assertIn("ON CONFLICT (organization_id, project_id, category) DO UPDATE", set_fn_body)


if __name__ == "__main__":
    unittest.main()
