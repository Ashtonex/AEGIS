from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MAPPINGS_MIGRATION = (ROOT / "migrations" / "184_finance_gl_bridge_mappings.sql").read_text(encoding="utf-8")
COLUMNS_MIGRATION = (ROOT / "migrations" / "185_finance_gl_bridge_journal_columns.sql").read_text(encoding="utf-8")
PERMISSIONS_MIGRATION = (ROOT / "migrations" / "186_finance_gl_bridge_permissions.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "gl_bridge.py").read_text(encoding="utf-8")
# The module docstring legitimately explains, in prose, why commitments and
# variations are NOT bridged - strip it before asserting the absence of
# those table names from actual code, so the explanation doesn't trip the
# regression guard it documents.
SERVICE_CODE_ONLY = SERVICE.split('"""', 2)[-1]
ROUTER = (ROOT / "routers" / "gl_bridge.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")
FINANCIAL_PERFORMANCE_ROUTER = (ROOT / "routers" / "financial_performance.py").read_text(encoding="utf-8")
FINAL_ACCOUNTS_ROUTER = (ROOT / "routers" / "final_accounts.py").read_text(encoding="utf-8")


class GlBridgeSchemaContractTests(unittest.TestCase):
    def test_mappings_table_is_additive_with_rls(self):
        self.assertIn("CREATE TABLE IF NOT EXISTS finance.gl_account_mappings", MAPPINGS_MIGRATION)
        self.assertIn("ALTER TABLE finance.gl_account_mappings ENABLE ROW LEVEL SECURITY", MAPPINGS_MIGRATION)
        self.assertIn("ALTER TABLE finance.gl_account_mappings FORCE ROW LEVEL SECURITY", MAPPINGS_MIGRATION)
        self.assertNotIn("ALTER TABLE finance.cost_transactions", MAPPINGS_MIGRATION)
        self.assertNotIn("ALTER TABLE finance.progress_claims", MAPPINGS_MIGRATION)
        self.assertNotIn("ALTER TABLE finance.retention_ledger", MAPPINGS_MIGRATION)

    def test_default_mappings_seed_every_cost_category_and_claim_key(self):
        for key in [
            "cost_category.labour", "cost_category.equipment", "cost_category.materials",
            "cost_category.subcontract", "cost_category.overhead", "cost_category.other",
            "cost_transaction.credit_control", "progress_claim.receivable",
            "progress_claim.retention_receivable", "progress_claim.revenue",
        ]:
            self.assertIn(f"'{key}'", MAPPINGS_MIGRATION)

    def test_journal_origin_columns_extend_phase_1_gl_tables_only(self):
        self.assertIn("ALTER TABLE finance.journal_entries", COLUMNS_MIGRATION)
        self.assertIn(
            "ADD COLUMN IF NOT EXISTS origination VARCHAR(20) NOT NULL DEFAULT 'manual'",
            COLUMNS_MIGRATION,
        )
        self.assertIn("CHECK (origination IN ('manual', 'system_proposed'))", COLUMNS_MIGRATION)
        self.assertIn(
            "CHECK (proposal_status IN ('pending_review', 'approved', 'rejected'))",
            COLUMNS_MIGRATION,
        )
        # Only ever touches the GL's own Phase-1 table, never a pre-existing
        # operational table.
        self.assertNotIn("finance.cost_transactions", COLUMNS_MIGRATION)
        self.assertNotIn("finance.progress_claims", COLUMNS_MIGRATION)
        self.assertNotIn("finance.retention_ledger", COLUMNS_MIGRATION)

    def test_permissions_granted_in_same_migration_that_defines_them(self):
        for key in [
            "finance.gl_bridge.read", "finance.gl_bridge.propose", "finance.gl_bridge.approve",
            "finance.gl_bridge.reject", "finance.gl_bridge.configure",
        ]:
            self.assertIn(f"'{key}'", PERMISSIONS_MIGRATION)
        self.assertGreaterEqual(PERMISSIONS_MIGRATION.count("INSERT INTO core.role_permissions"), 4)
        self.assertIn("r.name = 'SUPERADMIN'", PERMISSIONS_MIGRATION)
        self.assertIn("r.name = 'Finance Manager'", PERMISSIONS_MIGRATION)

    def test_review_actions_are_not_granted_to_read_only_roles(self):
        pm_qs_block = PERMISSIONS_MIGRATION.split("'Project Manager', 'Quantity Surveyor'")[0].split(
            "INSERT INTO core.role_permissions"
        )[-1]
        self.assertIn("finance.gl_bridge.read", pm_qs_block)
        for write_key in ("finance.gl_bridge.propose", "finance.gl_bridge.approve", "finance.gl_bridge.reject", "finance.gl_bridge.configure"):
            self.assertNotIn(write_key, pm_qs_block)


class GlBridgeServiceContractTests(unittest.TestCase):
    def test_commitments_and_variations_are_never_bridged_to_the_gl(self):
        """Regression guard for the deliberate encumbrance-accounting design
        decision: a PO commitment or an approved variation is exposure/a
        budget-ceiling change, not a realized transaction - bridging either
        into the GL would double-count once the real cost or claim posts."""
        self.assertNotIn("finance.commitments", SERVICE_CODE_ONLY)
        self.assertNotIn("finance.variations", SERVICE_CODE_ONLY)

    def test_statutory_liabilities_are_not_touched_by_the_bridge(self):
        # VAT/statutory bridging is explicitly Phase 8 - Phase 2 must not
        # reach into the parallel statutory shadow ledger.
        self.assertNotIn("statutory_liabilities", SERVICE)
        self.assertNotIn("accrue_liability_line", SERVICE)

    def test_project_forecast_is_read_only_reference_not_a_cutover(self):
        self.assertIn("from app.services.finance.project_forecast import compute_project_financials", SERVICE)
        # The bridge must never write back into project_forecasts - it only
        # reads compute_project_financials for the reconciliation comparison.
        self.assertNotIn("INSERT INTO finance.project_forecasts", SERVICE)
        self.assertNotIn("UPDATE finance.project_forecasts", SERVICE)

    def test_cost_transaction_proposal_uses_configured_mapping_not_hardcoded_accounts(self):
        self.assertIn('f"cost_category.{txn[\'cost_category\']}"', SERVICE)
        self.assertIn('"cost_transaction.credit_control"', SERVICE)

    def test_progress_claim_retention_math_matches_certified_amount_times_retention_pct(self):
        # Phase 8A: retention applies to revenue_base (the VAT-exclusive
        # certified amount), not the raw VAT-inclusive total owed - the two
        # are identical whenever a claim has no VAT (revenue_base ==
        # certified_amount when vat_amount == 0), so this is still the same
        # formula for every claim that predates VAT support.
        self.assertIn('Decimal(str(revenue_base)) * Decimal(str(claim["retention_pct"])) / Decimal("100")', SERVICE)
        self.assertIn("receivable_portion = round(total_owed - retention_portion, 2)", SERVICE)

    def test_retention_release_reclassifies_from_retention_receivable_to_receivable(self):
        self.assertIn("propose_journal_for_retention_release", SERVICE)
        self.assertIn("movement_type = 'released'", SERVICE)

    def test_idempotency_dedup_check_mirrors_department_transfers_pattern(self):
        # Same "check before insert, skip if a system-proposed journal
        # already references this source" idempotency shape used by
        # app/services/finance/department_transfers.py's post_department_transfer.
        self.assertIn("_already_proposed", SERVICE)
        self.assertIn("origination = 'system_proposed'", SERVICE)

    def test_rejection_never_deletes_the_journal(self):
        self.assertIn("proposal_status = 'rejected'", SERVICE)
        self.assertNotIn("DELETE FROM finance.journal_entries", SERVICE)

    def test_approval_reuses_existing_post_journal_not_a_duplicate_posting_path(self):
        self.assertIn("general_ledger.post_journal", SERVICE)


class GlBridgeIntegrationHookContractTests(unittest.TestCase):
    def test_certify_progress_claim_proposes_but_never_blocks_on_gl_interpretation_failure(self):
        self.assertIn("gl_bridge.propose_journal_for_progress_claim", FINANCIAL_PERFORMANCE_ROUTER)
        # The additive call must be wrapped so a GeneralLedgerError becomes a
        # warning field, never an exception that aborts certification.
        certify_fn = FINANCIAL_PERFORMANCE_ROUTER.split("async def certify_progress_claim")[1].split("\n@router")[0]
        self.assertIn("except GeneralLedgerError as exc:", certify_fn)
        self.assertIn("gl_proposal_warning", certify_fn)
        self.assertIn("await db.commit()", certify_fn)

    def test_final_account_close_out_proposes_retention_release_without_blocking(self):
        self.assertIn("gl_bridge.propose_journal_for_retention_release", FINAL_ACCOUNTS_ROUTER)
        self.assertIn("except GeneralLedgerError as exc:", FINAL_ACCOUNTS_ROUTER)
        self.assertIn("gl_proposal_warning", FINAL_ACCOUNTS_ROUTER)

    def test_cost_transaction_writers_are_untouched(self):
        # Phase 2 deliberately does NOT hook any of the 7 existing
        # cost_transactions writers - on-demand/bulk sync only this phase.
        for router_file in ("site_reports.py", "fleet.py", "procurement.py", "projects.py"):
            content = (ROOT / "routers" / router_file).read_text(encoding="utf-8")
            self.assertNotIn("gl_bridge.propose_journal_for_cost_transaction", content)


class GlBridgeRouterContractTests(unittest.TestCase):
    def test_router_exposes_full_bridge_surface(self):
        for route in [
            '@router.get("/mappings")',
            '@router.patch("/mappings/{mapping_key}")',
            '@router.get("/proposals")',
            '@router.post("/cost-transactions/{cost_transaction_id}/propose"',
            '@router.post("/projects/{project_id}/sync")',
            '@router.post("/proposals/{journal_id}/approve")',
            '@router.post("/proposals/{journal_id}/reject")',
            '@router.get("/projects/{project_id}/ledger")',
            '@router.get("/projects/{project_id}/reconciliation")',
        ]:
            self.assertIn(route, ROUTER)

    def test_review_actions_use_dedicated_permission_keys(self):
        expectations = {
            '@router.post("/proposals/{journal_id}/approve")': 'require_permission("finance.gl_bridge.approve")',
            '@router.post("/proposals/{journal_id}/reject")': 'require_permission("finance.gl_bridge.reject")',
            '@router.patch("/mappings/{mapping_key}")': 'require_permission("finance.gl_bridge.configure")',
        }
        for route_decorator, expected_permission in expectations.items():
            index = ROUTER.index(route_decorator)
            self.assertIn(expected_permission, ROUTER[index:index + 400])

    def test_gl_bridge_router_is_mounted(self):
        self.assertIn("from routers import gl_bridge", MAIN)
        self.assertIn(
            'app.include_router(gl_bridge.router, prefix="/api/v1/finance/gl/bridge"',
            MAIN,
        )


if __name__ == "__main__":
    unittest.main()
