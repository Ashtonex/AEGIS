from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_217 = (ROOT / "migrations" / "217_finance_management_accounts_packs.sql").read_text(encoding="utf-8")
MIGRATION_218 = (ROOT / "migrations" / "218_finance_management_accounts_permissions.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "management_accounts_pack.py").read_text(encoding="utf-8")
ROUTER = (ROOT / "routers" / "management_accounts.py").read_text(encoding="utf-8")
RENDERERS = (ROOT / "app" / "services" / "documents" / "renderers.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_table_has_the_four_lifecycle_statuses(self):
        create_stmt = MIGRATION_217.split("CREATE TABLE IF NOT EXISTS finance.management_accounts_packs (")[1].split(");")[0]
        self.assertIn("CHECK (status IN ('draft', 'reviewed', 'approved', 'locked'))", create_stmt)

    def test_has_five_jsonb_snapshot_columns(self):
        create_stmt = MIGRATION_217.split("CREATE TABLE IF NOT EXISTS finance.management_accounts_packs (")[1].split(");")[0]
        for col in ("income_statement", "balance_sheet", "cash_movement", "ar_aging", "ap_aging"):
            self.assertIn(col, create_stmt)
        self.assertEqual(create_stmt.count("JSONB"), 5)

    def test_one_pack_per_exact_period_per_org(self):
        self.assertIn("management_accounts_packs_org_period_idx", MIGRATION_217)
        self.assertIn("UNIQUE INDEX", MIGRATION_217)

    def test_permissions_tiered_correctly(self):
        for key in ("finance.pack.read", "finance.pack.manage", "finance.pack.reopen", "finance.pack.lock", "finance.portfolio.read"):
            self.assertIn(f"'{key}'", MIGRATION_218)
        self.assertIn("r.name = 'SUPERADMIN'", MIGRATION_218)
        self.assertIn("r.name = 'Finance Manager'", MIGRATION_218)
        self.assertIn("r.name IN ('Managing Director', 'Executive (Admin)')", MIGRATION_218)
        self.assertIn("r.name IN ('Commercial Manager', 'Contracts Manager')", MIGRATION_218)

    def test_finance_manager_never_granted_lock_or_reopen(self):
        finance_manager_block = MIGRATION_218.split("r.name = 'Finance Manager'")[0].split("SELECT r.organization_id")[-1]
        self.assertNotIn("finance.pack.lock", finance_manager_block)
        self.assertNotIn("finance.pack.reopen", finance_manager_block)


class LifecycleContractTests(unittest.TestCase):
    def _fn_body(self, fn_name: str, next_marker: str) -> str:
        return SERVICE.split(f"async def {fn_name}")[1].split(next_marker)[0]

    def test_recompute_only_allowed_while_draft(self):
        fn_body = self._fn_body("recompute_pack", "\n\nasync def submit_for_review")
        self.assertIn('pack["status"] != "draft"', fn_body)

    def test_submit_for_review_requires_draft(self):
        fn_body = self._fn_body("submit_for_review", "\n\nasync def approve_pack")
        self.assertIn('pack["status"] != "draft"', fn_body)

    def test_approve_requires_reviewed(self):
        fn_body = self._fn_body("approve_pack", "\n\nasync def lock_pack")
        self.assertIn('pack["status"] != "reviewed"', fn_body)

    def test_lock_requires_approved(self):
        fn_body = self._fn_body("lock_pack", "\n\nasync def reopen_pack")
        self.assertIn('pack["status"] != "approved"', fn_body)

    def test_reopen_requires_non_blank_reason_and_approved_or_locked(self):
        fn_body = self._fn_body("reopen_pack", "\n\nasync def list_packs")
        self.assertIn("if not reason or not reason.strip():", fn_body)
        self.assertIn('pack["status"] not in ("approved", "locked")', fn_body)

    def test_reopen_returns_status_to_draft(self):
        fn_body = self._fn_body("reopen_pack", "\n\nasync def list_packs")
        self.assertIn("status = 'draft'", fn_body)

    def test_create_pack_computes_snapshot_from_phase_11a_functions(self):
        fn_body = self._fn_body("create_pack", "\n\nasync def recompute_pack")
        self.assertIn("_compute_snapshot", fn_body)
        compute_fn = SERVICE.split("async def _compute_snapshot")[1].split("\n\nasync def _get_pack")[0]
        for fn_name in ("get_income_statement", "get_balance_sheet", "get_cash_movement_statement", "get_ar_aging", "get_ap_aging"):
            self.assertIn(fn_name, compute_fn)


class PdfRendererContractTests(unittest.TestCase):
    def test_renderer_class_exists(self):
        self.assertIn("class ManagementAccountsPackPDFRenderer(DocumentRenderer):", RENDERERS)

    def test_renderer_never_issues_a_db_query(self):
        fn_body = RENDERERS.split("class ManagementAccountsPackPDFRenderer(DocumentRenderer):")[1]
        # Regression guard: the renderer must only read the `data` dict
        # passed to it (the pack's frozen snapshot) - never query live data.
        self.assertNotIn("await db", fn_body)
        self.assertNotIn("SELECT", fn_body)


class RouterContractTests(unittest.TestCase):
    def test_each_lifecycle_action_gated_by_its_own_permission(self):
        expectations = {
            "create_pack": "finance.pack.manage",
            "recompute_pack": "finance.pack.manage",
            "submit_for_review": "finance.pack.manage",
            "approve_pack": "finance.pack.manage",
            "lock_pack": "finance.pack.lock",
            "reopen_pack": "finance.pack.reopen",
            "get_portfolio": "finance.portfolio.read",
        }
        for fn_name, perm in expectations.items():
            fn_body = ROUTER.split(f"async def {fn_name}")[1].split("\n\n\n@router")[0]
            self.assertIn(f'require_permission("{perm}")', fn_body)

    def test_write_endpoints_rollback_on_error(self):
        for fn_name in ("create_pack", "recompute_pack", "submit_for_review", "approve_pack", "lock_pack", "reopen_pack"):
            fn_body = ROUTER.split(f"async def {fn_name}")[1].split("\n\n\n@router")[0]
            self.assertIn("await db.rollback()", fn_body)

    def test_export_pdf_renders_from_the_stored_pack_only(self):
        fn_body = ROUTER.split("async def export_pack_pdf")[1]
        self.assertIn("packs.get_pack", fn_body)
        self.assertIn("ManagementAccountsPackPDFRenderer", fn_body)

    def test_router_is_mounted(self):
        self.assertIn("from routers import management_accounts", MAIN)
        self.assertIn(
            'app.include_router(management_accounts.router, prefix="/api/v1/finance/management-accounts"', MAIN
        )


if __name__ == "__main__":
    unittest.main()
