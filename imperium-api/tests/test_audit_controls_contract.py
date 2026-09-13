from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (ROOT / "migrations" / "220_finance_audit_controls_permissions.sql").read_text(encoding="utf-8")
MIGRATION_183 = (ROOT / "migrations" / "183_finance_gl_permissions.sql").read_text(encoding="utf-8")
GENERAL_LEDGER_SERVICE = (ROOT / "app" / "services" / "finance" / "general_ledger.py").read_text(encoding="utf-8")
PACK_SERVICE = (ROOT / "app" / "services" / "finance" / "management_accounts_pack.py").read_text(encoding="utf-8")
PAYMENTS_ROUTER = (ROOT / "routers" / "payments.py").read_text(encoding="utf-8")
CLOSE_READINESS = (ROOT / "app" / "services" / "finance" / "close_readiness.py").read_text(encoding="utf-8")
AUDIT_CONTROLS_ROUTER = (ROOT / "routers" / "audit_controls.py").read_text(encoding="utf-8")
DOCUMENTS_ROUTER = (ROOT / "routers" / "documents.py").read_text(encoding="utf-8")
MAIN = (ROOT / "main.py").read_text(encoding="utf-8")


class MigrationContractTests(unittest.TestCase):
    def test_new_audit_read_permission_granted_to_the_right_tier(self):
        self.assertIn("'finance.audit.read'", MIGRATION)
        self.assertIn(
            "r.name IN ('SUPERADMIN', 'Finance Manager', 'Managing Director', 'Executive (Admin)', 'External Auditor', 'Internal Auditor')",
            MIGRATION,
        )

    def test_auditor_roles_granted_existing_gl_keys_additively(self):
        self.assertIn("'finance.gl.read', 'finance.coa.read', 'finance.period.read'", MIGRATION)
        self.assertIn("r.name IN ('External Auditor', 'Internal Auditor')", MIGRATION)

    def test_migration_183_original_grants_are_untouched(self):
        # Regression guard: this phase must never edit the original grants -
        # only migration 220 may add to them.
        self.assertIn("WHERE r.is_deleted = false AND r.name = 'SUPERADMIN'", MIGRATION_183)
        self.assertIn("WHERE r.is_deleted = false AND r.name = 'Finance Manager'", MIGRATION_183)
        self.assertIn(
            "WHERE r.is_deleted = false AND r.name IN ('Managing Director', 'Executive (Admin)')", MIGRATION_183
        )
        self.assertIn(
            "WHERE r.is_deleted = false AND r.name IN ('Project Manager', 'Quantity Surveyor')", MIGRATION_183
        )


class SegregationOfDutiesContractTests(unittest.TestCase):
    def test_post_journal_uses_shared_helper_not_a_reimplemented_comparison(self):
        fn_body = GENERAL_LEDGER_SERVICE.split("async def post_journal")[1].split("\n\n\nasync def reverse_journal")[0]
        self.assertIn("is_self_certification(user_id, journal[\"created_by\"])", fn_body)
        self.assertNotIn('user_id == journal["created_by"]', fn_body)

    def test_post_journal_check_scoped_to_manual_non_reversal_journals_only(self):
        fn_body = GENERAL_LEDGER_SERVICE.split("async def post_journal")[1].split("\n\n\nasync def reverse_journal")[0]
        self.assertIn('journal["origination"] == "manual"', fn_body)
        # Regression guard: reverse_journal() creates and posts its reversal
        # atomically in one authorized action - without this exclusion its
        # own internal post_journal call would be blocked by the very check
        # meant for routine manually-drafted journals (confirmed live).
        self.assertIn('journal["journal_type"] != "reversal"', fn_body)

    def test_approve_pack_checks_against_created_by(self):
        fn_body = PACK_SERVICE.split("async def approve_pack")[1].split("\n\n\nasync def lock_pack")[0]
        self.assertIn('is_self_certification(user_id, pack["created_by"])', fn_body)

    def test_lock_pack_checks_against_approved_by_not_created_by(self):
        fn_body = PACK_SERVICE.split("async def lock_pack")[1]
        self.assertIn('is_self_certification(user_id, pack["approved_by"])', fn_body)
        self.assertNotIn('is_self_certification(user_id, pack["created_by"])', fn_body)

    def test_payment_batch_approve_checks_created_by(self):
        fn_body = PAYMENTS_ROUTER.split("async def decide_payment_batch")[1].split("\n\n\n@router")[0]
        self.assertIn("created_by", fn_body.split("SELECT")[1].split("FROM")[0])
        self.assertIn('action == "approve" and is_self_certification(user_id, batch_row.created_by)', fn_body)

    def test_gl_bridge_approve_proposal_is_untouched(self):
        # No human "creator" exists to segregate against for a
        # system-proposed journal's approval step.
        gl_bridge = (ROOT / "app" / "services" / "finance" / "gl_bridge.py").read_text(encoding="utf-8")
        fn_body = gl_bridge.split("async def approve_proposal")[1].split("\n\n\nasync def")[0]
        self.assertNotIn("is_self_certification", fn_body)


class CloseReadinessContractTests(unittest.TestCase):
    def test_cash_advances_factor_always_incomplete(self):
        fn_body = CLOSE_READINESS.split("async def get_close_readiness")[1]
        self.assertIn('"truth_status": "INCOMPLETE"', fn_body)

    def test_cash_advances_excluded_from_the_composite(self):
        fn_body = CLOSE_READINESS.split("async def get_close_readiness")[1]
        readiness_calc = fn_body.split("readiness_level")[0]
        self.assertNotIn("advances_balance", readiness_calc.split("if unposted")[-1] if "if unposted" in readiness_calc else readiness_calc)
        self.assertIn("if unposted > 0 or unreconciled > 0:", fn_body)

    def test_response_always_includes_full_factor_breakdown_alongside_composite(self):
        fn_body = CLOSE_READINESS.split("async def get_close_readiness")[1]
        self.assertIn('return {"factors": factors, "readiness_level": readiness_level}', fn_body)

    def test_unposted_journal_count_reuses_the_draft_status_predicate(self):
        fn_body = CLOSE_READINESS.split("async def _count_unposted_journals")[1].split("\n\n\nasync def _count_unreconciled")[0]
        self.assertIn("status = 'draft'", fn_body)

    def test_source_resolver_covers_every_known_source_type(self):
        # cost_transaction..payroll_run come from gl_bridge.py's own known
        # vocabulary; journal_reversal is written by general_ledger.py's own
        # reverse_journal - found and added during live verification against
        # a real posted reversal journal in the dev DB.
        for source_type in (
            "cost_transaction", "progress_claim", "retention_release",
            "supplier_invoice_approval", "supplier_payment_batch", "payroll_run",
            "journal_reversal",
        ):
            self.assertIn(f'@_source_resolver("{source_type}")', CLOSE_READINESS)

    def test_resolve_journal_source_never_fabricates_for_an_unrecognized_type(self):
        fn_body = CLOSE_READINESS.split("async def resolve_journal_source")[1]
        self.assertIn("Unrecognized source type", fn_body)
        self.assertIn("no longer exists or is not visible", fn_body)


class AuditControlsRouterContractTests(unittest.TestCase):
    def test_both_endpoints_gated_by_the_new_audit_permission(self):
        self.assertEqual(AUDIT_CONTROLS_ROUTER.count('require_permission("finance.audit.read")'), 2)

    def test_drill_down_bundles_journal_history_and_source_without_duplicating_queries(self):
        fn_body = AUDIT_CONTROLS_ROUTER.split("async def get_journal_drill_down")[1]
        self.assertIn("gl.get_journal(", fn_body)
        self.assertIn("gl.get_audit_history(", fn_body)
        self.assertIn("close_readiness.resolve_journal_source(", fn_body)
        self.assertNotIn("SELECT", fn_body)

    def test_audit_history_helper_is_shared_not_duplicated(self):
        self.assertIn("_AUDIT_HISTORY_TABLE_ALLOW_LIST", GENERAL_LEDGER_SERVICE)
        self.assertIn("async def get_audit_history", GENERAL_LEDGER_SERVICE)

    def test_router_is_mounted(self):
        self.assertIn("from routers import audit_controls", MAIN)
        self.assertIn('app.include_router(audit_controls.router, prefix="/api/v1/finance/audit"', MAIN)


class DocumentEntityContractTests(unittest.TestCase):
    def test_journal_entry_registered_in_the_shared_entity_allow_list(self):
        entity_block = DOCUMENTS_ROUTER.split("_DOCUMENT_LINK_ENTITY_TABLES = {")[1].split("}")[0]
        self.assertIn('"journal_entry": "finance.journal_entries"', entity_block)
        # Every pre-existing entry must remain present (additive only).
        for existing in ("tender", "opportunity", "lead", "project", "supplier"):
            self.assertIn(f'"{existing}":', entity_block)


if __name__ == "__main__":
    unittest.main()
