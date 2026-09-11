from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUDGETS_MIGRATION = (ROOT / "migrations" / "195_finance_company_budgets.sql").read_text(encoding="utf-8")
LINES_MIGRATION = (ROOT / "migrations" / "196_finance_company_budget_lines.sql").read_text(encoding="utf-8")
PERMISSIONS_MIGRATION = (ROOT / "migrations" / "197_finance_company_budget_permissions.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "company_budget.py").read_text(encoding="utf-8")
# The module docstring legitimately explains, in prose, the deliberate
# separation from project_budgets/project_forecasts - strip it before
# asserting those tables are never touched by the actual code.
SERVICE_CODE_ONLY = SERVICE.split('"""', 2)[-1]
ROUTER = (ROOT / "routers" / "company_budgets.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class Phase5ASchemaContractTests(unittest.TestCase):
    def test_company_budgets_table_uses_master_spec_status_vocabulary(self):
        for status in ("draft", "submitted", "under_review", "approved_baseline", "revision", "superseded", "frozen", "cancelled"):
            self.assertIn(f"'{status}'", BUDGETS_MIGRATION)

    def test_sole_baseline_per_fiscal_year_enforced_at_db_level(self):
        self.assertIn("CREATE UNIQUE INDEX IF NOT EXISTS company_budgets_single_baseline", BUDGETS_MIGRATION)
        self.assertIn("WHERE status = 'approved_baseline' AND is_deleted = false", BUDGETS_MIGRATION)

    def test_project_budgets_and_project_forecasts_are_never_touched(self):
        for migration in (BUDGETS_MIGRATION, LINES_MIGRATION, PERMISSIONS_MIGRATION):
            self.assertNotIn("ALTER TABLE finance.project_budgets", migration)
            self.assertNotIn("ALTER TABLE finance.project_forecasts", migration)

    def test_budget_lines_support_both_revenue_and_cost_with_correct_vocabularies(self):
        self.assertIn("CHECK (line_type IN ('revenue', 'cost'))", LINES_MIGRATION)
        for category in ("labour", "equipment", "materials", "subcontract", "overhead", "other"):
            self.assertIn(f"'{category}'", LINES_MIGRATION)
        for category in ("contract_revenue", "other_income"):
            self.assertIn(f"'{category}'", LINES_MIGRATION)

    def test_budget_lines_are_month_bucketed(self):
        self.assertIn("period_month", LINES_MIGRATION)
        self.assertIn("DATE NOT NULL", LINES_MIGRATION)
        self.assertIn("CHECK (period_month = date_trunc('month', period_month)::date)", LINES_MIGRATION)

    def test_permissions_granted_in_same_migration_with_correct_tiering(self):
        for key in (
            "finance.company_budget.read", "finance.company_budget.manage", "finance.company_budget.approve",
            "finance.company_budget.freeze", "finance.company_budget.reopen",
        ):
            self.assertIn(f"'{key}'", PERMISSIONS_MIGRATION)
        # Read-only roles must never receive manage/approve/freeze/reopen.
        pm_qs_block = PERMISSIONS_MIGRATION.split("Project Manager', 'Quantity Surveyor")[0].split("INSERT INTO core.role_permissions")[-1]
        for write_key in ("finance.company_budget.manage", "finance.company_budget.approve", "finance.company_budget.freeze", "finance.company_budget.reopen"):
            self.assertNotIn(write_key, pm_qs_block)


class Phase5AServiceContractTests(unittest.TestCase):
    def test_transitions_table_never_allows_skipping_states(self):
        # draft cannot jump straight to approved_baseline or frozen - must
        # pass through submitted -> under_review -> (approve_budget).
        self.assertIn('"submit": {"from": ("draft", "revision"), "to": "submitted"}', SERVICE)
        self.assertIn('"start_review": {"from": ("submitted",), "to": "under_review"}', SERVICE)
        self.assertIn('"freeze": {"from": ("approved_baseline",), "to": "frozen"}', SERVICE)

    def test_approve_only_allowed_from_under_review(self):
        fn_body = SERVICE.split("async def approve_budget")[1].split("\nasync def ")[0]
        self.assertIn('if budget["status"] != "under_review":', fn_body)

    def test_approve_atomically_supersedes_prior_baseline_in_same_transaction(self):
        fn_body = SERVICE.split("async def approve_budget")[1].split("\nasync def ")[0]
        self.assertIn("revises_budget_id", fn_body)
        self.assertIn("status = 'superseded'", fn_body)
        # No separate commit between the supersede and the new approval -
        # both statements execute on the same db handle before the caller commits.
        self.assertNotIn("await db.commit()", fn_body)

    def test_reopen_requires_a_reason_and_only_from_frozen(self):
        fn_body = SERVICE.split("async def reopen_budget")[1].split("\nasync def ")[0]
        self.assertIn("A reason is required to reopen", fn_body)
        self.assertIn('if budget["status"] != "frozen":', fn_body)

    def test_reject_requires_a_reason(self):
        fn_body = SERVICE.split("async def reject_budget")[1].split("\nasync def ")[0]
        self.assertIn("A reason is required to reject", fn_body)

    def test_replace_lines_only_allowed_while_draft_or_revision(self):
        fn_body = SERVICE.split("async def replace_budget_lines")[1].split("\nasync def ")[0]
        self.assertIn('if budget["status"] not in ("draft", "revision"):', fn_body)

    def test_create_revision_only_allowed_from_approved_baseline_and_copies_lines(self):
        fn_body = SERVICE.split("async def create_revision")[1].split("\nasync def ")[0]
        self.assertIn('if source["status"] != "approved_baseline":', fn_body)
        self.assertIn("INSERT INTO finance.company_budget_lines", fn_body)
        self.assertIn("SELECT organization_id, :new_id, department_id, line_type, category, period_month, amount, notes, :user_id", fn_body)

    def test_variance_never_fabricates_a_comparison_without_a_baseline(self):
        fn_body = SERVICE.split("async def _get_variance")[1].split("\nasync def ")[0]
        self.assertIn('"no_baseline_budget": True', fn_body)
        self.assertIn('"budget_revenue": None, "actual_revenue": row["revenue"], "revenue_variance": None', fn_body)

    def test_project_budgets_and_project_forecasts_never_queried(self):
        # A code comment explaining the design precedent (mirrors the
        # project_budgets supersede pattern) is fine and expected - this
        # guards against actually reading/writing those tables in SQL.
        self.assertNotIn("FROM finance.project_budgets", SERVICE_CODE_ONLY)
        self.assertNotIn("INTO finance.project_budgets", SERVICE_CODE_ONLY)
        self.assertNotIn("UPDATE finance.project_budgets", SERVICE_CODE_ONLY)
        self.assertNotIn("finance.project_forecasts", SERVICE_CODE_ONLY)

    def test_no_gl_posting_of_any_kind(self):
        self.assertNotIn("journal_entries", SERVICE_CODE_ONLY)
        self.assertNotIn("journal_lines", SERVICE_CODE_ONLY)


class Phase5ARouterContractTests(unittest.TestCase):
    def test_workflow_actions_use_dedicated_permission_tiers(self):
        expectations = {
            '@router.post("/{budget_id}/submit")': 'require_permission("finance.company_budget.manage")',
            '@router.post("/{budget_id}/approve")': 'require_permission("finance.company_budget.approve")',
            '@router.post("/{budget_id}/freeze")': 'require_permission("finance.company_budget.freeze")',
            '@router.post("/{budget_id}/reopen")': 'require_permission("finance.company_budget.reopen")',
        }
        for route_decorator, expected_permission in expectations.items():
            index = ROUTER.index(route_decorator)
            self.assertIn(expected_permission, ROUTER[index:index + 400])

    def test_router_is_mounted(self):
        self.assertIn("from routers import company_budgets", MAIN)
        self.assertIn('app.include_router(company_budgets.router, prefix="/api/v1/finance/company-budgets"', MAIN)

    def test_variance_endpoints_exist(self):
        self.assertIn('@router.get("/variance/company")', ROUTER)
        self.assertIn('@router.get("/variance/department/{department_id}")', ROUTER)


if __name__ == "__main__":
    unittest.main()
