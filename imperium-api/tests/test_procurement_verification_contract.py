from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BANK_MIGRATION = (ROOT / "migrations" / "188_procurement_supplier_bank_details.sql").read_text(encoding="utf-8")
LINE_LINK_MIGRATION = (ROOT / "migrations" / "189_procurement_invoice_line_po_link.sql").read_text(encoding="utf-8")
FINDINGS_MIGRATION = (ROOT / "migrations" / "190_procurement_verification_findings.sql").read_text(encoding="utf-8")
MAPPINGS_MIGRATION = (ROOT / "migrations" / "191_procurement_gl_bridge_mappings.sql").read_text(encoding="utf-8")
SERVICE = (ROOT / "app" / "services" / "finance" / "procurement_verification.py").read_text(encoding="utf-8")
SERVICE_CODE_ONLY = SERVICE.split('"""', 2)[-1]
GL_BRIDGE_SERVICE = (ROOT / "app" / "services" / "finance" / "gl_bridge.py").read_text(encoding="utf-8")
PROCUREMENT_ROUTER = (ROOT / "routers" / "procurement.py").read_text(encoding="utf-8")
PAYMENTS_ROUTER = (ROOT / "routers" / "payments.py").read_text(encoding="utf-8")
SUPPLIER_RECORDS_ROUTER = (ROOT / "routers" / "supplier_records.py").read_text(encoding="utf-8")


class Phase3ASchemaContractTests(unittest.TestCase):
    def test_supplier_bank_columns_are_additive_and_nullable(self):
        self.assertIn("ALTER TABLE procurement.suppliers", BANK_MIGRATION)
        for column in ("bank_name", "bank_account_number", "bank_branch_code", "bank_updated_at", "bank_updated_by"):
            self.assertIn(f"ADD COLUMN IF NOT EXISTS {column}", BANK_MIGRATION)
        # No NOT NULL/DEFAULT - every existing supplier row is unaffected.
        self.assertNotIn("NOT NULL", BANK_MIGRATION)

    def test_invoice_line_po_link_is_additive(self):
        self.assertIn("ALTER TABLE procurement.supplier_invoice_lines", LINE_LINK_MIGRATION)
        self.assertIn("ADD COLUMN IF NOT EXISTS po_line_id UUID REFERENCES procurement.purchase_order_lines(id)", LINE_LINK_MIGRATION)

    def test_check_type_widening_preserves_all_prior_values(self):
        # Must include the original 3 values from migration 113 AND the 4th
        # value added since by unrelated parallel work (187) - a widening,
        # never a narrowing or rename.
        for prior_value in ("budget_boq_overrun", "requisition_budget_breach", "variance_stale_approval", "weekly_boq_pace_variance"):
            self.assertIn(f"'{prior_value}'", FINDINGS_MIGRATION)
        for new_value in (
            "invoice_line_price_variance", "invoice_line_quantity_variance", "invoice_missing_po_or_grn",
            "duplicate_invoice_suspected", "invoice_unapproved_supplier", "supplier_bank_changed",
        ):
            self.assertIn(f"'{new_value}'", FINDINGS_MIGRATION)
        self.assertIn("DROP CONSTRAINT IF EXISTS ccb_monitor_findings_check_type_check", FINDINGS_MIGRATION)
        self.assertIn("ADD CONSTRAINT ccb_monitor_findings_check_type_check", FINDINGS_MIGRATION)

    def test_gl_bridge_mappings_seed_the_two_new_keys(self):
        self.assertIn("'supplier_invoice.accounts_payable'", MAPPINGS_MIGRATION)
        self.assertIn("'supplier_payment.cash_account'", MAPPINGS_MIGRATION)
        self.assertIn("'2000'", MAPPINGS_MIGRATION)
        self.assertIn("'1000'", MAPPINGS_MIGRATION)


class Phase3AVerificationServiceContractTests(unittest.TestCase):
    def test_commitments_and_variations_are_never_touched(self):
        self.assertNotIn("finance.commitments", SERVICE_CODE_ONLY)
        self.assertNotIn("finance.variations", SERVICE_CODE_ONLY)

    def test_every_check_function_is_wrapped_non_blocking(self):
        for fn_name in ("check_invoice_at_creation", "check_line_level_match", "check_supplier_bank_changed"):
            fn_body = SERVICE.split(f"async def {fn_name}")[1].split("\nasync def ")[0]
            self.assertIn("try:", fn_body)
            self.assertIn("except Exception:", fn_body)

    def test_line_level_match_requires_po_line_id_join(self):
        # Regression guard: must never fabricate a finding when no lines are
        # linked to a PO line - the JOIN itself is what makes that the case.
        fn_body = SERVICE.split("async def check_line_level_match")[1].split("\nasync def ")[0]
        self.assertIn("JOIN procurement.purchase_order_lines pol ON pol.id = sil.po_line_id", fn_body)
        self.assertIn("sil.po_line_id IS NOT NULL", fn_body)

    def test_bank_changed_check_compares_against_po_issued_at(self):
        fn_body = SERVICE.split("async def check_supplier_bank_changed")[1].split("\nasync def ")[0]
        self.assertIn("bank_updated_at", fn_body)
        self.assertIn("issued_at", fn_body)
        self.assertIn('bank_updated_at"] > inv["issued_at"]', fn_body)

    def test_finding_upsert_uses_natural_key_dedup_same_shape_as_ccb_monitor(self):
        self.assertIn("ON CONFLICT (organization_id, natural_key) DO UPDATE SET", SERVICE)


class Phase3AGlBridgeExtensionContractTests(unittest.TestCase):
    def test_supplier_invoice_approval_journal_reclassifies_accrual_to_payable(self):
        fn_body = GL_BRIDGE_SERVICE.split("async def propose_journal_for_supplier_invoice_approval")[1].split("\nasync def ")[0]
        self.assertIn('"cost_transaction.credit_control"', fn_body)
        self.assertIn('"supplier_invoice.accounts_payable"', fn_body)
        self.assertIn("status = 'approved'", fn_body)

    def test_supplier_payment_journal_clears_payable_against_cash(self):
        fn_body = GL_BRIDGE_SERVICE.split("async def propose_journal_for_supplier_payment")[1].split("\nasync def ")[0]
        self.assertIn('"supplier_invoice.accounts_payable"', fn_body)
        self.assertIn('"supplier_payment.cash_account"', fn_body)
        self.assertIn("status = 'posted'", fn_body)

    def test_both_new_functions_reuse_create_journal_not_a_duplicate_posting_path(self):
        for fn_name in ("propose_journal_for_supplier_invoice_approval", "propose_journal_for_supplier_payment"):
            fn_body = GL_BRIDGE_SERVICE.split(f"async def {fn_name}")[1].split("\nasync def ")[0]
            self.assertIn("general_ledger.create_journal", fn_body)
            self.assertIn("_already_proposed", fn_body)


class Phase3AIntegrationHookContractTests(unittest.TestCase):
    def test_create_invoice_calls_verification_checks_non_blocking(self):
        fn_body = PROCUREMENT_ROUTER.split("async def create_invoice")[1].split("\n@router")[0]
        self.assertIn("procurement_verification.check_invoice_at_creation", fn_body)
        self.assertIn("procurement_verification.check_line_level_match", fn_body)

    def test_payment_decision_hooks_bank_check_and_gl_proposal_only_on_approval(self):
        fn_body = PROCUREMENT_ROUTER.split("async def payment_decision")[1].split("\n@router")[0]
        self.assertIn('if status_value == "approved":', fn_body)
        self.assertIn("procurement_verification.check_supplier_bank_changed", fn_body)
        self.assertIn("gl_bridge.propose_journal_for_supplier_invoice_approval", fn_body)
        self.assertIn("except GeneralLedgerError as exc:", fn_body)
        self.assertIn("gl_proposal_warning", fn_body)

    def test_payment_batch_post_action_proposes_cash_clearing_journal(self):
        self.assertIn("gl_bridge.propose_journal_for_supplier_payment", PAYMENTS_ROUTER)
        self.assertIn('if action == "post":', PAYMENTS_ROUTER)
        self.assertIn("except GeneralLedgerError as exc:", PAYMENTS_ROUTER)

    def test_match_invoice_header_logic_is_untouched(self):
        # Regression guard for the "additive only" decision: the existing
        # header-amount match_status computation must not be touched by
        # this phase - the new checks are advisory flags alongside it.
        match_fn = PROCUREMENT_ROUTER.split("async def match_invoice")[1].split("\n@router")[0]
        self.assertNotIn("procurement_verification", match_fn)
        self.assertIn("matched_amount = min(", match_fn)

    def test_supplier_bank_edit_is_stamped_with_actor_and_timestamp(self):
        self.assertIn("SUPPLIER_BANK_COLUMNS", SUPPLIER_RECORDS_ROUTER)
        self.assertIn("bank_updated_at", SUPPLIER_RECORDS_ROUTER)
        self.assertIn("bank_updated_by", SUPPLIER_RECORDS_ROUTER)
        for column in ("bank_name", "bank_account_number", "bank_branch_code"):
            self.assertIn(f'"{column}"', SUPPLIER_RECORDS_ROUTER)


if __name__ == "__main__":
    unittest.main()
